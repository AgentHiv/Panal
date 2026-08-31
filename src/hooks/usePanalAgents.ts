/**
 * Panal — Los agentes del mercado.
 *
 * Salen del CATÁLOGO del indexador: una petición HTTP, con nombre, skills,
 * precio y estadísticas ya dentro.
 *
 * Antes se leían del registro con `getAgents(0, 50)` y dos llamadas RPC por
 * agente. Eso tenía dos problemas y ninguno avisaba: el agente 51 en adelante
 * NO EXISTÍA para el mercado —ni en el listado, ni en el buscador, ni en las
 * categorías, ni en el podio—, y cada carga de página costaba 100 llamadas
 * contra un RPC público que corta cerca de 50 concurrentes.
 *
 * Esa lectura sigue aquí como RESPALDO, y salta si el indexador no responde o
 * va más de diez minutos por detrás de la cadena. Es peor —vuelve a ver solo
 * los 50 primeros— pero un mercado pobre es mejor que un mercado vacío.
 *
 * El volumen cobrado por moneda lo sigue poniendo `useIndexAgents`, que es una
 * consulta compartida con el resto de la web.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import {
  NATIVE_CURRENCY,
  currencySymbol,
  PANAL_NAMES_ADDRESS,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_REPUTATION_ADDRESS,
  PANAL_REPUTATION_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalNamesAbi, panalRegistryAbi, panalRegistryV2Abi, panalReputationAbi } from '@/contracts/abis';
import type { Agent, AgentCategory } from '@/data/agents';
import { esTokenDeNivel, esTokenDeTipo, leerTipo } from '@panal/sdk';
import { useIdiomaDelDocumento } from '@/lib/idiomaActual';
import { MARCA_VACIA, esTokenDeMarca, leerMarca, type Marca } from '@/lib/marca';
import { canalDeFicha, type Canal } from '@/lib/botEndpoint';
import {
  fetchCatalogo,
  useIndexAgents,
  type AgentStats,
  type CatalogAgent,
  type NombreDeAgente,
} from '@/lib/indexer';

// Se re-exporta para que las cuatro pantallas que lo pintan importen el tipo
// del mismo sitio del que importan `canalDe`, y no de dos.
export type { Canal } from '@/lib/botEndpoint';

/** Agent del mercado enriquecido con datos reales on-chain + indexador. */
export interface OnchainAgent extends Agent {
  onchain: true;
  /** dirección real del agente (worker en PanalEscrow) */
  workerAddress: Address;
  /** precio exacto en wei (para el value/amount de createTask) */
  priceWei: bigint;
  /** moneda del precio: address(0) = MON (v1 siempre), PANAL_TOKEN = $PANAL (solo v2) */
  currency: Address;
  /** stats del indexador para esta address (null si aún no tiene actividad) */
  indexStats: AgentStats | null;
  /** Su nombre en PanalNames, con cómo y cuándo lo consiguió. */
  nombreOnchain: NombreDeAgente | null;
  /**
   * Logo y enlaces que el creador publicó en su ficha.
   *
   * Sale del `metadataURI`, así que lo trae tanto el catálogo del indexador
   * como la lectura directa del registro: un agente no pierde su logo porque
   * el indexador esté caído.
   */
  marca: Marca;
  /**
   * Si publica una dirección por donde recibir encargos, o no se sabe.
   *
   * Son TRES estados y no un booleano, por el mismo motivo que `verification`:
   * el catálogo del indexador manda el `metadataURI` desde hace poco y uno
   * anterior no lo manda. Aplastarlo en un `false` haría que un indexador
   * viejo dejara el mercado entero marcado como «no recibe encargos», que es
   * exactamente la mentira contraria a la que esto viene a arreglar.
   */
  canal: Canal;
}

/**
 * Por dónde recibe encargos un agente, sea del tipo que sea.
 *
 * Fuera de la cadena no hay ficha que leer, así que la respuesta honrada es
 * «no se sabe». Se resuelve aquí y no en cada tarjeta por lo mismo que
 * `marcaDe`: son cuatro sitios los que lo pintan.
 */
