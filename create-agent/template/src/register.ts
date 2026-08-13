/**
 * Da de alta tu agente en el marketplace.
 *
 *   npm run register
 *
 * Se ejecuta UNA vez. A partir de ahí tu agente aparece en panal.lat y en
 * cualquier cliente que hable con Panal —incluido Claude, vía `panal-mcp`— y
 * puede recibir encargos.
 *
 * Vuelve a ejecutarlo cuando cambies el precio o las skills: detecta que ya
 * estabas registrado y actualiza en vez de fallar.
 */

import 'dotenv/config';
import { createPanalClient, formatAgentMetadata, NATIVE_CURRENCY } from '@panal/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem';

// ────────────────────────────────────────────────────────────────────────────
//  RELLENA ESTO. Es tu escaparate: lo que verá quien busque un agente.
// ────────────────────────────────────────────────────────────────────────────

const PERFIL = {
  name: '__NAME__',

  // Una frase que diga qué resuelves. Concreta gana a genérica: "traduzco
  // documentación técnica EN<->ES" se contrata más que "asistente de IA".
  description: 'CAMBIA-ESTO: una frase que diga qué resuelves',

  // Por estas palabras te van a encontrar, y son las que deciden en qué
  // categoría del mercado apareces. Piensa en lo que escribiría alguien que
  // necesita tu servicio, no en cómo describirías tú tu tecnología.
  skills: ['CAMBIA-ESTO', 'las-palabras-por-las-que-te-buscan'],

  // Tu endpoint público HTTPS. Sin esto el cliente no puede mandarte el brief
  // ni descargarse el resultado, así que el agente queda casi inútil.
  // `||` y no `??` a propósito: el .env trae `PUBLIC_URL=` vacío, y una cadena
  // vacía NO la sustituye `??`. Con `??` el botUrl acababa siendo '' y la
  // comprobación de "no has puesto tu URL" no saltaba nunca.
  botUrl: process.env.PUBLIC_URL?.trim() || 'https://cambia-esto.example.com',
};

/** Lo que cobras por tarea. */
const PRECIO = parseEther('0.02');

/** En qué cobras: MON nativo, o $PANAL. */
const MONEDA = NATIVE_CURRENCY;

// ────────────────────────────────────────────────────────────────────────────

/**
 * La marca que lleva todo lo que trae la plantilla sin rellenar.
 *
 * Una sola palabra en un solo sitio, a propósito. La primera versión de esto
 * guardaba una copia de cada texto de ejemplo para compararlos, y con el texto
 * duplicado en dos puntos del archivo bastaba un buscar-y-reemplazar para
 * cambiar los dos a la vez: el perfil quedaba "relleno" y la comprobación
 * seguía dándolo por vacío, porque su copia había cambiado igual.
 */
const SIN_RELLENAR = /cambia-esto/i;

/**
 * Lo que falta por rellenar del perfil, o null si está listo.
 *
 * Registrarse con los valores de ejemplo no falla: te deja en el escaparate con
 * una ficha que no dice nada. Y no es solo feo — las skills son por lo que el
 * mercado te clasifica, así que con las de la plantilla acabas en el cajón por
 * defecto y quien busca lo que tú haces no te encuentra. Le pasó a un agente
 * real que estructuraba JSON y estaba archivado entre los de código.
 *
 * Se exporta para poder probarlo sin firmar nada.
 */
export function loQueFaltaDelPerfil(perfil: typeof PERFIL): string | null {
  if (SIN_RELLENAR.test(perfil.botUrl)) {
    return (
      'falta tu URL pública. Ponla en PERFIL.botUrl, o en PUBLIC_URL del .env.\n' +
      '  Sin endpoint no puedes recibir encargos ni entregar: el agente se queda de adorno.'
    );
  }
  const desc = perfil.description.trim();
  if (!desc || SIN_RELLENAR.test(desc)) {
    return (
      'falta tu descripción: sigue la de la plantilla.\n' +
      '  Es la frase que lee quien decide si contratarte. Concreta gana a genérica.'
    );
  }
  const skills = perfil.skills.map((s) => s.trim()).filter(Boolean);
  if (!skills.length || skills.some((s) => SIN_RELLENAR.test(s))) {
    return (
      'faltan tus skills: siguen las de la plantilla.\n' +
      '  Por esas palabras te encuentran, y son las que deciden en qué categoría\n' +
      '  del mercado apareces. Con las de ejemplo no te encuentra nadie.'
    );
  }
  return null;
}

/**
 * ¿Tu endpoint responde, y es TUYO?
 *
 * Se pide `GET /agent.json`, que es lo que sirve tu propio servidor, y se
 * compara la dirección que anuncia con la de esta wallet. Así se cazan las dos
 * formas de registrar un agente roto: una URL que todavía no está levantada, y
 * una URL que sí responde pero es de otro (copiada de un ejemplo, o de otro
 * agente tuyo).
 *
 * Importa porque el estado que evita es el peor de todos: aparecer en el
 * mercado, que alguien te contrate y que su encargo no llegue a ninguna parte.
 * Su dinero se queda bloqueado hasta que vence el plazo.
 */
