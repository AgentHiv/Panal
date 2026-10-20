/**
 * El tablón con reglas (PanalTablon) en el MCP.
 *
 * Un cliente publica un encargo sin elegir agente: el dinero espera en el
 * contrato y se lo queda un agente que pasa las reglas —su nivel según la
 * reputación, su cupo del día, sus categorías y sus faltas—. En INMEDIATO lo
 * coge el primero que pasa las reglas; en SELECCIÓN los agentes ofertan precio
 * y plazo, y elige el cliente. Especificación: contracts/BOARD.md.
 *
 * Aquí viven las herramientas de los dos lados —quien publica y quien
 * trabaja—, con los mismos guardas que el resto del servidor: lo que mueve
 * dinero o firma necesita MCP_ENABLE_WRITES, una wallet y la confirmación de la
 * persona, y lo que pone dinero nuevo cuenta contra el presupuesto de SU
 * moneda. Lo demás (mirar el tablón, un encargo) funciona en solo lectura.
 *
 * Dos cosas que distinguen este tablón del de antes y que las herramientas
 * dicen: en el escrow, el cliente de estas tareas es PanalTablon, así que
 * aprobar y disputar se hacen a través de él; y los textos —anuncio, encargo,
 * entrega— van por el BUZÓN DEL TABLÓN, comprobados contra los hashes que
 * guarda la cadena.
 */

import { BaseError, ContractFunctionRevertedError, formatEther, keccak256, parseEther, toBytes, type Address } from 'viem';
import {
  CATEGORIAS_TABLON,
  EstadoTablon,
  MARGEN_ASIGNACION_S,
  MAX_CATEGORIAS,
  ModoTablon,
  NATIVE_CURRENCY,
  TaskStatus,
  MAX_ARCHIVOS_TABLON,
  anuncioPara,
  appendAttachmentsManifest,
  attachmentFrom,
  audienciaAdmite,
  categoriaDelTablon,
  parseAttachmentsManifest,
  parseFilesManifest,
  problemaConArchivos,
  stripFilesManifest,
  type ArchivoParaSubir,
  type HashedFile,
  leerAnuncio,
  leerTipo,
  problemaAlPublicar,
  type AudienciaTablon,
  type EncargoConReglas,
  type OfertaConReglas,
  type PanalClient,
  type PublicarEnElTablon,
  type TipoDeAgente,
} from '@panal/sdk';

/** La misma forma que las herramientas de server.ts. */
export interface Herramienta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface DepsTablon {
  panal: PanalClient;
  /** La wallet del servidor, si hay. */
  cuenta: Address | null;
  /** Motivo por el que no se puede escribir, o null. */
  escrituraCerrada: () => string | null;
  /** ¿Cabe este gasto en el presupuesto de su moneda? El motivo, o null. */
  revisarPresupuesto: (moneda: Address, importe: bigint, simbolo: string) => string | null;
  registrarGasto: (moneda: Address, importe: bigint) => void;
  simbolo: (moneda: Address) => string;
  usd: (importe: bigint, moneda: Address) => string;
  refrescarPrecios: () => Promise<void>;
  log: (m: string) => void;
  explorer: string;
  /** Un archivo de esta máquina, dentro de la carpeta permitida, o por qué no (adjuntos.ts). */
  leerArchivoLocal: (ruta: string) => ArchivoParaSubir | { error: string };
  /** Guarda lo bajado en la carpeta de descargas y devuelve dónde quedó. */
  guardarDescarga: (nombre: string, bytes: Uint8Array) => string;
}

/** «12 B», «340 kB», «1.2 MB». */
function tamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** Una lista de archivos anunciados, para enseñarla con el texto. */
function listaDeArchivos(titulo: string, archivos: HashedFile[], pista: string): string {
  if (archivos.length === 0) return '';
  return `\n\n${titulo}:\n${archivos.map((f) => `  ${f.name} (${tamano(f.size)})`).join('\n')}\n${pista}`;
}

const MODO = { [ModoTablon.Inmediato]: 'Immediate', [ModoTablon.Seleccion]: 'Selection' } as const;
const ESTADO = {
  [EstadoTablon.Publicado]: 'Posted',
  [EstadoTablon.Asignado]: 'Assigned',
  [EstadoTablon.Cerrado]: 'Closed',
  [EstadoTablon.Retirado]: 'Withdrawn',
  [EstadoTablon.Caducado]: 'Expired',
} as const;

const ahoraS = (): number => Math.floor(Date.now() / 1000);
const corto = (err: unknown): string => (err instanceof Error ? err.message.split('\n')[0]! : String(err));

/** Los errores de PanalTablon, dichos en claro (los mismos que la web). */
const RECHAZOS: Record<string, string> = {
  NotClient: 'only whoever posted the job can do that',
  WrongMode: 'that does not apply in this mode',
  WrongState: 'the job is no longer at that point',
  Expired: 'the deadline has passed',
  NotExpired: 'it has not expired yet',
  OffersOpen: 'offers are still open: the client cannot choose yet',
  OffersClosed: 'offers are already closed',
  ClientChoosing: 'the client still has time to choose',
  NoOffer: 'that agent has no offer',
  OffersFull: 'there are 50 offers and this one does not displace any',
  NoValidOffer: 'no offer qualifies: they are all above the budget or their agents no longer meet the rules',
  NotFinished: 'the escrow has not finished with this job yet',
  NothingToClaim: 'there is nothing to claim',
  IsPaused: 'the board is paused',
  UnsupportedCurrency: 'that currency is not accepted',
  BelowMinimum: 'below the minimum amount',
  OverPerJobCap: "above the beta's per-job cap",
  OverTotalCap: "above the beta's total cap",
  InvalidTimes: 'the times do not add up',
  TooSlow: "the offer's delivery time cannot be longer than the job's",
  InvalidCategories: 'up to three categories, no repeats',
  InvalidJob: 'that job does not exist',
};

/**
 * Por qué falló, en una línea. Si lo rechazó el contrato, con su error por el
 * nombre y en claro: la primera línea de viem solo dice «reverted», y el
 * motivo —que es lo que permite decidir qué hacer— venía debajo.
 */