export function canalDe(agent: Agent): Canal {
  return isOnchainAgent(agent) ? agent.canal : 'desconocido';
}

/**
 * ¿Este nombre acaba de cambiar de manos?
 *
 * Treinta días. Un nombre comprado la semana pasada y uno reclamado hace un año
 * valen lo mismo como identificador y no valen lo mismo como señal: lo único
 * que viaja en una venta es el nombre, y la reputación se queda en la dirección
 * del vendedor. Quien busca a `lint` por su nombre merece saber que el `lint`
 * de hoy no es el que hizo esas tareas.
 */
/**
 * El logo y los enlaces de un agente, sea del tipo que sea.
 *
 * Solo los agentes on-chain tienen ficha en el registro, así que para el resto
 * la respuesta es «no publicó nada». Se resuelve aquí y no en cada tarjeta
 * porque son cuatro sitios que la pintan y ninguno debería tener que saberlo.
 */
export function marcaDe(agent: Agent): Marca {
  return isOnchainAgent(agent) ? agent.marca : MARCA_VACIA;
}

export const DIAS_CAMBIO_RECIENTE = 30;

export function cambioReciente(n: NombreDeAgente | null, ahoraS: number): boolean {
  // Sin `origen` NO se avisa. Es `undefined` cuando la ficha se leyó de la
  // cadena, que sabe el nombre y desde cuándo pero no cómo se consiguió.
  // Avisar ahí acusaría de una compra que no consta, y esta advertencia solo
  // sirve si cuando aparece es verdad.
  if (!n || !n.origen || n.origen === 'reclamado') return false;
  return ahoraS - n.desdeTs < DIAS_CAMBIO_RECIENTE * 86_400;
}

export function isOnchainAgent(agent: Agent): agent is OnchainAgent {
  return (agent as OnchainAgent).onchain === true;
}

/**
 * Palabras que delatan la categoría de un agente, en los idiomas en los que la
 * gente escribe sus skills. El orden importa: gana la primera que acierte.
 *
 * Es deliberadamente corto. Adivinar de más es peor que no adivinar: un agente
 * mal archivado desaparece del filtro donde su cliente lo busca.
 */
const PISTAS: [AgentCategory, RegExp][] = [
  ['legal', /\b(legal|contract|contrato|compliance|licen|juríd|jurid|abogad|law)/i],
  ['defi', /\b(defi|swap|liquid|token|trading|yield|staking|precio|price|onchain|on-chain|wallet)/i],
  ['vision', /\b(vision|visión|image|imagen|foto|photo|ocr|video|vídeo|diagram)/i],
  ['datos', /\b(data|datos|json|csv|pars|extract|extracc|structur|estructur|scrap|sql|query|tabla)/i],
  ['codigo', /\b(code|código|codigo|review|revisi|test|qa|bug|audit|refactor|lint|debug|security|seguridad|program)/i],
  ['creativo', /\b(creativ|design|diseñ|dise[nñ]|brand|marca|copy|slogan|logo|arte|art\b|music|música)/i],
  ['texto', /\b(text|texto|translat|traduc|summar|resum|redact|writ|escrib|content|contenido|idioma|language)/i],
];

/**
 * A qué categoría pertenece un agente, según lo que él mismo declara.
 *
 * Antes esto devolvía siempre 'codigo', así que TODOS los agentes salían
 * archivados como programadores: quien filtraba por "Datos" no encontraba al
 * que estructura JSON, aunque estuviera registrado, activo y funcionando.
 *
 * Cuando nada encaja se cae en 'texto', que es lo más neutro: un agente en la
 * categoría equivocada engaña, y uno sin categoría no se puede filtrar.
 */
export function categoriaDe(skills: string[] | undefined, tagline?: string): AgentCategory {
  const heno = [...(skills ?? []), tagline ?? ''].join(' ');
  for (const [categoria, pista] of PISTAS) {
    if (pista.test(heno)) return categoria;
  }
  return 'texto';
}

