/**
 * Panal — la wallet del teléfono, hablando el idioma de wagmi.
 *
 * POR QUÉ EXISTE
 *
 * Toda la app firma a través de wagmi: `useWriteContract` para encargar y
 * cobrar, `useWalletClient` para el permit de x402, `useSignMessage` para
 * traerse una entrega. Con una sola forma de conectarse —WalletConnect— cada
 * una de esas firmas obliga a salir a otra aplicación, aprobar y volver. Para
 * un mensaje de chat que cuesta unos céntimos, eso es más trabajo que el
 * mensaje.
 *
 * Un conector propio arregla eso sin tocar una sola pantalla: wagmi no
 * pregunta de dónde sale la firma. Las mismas quince pantallas siguen igual y
 * la clave que firma es la que ya está en el teléfono.
 *
 * ES UN PROVEEDOR EIP-1193, NO UNA WALLET
 *
 * Lo que wagmi pide de un conector es un objeto con `request({method, params})`
 * —el mismo que inyecta una extensión en el navegador—. Aquí lo contesta viem
 * con la cuenta local: las firmas se hacen dentro, y todo lo que no sea firmar
 * se reenvía al nodo tal cual. Sin relé, sin sesión, sin salir de la app.
 *
 * LO QUE NO HACE, Y HAY QUE SABERLO
 *
 * No enseña nada antes de firmar. Una wallet de fuera abre su pantalla y te
 * deja leer lo que vas a aprobar; aquí esa pantalla es la de Panal. Por eso
 * cada acción que cuesta dinero pasa por una hoja que dice qué se firma, y por
 * eso el llavero se abre con el PIN una vez por sesión y no se queda abierto
 * de un día para otro.
 */

import { createConnector } from 'wagmi';
import { SwitchChainError, UserRejectedRequestError, createWalletClient, http, numberToHex } from 'viem';
import type { Address, Hex, TypedDataDefinition } from 'viem';
import { activeChain, publicClient } from '@/contracts/config';
import { cerrarSesion, cuentaViva } from '~/lib/sesion';
import { textos } from '~/i18n/idiomas';

export const ID_LLAVERO = 'panal-llavero';

/** Lo que llega en `eth_sendTransaction`, en crudo: todo cadenas hexadecimales. */
interface TxCruda {
  to?: Address;
  data?: Hex;
  value?: Hex;
  gas?: Hex;
  nonce?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
}

const aBigInt = (v: Hex | undefined): bigint | undefined => (v === undefined ? undefined : BigInt(v));

function exigirCuenta() {
  const cuenta = cuentaViva();
  if (!cuenta) {
    // Es lo que le pasa a wagmi cuando alguien cierra la wallet sin aprobar, y
    // es lo que corresponde: el llavero cerrado no es un fallo de la app.
    throw new UserRejectedRequestError(new Error(textos().comun.llaveroCerrado));
  }
  return cuenta;
}

/**
 * El proveedor.
 *
 * El `default` reenvía al nodo en vez de fallar: wagmi y viem piden por aquí
 * cosas que no son firmas —estimar gas, leer el recibo, mirar un bloque— y una
 * wallet inyectada las contestaría igual, hablando con su propio nodo.
 */
function proveedor() {
  return {
    async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts': {
          const cuenta = cuentaViva();
          return cuenta ? [cuenta.address] : [];
        }

        case 'eth_chainId':
          return numberToHex(activeChain.id);

        case 'personal_sign': {
          const cuenta = exigirCuenta();
          // El orden es [mensaje, dirección], al revés que en signTypedData.
          const [datos] = params as [Hex, Address];
          return cuenta.signMessage!({ message: { raw: datos } });
        }

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4': {
          const cuenta = exigirCuenta();
          const [, sinAbrir] = params as [Address, string | TypedDataDefinition];
          const tipado = (
            typeof sinAbrir === 'string' ? JSON.parse(sinAbrir) : sinAbrir
          ) as TypedDataDefinition;
          return cuenta.signTypedData!(tipado);
        }

        case 'eth_sendTransaction': {
          const cuenta = exigirCuenta();
          const [t] = params as [TxCruda];
          const cliente = createWalletClient({
            account: cuenta,
            chain: activeChain,
            transport: http(activeChain.rpcUrls.default.http[0]),
          });
          return cliente.sendTransaction({
            to: t.to,
            data: t.data,
            value: aBigInt(t.value),
            gas: aBigInt(t.gas),
            nonce: t.nonce === undefined ? undefined : Number(BigInt(t.nonce)),
            gasPrice: aBigInt(t.gasPrice),
            maxFeePerGas: aBigInt(t.maxFeePerGas),
            maxPriorityFeePerGas: aBigInt(t.maxPriorityFeePerGas),
          } as Parameters<typeof cliente.sendTransaction>[0]);
        }

        case 'wallet_switchEthereumChain': {
          const [{ chainId }] = params as [{ chainId: Hex }];
          if (Number(BigInt(chainId)) === activeChain.id) return null;
          // Esta wallet vive en una sola red a propósito: la clave es la misma
          // en todas, pero Panal solo existe aquí, y ofrecer un cambio de red
          // que no lleva a ninguna parte solo sirve para perder dinero.
          throw new SwitchChainError(new Error(`Esta wallet solo usa ${activeChain.name}.`));
        }

        default:
          return publicClient.request({ method, params } as never);
      }
    },
    on(): void {},
    removeListener(): void {},
  };
}

export const PROVEEDOR = proveedor();
export type ProveedorLlavero = typeof PROVEEDOR;

/**
 * El conector.
 *
 * `isAuthorized` devuelve `false` con el llavero cerrado, y de ahí sale el
 * comportamiento correcto al reabrir la app: wagmi no reconecta solo, la
 * pantalla vuelve a ofrecer conectar, y hay que poner el PIN. Es lo que debe
 * pasar — la alternativa sería una app que firma sola en cuanto se abre.
 */
export function conectorLlavero() {
  return createConnector<ProveedorLlavero>((config) => ({
    id: ID_LLAVERO,
    name: textos().comun.walletDelTelefono,
    type: 'llavero',

    async connect() {
      const cuenta = exigirCuenta();
      // El `as never` no tapa nada: wagmi tipa `accounts` según un genérico
      // `withCapabilities` (EIP-5792) que este conector no anuncia, y no hay
      // forma de satisfacer las dos ramas del condicional desde aquí.
      return { accounts: [cuenta.address], chainId: activeChain.id } as never;
    },

    async disconnect() {
      cerrarSesion();
    },

    async getAccounts() {
      const cuenta = cuentaViva();
      return (cuenta ? [cuenta.address] : []) as readonly Address[];
    },

    async getChainId() {
      return activeChain.id;
    },

    async getProvider() {
      return PROVEEDOR;
    },

    async isAuthorized() {
      return cuentaViva() !== null;
    },

    async switchChain({ chainId }) {
      const red = config.chains.find((c) => c.id === chainId);
      if (!red || chainId !== activeChain.id)
        throw new SwitchChainError(new Error(`Esta wallet solo usa ${activeChain.name}.`));
      return red;
    },

    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}