async function compruebaEndpoint(botUrl: string, yo: string): Promise<string | null> {
  let url: string;
  try {
    url = new URL('/agent.json', botUrl).toString();
  } catch {
    return `PERFIL.botUrl no es una URL válida: ${botUrl}`;
  }
  if (!url.startsWith('https://')) {
    return (
      `tu endpoint no es https (${botUrl}).\n` +
      '  Por ahí viaja el encargo del cliente con su firma, y en claro lo lee cualquiera.'
    );
  }

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return (
      `tu endpoint no responde (${url}).\n` +
      `  ${err instanceof Error ? err.message : err}\n` +
      '  Arranca el agente y expón el puerto con https ANTES de registrarte.'
    );
  }
  if (!res.ok) return `tu endpoint respondió ${res.status} en ${url}, y debería devolver tu tarjeta.`;

  let card: { agent?: string };
  try {
    card = (await res.json()) as { agent?: string };
  } catch {
    return `${url} no devuelve JSON. ¿Seguro que ahí está tu agente y no otra cosa?`;
  }
  if (!card.agent) return `${url} responde, pero no anuncia ninguna dirección. ¿Es tu agente de Panal?`;
  if (card.agent.toLowerCase() !== yo.toLowerCase()) {
    return (
      `esa URL es de OTRO agente.\n` +
      `  ${url} dice ser ${card.agent}\n` +
      `  y tú te estás registrando como ${yo}.`
    );
  }
  return null;
}

async function main(): Promise<void> {
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('Falta AGENT_PRIVATE_KEY en el .env (0x + 64 hex).');
    process.exit(1);
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  const panal = createPanalClient({ account, rpcUrl: process.env.RPC_URL });

  // Lo primero, porque no cuesta nada y es lo que más se olvida.
  const falta = loQueFaltaDelPerfil(PERFIL);
  if (falta) {
    console.error(`No te registro todavía: ${falta}\n\nEstá todo en src/register.ts, arriba del todo.`);
    process.exit(1);
  }

  console.log(`Wallet:  ${account.address}`);

  // El endpoint ANTES que el saldo, y no al revés: levantar un servidor con
  // https es la parte larga, y mandar gas la corta. Decirle a alguien que le
  // falta MON cuando su agente ni siquiera responde le hace resolver lo fácil
  // para chocarse con lo difícil después.
  if (process.env.REGISTRO_SIN_COMPROBAR === '1') {
    console.log('\n(REGISTRO_SIN_COMPROBAR=1: no compruebo tu endpoint. Tú sabrás.)');
  } else {
    const roto = await compruebaEndpoint(PERFIL.botUrl, account.address);
    if (roto) {
      console.error(
        `\nNo te registro: ${roto}\n\n` +
          'Si sabes lo que haces y quieres registrarte igual, repite con REGISTRO_SIN_COMPROBAR=1.',
      );
      process.exit(1);
    }
    console.log(`Endpoint: ${PERFIL.botUrl} responde y es tuyo.`);
  }

  const balance = await panal.publicClient.getBalance({ address: account.address });
  console.log(`Saldo:   ${formatEther(balance)} MON`);
  if (balance === 0n) {
    console.error('\nSin MON no puedes ni pagar el gas del registro. Manda un poco a esa dirección.');
    process.exit(1);
  }

  console.log(`\nPerfil:  ${formatAgentMetadata(PERFIL)}`);
  console.log(`Precio:  ${formatEther(PRECIO)} ${MONEDA === NATIVE_CURRENCY ? 'MON' : '$PANAL'} por tarea\n`);

  // ¿Ya estabas? Registrarse dos veces revierte, así que se actualiza.
  const existente = await panal.getAgent(account.address).catch(() => null);
  const yaRegistrado = existente !== null && existente.registeredAt > 0n;

  if (yaRegistrado) {
    console.log('Ya estabas registrado: actualizo el perfil y el precio.');
    await panal.updateMetadata(PERFIL);
    await panal.updatePrice(PRECIO, MONEDA);
    if (!existente.active) {
      await panal.setActive(true);
      console.log('Y te vuelvo a poner activo.');
    }
  } else {
    await panal.registerAgent({ metadata: PERFIL, pricePerTask: PRECIO, currency: MONEDA });
    console.log('Registrado.');
  }

  // El nombre va DESPUÉS del registro y no puede tumbarlo: `reclamar` exige
  // estar registrado y activo, así que el orden es obligatorio, y si algo falla
  // —nombre cogido, sin saldo, contrato no desplegado— el agente ya está
  // trabajando igual. El nombre es un extra, no un requisito.
  await reclamaTuNombre(account, PERFIL.name);

  console.log(`\nYa apareces en https://panal.lat/market`);
  console.log(`Compruébalo desde Claude: "¿qué agentes hay en Panal?"`);
}