/**
 * La clave de traducción del precio según la moneda REAL del agente.
 *
 * Cada texto con un precio existe dos veces en los locales: `foo` dice MON y
 * `fooToken` dice $PANAL. Elegir a mano en cada sitio es justo lo que falló —
 * un agente que cobraba 100 $PANAL salía anunciado a "100 MON" en el ranking
 * y en el botón de contratar, que es prometer un precio que no es el que se
 * va a cobrar. Con este ayudante el sitio nuevo solo tiene que pasar la base.
 */
export function priceKey(base: string, agent: Agent): string {
  return isOnchainAgent(agent) && currencySymbol(agent.currency) === '$PANAL' ? `${base}Token` : base;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * metadataURI de texto libre → campos de presentación.
 *
 * Los tokens con forma —`bot:`, `logo:`, `github:`, `nivel:`…— se apartan
 * antes de repartir posiciones. Sin eso, el segundo segmento de un agente que solo
 * publicara su bot saldría de descripción: la tarjeta anunciaría
 * «bot:https://…» donde debería decir qué hace.
 */
function parseMetadata(uri: string, addr: Address): { name: string; tagline: string; skills: string[] } {
  const fallback = { name: `Agente ${short(addr)}`, tagline: '', skills: [] as string[] };
  const text = uri.trim();
  if (!text) return { ...fallback, tagline: 'Agente registrado on-chain en PanalRegistry.' };
  // Formato sugerido: "Nombre · descripción · skill1, skill2"
  const parts = text
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter(
      (p) =>
        !esTokenDeMarca(p) &&
        !esTokenDeNivel(p) &&
        !esTokenDeTipo(p) &&
        !/^bot:\s*https?:\/\//i.test(p),
    );
  if (parts.length > 0) {
    return {
      name: parts[0] || fallback.name,
      tagline: parts[1] || parts[0],
      skills: parts[2] ? parts[2].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6) : [],
    };
  }
  return { ...fallback, tagline: text };
}

interface RawAgentTuple {
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
  /** solo registry v2 (ausente en v1) */
  currency?: Address;
}

/**
 * El catálogo del indexador, ya con la forma que consume el mercado.
 *
 * Es el camino normal. La lectura directa del registro (`fetchOnchainAgents`,
 * aquí abajo) pasa a ser el respaldo: funciona, pero solo ve los 50 primeros
 * agentes y cuesta 100 llamadas RPC por carga.
 */
/**
 * Lo cobrado, en la moneda del agente, y lo cobrado en la otra si la hay.
 *
 * Una tarea se paga en MON y una consulta en $PANAL, y no hay tipo de cambio:
 * sumarlas en una cifra seria inventarse un numero. Se enseña la del agente y
 * la otra aparte.
 */
function volumenDe(
  st: AgentStats | null,
  currency: Address,
): { totalEarned: number; earnedOther?: { amount: number; symbol: 'MON' | '$PANAL' } } {
  if (!st) return { totalEarned: 0 };
  const propia = currencySymbol(currency);
  const otra: 'MON' | '$PANAL' = propia === '$PANAL' ? 'MON' : '$PANAL';
  const enOtra = Number(formatEther(BigInt(st.volume[otra] ?? '0')));
  return {
    totalEarned: Number(formatEther(BigInt(st.volume[propia] ?? '0'))),
    ...(enOtra > 0 ? { earnedOther: { amount: enOtra, symbol: otra } } : {}),
  };
}

/**
 * La descripción de un agente en el idioma de quien mira.
 *
 * La traduce el propio agente y el indexador la guarda; aquí solo se elige. Si
 * ese idioma no está —un agente de una plantilla anterior, una traducción que
 * falló, un indexador viejo— se devuelve el texto original, que es exactamente
 * lo que se enseñaba antes de que esto existiera.
 */
function descripcionEnIdioma(f: CatalogAgent, idioma: string): string {
  // `es-419`, `zh-Hans`: el navegador dice la variante y el catálogo guarda la
  // base. Sin recortar, un mexicano caería al texto sin traducir.
  const base = idioma.toLowerCase().split(/[-_]/)[0] ?? '';
  return f.idiomas?.[base]?.trim() || f.description;
}

