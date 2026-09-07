/**
 * Cambia lo que este agente cobra por encargo, en el registro de Panal.
 *
 *   npx tsx scripts/precio.ts 1              enseña lo que haría, no firma nada
 *   npx tsx scripts/precio.ts 1 --va         lo hace
 *   npx tsx scripts/precio.ts 1 --firmar     firma y NO envía: imprime la transacción
 *   npx tsx scripts/precio.ts --emitir 0x…   envía una transacción ya firmada
 *
 * El importe va en unidades enteras de MON («1», «0.5»), no en wei.
 *
 * PARA QUÉ SIRVE FIRMAR SIN ENVIAR
 *
 * Porque una máquina puede poder firmar y no poder enviar. Le pasa a la del bot
 * con `rpc.monad.xyz`: las lecturas le funcionan —y son todo lo que hace falta
 * para el nonce, las fees y el gas— pero el `eth_sendRawTransaction` le vuelve
 * con «this request method is not supported», mientras que desde otra IP el
 * mismo endpoint lo acepta sin rechistar.
 *
 * Con `--firmar` la clave se queda donde está y solo sale la transacción ya
 * firmada, que se emite desde donde sí se pueda con `--emitir`. Ese texto no
 * revela nada de la clave y solo puede hacer una cosa: esa, una vez, con ese
 * nonce. Si alguien lo copia, lo único que consigue es pagarte el gas.
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
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monad, NATIVE_CURRENCY, registryAbi } from '../src/chain.js';

const RPC_URL = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
const REGISTRY = getAddress(process.env.REGISTRY_ADDRESS?.trim() || '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51');

function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

/**
 * La frase corta de un error de viem, no su volcado.
 *
 * `shortMessage` es lo único que dice algo —«execution reverted», «HTTP request
 * failed»—; el resto es la petición JSON-RPC entera repetida dos veces. Sin
 * esto, cualquier fallo aquí sale como un muro que termina en «Node.js v24» y
 * quien lo ejecuta se queda sin saber qué pasó.
 */
function mensajeDe(err: unknown): string {
  const partes: string[] = [];
  if (typeof err === 'object' && err !== null) {
    const e = err as { shortMessage?: unknown; details?: unknown; cause?: unknown };
    if (typeof e.shortMessage === 'string' && e.shortMessage) partes.push(e.shortMessage);
    // `details` es donde va lo que dijo el NODO. Sin esto, un rechazo de
    // `eth_sendRawTransaction` sale como «RPC Request failed.» y punto, que no
    // distingue un saldo corto de un nonce repetido de un método capado.
    if (typeof e.details === 'string' && e.details && !partes.includes(e.details)) partes.push(e.details);
    if (!partes.length && e.cause) return mensajeDe(e.cause);
  }
  if (partes.length) return partes.join(' — ');
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

// Nada de volcados en crudo: lo que no se haya previsto sale como una línea
// legible y con el código de salida que toca.
process.on('unhandledRejection', (err) => salir(`\nFalló: ${mensajeDe(err)}`));
process.on('uncaughtException', (err) => salir(`\nFalló: ${mensajeDe(err)}`));

const args = process.argv.slice(2);
const VA = args.includes('--va');
const FIRMAR = args.includes('--firmar');

/** Emite una transacción ya firmada y espera el recibo. No necesita la clave. */
async function emitir(crudo: Hex): Promise<never> {
  const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL, { timeout: 20_000 }) });
  console.log(`rpc      ${RPC_URL}`);
  const hash = await publicClient
    .sendRawTransaction({ serializedTransaction: crudo })
    .catch((err: unknown) => salir(`\nNo se pudo emitir: ${mensajeDe(err)}`));
  console.log(`enviada  ${hash}`);
  const recibo = await publicClient.waitForTransactionReceipt({ hash });
  if (recibo.status !== 'success') salir(`\nEntró pero revirtió: ${hash}`);
  console.log(`hecho    ${hash}`);
  process.exit(0);
}

// Va antes que todo lo demás: emitir no necesita ni clave ni importe, solo el
// texto de la transacción y un RPC que acepte enviarla.
const iEmitir = args.indexOf('--emitir');
if (iEmitir !== -1) {
  const crudo = args[iEmitir + 1];
  if (!crudo || !/^0x[0-9a-fA-F]+$/.test(crudo)) salir('Tras --emitir va la transacción firmada (0x…), la que imprime --firmar.');
  await emitir(crudo as Hex);
}

const importe = args.find((a) => !a.startsWith('--'));
if (!importe) salir('Falta el precio.  Uso: npx tsx scripts/precio.ts 1 [--va | --firmar]');
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

// Lo primero que se imprime, antes de cualquier cosa que pueda fallar: con qué
// dirección se va a firmar y contra qué. Sin esto, un fallo más abajo deja al
// que lo ejecuta sin saber siquiera si la clave era la que creía.
console.log(`agente   ${account.address}`);
console.log(`registro ${REGISTRY}`);
console.log(`rpc      ${RPC_URL}`);

const ficha = await publicClient
  .readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getAgent', args: [account.address] })
  .catch((err: unknown) => salir(`\nNo he podido leer el registro: ${mensajeDe(err)}\nSi es cosa del RPC, prueba con RPC_URL=https://rpc.monad.xyz por delante del comando.`));

if (ficha.registeredAt === 0n) salir(`${account.address} no está registrado en ${REGISTRY}. No hay precio que cambiar.`);

