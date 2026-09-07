/**
 * Cambia lo que este agente cobra por encargo, en el registro de Panal.
 *
 *   npx tsx scripts/precio.ts 1          enseña lo que haría, no firma nada
 *   npx tsx scripts/precio.ts 1 --va     lo hace
 *
 * El importe va en unidades enteras de MON («1», «0.5»), no en wei.
 *
 * POR QUÉ UN SCRIPT Y NO EL PANEL DE LA WEB
 *
 * `updatePrice` está restringida a la PROPIA dirección del agente
 * —`onlyAgentOwner(msg.sender)` compara `_agents[msg.sender].owner` con
 * `msg.sender`—, así que no basta con ser el dueño desde otra wallet: firma la
 * clave del bot o no firma nadie. Y esa clave vive en el `.env` de la máquina
 * del bot, no en una cartera de móvil.
 *
 * LO QUE ESTE SCRIPT NO TOCA, A PROPÓSITO
 *
 * El `metadataURI`. Un agente puede vender por tamaños, y esos niveles viven
 * DENTRO de la ficha como tokens `nivel:<precio>|<nombre>|…`. Reescribir la
 * ficha desde aquí los borraría, que es exactamente lo que hace el
 * `updateMetadata` del SDK sin avisar: `formatAgentMetadata` no los emite.
 *
 * Este bot no tiene niveles, así que cambiar el precio es una transacción y ya.
 * Si algún día se le ponen, hay que mover TAMBIÉN el más barato para que valga
 * exactamente esto: quien contrata desde un cliente que no sabe de niveles
 * bloquea el precio del registro, y si el nivel más barato costara más, el
 * agente le rechazaría el encargo con el dinero ya bloqueado y habría que
 * esperar al plazo para recuperarlo.
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, formatEther, getAddress, http, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, NATIVE_CURRENCY, registryAbi } from '../src/chain.js';

const RPC_URL = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
const REGISTRY = getAddress(process.env.REGISTRY_ADDRESS?.trim() || '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51');

function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

const args = process.argv.slice(2);
const VA = args.includes('--va');
const importe = args.find((a) => !a.startsWith('--'));
if (!importe) salir('Falta el precio.  Uso: npx tsx scripts/precio.ts 1 [--va]');
// Se valida el texto y no el número que sale de él: `parseEther('abc')` no
// lanza en todas las versiones, y publicar un precio de 0 por un dedazo es
// regalar el trabajo a quien pase.
if (!/^\d{1,12}(\.\d{1,18})?$/.test(importe)) salir(`«${importe}» no es un importe. Van unidades enteras de MON: 1, 0.5, 2.25.`);
const NUEVO = parseEther(importe);
if (NUEVO === 0n) salir('Un precio de 0 deja el trabajo gratis. Si es lo que quieres, ponlo desde otro sitio.');

const clave = process.env.BOT_PRIVATE_KEY?.trim();
if (!clave || !/^0x[0-9a-fA-F]{64}$/.test(clave)) salir('Falta BOT_PRIVATE_KEY en el .env (0x + 64 hex).');
const account = privateKeyToAccount(clave as `0x${string}`);

const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });

const ficha = await publicClient.readContract({
  address: REGISTRY,
  abi: registryAbi,
  functionName: 'getAgent',
  args: [account.address],
});

if (ficha.registeredAt === 0n) salir(`${account.address} no está registrado en ${REGISTRY}. No hay precio que cambiar.`);

// Si la ficha lleva niveles, el más barato manda: cambiar solo el registro los
// dejaría descuadrados y el agente rechazaría a quien pague el precio nuevo.
const niveles = ficha.metadataURI.split('·').filter((s) => s.trim().toLowerCase().startsWith('nivel:'));
if (niveles.length > 0) {
  salir(
    `Este agente vende por tamaños (${niveles.length} niveles) y este script solo cambia el precio del registro.\n` +
      'Cambiar uno sin el otro deja la ficha descuadrada. Hay que reescribir el `metadataURI`\n' +
      'entero conservando nombres y topes, y poner el nivel más barato a este mismo importe.',
  );
}

const moneda = ficha.currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase() ? 'MON' : ficha.currency;
console.log(`agente   ${account.address}`);
console.log(`saldo    ${formatEther(await publicClient.getBalance({ address: account.address }))} MON`);
console.log(`antes    ${formatEther(ficha.pricePerTask)} ${moneda}`);
console.log(`después  ${formatEther(NUEVO)} MON`);

// Contra el estado real antes de firmar: si fuera a revertir —por la clave
// equivocada, sobre todo— se ve aquí y no después de haber pagado el gas.
const { request } = await publicClient.simulateContract({
  address: REGISTRY,
  abi: registryAbi,
  functionName: 'updatePrice',
  args: [NUEVO, NATIVE_CURRENCY as Address],
  account: account.address,
});

if (!VA) {
  console.log('\nSimulada y correcta. Repite con --va para firmarla.');
  process.exit(0);
}

const wallet = createWalletClient({ account, chain: monad, transport: http(RPC_URL) });
const hash = await wallet.writeContract(request);
await publicClient.waitForTransactionReceipt({ hash });
console.log(`\nhecho    ${hash}`);
console.log('El bot no hace falta reiniciarlo: el precio lo lee del registro, no de su código.');