function delCatalogo(fichas: CatalogAgent[], idioma: string): OnchainAgent[] {
  return fichas
    .filter((f) => f.active)
    .map((f) => {
      const addr = f.address as Address;
      const priceWei = BigInt(f.pricePerTask);
      const descripcion = descripcionEnIdioma(f, idioma);
      // El rating sale del indexador y no de getScore: es el mismo dato —los
      // dos salen de PanalReputation— y así no hay que preguntar por cada uno.
      const rating = f.stats?.avgRating ?? 0;
      return {
        id: `onchain-${f.address}`,
        name: f.name || `Agente ${short(addr)}`,
        // La categoría sale de la descripción ORIGINAL, no de la traducida: las
        // palabras que la delatan están escritas en unos pocos idiomas, y un
        // agente cambiaría de categoría según quién lo esté mirando.
        category: categoriaDe(f.skills, f.description),
        // Quién hay detrás, dicho por él en su ficha on-chain. Estuvo cableado
        // a 'ia' desde el principio —lo eran todos— y es lo que separa los dos
        // mercados. Un catálogo sin `metadataURI` (indexador viejo) no lo trae:
        // entonces sale 'ia', que es lo que se enseñaba antes.
        type: leerTipo(f.metadataURI) === 'persona' ? 'humano' : 'ia',
        tagline: descripcion || 'Agente registrado on-chain en PanalRegistry.',
        description: descripcion || 'Agente registrado directamente en PanalRegistry (Monad mainnet).',
        pricePerTask: Number(formatEther(priceWei)),
        rating: rating > 0 ? Math.min(5, rating) : 0,
        reviews: f.stats?.ratingCount ?? 0,
        tasksCompleted: f.stats?.completed ?? 0,
        avgResponse: '—',
        avgResponseSec: Number.MAX_SAFE_INTEGER,
        successRate: 100,
        status: 'en-linea',
        // Lo dice el indexador tras pedirle la tarjeta a su dominio y comprobar
        // que declara esta misma direccion. Estuvo cableado a false desde que
        // se pintaron las tarjetas, con la insignia ya puesta en el componente.
        verified: f.verificado === true,
        // El indexador distingue tres estados y aqui se conservan los tres:
        // `undefined` es «aun no mirado», no «no verificado». Aplastarlos en un
        // booleano deja la ficha sin poder decir por que falta la insignia.
        verification: f.verificado === true ? 'verified' : f.verificado === false ? 'unverified' : 'unchecked',
        verificationReason: f.verificadoMotivo,
        acceptsSubcontracting: false,
        wallet: addr,
        walletShort: short(addr),
        skills: f.skills,
        memberSince: new Date(f.registeredAt * 1000).toLocaleDateString('es-ES', {
          month: 'short',
          year: 'numeric',
        }),
        volume24h: 0,
        trend7d: [0, 0, 0, 0, 0, 0, 0],
        onchain: true,
        workerAddress: addr,
        priceWei,
        currency: (f.currency || NATIVE_CURRENCY) as Address,
        indexStats: f.stats,
        nombreOnchain: f.nombre ?? null,
        // Del `metadataURI` que sirve el catálogo. Un indexador anterior a la
        // marca no lo manda: entonces `marca` queda vacía y la tarjeta se
        // pinta como siempre, que es exactamente lo que hacía antes.
        marca: leerMarca(f.metadataURI),
        // Del mismo `metadataURI`, y por eso mismo `undefined` con un indexador
        // anterior a él: entonces es «no se sabe» y no se marca nada.
        canal: canalDeFicha(f.metadataURI),
        // El volumen se calcula AQUÍ porque la ficha del catálogo ya lo trae:
        // pedirlo otra vez a `/index/agents` seria traerse dos veces lo mismo,
        // y esa segunda consulta devuelve el mercado entero sin paginar.
        ...volumenDe(f.stats, (f.currency || NATIVE_CURRENCY) as Address),
      } satisfies OnchainAgent;
    });
}

async function fetchAgents(idioma: string): Promise<OnchainAgent[]> {
  // El catálogo primero: una petición HTTP en vez de 100 llamadas RPC, y sin
  // el techo de 50 agentes. Si el indexador no responde o va atrasado, se lee
  // el registro como siempre: peor —solo los 50 primeros— pero nunca un
  // mercado vacío.
  const cabeza = await publicClient.getBlockNumber().catch(() => undefined);
  const fichas = await fetchCatalogo(cabeza);
  if (fichas !== null) return delCatalogo(fichas, idioma);
  return fetchOnchainAgents();
}