// El contrato exige que el agente sea su propio dueño. Se avisa aquí, con la
// dirección delante, en vez de dejar que reviente la simulación con un
// «execution reverted» que no dice de quién es la culpa.
if (ficha.owner.toLowerCase() !== account.address.toLowerCase()) {
  salir(
    `\nEsta clave no puede cambiar ese precio: el dueño de ${account.address} es ${ficha.owner}.\n` +
      '`updatePrice` está restringida a la propia dirección del agente, así que tiene que firmar ella.',
  );
}

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

const saldo = await publicClient.getBalance({ address: account.address });
const moneda = ficha.currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase() ? 'MON' : ficha.currency;
console.log(`saldo    ${formatEther(saldo)} MON`);
console.log(`antes    ${formatEther(ficha.pricePerTask)} ${moneda}`);
console.log(`después  ${formatEther(NUEVO)} MON`);
if (saldo === 0n) salir('\nSin MON no se paga el gas. Manda un poco a esa dirección.');

// Contra el estado real antes de firmar: si fuera a revertir se ve aquí y no
// después de haber pagado el gas.
const { request } = await publicClient
  .simulateContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: 'updatePrice',
    args: [NUEVO, NATIVE_CURRENCY as Address],
    account: account.address,
  })
  .catch((err: unknown) => salir(`\nLa simulación falla, así que no firmo nada: ${mensajeDe(err)}`));

if (FIRMAR) {
  // Se firma con lo que ya se sabe, sin pedirle al nodo que la mande. El nonce,
  // las fees y el gas salen de lecturas, que es justo lo que esta máquina sí
  // puede hacer.
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: 'updatePrice',
    args: [NUEVO, NATIVE_CURRENCY as Address],
  });
  const preparada = await publicClient
    .prepareTransactionRequest({ account, to: REGISTRY, data, chain: monad })
    .catch((err: unknown) => salir(`\nNo he podido preparar la transacción: ${mensajeDe(err)}`));
  const crudo = await account.signTransaction({
    ...preparada,
    chainId: monad.id,
    to: REGISTRY,
    data,
  } as Parameters<typeof account.signTransaction>[0]);

  console.log(`\nnonce    ${preparada.nonce}`);
  console.log('\nFirmada y SIN ENVIAR. El precio no ha cambiado todavía.');
  console.log('Emítela desde una máquina cuyo RPC acepte enviar:\n');
  console.log(crudo);
  console.log(`\n  npx tsx scripts/precio.ts --emitir ${crudo.slice(0, 12)}…`);
  console.log('\nEse texto no dice nada de tu clave y solo sirve para esto una vez:');
  console.log(`va atada al nonce ${preparada.nonce} de ${account.address}.`);
  process.exit(0);
}

if (!VA) {
  console.log('\nSimulada y correcta, pero EL PRECIO NO HA CAMBIADO: esto solo era el ensayo.');
  console.log('Para cambiarlo de verdad, el mismo comando con --va al final.');
  console.log('Y si esta máquina no puede enviar, --firmar en vez de --va.');
  process.exit(0);
}

const wallet = createWalletClient({ account, chain: monad, transport: http(RPC_URL, { timeout: 20_000 }) });

/**
 * Manda la transacción, y si el nodo la rechaza lo reintenta UNA vez pagando
 * un pelín más de propina.
 *
 * No es un reintento por si acaso: Monad devuelve el rechazo CACHEADO cuando le
 * llega dos veces el mismo payload. Firmar lo mismo con el mismo nonce y las
 * mismas fees da bytes idénticos —ECDSA es determinista—, así que el nodo
 * repite su respuesta anterior sin volver a mirar nada. Eso convierte un fallo
 * puntual en un fallo permanente que no se arregla reintentando a mano, que es
 * exactamente como se ve desde fuera: falla siempre igual.
 *
 * Subir la propina cambia los bytes sin tocar el nonce, y con eso el nodo lo
 * vuelve a evaluar de verdad.
 */
async function enviar(): Promise<`0x${string}`> {
  try {
    return await wallet.writeContract(request);
  } catch (err) {
    console.error(`\nEl primer envío falló: ${mensajeDe(err)}`);
    const fees = await publicClient.estimateFeesPerGas();
    const propina = ((fees.maxPriorityFeePerGas ?? 1_000_000_000n) * 125n) / 100n;
    const tope = (fees.maxFeePerGas ?? 150_000_000_000n) + propina;
    console.error(`Reintento una vez con más propina (${propina} wei) para que no sea el mismo payload.`);
    return wallet
      .writeContract({ ...request, maxPriorityFeePerGas: propina, maxFeePerGas: tope })
      .catch((err2: unknown) => salir(`\nTampoco con más propina: ${mensajeDe(err2)}`));
  }
}

const hash = await enviar();
const recibo = await publicClient.waitForTransactionReceipt({ hash });
if (recibo.status !== 'success') salir(`\nLa transacción entró pero revirtió: ${hash}`);

// Se relee de la cadena en vez de dar por bueno el recibo: es la única prueba
// de que lo que quedó publicado es lo que se quería publicar.
const despues = await publicClient.readContract({
  address: REGISTRY, abi: registryAbi, functionName: 'getAgent', args: [account.address],
});
console.log(`\nhecho    ${hash}`);
console.log(`ahora    ${formatEther(despues.pricePerTask)} MON  (releído de la cadena)`);
console.log('El bot no hace falta reiniciarlo: el precio lo lee del registro, no de su código.');
