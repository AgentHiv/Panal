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
 *
 * Y por eso no firma CUALQUIER cosa que le llegue: antes de tocar la clave,
 * `lib/signingPolicy.ts` mira que sea una operación de Panal, y las que mueven
 * dinero hacia otro —encargar, pagar un mensaje— que coincidan con lo que la
 * hoja acaba de confirmar.
 */

import { createConnector } from 'wagmi';
import { SwitchChainError, UserRejectedRequestError, createWalletClient, http, numberToHex } from 'viem';
import type { Address, Hex, TypedDataDefinition } from 'viem';
import { activeChain, publicClient } from '@/contracts/config';
import { alCambiarDeWallet, cerrarSesion, cuentaViva } from '~/lib/sesion';
import { olvidarPermisos, revisarMensaje, revisarTipado, revisarTransaccion } from '~/lib/signingPolicy';
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
 * El gas con el que firma la wallet del teléfono: `eth_estimateGas` + 10 %.
 *
 * Monad cobra el límite de gas ENTERO, no el gastado. Si no se fija, viem lo
 * rellena con `eth_fillTransaction`, y el nodo de Monad a veces devuelve un
 * límite absurdo: así se perdió una retirada de 1,092 MON entera en gas. Con
 * una wallet de fuera no pasa —estima ella—, pero aquí la wallet es esta.
 *
 * Si quien llama ya trae un gas —una retirada lo calcula con su tope—, se
 * respeta mientras no pase del doble de lo estimado. Y si la estimación falla,
 * es que la transacción revertiría: se para aquí en vez de pagar el intento.
 */
async function gasFijado(de: Address, t: TxCruda, propuesto?: bigint): Promise<bigint> {
  const estimado = await publicClient.estimateGas({
    account: de,
    to: t.to,
    data: t.data,
    value: aBigInt(t.value),
  });
  const justo = (estimado * 11n + 9n) / 10n;
  if (propuesto !== undefined && propuesto <= justo * 2n) return propuesto;
  return justo;
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
          revisarMensaje(datos);
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
          revisarTipado(tipado, cuenta.address);
          return cuenta.signTypedData!(tipado);
        }

        case 'eth_sendTransaction': {
          const cuenta = exigirCuenta();
          const [t] = params as [TxCruda];
          revisarTransaccion({ to: t.to, data: t.data, value: aBigInt(t.value) });
          const gas = await gasFijado(cuenta.address, t, aBigInt(t.gas));
          const cliente = createWalletClient({
            account: cuenta,
            chain: activeChain,
            transport: http(activeChain.rpcUrls.default.http[0]),
          });
          return cliente.sendTransaction({
            to: t.to,
            data: t.data,
            value: aBigInt(t.value),
            gas,
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
 *
 * Y ESCUCHA LOS CAMBIOS DE WALLET, que es lo que faltaba.
 *
 * wagmi pregunta las cuentas UNA vez, al conectar, y a partir de ahí trabaja
 * con lo que guardó. Una extensión del navegador resuelve esto emitiendo
 * `accountsChanged` cuando cambias de cuenta; este conector no emitía nada, así
 * que elegir otra wallet del llavero descifraba su clave —y firmaba con ella—
 * mientras `useAccount()` seguía devolviendo la dirección anterior. La app
 * entera se quedaba mirando una wallet y pagando con otra.
 *
 * El aviso entra por `alCambiarDeWallet` y sale por `emitter.emit('change')`,
 * que es lo mismo que wagmi usa por dentro para eso. Se engancha al conectar y
 * se suelta al desconectar: cada `connect` con una función crea un conector
 * nuevo, y sin soltarlo quedaría un oyente vivo por cada uno.
 */
export function conectorLlavero() {
  return createConnector<ProveedorLlavero>((config) => {
    /** Cómo soltar el oyente de cambios. `null` mientras no hay ninguno. */
    let soltar: (() => void) | null = null;

    return {
      id: ID_LLAVERO,
      name: textos().comun.walletDelTelefono,
      type: 'llavero',

      async connect() {
        const cuenta = exigirCuenta();
        soltar?.();
        soltar = alCambiarDeWallet((direccion) => {
          config.emitter.emit('change', { accounts: [direccion], chainId: activeChain.id });
        });
        // El `as never` no tapa nada: wagmi tipa `accounts` según un genérico
        // `withCapabilities` (EIP-5792) que este conector no anuncia, y no hay
        // forma de satisfacer las dos ramas del condicional desde aquí.
        return { accounts: [cuenta.address], chainId: activeChain.id } as never;
      },

      async disconnect() {
        soltar?.();
        soltar = null;
        olvidarPermisos();
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
    };
  });
}