export function fallo(err: unknown): string {
  let nombre: string | undefined;
  let primero: unknown;
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError && r.data?.errorName) {
      nombre = r.data.errorName;
      [primero] = (r.data.args ?? []) as unknown[];
    }
  }
  if (!nombre && err instanceof Error) {
    // Por si llega envuelto en otro error: viem lo escribe «Error: Nombre(args)».
    const m = /Error: ([A-Z]\w+)\((?:string reason: )?([^)]*)\)/.exec(err.message);
    if (m) [nombre, primero] = [m[1], m[2] || undefined];
  }
  if (nombre === 'NotAllowed' && typeof primero === 'string' && primero) return `the contract says no: ${primero}`;
  if (nombre) return `${RECHAZOS[nombre] ?? 'the contract rejected it'} (${nombre})`;
  return corto(err);
}
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** «3 h» o «2 d». */
export function duracion(segundos: number): string {
  const s = Math.max(0, segundos);
  if (s >= 2 * 86_400) return `${Math.round(s / 86_400)} d`;
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.max(1, Math.round(s / 60))} min`;
}

/** «codigo», «código», «2» → 2. `null` si no es una categoría. */
export function categoriaDeTexto(entrada: string): number | null {
  const t = entrada
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
  const n = /^\d+$/.test(t) ? Number(t) : (CATEGORIAS_TABLON as readonly string[]).indexOf(t);
  return Number.isInteger(n) && n >= 0 && categoriaDelTablon(n) !== null ? n : null;
}

const LISTA_CATEGORIAS = CATEGORIAS_TABLON.join(', ');

/**
 * Para quién es un encargo. La cadena no lo sabe: va en el anuncio
 * (`para:personas · …`) y lo respetan los clientes de Panal. Ver `anuncioPara`.
 */
const AUDIENCIA_DE_TEXTO: Record<string, AudienciaTablon> = {
  everyone: 'todos',
  anyone: 'todos',
  people: 'personas',
  persons: 'personas',
  humans: 'personas',
  agents: 'agentes',
  bots: 'agentes',
  programs: 'agentes',
};
const NOMBRE_AUDIENCIA: Record<AudienciaTablon, string> = {
  todos: 'everyone',
  personas: 'people only',
  agentes: 'agents only',
};

/** Por qué este tipo de wallet no entra en un encargo para esa audiencia, o null. */
function fueraDeAudiencia(audiencia: AudienciaTablon, tipo: TipoDeAgente | null): string | null {
  if (!tipo || audienciaAdmite(audiencia, tipo)) return null;
  return audiencia === 'personas'
    ? "it is for people only, and this wallet's profile says it is a program"
    : "it is for agents only, and this wallet's profile says it is a person";
}

/** El último momento en que un encargo publicado se puede asignar (`_lastAssign`). */
function ultimoParaAsignar(j: EncargoConReglas): number {
  if (j.modo !== ModoTablon.Seleccion) return j.caducaEn;
  return Math.min(j.caducaEn, j.publicadoEn + j.ventanaOfertasS + j.ventanaEleccionS + MARGEN_ASIGNACION_S);
}

/** ¿Se puede coger u ofertar ahora mismo, por las fechas? */
function abiertoAhora(j: EncargoConReglas, ahora: number): boolean {
  if (j.estado !== EstadoTablon.Publicado || ahora > j.caducaEn) return false;
  return j.modo === ModoTablon.Inmediato || ahora < j.publicadoEn + j.ventanaOfertasS;
}

function parseJobId(v: unknown): bigint | null {
  const s = typeof v === 'number' ? String(v) : texto(v);
  if (!s || !/^\d+$/.test(s)) return null;
  return BigInt(s);
}

/** «1.5» → wei. `null` si no es un número. */
function parseImporte(v: unknown): bigint | null {
  const s = (typeof v === 'number' ? String(v) : texto(v))?.replace(',', '.');
  if (!s || !/^\d+(\.\d{1,18})?$/.test(s)) return null;
  return parseEther(s);
}

export function herramientasDelTablon(d: DepsTablon): { lectura: Herramienta[]; escritura: Herramienta[] } {
  const { panal } = d;
  const tablon = (): Address => panal.addresses.tablon;
  const monedaDe = (nombre: string | undefined): Address | null => {
    const n = (nombre ?? 'MON').trim().toUpperCase().replace('$', '');
    if (n === 'MON') return NATIVE_CURRENCY;
    if (n === 'PANAL') return panal.addresses.panalToken;
    return null;
  };
  const importe = (wei: bigint, moneda: Address): string => `${formatEther(wei)} ${d.simbolo(moneda)}${d.usd(wei, moneda)}`;
  const tx = (hash: string): string => `${d.explorer}/tx/${hash}`;
  const disponible = (): string | null =>
    panal.boardJobsAvailable ? null : 'The board with rules (PanalTablon) is not deployed on this network.';
  /** Para las que firman: escritura abierta y tablón disponible. */
  const puedeEscribir = (args: Record<string, unknown>, que: string): string | null =>
    disponible() ??
    d.escrituraCerrada() ??
    (args.confirmed_by_user === true ? null : `I will not ${que} without confirmed_by_user: true.`);

  /** Los anuncios del buzón del tablón, por número, comprobados contra la cadena. */
  /**
   * Los encargos CONFIDENCIALES vistos en la última lectura de anuncios: su
   * encargo va cifrado y solo lo lee quien su cliente elija. Lo dice el buzón;
   * si mintiera, lo que cambia es un aviso.
   */
  const confidenciales = new Set<string>();

  /**
   * Lo publicado como confidencial, tal como se subió: para reintentar si los
   * textos o los archivos no llegaron. No se puede volver a componer —el
   * cifrado es aleatorio— y por eso se guarda. En memoria: tras reiniciar, un
   * reintento ya no es posible y el encargo se retira y se vuelve a publicar.
   */
  const publicadosCifrados = new Map<string, { anuncio: string; encargo: string; archivos: ArchivoParaSubir[] }>();

  /**
   * Da acceso a quien decide la disputa de un encargo del tablón, y lo dice en
   * una línea. `null` si no había nada cifrado que dar.
   */
  async function accesoParaQuienDecide(id: bigint): Promise<string | null> {
    try {
      const r = await panal.grantBoardDisputeAccess(id);
      if (r.objetos === 0) return null;
      if (r.arbitros > 0) {
        return `  The deciders (${r.arbitros} of ${r.arbitros + r.sinClave.length} multisig signers) were given access to the encrypted brief and delivery, so they can read what is disputed.`;
      }
      return '  WARNING: the brief or the delivery is encrypted and no multisig signer has published an encryption key yet, so they cannot read it. Call panal_grant_board_access with to "deciders" again later.';
    } catch (err) {
      return `  WARNING: giving the deciders access to the encrypted brief failed (${fallo(err)}). Retry with panal_grant_board_access and to "deciders".`;
    }
  }

  async function anunciosDe(encargos: EncargoConReglas[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      const res = await fetch(`${panal.buzonUrl}/${tablon()}/lista`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return out;
      const { anuncios = [] } = (await res.json()) as { anuncios?: { jobId: string; anuncio: string; cifrado?: boolean }[] };
      const hashes = new Map(encargos.map((j) => [j.id.toString(), j.advertHash.toLowerCase()]));
      for (const a of anuncios) {
        if (typeof a.anuncio === 'string' && hashes.get(a.jobId) === keccak256(toBytes(a.anuncio)).toLowerCase()) {
          out.set(a.jobId, a.anuncio);
          if (a.cifrado === true) confidenciales.add(a.jobId);
          else confidenciales.delete(a.jobId);
        }
      }
    } catch {
      // Sin buzón el tablón se sigue leyendo: los encargos salen sin su texto.
    }
    return out;
  }

  /** Los archivos de unas rutas locales, o por qué no. Las mismas guardas que al contratar. */
  function archivosDeRutas(v: unknown): ArchivoParaSubir[] | string {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return 'files is a list of paths on this machine.';
    if (v.length > MAX_ARCHIVOS_TABLON) return `At most ${MAX_ARCHIVOS_TABLON} files.`;
    const out: ArchivoParaSubir[] = [];
    for (const ruta of v as string[]) {
      const leido = d.leerArchivoLocal(ruta);
      if ('error' in leido) return leido.error;
      out.push(leido);
    }
    const problema = out.length > 0 ? problemaConArchivos(out) : null;
    return problema ?? out;
  }

  /** Lo que dice la ficha de esta wallet que es, o null si no es agente. */
  async function miTipo(): Promise<TipoDeAgente | null> {
    if (!d.cuenta) return null;
    try {
      return leerTipo((await panal.getAgent(d.cuenta)).metadataURI);
    } catch {
      return null;
    }
  }

  /** Para quién es un encargo, según su anuncio. Sin buzón, «todos»: lo demás lo dice el contrato. */
  async function audienciaDe(j: EncargoConReglas): Promise<AudienciaTablon> {
    const crudo = (await anunciosDe([j])).get(j.id.toString());
    return crudo ? leerAnuncio(crudo).audiencia : 'todos';
  }

  async function leerEncargo(id: bigint): Promise<EncargoConReglas | string> {
    try {
      return await panal.getBoardJob(id);
    } catch (err) {
      return /InvalidJob|reverted/.test(String(err)) ? `Board job #${id} does not exist.` : `Could not read board job #${id}: ${fallo(err)}`;
    }
  }

  /** Una línea de cabecera de un encargo. */
  function cabecera(j: EncargoConReglas, ahora: number, nOfertas?: number): string {
    const partes = [
      `#${j.id} — ${MODO[j.modo]} · ${categoriaDelTablon(j.categoria) ?? `category ${j.categoria}`}`,
      `${j.modo === ModoTablon.Seleccion ? 'budget ' : ''}${importe(j.importe, j.moneda)}`,
      `deliver within ${duracion(j.plazoEntregaS)} of assignment`,
    ];
    if (j.estado === EstadoTablon.Publicado) {
      if (j.modo === ModoTablon.Seleccion) {
        const fin = j.publicadoEn + j.ventanaOfertasS;
        partes.push(ahora < fin ? `offers close in ${duracion(fin - ahora)}${nOfertas !== undefined ? ` · ${nOfertas} offer(s)` : ''}` : 'offers closed');
      } else {
        partes.push(`can be taken for ${duracion(j.caducaEn - ahora)}`);
      }
    }
    if (j.soloConExperiencia) partes.push('experienced agents only');
    return partes.join(', ');
  }

  async function nombreYTipo(dir: Address): Promise<string> {
    try {
      const a = await panal.getAgent(dir);
      const persona = leerTipo(a.metadataURI) === 'persona' ? ' [person]' : '';
      return `${a.metadata.name || dir}${persona} (${dir})`;
    } catch {
      return dir;
    }
  }

  /** Lo abierto ahora en PanalTablon, con su anuncio y si esta wallet puede. */
  async function abiertosConReglas(filtro: number | null): Promise<string> {
    const ahora = ahoraS();
    const abiertos = (await panal.listBoardJobs({ limit: 100 })).filter(
      (j) => abiertoAhora(j, ahora) && (filtro === null || j.categoria === filtro),
    );
    if (!abiertos.length) return 'Nothing is open on the board with rules right now' + (filtro !== null ? ' in that category.' : '.');
    const [anuncios, ofertas, permisos, tipo] = await Promise.all([
      anunciosDe(abiertos),
      Promise.all(abiertos.map((j) => (j.modo === ModoTablon.Seleccion ? panal.getBoardOffers(j.id).catch(() => null) : null))),
      // Una lectura por encargo: con muchos, solo los primeros.
      d.cuenta
        ? Promise.all(abiertos.slice(0, 20).map((j) => panal.canTakeBoardJob(d.cuenta!, j.id).catch(() => null)))
        : Promise.resolve([]),
      miTipo(),
    ]);
    const lineas = abiertos.map((j, i) => {
      const permiso = permisos[i];
      const tuyo = d.cuenta && j.cliente.toLowerCase() === d.cuenta.toLowerCase();
      const crudo = anuncios.get(j.id.toString());
      const { audiencia, texto: anuncio } = crudo ? leerAnuncio(crudo) : { audiencia: 'todos' as const, texto: null };
      const fuera = fueraDeAudiencia(audiencia, tipo);
      const confidencial = confidenciales.has(j.id.toString());
      return [
        `\n${cabecera(j, ahora, ofertas[i]?.length)}${audiencia !== 'todos' ? `, for ${NOMBRE_AUDIENCIA[audiencia]}` : ''}${confidencial ? ', CONFIDENTIAL' : ''}`,
        `  "${anuncio ?? '(advert not in the mailbox)'}"`,
        `  posted by ${j.cliente}`,
        confidencial && !tuyo
          ? '  Confidential: the brief is encrypted, and the client gives access only to the agent it picks. Bidding publishes this wallet\'s encryption key (two signatures, no gas) so it can be given access.'
          : null,
        tuyo
          ? '  (posted by this wallet)'
          : fuera
            ? `  This wallet cannot: ${fuera}.`
            : permiso
              ? permiso.ok
                ? `  This wallet can ${j.modo === ModoTablon.Inmediato ? 'take it' : 'bid on it'}.`
                : `  This wallet cannot: ${permiso.motivo}.`
              : null,
      ]
        .filter(Boolean)
        .join('\n');
    });
    return [
      `${abiertos.length} job(s) open on the board with rules:`,
      ...lineas,
      '\nDetails with panal_board_job. An agent takes an immediate job with panal_take_board_job, or bids on a ' +
        'selection job with panal_offer_board_job. Posting needs panal_post_board_job.',
    ].join('\n');
  }

  /* ── lectura ─────────────────────────────────────────────────────────── */

  const lectura: Herramienta[] = [
    {
      name: 'panal_board',
      description:
        'List the jobs open right now on the Panal board with rules (PanalTablon): jobs a client paid for ' +
        'WITHOUT choosing an agent. In "Immediate" mode the first agent that passes the rules takes it; in ' +
        '"Selection" mode agents offer a price and a deadline and the client chooses. Each advert is checked ' +
        'against its hash on chain. If this server has a wallet, it also says whether that wallet could take ' +
        'or bid on each one, and why not. Optional `category` filter: ' + LISTA_CATEGORIAS + '. Without a ' +
        'filter it also lists what is left from the previous board (no rules, taken with panal_claim_task). Read-only.',
      inputSchema: {
        type: 'object',
        properties: { category: { type: 'string', description: 'A category name or number, to filter.' } },
      },
      handler: async (args) => {
        let filtro: number | null = null;
        if (texto(args.category)) {
          filtro = categoriaDeTexto(texto(args.category)!);
          if (filtro === null) return `"${texto(args.category)}" is not a category. They are: ${LISTA_CATEGORIAS}.`;
        }
        // Lo que queda del tablón anterior va aparte y al final: ya no se
        // publica ahí, pero lo publicado sigue pagado y alguien tiene que
        // poder cogerlo. No tiene categorías, así que con filtro no sale.
        const [nuevos, anteriores] = await Promise.all([
          disponible() ? Promise.resolve(disponible()!) : abiertosConReglas(filtro).catch((err) => `Could not read the board: ${fallo(err)}`),
          filtro === null ? panal.listBoard().catch(() => []) : Promise.resolve([]),
          d.refrescarPrecios(),
        ]);
        const viejos = anteriores.length
          ? [
              `\nLeft from the previous board (no rules: any active registered agent takes it with panal_claim_task):`,
              ...anteriores.map((e) => {
                const horas = Math.max(0, Math.floor((Number(e.deadline) - ahoraS()) / 3600));
                return `\n#${e.taskId} (escrow task) — ${importe(e.amount, e.currency)}, ${horas} h left\n  "${e.anuncio}"\n  posted by ${e.cliente}`;
              }),
            ]
          : [];
        return [nuevos, ...viejos].join('\n');
      },
    },
    {
      name: 'panal_board_job',
      description:
        'Everything about one job on the board with rules: its state, mode, category, amount, deadlines, the ' +
        'offers (with each agent\'s level, price and deadline, and whether its profile says it is a person), ' +
        'the agent it went to and its delivery state, and what this wallet can do next. With include_brief and ' +
        'a wallet that is its client or its agent, it also returns the private brief, checked against its hash ' +
        '(that signs a read credential, no transaction). Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          include_brief: { type: 'boolean', description: 'Also read the private brief (client or agent only).' },
        },
        required: ['job_id'],
      },
      handler: async (args) => {
        const no = disponible();
        if (no) return no;
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        await d.refrescarPrecios();
        const j = await leerEncargo(id);
        if (typeof j === 'string') return j;
        const ahora = ahoraS();
        const yo = d.cuenta?.toLowerCase();
        const soyCliente = yo === j.cliente.toLowerCase();
        const soyAgente = yo === j.agente.toLowerCase();
        const crudo = (await anunciosDe([j])).get(id.toString());
        const { audiencia, texto: anuncio } = crudo ? leerAnuncio(crudo) : { audiencia: 'todos' as const, texto: null };

        const confidencial = confidenciales.has(id.toString());
        const lineas: (string | null)[] = [
          cabecera(j, ahora),
          `  State: ${ESTADO[j.estado]}`,
          confidencial
            ? '  Confidential: the brief and its files are encrypted. Only the client and the agent it picks (which needs a published encryption key) can read them; not even Panal\'s mailbox can.'
            : null,
          audiencia !== 'todos' ? `  For: ${NOMBRE_AUDIENCIA[audiencia]} (declared in the advert; the contract cannot check who is a person)` : null,
          `  Advert: ${anuncio ? `"${anuncio}"` : '(not in the mailbox)'}`,
          `  Client: ${j.cliente}${soyCliente ? ' (this wallet)' : ''}`,
        ];

        if (j.estado === EstadoTablon.Publicado && j.modo === ModoTablon.Seleccion) {
          const fin = j.publicadoEn + j.ventanaOfertasS;
          const finEleccion = fin + j.ventanaEleccionS;
          lineas.push(
            ahora < fin
              ? `  Offers close in ${duracion(fin - ahora)}; then the client has ${duracion(j.ventanaEleccionS)} to choose.`
              : ahora <= Math.min(finEleccion, j.caducaEn)
                ? `  The client can choose an offer for ${duracion(Math.min(finEleccion, j.caducaEn) - ahora)}.`
                : '  The client did not choose in time: anyone can assign it to the best offer by the rules.',
          );
          const ofertas = await panal.getBoardOffers(id).catch(() => [] as OfertaConReglas[]);
          if (ofertas.length) {
            lineas.push(`  Offers (${ofertas.length}):`);
            for (const o of ofertas.slice(0, 20)) {
              const encima = o.precio > j.importe ? ` — above the budget by ${formatEther(o.precio - j.importe)}` : '';
              lineas.push(
                `    ${await nombreYTipo(o.agente)} — level ${o.nivel}, ${importe(o.precio, j.moneda)}, delivers in ${duracion(o.plazoEntregaS)}${encima}`,
              );
            }
            lineas.push('    "[person]" is what that agent\'s profile declares; the contract cannot check it.');
          } else {
            lineas.push('  No offers yet.');
          }
        }

        if (j.estado === EstadoTablon.Asignado || j.estado === EstadoTablon.Cerrado) {
          lineas.push(`  Agent: ${await nombreYTipo(j.agente)}${soyAgente ? ' — this wallet' : ''}`);
          try {
            const t = await panal.getTask(j.escrowTaskId);
            lineas.push(
              `  Escrow task #${j.escrowTaskId}: ${TaskStatus[t.status] ?? t.status}` +
                (t.status === TaskStatus.Open ? `, deliver by ${new Date(Number(t.deadline) * 1000).toISOString()}` : ''),
            );
          } catch {
            lineas.push(`  Escrow task #${j.escrowTaskId}`);
          }
          if (j.devolucionPendiente) lineas.push('  Dispute resolved: the refund waits for the arbitrator\'s split.');
        }

        // Lo siguiente que puede hacer esta wallet.
        const siguiente: string[] = [];
        if (j.estado === EstadoTablon.Publicado) {
          if (soyCliente) {
            if (ahora > ultimoParaAsignar(j)) siguiente.push('nobody took it in time: get the money back with panal_close_board_job');
            else {
              if (j.modo === ModoTablon.Seleccion && ahora >= j.publicadoEn + j.ventanaOfertasS) {
                siguiente.push('choose an offer with panal_choose_board_offer');
              }
              siguiente.push('withdraw it and get the money back with panal_close_board_job');
            }
          } else if (d.cuenta && abiertoAhora(j, ahora)) {
            const fuera = fueraDeAudiencia(audiencia, await miTipo());
            const p = fuera ? null : await panal.canTakeBoardJob(d.cuenta, id).catch(() => null);
            if (fuera) siguiente.push(`this wallet cannot take or bid on it: ${fuera}`);
            else if (p?.ok) siguiente.push(j.modo === ModoTablon.Inmediato ? 'take it with panal_take_board_job' : 'bid with panal_offer_board_job');
            else if (p) siguiente.push(`this wallet cannot take or bid on it: ${p.motivo}`);
          }
        } else if (j.estado === EstadoTablon.Asignado) {
          if (soyAgente) siguiente.push('read the brief with include_brief, and deliver with panal_deliver_board_job');
          if (soyCliente) {
            if (confidencial) {
              siguiente.push('if the agent cannot read it yet (it was assigned automatically, or the access failed), give it access with panal_grant_board_access');
            }
            siguiente.push('read the delivery with panal_board_result, then panal_approve_board_job or panal_dispute_board_job');
          }
          siguiente.push('once the escrow is done (approved, released after 72 h, or cancelled past the deadline), panal_close_board_job settles it');
        }
        if (siguiente.length) lineas.push(`  Next for this wallet: ${siguiente.join('; ')}.`);

        if (args.include_brief === true) {
          if (!d.cuenta) lineas.push('\nThe brief needs a wallet: this server has none.');
          else if (!soyCliente && !soyAgente) lineas.push('\nOnly the client and the assigned agent can read the brief.');
          else {
            try {
              const brief = await panal.readBoardJobBrief(id);
              lineas.push(
                `\nThe brief (checked against its hash on chain):\n\n${stripFilesManifest(brief)}` +
                  listaDeArchivos('Files with the job', parseAttachmentsManifest(brief), `Download them with panal_download_board_file job_id ${id} from "job".`),
              );
            } catch (err) {
              lineas.push(`\nCould not read the brief: ${fallo(err)}`);
            }
          }
        }
        return lineas.filter(Boolean).join('\n');
      },
    },
  ];

  /* ── escritura (y lo que necesita la wallet) ─────────────────────────── */

  const escritura: Herramienta[] = [
    {
      name: 'panal_board_mine',
      description:
        'This wallet on the board with rules. As a client: the jobs it posted, where each one is, and the ' +
        'refunds the board owes it. As an agent: its level, today\'s quota, newcomer jobs left, any suspension, ' +
        'its categories, its open offers and the jobs it has to deliver. Needs a wallet; spends nothing.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const no = disponible();
        if (no) return no;
        if (!d.cuenta) return 'This server has no wallet (MCP_PRIVATE_KEY), so there is no "mine" to show.';
        const yo = d.cuenta;
        const yoLc = yo.toLowerCase();
        await d.refrescarPrecios();
        try {
          const [encargos, situacion, debeMon, debePanal] = await Promise.all([
            panal.listBoardJobs({ limit: 200, estado: 'todos' }),
            panal.boardStanding(yo),
            panal.getBoardRefund(yo, NATIVE_CURRENCY),
            panal.getBoardRefund(yo, panal.addresses.panalToken),
          ]);
          const ahora = ahoraS();
          const publicados = encargos.filter((j) => j.cliente.toLowerCase() === yoLc);
          const asignados = encargos.filter((j) => j.agente.toLowerCase() === yoLc);
          const conOferta: EncargoConReglas[] = [];
          for (const j of encargos.filter((x) => x.estado === EstadoTablon.Publicado && x.modo === ModoTablon.Seleccion).slice(0, 30)) {
            const ofertas = await panal.getBoardOffers(j.id).catch(() => []);
            if (ofertas.some((o) => o.agente.toLowerCase() === yoLc)) conOferta.push(j);
          }

          const lineas: string[] = [`Wallet ${yo} on the board with rules.`];
          lineas.push('\nAs an agent:');
          lineas.push(
            `  Level ${situacion.nivel}` +
              (situacion.nivel === 0
                ? ` (newcomer: ${situacion.novatoLibres} newcomer job(s) left, one at a time)`
                : ` · ${situacion.hoyLibres} of ${situacion.cupoDiario} left today · ${situacion.abiertos} in progress`),
          );
          if (situacion.suspendidoHasta > ahora) {
            lineas.push(`  SUSPENDED until ${new Date(situacion.suspendidoHasta * 1000).toISOString()} for a recent strike.`);
          }
          lineas.push(
            `  Categories: ${situacion.categorias.length ? situacion.categorias.map((c) => categoriaDelTablon(c) ?? c).join(', ') : 'none — it cannot take or bid on anything; declare them with panal_set_board_categories'}`,
          );
          if (conOferta.length) lineas.push(`  Open offers on: ${conOferta.map((j) => `#${j.id}`).join(', ')}`);
          const porEntregar = asignados.filter((j) => j.estado === EstadoTablon.Asignado);
          if (porEntregar.length) {
            lineas.push('  Assigned to this wallet:');
            for (const j of porEntregar) lineas.push(`    ${cabecera(j, ahora)} — read it with panal_board_job include_brief`);
          }

          lineas.push('\nAs a client:');
          if (!publicados.length) lineas.push('  It has posted nothing on this board.');
          for (const j of publicados.slice(0, 20)) lineas.push(`  ${cabecera(j, ahora)} · ${ESTADO[j.estado]}`);
          const deudas = [
            debeMon > 0n ? importe(debeMon, NATIVE_CURRENCY) : null,
            debePanal > 0n ? importe(debePanal, panal.addresses.panalToken) : null,
          ].filter(Boolean);
          if (deudas.length) lineas.push(`  The board owes this wallet ${deudas.join(' and ')}: collect it with panal_withdraw.`);
          return lineas.join('\n');
        } catch (err) {
          return `Could not read this wallet's board state: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_post_board_job',
      description:
        'Post a job on the board with rules and LOCK THE REAL PAYMENT in the PanalTablon contract. The advert is ' +
        'public; the brief is private (only the agent that gets it reads it); only their hashes go on chain. ' +
        'Mode "selection" (default): agents bid a price and a deadline during offer_hours, then you choose ' +
        'within choose_hours, or the best offer by the rules gets it. Mode "immediate": the first agent that ' +
        'passes the rules takes it at your price. category is one of: ' + LISTA_CATEGORIAS + '. ' +
        'audience "people" makes it people-only (always selection, you pick the person) and "agents" agents-only; ' +
        'it goes in the advert, since the contract cannot tell a person from a program. ' +
        'Counts against this server\'s budget for that currency. Requires an explicit yes from the person after ' +
        'seeing the amount, mode, category and deadlines. If the texts failed to reach the mailbox, call it ' +
        'again with retry_job_id and the SAME advert and brief: that only re-sends the texts.',
      inputSchema: {
        type: 'object',
        properties: {
          advert: { type: 'string', description: 'Public text everyone reads (max 500 chars). Nothing private.' },
          brief: { type: 'string', description: 'The private job, exactly as the agent will receive it.' },
          category: { type: 'string', description: 'A category name or number.' },
          amount: { type: 'string', description: 'What you pay, e.g. "1.5". In selection, the budget.' },
          currency: { type: 'string', description: '"MON" (default) or "PANAL".' },
          mode: { type: 'string', description: '"selection" (default) or "immediate".' },
          audience: { type: 'string', description: '"everyone" (default), "people" or "agents".' },
          delivery_hours: { type: 'number', description: 'Time to deliver once assigned. At least 1. Default 72.' },
          open_hours: { type: 'number', description: 'How long it can be taken. Default 72.' },
          offer_hours: { type: 'number', description: 'Selection: time to make offers. Default 2.' },
          choose_hours: { type: 'number', description: 'Selection: time to choose after offers close (max 168). Default 24.' },
          experienced_only: { type: 'boolean', description: 'Only agents at level 1 or higher.' },
          relist: { type: 'boolean', description: 'If the agent does not deliver, post it again instead of refunding.' },
          confidential: {
            type: 'boolean',
            description:
              'Selection only. Encrypt the brief and its files end to end: only this wallet and the agent it picks can read them, not even Panal\'s mailbox. Only agents with a published encryption key can be picked. The advert stays public.',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional: paths of files on this machine to send with the job (at most ${MAX_ARCHIVOS_TABLON}, 25 MB each, 30 MB in total). Their hashes go inside the brief, so the chain covers them.`,
          },
          retry_job_id: { type: 'string', description: 'Only re-send the texts (and files) of an already posted job.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person approved posting and paying.' },
        },
        required: ['advert', 'brief', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'post a job');
        if (no) return no;
        const textoAnuncio = texto(args.advert);
        // El encargo tal cual: su hash es lo que va a la cadena.
        const encargo = typeof args.brief === 'string' ? args.brief : '';
        if (!textoAnuncio || !encargo.trim()) return 'Both advert and brief are needed.';
        const audiencia = AUDIENCIA_DE_TEXTO[(texto(args.audience) ?? 'everyone').toLowerCase()];
        if (!audiencia) return 'audience is "everyone", "people" or "agents".';
        // Para quién va delante del anuncio, y su hash lo deja fijo. Reintentar
        // lo vuelve a componer igual, así que hay que pasar la misma audiencia.
        const anuncio = anuncioPara(audiencia, textoAnuncio);
        const adjuntos = archivosDeRutas(args.files);
        if (typeof adjuntos === 'string') return `Not posted, nothing was spent: ${adjuntos}`;

        const reintento = args.retry_job_id === undefined ? null : parseJobId(args.retry_job_id);
        if (args.retry_job_id !== undefined) {
          if (reintento === null) return 'retry_job_id must be a board job number.';
          // Uno confidencial no se puede volver a componer —el cifrado es
          // aleatorio—: se reenvía la copia que se guardó al publicarlo.
          const guardado = publicadosCifrados.get(reintento.toString());
          if (guardado) {
            try {
              await panal.publishBoardJobTexts(reintento, { anuncio: guardado.anuncio, encargo: guardado.encargo });
              await panal.publishBoardJobFiles(reintento, guardado.archivos);
              return `Texts${guardado.archivos.length ? ' and files' : ''} of confidential board job #${reintento} are in the mailbox now. Nothing was charged.`;
            } catch (err) {
              return `The mailbox still did not take them: ${fallo(err)}. Nothing was charged. Try again in a while.`;
            }
          }
          try {
            // El mismo encargo que se hasheó: el texto con los adjuntos anunciados.
            const encargoFinal = appendAttachmentsManifest(encargo, adjuntos.map((a) => attachmentFrom(a.name, a.bytes, a.mime)));
            await panal.publishBoardJobTexts(reintento, { anuncio, encargo: encargoFinal });
            await panal.publishBoardJobFiles(reintento, adjuntos);
            return `Texts${adjuntos.length ? ' and files' : ''} of board job #${reintento} are in the mailbox now. Nothing was charged.`;
          } catch (err) {
            return `The mailbox still did not take them: ${fallo(err)}. Nothing was charged. They must be the exact texts and files that were posted.`;
          }
        }

        const categoria = categoriaDeTexto(texto(args.category) ?? '');
        if (categoria === null) return `category is required and must be one of: ${LISTA_CATEGORIAS}.`;
        const moneda = monedaDe(texto(args.currency));
        if (!moneda) return 'currency is "MON" or "PANAL".';
        const cuanto = parseImporte(args.amount);
        if (cuanto === null || cuanto === 0n) return 'amount must be a positive number, like "1.5".';
        const modo = (texto(args.mode) ?? 'selection').toLowerCase() === 'immediate' ? ModoTablon.Inmediato : ModoTablon.Seleccion;
        if (audiencia === 'personas' && modo === ModoTablon.Inmediato) {
          return 'Not posted, nothing was spent: a people-only job goes in selection mode, so you pick the person. In immediate mode the first one that passes the rules would take it, and the contract cannot tell a person from a program.';
        }
        const horas = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def);

        const p: PublicarEnElTablon = {
          anuncio,
          encargo,
          categoria,
          importe: cuanto,
          moneda,
          plazoEntregaS: Math.round(horas(args.delivery_hours, 72) * 3600),
          caducaEnS: Math.round(horas(args.open_hours, 72) * 3600),
          modo,
          ventanaOfertasS: Math.round(horas(args.offer_hours, 2) * 3600),
          ventanaEleccionS: Math.round(horas(args.choose_hours, 24) * 3600),
          soloConExperiencia: args.experienced_only === true,
          republicar: args.relist === true,
          adjuntos,
          confidencial: args.confidential === true,
        };
        const problema = problemaAlPublicar(p);
        if (problema) return `Not posted, nothing was spent: ${problema}`;
        const simbolo = d.simbolo(moneda);
        const presupuesto = d.revisarPresupuesto(moneda, cuanto, simbolo);
        if (presupuesto) return presupuesto;

        // Antes de cobrar nada: sin buzón, el encargo quedaría pagado y mudo.
        try {
          const res = await fetch(`${panal.buzonUrl}/${tablon()}/lista`, { signal: AbortSignal.timeout(10_000) });
          const cuerpo = res.ok ? ((await res.json()) as { anuncios?: unknown }) : null;
          if (!cuerpo || !Array.isArray(cuerpo.anuncios)) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          return `Not posted, nothing was spent: the board's mailbox does not answer (${fallo(err)}), and a job without its texts could not be read by anyone. Try again later.`;
        }

        try {
          const r = await panal.postBoardJob(p);
          if (p.confidencial) publicadosCifrados.set(r.jobId.toString(), { anuncio, encargo: r.encargo, archivos: r.archivos });
          d.registrarGasto(moneda, cuanto);
          d.log(`publicado en el tablón #${r.jobId} por ${formatEther(cuanto)} ${simbolo}`);
          return [
            `Posted: board job #${r.jobId}, ${importe(cuanto, moneda)} locked in PanalTablon.`,
            `  tx: ${tx(r.txHash)}`,
            r.textosGuardados && r.archivosGuardados
              ? `  Advert and brief${adjuntos.length ? ` and ${adjuntos.length} file(s)` : ''} are in the mailbox.`
              : `  WARNING: the ${r.textosGuardados ? 'files' : 'texts'} did NOT reach the mailbox (${r.error}). Call panal_post_board_job again with retry_job_id ${r.jobId} and the same advert, brief and files: that only re-sends them.`,
            p.confidencial
              ? '  Confidential: the brief and its files are encrypted for this wallet. Only agents with a published encryption key can be chosen, and choosing one gives it access.'
              : null,
            modo === ModoTablon.Seleccion
              ? `Agents can bid for ${duracion(p.ventanaOfertasS!)}. Follow it with panal_board_job ${r.jobId}.`
              : `The first agent that passes the rules takes it. Follow it with panal_board_job ${r.jobId}.`,
          ]
            .filter(Boolean)
            .join('\n');
        } catch (err) {
          return `Could not post: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_choose_board_offer',
      description:
        'As the client of a selection job, choose an offer once offers are closed: the job goes to that agent ' +
        'and its price to the escrow. If the offer is below the budget, the rest can be collected with ' +
        'panal_withdraw; if it is ABOVE the budget, the difference is paid now and counts against the budget. ' +
        'Requires an explicit yes from the person.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          agent: { type: 'string', description: 'The address of the agent whose offer is chosen.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person chose this offer.' },
        },
        required: ['job_id', 'agent', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'choose an offer');
        if (no) return no;
        const id = parseJobId(args.job_id);
        const agente = texto(args.agent);
        if (id === null || !agente || !/^0x[0-9a-fA-F]{40}$/.test(agente)) return 'job_id and a valid agent address are needed.';
        const j = await leerEncargo(id);
        if (typeof j === 'string') return j;
        const ofertas = await panal.getBoardOffers(id).catch(() => [] as OfertaConReglas[]);
        const o = ofertas.find((x) => x.agente.toLowerCase() === agente.toLowerCase());
        if (!o) return `${agente} has no offer on board job #${id}.`;
        // Quien publicó dijo para quién era: el contrato dejaría elegir a cualquiera.
        const audiencia = await audienciaDe(j);
        if (audiencia !== 'todos') {
          const tipo = await panal.getAgent(o.agente).then((a) => leerTipo(a.metadataURI)).catch(() => null);
          if (tipo && !audienciaAdmite(audiencia, tipo)) {
            return `Board job #${id} is for ${NOMBRE_AUDIENCIA[audiencia]}, and ${o.agente}'s profile says it is ${tipo === 'persona' ? 'a person' : 'a program'}. Choose another offer.`;
          }
        }
        const diferencia = o.precio > j.importe ? o.precio - j.importe : 0n;
        if (diferencia > 0n) {
          const presupuesto = d.revisarPresupuesto(j.moneda, diferencia, d.simbolo(j.moneda));
          if (presupuesto) return presupuesto;
        }
        try {
          const r = await panal.chooseBoardOffer(id, o.agente);
          if (diferencia > 0n) d.registrarGasto(j.moneda, diferencia);
          return [
            `Board job #${id} assigned to ${o.agente} for ${importe(o.precio, j.moneda)} (escrow task #${r.escrowTaskId}).`,
            `  tx: ${tx(r.txHash)}`,
            diferencia > 0n
              ? `  You added ${importe(diferencia, j.moneda)} to cover an offer above the budget.`
              : o.precio < j.importe
                ? `  ${importe(j.importe - o.precio, j.moneda)} was left over: collect it with panal_withdraw.`
                : null,
            r.acceso?.ok === true
              ? '  Confidential: the agent was given access to the brief and its files.'
              : r.acceso?.ok === false
                ? `  WARNING: the job is the agent's, but giving it access to the confidential brief failed (${r.acceso.error}). Retry with panal_grant_board_access ${id}: until then it cannot read what to do.`
                : null,
            `The agent has ${duracion(o.plazoEntregaS)} to deliver. Then read it with panal_board_result.`,
          ]
            .filter(Boolean)
            .join('\n');
        } catch (err) {
          return `Could not choose: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_board_result',
      description:
        'As the client of a board job, read what the agent delivered. It comes from the board\'s mailbox and is ' +
        'checked against the hash anchored in the escrow, so the mailbox cannot change it. Signs a read ' +
        'credential (no transaction, no money).',
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'The board job number.' } },
        required: ['job_id'],
      },
      handler: async (args) => {
        const no = disponible();
        if (no) return no;
        if (!d.cuenta) return 'Reading a delivery needs this server\'s wallet (MCP_PRIVATE_KEY) to sign: there is none.';
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        try {
          const entrega = await panal.readBoardJobResult(id);
          return (
            `The delivery of board job #${id} (checked against the hash on chain):\n\n${stripFilesManifest(entrega)}` +
            listaDeArchivos('Delivered files', parseFilesManifest(entrega), `Download them with panal_download_board_file job_id ${id} from "delivery".`) +
            '\n\nApprove with panal_approve_board_job, or dispute with panal_dispute_board_job.'
          );
        } catch (err) {
          return `Could not read the delivery: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_approve_board_job',
      description:
        'As the client, approve the delivery of a board job: RELEASES THE PAYMENT to the agent, leaves a 1-5 ' +
        'rating that feeds its level, and closes the job. Only after the person has seen the delivery and ' +
        'decided the score.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          rating: { type: 'number', description: 'The 1-5 rating the person decided.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person approved it.' },
        },
        required: ['job_id', 'rating', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'release the payment');
        if (no) return no;
        const id = parseJobId(args.job_id);
        const nota = Number(args.rating);
        if (id === null) return 'job_id must be a board job number.';
        if (!Number.isInteger(nota) || nota < 1 || nota > 5) return 'The rating is an integer from 1 to 5.';
        try {
          const hash = await panal.approveBoardJob(id, nota);
          return `Payment released for board job #${id} with a ${nota}/5 rating, and the job is closed.\n  tx: ${tx(hash)}`;
        } catch (err) {
          return `Could not approve: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_dispute_board_job',
      description:
        'As the client, dispute the delivery of a board job: the payment stays frozen and Panal\'s 2-of-3 ' +
        'multisig resolves it. If nobody resolves it within 14 days, the money comes back. Requires an ' +
        'explicit yes from the person.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person decided to dispute.' },
        },
        required: ['job_id', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'open a dispute');
        if (no) return no;
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        try {
          const hash = await panal.disputeBoardJob(id);
          return [
            `Dispute opened on board job #${id}. The multisig resolves it; follow it with panal_board_job.`,
            `  tx: ${tx(hash)}`,
            await accesoParaQuienDecide(id),
          ]
            .filter(Boolean)
            .join('\n');
        } catch (err) {
          return `Could not open the dispute: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_grant_board_access',
      description:
        'For a CONFIDENTIAL board job (its brief is encrypted): give access to whoever has to read it. to "agent": ' +
        'as the client, give the assigned agent access to the brief and its files — it happens when choosing an ' +
        'offer; this is for a job assigned automatically or an access that failed. to "deciders": as a party in a ' +
        'dispute, give the multisig signers access to what this wallet can read, so they can decide. Repeating it ' +
        'does not duplicate anything. Signs messages only: no transaction, no money.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          to: { type: 'string', description: '"agent" (default) or "deciders".' },
        },
        required: ['job_id'],
      },
      handler: async (args) => {
        const no = disponible();
        if (no) return no;
        if (!d.cuenta) return 'Giving access needs this server\'s wallet (MCP_PRIVATE_KEY) to sign: there is none.';
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        const a = (texto(args.to) ?? 'agent').toLowerCase();
        if (a === 'deciders') return (await accesoParaQuienDecide(id))?.trim() ?? `Nothing in board job #${id} is encrypted: the deciders can read it as it is.`;
        if (a !== 'agent') return 'to is "agent" or "deciders".';
        try {
          const n = await panal.grantBoardJobAccess(id);
          return n === 0
            ? `Nothing in board job #${id} is encrypted: its agent can read it as it is.`
            : `The agent of board job #${id} was given access to the brief and its files (${n} item(s)). It can read them now.`;
        } catch (err) {
          return `Could not give access: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_close_board_job',
      description:
        'Move a board job along when it is stuck, choosing the right step: the client WITHDRAWS a job nobody has ' +
        'yet (money back); anyone EXPIRES one nobody took in time (money back to the client); anyone SETTLES an ' +
        'assigned one whose escrow is done — approved, released after 72 h, or cancelled past its deadline — ' +
        'which pays the agent or refunds the client and frees the agent\'s quota. With action "assign_best", ' +
        'anyone assigns a selection job whose client did not choose in time to the best offer by the rules. ' +
        'Refunds are CREDITED in the board: collect them with panal_withdraw. Costs gas.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          action: { type: 'string', description: 'Optional: "withdraw", "expire", "settle" or "assign_best". Default: the one that applies.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person asked for it.' },
        },
        required: ['job_id', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'close a job');
        if (no) return no;
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        const j = await leerEncargo(id);
        if (typeof j === 'string') return j;
        const ahora = ahoraS();
        let accion = texto(args.action)?.toLowerCase();
        if (!accion) {
          if (j.estado === EstadoTablon.Asignado) accion = 'settle';
          else if (j.estado === EstadoTablon.Publicado) accion = ahora > ultimoParaAsignar(j) ? 'expire' : 'withdraw';
          else return `Board job #${id} is ${ESTADO[j.estado]}: there is nothing left to close.`;
        }
        try {
          const hash =
            accion === 'withdraw'
              ? await panal.withdrawBoardJob(id)
              : accion === 'expire'
                ? await panal.expireBoardJob(id)
                : accion === 'settle'
                  ? await panal.settleBoardJob(id)
                  : accion === 'assign_best'
                    ? await panal.autoAssignBoardJob(id)
                    : null;
          if (hash === null) return 'action is "withdraw", "expire", "settle" or "assign_best".';
          const hecho = {
            withdraw: 'withdrawn: the money is credited back to the client',
            expire: 'expired: the money is credited back to the client',
            settle: 'settled: the books are closed',
            assign_best: 'assigned to the best offer by the rules',
          }[accion as 'withdraw' | 'expire' | 'settle' | 'assign_best'];
          return `Board job #${id} ${hecho}.\n  tx: ${tx(hash)}\nAnything credited to this wallet is collected with panal_withdraw.`;
        } catch (err) {
          const m = fallo(err);
          if (/NotFinished/.test(m)) return `Board job #${id} cannot be settled yet: the escrow has not finished (delivered less than 72 h ago, or still open within its deadline).`;
          return `Could not ${accion}: ${m}`;
        }
      },
    },
    {
      name: 'panal_set_board_categories',
      description:
        'As an agent, declare up to three categories on the board with rules. The contract only lets an agent ' +
        `take or bid on jobs in its own categories. They are: ${LISTA_CATEGORIAS}. Replaces the previous ones. Costs gas.`,
      inputSchema: {
        type: 'object',
        properties: {
          categories: { type: 'string', description: 'Comma-separated names or numbers, up to three.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person chose them.' },
        },
        required: ['categories', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'change the categories');
        if (no) return no;
        const entradas = (texto(args.categories) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const numeros: number[] = [];
        for (const e of entradas) {
          const n = categoriaDeTexto(e);
          if (n === null) return `"${e}" is not a category. They are: ${LISTA_CATEGORIAS}.`;
          if (!numeros.includes(n)) numeros.push(n);
        }
        if (numeros.length === 0 || numeros.length > MAX_CATEGORIAS) return `Between 1 and ${MAX_CATEGORIAS} categories.`;
        try {
          const hash = await panal.setBoardCategories(numeros);
          return `Categories on the board: ${numeros.map((n) => categoriaDelTablon(n)).join(', ')}.\n  tx: ${tx(hash)}`;
        } catch (err) {
          return `Could not set the categories: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_take_board_job',
      description:
        'As an agent, take an IMMEDIATE board job: it is assigned to this wallet at once and its private brief is ' +
        'returned. Taking is a commitment: not delivering in time costs a strike and a 7-day suspension. The ' +
        'contract checks level, quota, category and suspensions first, and the reason comes back if it says no. ' +
        'Calling it again on a job this wallet already has only re-reads the brief. Selection jobs are bid on ' +
        'with panal_offer_board_job. Costs gas.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person asked to take it.' },
        },
        required: ['job_id', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'take a job');
        if (no) return no;
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        const j = await leerEncargo(id);
        if (typeof j === 'string') return j;
        let cabeza: string;
        if (j.estado === EstadoTablon.Asignado && j.agente.toLowerCase() === d.cuenta!.toLowerCase()) {
          cabeza = `Board job #${id} was already this wallet's.`;
        } else {
          if (j.modo === ModoTablon.Seleccion) return `Board job #${id} is in selection mode: bid on it with panal_offer_board_job.`;
          // Para quién es: lo dice el anuncio, no el contrato, así que se mira aquí.
          const fuera = fueraDeAudiencia(await audienciaDe(j), await miTipo());
          if (fuera) return `This wallet cannot take board job #${id}: ${fuera}.`;
          // Las reglas antes de firmar, con el motivo del contrato tal cual.
          const permiso = await panal.canTakeBoardJob(d.cuenta!, id).catch(() => null);
          if (permiso && !permiso.ok) return `This wallet cannot take board job #${id}: ${permiso.motivo}.`;
          try {
            const r = await panal.takeBoardJob(id);
            d.log(`cogido del tablón #${id}`);
            cabeza = `Board job #${id} is yours (escrow task #${r.escrowTaskId}). Deliver within ${duracion(j.plazoEntregaS)}.\n  tx: ${tx(r.txHash)}`;
          } catch (err) {
            return `Could not take board job #${id}: ${fallo(err)}`;
          }
        }
        try {
          const brief = await panal.readBoardJobBrief(id);
          return (
            `${cabeza}\n\nThe brief (checked against its hash on chain):\n\n${stripFilesManifest(brief)}` +
            listaDeArchivos('Files with the job', parseAttachmentsManifest(brief), `Download them with panal_download_board_file job_id ${id} from "job".`) +
            '\n\nWhen the work is done, deliver it with panal_deliver_board_job.'
          );
        } catch (err) {
          return `${cabeza}\nBut the brief could not be read yet: ${fallo(err)}\nCalling panal_take_board_job again re-reads it without taking twice.`;
        }
      },
    },
    {
      name: 'panal_offer_board_job',
      description:
        'As an agent, bid on a SELECTION board job: a price (it may be above the budget; then only the client can ' +
        'pick it, paying the difference) and, optionally, a shorter delivery time. Calling it again changes the ' +
        'offer; withdraw: true removes it while offers are open. If the client picks it — or the contract does, ' +
        'by the rules — the job is assigned to this wallet: read the brief with panal_board_job include_brief. ' +
        'Costs gas.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          price: { type: 'string', description: 'The price asked, in the job\'s currency, e.g. "0.8".' },
          delivery_hours: { type: 'number', description: 'Optional: delivery time, at most the job\'s.' },
          withdraw: { type: 'boolean', description: 'Remove this wallet\'s offer instead.' },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person approved the offer.' },
        },
        required: ['job_id', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'make an offer');
        if (no) return no;
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        if (args.withdraw === true) {
          try {
            return `Offer on board job #${id} withdrawn.\n  tx: ${tx(await panal.withdrawBoardOffer(id))}`;
          } catch (err) {
            return `Could not withdraw the offer: ${fallo(err)}`;
          }
        }
        const j = await leerEncargo(id);
        if (typeof j === 'string') return j;
        if (j.modo !== ModoTablon.Seleccion) return `Board job #${id} is immediate: take it with panal_take_board_job.`;
        const precio = parseImporte(args.price);
        if (precio === null || precio === 0n) return 'price must be a positive number, like "0.8".';
        const segundos = typeof args.delivery_hours === 'number' && args.delivery_hours > 0 ? Math.round(args.delivery_hours * 3600) : 0;
        const fuera = fueraDeAudiencia(await audienciaDe(j), await miTipo());
        if (fuera) return `This wallet cannot bid on board job #${id}: ${fuera}.`;
        const permiso = await panal.canTakeBoardJob(d.cuenta!, id).catch(() => null);
        if (permiso && !permiso.ok) return `This wallet cannot bid on board job #${id}: ${permiso.motivo}.`;
        try {
          const hash = await panal.offerOnBoardJob(id, precio, segundos);
          return [
            `Offer on board job #${id}: ${importe(precio, j.moneda)}, delivery in ${duracion(segundos || j.plazoEntregaS)}.`,
            `  tx: ${tx(hash)}`,
            precio > j.importe ? '  It is above the budget: only the client can pick it, paying the difference.' : null,
          ]
            .filter(Boolean)
            .join('\n');
        } catch (err) {
          return `Could not make the offer: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_deliver_board_job',
      description:
        'As the agent of a board job, deliver the work. The text is left in the board\'s mailbox first, signed ' +
        'with its hash inside, and only then its hash is anchored in the escrow — so the client can always read ' +
        'what was anchored. If the mailbox refuses it, nothing is anchored and it can be retried. With files, ' +
        'they are uploaded first and their hashes go inside the anchored text. Costs gas.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          result: { type: 'string', description: 'The finished work, exactly as the client will receive it.' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: `Optional: paths of files on this machine to deliver (at most ${MAX_ARCHIVOS_TABLON}, 25 MB each, 30 MB in total).`,
          },
          confirmed_by_user: { type: 'boolean', description: 'true only if the person approved delivering this.' },
        },
        required: ['job_id', 'result', 'confirmed_by_user'],
      },
      handler: async (args) => {
        const no = puedeEscribir(args, 'deliver');
        if (no) return no;
        // Tal cual, sin recortar: lo que se ancla es el hash de estos bytes.
        const resultado = typeof args.result === 'string' ? args.result : '';
        const archivos = archivosDeRutas(args.files);
        if (typeof archivos === 'string') return `Nothing was delivered: ${archivos}`;
        if (!resultado.trim() && archivos.length === 0) return 'result is empty: there is nothing to deliver.';
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        try {
          const { txHash, resultHash } = await panal.deliverBoardJob(id, resultado, archivos);
          d.log(`entregado del tablón #${id}`);
          return (
            `Board job #${id} delivered${archivos.length ? ` with ${archivos.length} file(s)` : ''}.\n  tx: ${tx(txHash)}\n  result hash: ${resultHash}\n\n` +
            'The client can now read it and approve. Once approved, the payment is CREDITED in the escrow: ' +
            'collect it with panal_withdraw. If the client does nothing for 72 h, panal_close_board_job settles it.'
          );
        } catch (err) {
          return `Could not deliver board job #${id}: ${fallo(err)}`;
        }
      },
    },
    {
      name: 'panal_download_board_file',
      description:
        'Download the files of a board job to this machine, each one checked byte by byte against the hash in ' +
        'the anchored text: from "job", the files the client sent with it (its client and its agent can); from ' +
        '"delivery", the files the agent delivered (its client can). Signs a read credential (no transaction, ' +
        'no money). Files land in MCP_DOWNLOAD_DIR.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The board job number.' },
          from: { type: 'string', description: '"job" (the attachments) or "delivery" (the delivered files).' },
          file: { type: 'string', description: 'Optional: the name of one file. Without it, all of them.' },
        },
        required: ['job_id', 'from'],
      },
      handler: async (args) => {
        const no = disponible();
        if (no) return no;
        if (!d.cuenta) return 'Downloading needs this server\'s wallet (MCP_PRIVATE_KEY) to sign: there is none.';
        const id = parseJobId(args.job_id);
        if (id === null) return 'job_id must be a board job number.';
        const de = texto(args.from)?.toLowerCase() === 'delivery' ? 'entrega' : texto(args.from)?.toLowerCase() === 'job' ? 'adjunto' : null;
        if (!de) return 'from is "job" or "delivery".';
        try {
          // El hash sale del texto anclado —encargo o entrega—, nunca del buzón.
          const anunciados =
            de === 'adjunto' ? parseAttachmentsManifest(await panal.readBoardJobBrief(id)) : parseFilesManifest(await panal.readBoardJobResult(id));
          const pedido = texto(args.file);
          const lista = pedido ? anunciados.filter((f) => f.name === pedido) : anunciados;
          if (anunciados.length === 0) return `Board job #${id} has no files ${de === 'adjunto' ? 'with the job' : 'in its delivery'}.`;
          if (lista.length === 0) return `"${pedido}" is not one of them: ${anunciados.map((f) => f.name).join(', ')}.`;
          const bytes = await panal.downloadBoardJobFiles(id, lista, de);
          const guardados = lista.map((f, i) => `  ${f.name} (${tamano(f.size)}) → ${d.guardarDescarga(f.name, bytes[i]!)}`);
          return `Downloaded and checked against the hash on chain:\n${guardados.join('\n')}`;
        } catch (err) {
          return `Could not download: ${fallo(err)}`;
        }
      },
    },
  ];

  return { lectura, escritura };
}

/**
 * Lo que el tablón le debe a una wallet, por moneda (MON y $PANAL). Para
 * `panal_wallet` y `panal_withdraw`: es dinero suyo que no aparece en el saldo.
 */
export async function deudaDelTablon(panal: PanalClient, quien: Address): Promise<{ moneda: Address; importe: bigint | null }[]> {
  if (!panal.boardJobsAvailable) return [];
  const monedas = [NATIVE_CURRENCY, panal.addresses.panalToken];
  return Promise.all(
    monedas.map(async (moneda) => ({ moneda, importe: await panal.getBoardRefund(quien, moneda).catch(() => null) })),
  );
}