/**
 * El nombre de PanalNames de una dirección, leído de la cadena.
 *
 * Dos llamadas y no una: `nombreDe` da el nombre y `fichaDe` la fecha desde la
 * que es suyo, que es lo que permite avisar de un nombre recién cambiado de
 * manos. La segunda solo se pide si hay nombre, así que la mayoría de agentes
 * pagan una sola lectura.
 *
 * Nunca lanza: no tener nombre es lo normal, y un dato de más no puede tumbar
 * la carga del mercado entero.
 */
async function leerNombreOnchain(addr: Address): Promise<NombreDeAgente | null> {
  try {
    const nombre = (await publicClient.readContract({
      address: PANAL_NAMES_ADDRESS,
      abi: panalNamesAbi,
      functionName: 'nombreDe',
      args: [addr],
    })) as string;
    if (!nombre) return null;

    const ficha = (await publicClient.readContract({
      address: PANAL_NAMES_ADDRESS,
      abi: panalNamesAbi,
      functionName: 'fichaDe',
      args: [nombre],
    })) as readonly [Address, bigint, bigint, boolean];

    // Sin `origen` a propósito: la cadena no lo sabe, y ponerle 'reclamado'
    // sería inventarse justo la parte que avisa de una compra reciente.
    return { nombre, desdeTs: Number(ficha[1]) };
  } catch {
    return null;
  }
}

async function fetchOnchainAgents(): Promise<OnchainAgent[]> {
  // Con V2_ENABLED se lee del registry v2 (mismo formato + currency al final).
  const registryAddr = V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS;
  const reputationAddr = V2_ENABLED ? PANAL_REPUTATION_V2_ADDRESS : PANAL_REPUTATION_ADDRESS;
  const registryAbi = V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi;

  const count = (await publicClient.readContract({
    address: registryAddr,
    abi: registryAbi,
    functionName: 'getAgentCount',
  })) as bigint;

  if (count === 0n) return [];

  const addresses = (await publicClient.readContract({
    address: registryAddr,
    abi: registryAbi,
    functionName: 'getAgents',
    args: [0n, 50n],
  })) as Address[];

  // El RPC público limita a ~15 req/s (HTTP 429): leemos en lotes de 4
  // agentes con pausa entre lotes en vez de un Promise.all masivo.
  const BATCH = 4;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const readOne = async (addr: Address): Promise<OnchainAgent | null> => {
    const [data, score, nombreOnchain] = await Promise.all([
      publicClient.readContract({
        address: registryAddr,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [addr],
      }) as Promise<RawAgentTuple>,
      publicClient.readContract({
        address: reputationAddr,
        abi: panalReputationAbi,
        functionName: 'getScore',
        args: [addr],
      }).catch(() => 0n),
      // El nombre único, leído de la cadena.
      //
      // Esta ruta solo corre cuando el indexador no responde, y es justo
      // entonces cuando más falta hace: sin él se pierde también `verificado`,
      // así que la tarjeta se quedaba sin UNA SOLA señal de identidad. El
      // nombre del perfil es texto libre y se repite —hay tres direcciones
      // anunciándose como "LexPanal"—; este lo tiene una sola dirección y no
      // depende de que nada esté levantado.
      leerNombreOnchain(addr),
    ]);

    const meta = parseMetadata(data.metadataURI, addr);
    const priceWei = data.pricePerTask;
    const priceMon = Number(formatEther(priceWei));
    const rating = Number(score) / 100; // score x100 → estrellas

    return {
      id: `onchain-${addr.toLowerCase()}`,
      name: meta.name,
      category: categoriaDe(meta.skills, meta.tagline),
      type: leerTipo(data.metadataURI) === 'persona' ? 'humano' : 'ia',
      tagline: meta.tagline || 'Agente registrado on-chain en PanalRegistry.',
      description:
        meta.tagline ||
        'Agente registrado directamente en PanalRegistry (Monad mainnet). La reputación mostrada proviene de PanalReputation.',
      pricePerTask: priceMon,
      rating: rating > 0 ? Math.min(5, rating) : 0,
      reviews: 0,
      tasksCompleted: 0,
      avgResponse: '—',
      avgResponseSec: Number.MAX_SAFE_INTEGER,
      successRate: 100,
      status: data.active ? 'en-linea' : 'desconectado',
      // Esta ficha se leyo del registry, y la cadena no guarda verificaciones
      // de dominio: la verdad aqui es «no se ha mirado», no «no verificado».
      verified: false,
      verification: 'unchecked',
      acceptsSubcontracting: false,
      wallet: addr,
      walletShort: short(addr),
      skills: meta.skills,
      marca: leerMarca(data.metadataURI),
      // Aquí la ficha viene entera de la cadena: la respuesta es sí o no.
      canal: canalDeFicha(data.metadataURI),
      totalEarned: 0,
      memberSince: new Date(Number(data.registeredAt) * 1000).toLocaleDateString('es-ES', {
        month: 'short',
        year: 'numeric',
      }),
      volume24h: 0,
      trend7d: [0, 0, 0, 0, 0, 0, 0],
      onchain: true,
      workerAddress: addr,
      priceWei,
      currency: data.currency ?? NATIVE_CURRENCY,
      indexStats: null,
      // El nombre SÍ se puede leer sin indexador: está en PanalNames, que es un
      // contrato. Lo que no se puede saber por aquí es su `origen`, porque eso
      // sale de los eventos — y por eso `cambioReciente` no avisa sin ese dato.
      nombreOnchain,
    };
  };

  const agents: Array<OnchainAgent | null> = [];
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = await Promise.all(addresses.slice(i, i + BATCH).map(readOne));
    agents.push(...chunk);
    if (i + BATCH < addresses.length) await sleep(350);
  }

  return agents.filter((a): a is OnchainAgent => a !== null && a.status === 'en-linea');
}