/**
 * Convierte el nombre del perfil en un handle válido para PanalNames.
 *
 * El contrato solo acepta `a-z`, `0-9` y `-`, y ahí es donde mueren los
 * homoglifos: la `а` cirílica no colisiona con la latina, es que no se puede
 * escribir. Así que "LexPanal" pasa a `lexpanal` y "Traductor ES→DE" a
 * `traductor-es-de`.
 *
 * Los acentos se quitan descomponiendo el texto (NFD) y tirando las marcas:
 * "Ágil" -> `agil`. Transliterar a ojo cada idioma sería inventar.
 */
export function aHandle(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/**
 * PanalNames en Monad mainnet. Vacío mientras no esté desplegado, y entonces
 * este paso no hace nada — que es lo correcto: no hay contrato al que pedirle.
 * Se puede apuntar a otro con PANAL_NAMES_ADDRESS.
 */
const PANAL_NAMES = '';

const NOMBRES_ABI = [
  {
    type: 'function',
    name: 'disponible',
    stateMutability: 'view',
    inputs: [{ name: 'nombre', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'nombreDe',
    stateMutability: 'view',
    inputs: [{ name: 'agente', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'tarifaDe',
    stateMutability: 'view',
    inputs: [{ name: 'nombre', type: 'string' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reclamar',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nombre', type: 'string' }],
    outputs: [],
  },
] as const;

/**
 * Reclama tu nombre único en PanalNames, si se puede.
 *
 * NUNCA lanza. Todo lo que puede salir mal aquí —que el contrato no esté
 * desplegado, que el nombre esté cogido, que no tengas saldo— es un extra que
 * no sale, y el agente ya está registrado y trabajando. Se avisa y se sigue.
 *
 * Se hace en el mismo comando a propósito: si hay que volver días después a
 * reclamarlo, para entonces se lo habrá quedado otro.
 */
async function reclamaTuNombre(account: ReturnType<typeof privateKeyToAccount>, nombre: string): Promise<void> {
  const contrato = process.env.PANAL_NAMES_ADDRESS?.trim() || PANAL_NAMES;
  if (!contrato || !/^0x[0-9a-fA-F]{40}$/.test(contrato)) return;

  const handle = aHandle(nombre);
  if (handle.length < 3) {
    // Pasa con los nombres en alfabetos no latinos: el contrato solo acepta
    // `a-z0-9-`, que es lo que impide los homoglifos, así que de "日本語" no
    // sale nada. No es un fallo, pero hay que decir qué hacer.
    console.log(`\nNo te reclamo nombre: de "${nombre}" no sale un handle de 3 letras o más.`);
    console.log(`Los nombres solo admiten a-z, 0-9 y guion. Elige uno a mano desde https://panal.lat/dashboard`);
    return;
  }

  try {
    const rpc = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
    const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
    const publico = createPublicClient({ transport: http(rpc) });
    const cartera = createWalletClient({ account, chain, transport: http(rpc) });
    const donde = contrato as `0x${string}`;

    const yaTengo = await publico.readContract({ address: donde, abi: NOMBRES_ABI, functionName: 'nombreDe', args: [account.address] });
    if (yaTengo) {
      console.log(`\nTu nombre en Panal ya es: ${yaTengo}`);
      return;
    }

    const libre = await publico.readContract({ address: donde, abi: NOMBRES_ABI, functionName: 'disponible', args: [handle] });
    if (!libre) {
      console.log(`\nEl nombre "${handle}" ya está cogido. Puedes reclamar otro desde https://panal.lat/dashboard`);
      return;
    }

    const tarifa = await publico.readContract({ address: donde, abi: NOMBRES_ABI, functionName: 'tarifaDe', args: [handle] });
    if (tarifa > 0n) {
      // Con tarifa hay que aprobar el gasto antes, y eso es otra firma y otra
      // decision. No se hace a tus espaldas: se te dice y lo haces tu.
      console.log(`\nTu nombre "${handle}" está libre, pero cuesta ${formatEther(tarifa)} $PANAL.`);
      console.log(`Reclámalo desde https://panal.lat/dashboard cuando quieras.`);
      return;
    }

    const hash = await cartera.writeContract({ address: donde, abi: NOMBRES_ABI, functionName: 'reclamar', args: [handle], chain });
    await publico.waitForTransactionReceipt({ hash });
    console.log(`\nTu nombre único en Panal: ${handle}`);
  } catch (err) {
    // Un fallo aqui no es grave: el agente ya esta registrado y puede trabajar.
    console.log(`\nNo pude reclamarte el nombre (${err instanceof Error ? err.message.split('\n')[0] : err}).`);
    console.log(`Puedes hacerlo luego desde https://panal.lat/dashboard`);
  }
}

main().catch((err) => {
  console.error(`\nFalló: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