export function usePanalAgents() {
  // Del `lang` del documento y no de i18next: este hook lo usa TAMBIÉN la app,
  // que no monta i18next. Ver `idiomaActual.ts`.
  const idioma = useIdiomaDelDocumento();
  const query = useQuery({
    // El idioma va en la clave: el catálogo trae la descripción de cada agente
    // traducida, así que cambiar de idioma tiene que rehacer la lista y no
    // devolver la que había en el idioma anterior.
    queryKey: ['panal-agents', V2_ENABLED, idioma],
    queryFn: () => fetchAgents(idioma),
    staleTime: 30_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10_000),
  });
  // Stats reales del indexador (react-query dedup por queryKey: el fetch lo
  // comparte con el resto de consumidores de useIndexAgents).
  const { byAddress } = useIndexAgents();

  const agents = useMemo<OnchainAgent[]>(
    () =>
      (query.data ?? []).map((a) => {
        // Los del CATALOGO ya vienen completos: su ficha trae las stats y el
        // volumen. La fusion es solo para los del respaldo, que salen del
        // registro y no saben nada del indexador.
        if (a.indexStats !== null) return a;
        const st = byAddress.get(a.workerAddress.toLowerCase()) ?? null;
        if (!st) return a;
        const propia = currencySymbol(a.currency);
        const otra = propia === '$PANAL' ? 'MON' : '$PANAL';
        const enOtra = Number(formatEther(BigInt(st.volume[otra] ?? '0')));
        return {
          ...a,
          indexStats: st,
          tasksCompleted: st.completed,
          rating: st.avgRating ?? a.rating,
          reviews: st.ratingCount,
          // El volumen se lee en la moneda del agente. Antes se cogía siempre
          // el de MON, así que un agente que cobra en $PANAL salía con volumen
          // cero por muchas tareas que hubiera hecho.
          totalEarned: Number(formatEther(BigInt(st.volume[propia] ?? '0'))),
          earnedOther: enOtra > 0 ? { amount: enOtra, symbol: otra } : undefined,
        };
      }),
    [query.data, byAddress],
  );

  return {
    agents,
    loading: query.isLoading,
    hasOnchain: agents.length > 0,
  };
}
