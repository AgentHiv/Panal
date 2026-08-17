/**
 * Panal SDK — el cliente.
 *
 *   import { createPanalClient } from '@panal/sdk';
 *
 *   const panal = createPanalClient();                 // solo lectura, mainnet
 *   const agents = await panal.searchAgents('traducción');
 *
 * Con una cuenta pasa a poder contratar:
 *
 *   import { privateKeyToAccount } from 'viem/accounts';
 *   const panal = createPanalClient({ account: privateKeyToAccount(key) });
 *   const { taskId } = await panal.hire({ agent, brief });
 *
 * Sin configuración apunta a Monad mainnet, que es donde Panal está desplegado
 * y en uso: el caso de "quiero probar esto ahora" no debería exigir un .env.
 */

import { createPublicClient, createWalletClient, formatEther, getAddress, http, keccak256, toBytes } from 'viem';
import type { Account, Address, Hex, PublicClient, WalletClient } from 'viem';
import { erc20Abi, escrowAbi, namesAbi, registryAbi } from './abis.js';
import { assertPublicUrl, fetchLimited } from './net.js';
import { X402Error, payAndAsk, quoteAsk, type AskResult, type X402Accept } from './x402.js';
import { descend, newEnvelope, remainingBudget, type CallEnvelope } from './envelope.js';
import { NATIVE_CURRENCY, addressesFor, chainFor, type PanalAddresses, type PanalNetwork } from './chains.js';
import {
  TaskStatus,
  formatAgentMetadata,
  parseAgentMetadata,
  type Agent,
  type AgentMetadata,
  type NombreDeAgente,
  type Task,
} from './types.js';

export interface PanalClientOptions {
  /** `mainnet` por defecto. */
  network?: PanalNetwork;
  /** RPC propio. Sin esto se usa el público, que limita a ~15 llamadas/s. */
  rpcUrl?: string;
  /** Necesaria solo para contratar y aprobar; leer no la requiere. */
  account?: Account;
  /** Sobrescribe direcciones concretas (para pruebas o un despliegue propio). */
  addresses?: Partial<PanalAddresses>;
  /**
   * Indexador desde el que buscar agentes. `https://api.panal.lat` por defecto.
   *
   * Buscar leyendo el registro entero deja de funcionar justo cuando más falta
   * hace: `searchAgents` pagina hasta 500 agentes y luego lanza 500 lecturas a
   * la vez, y el RPC público corta a partir de ~50 concurrentes. O sea que
   * cuantos más agentes hay, MENOS puede un agente encontrar a otro.
   *
   * Con el indexador es una petición. Si no responde, se vuelve al registro:
   * peor y con tope, pero nunca sin respuesta.
   *
   * `null` lo desactiva y lee siempre de la cadena.
   */
  indexerUrl?: string | null;
}

/** Cuántos agentes se leen por llamada al registry. */
const REGISTRY_PAGE = 50n;
/** Tope duro de agentes recorridos, por si el registro crece mucho. */
const REGISTRY_MAX = 500;

export interface HireParams {
  /** Dirección del agente que hará el trabajo. */
  agent: Address;
  /** El encargo. No viaja on-chain: solo su keccak256. */
  brief: string;
  /**
   * Cuánto pagar, en unidades mínimas. Por defecto el `pricePerTask` que el
   * agente publica, leído en el momento de contratar.
   */
  amount?: bigint;
  /** Plazo de entrega. Por defecto 24 h desde ahora. */
  deadline?: bigint;
}

export interface HireResult {
  taskId: bigint;
  txHash: Hex;
  amount: bigint;
  currency: Address;
  /** El hash del brief que quedó registrado, para poder probarlo después. */
  taskHash: Hex;
}

/**
 * ¿Esto que manda el indexador es un nombre de PanalNames?
 *
 * Se valida como todo lo que llega de un servicio: si viene a medias se
 * descarta, porque un `origen` inventado haria que la web avisara de una venta
 * que no existio, o peor, que callara una que si.
 */
/**
 * La skill pedida y, detrás, versiones cada vez más generales de ella.
 *
 * `searchAgents` exige que TODAS las palabras aparezcan, así que cuantas más
 * lleve la skill, menos gente la cumple. Quien escribe estas cadenas suele ser
 * un modelo, y un modelo pide "Spanish tax law" donde el mercado vende "tax".
 *
 * Se recorta POR LA IZQUIERDA porque en inglés el núcleo del sintagma va al
 * final: "Spanish tax law" → "tax law" → "law" sigue hablando de lo mismo.
 * Recortar por la derecha dejaría "Spanish", que casa con cualquier cosa
 * española y con nada de impuestos: peor que no encontrar a nadie, porque se
 * pagaría al agente equivocado.
 *
 * Nunca baja de una palabra y nunca devuelve duplicados, así que en el caso
 * normal —una o dos palabras, que es lo que el prompt pide— esto es una sola
 * búsqueda y no cambia nada.
 */
export function variantesDeSkill(skill: string): string[] {
  const palabras = skill.trim().split(/\s+/).filter(Boolean);
  if (palabras.length <= 1) return [skill.trim()].filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < palabras.length; i++) {
    const v = palabras.slice(i).join(' ');
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function esNombre(v: unknown): v is { nombre: string; desdeTs: number; origen: 'reclamado' | 'comprado' | 'recibido' } {
  if (v === null || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.nombre === 'string' &&
    n.nombre.length > 0 &&
    typeof n.desdeTs === 'number' &&
    (n.origen === 'reclamado' || n.origen === 'comprado' || n.origen === 'recibido')
  );
}

export class PanalClient {
  readonly network: PanalNetwork;
  readonly addresses: PanalAddresses;
  readonly publicClient: PublicClient;
  readonly account?: Account;
  /**
   * Público a propósito: quien monte la mitad servidor de x402 lo necesita para
   * ejecutar el `permit` y el `transferFrom` del cobro. Es undefined cuando el
   * cliente se creó sin cuenta, o sea en modo solo lectura.
   */
  readonly walletClient?: WalletClient;
  /** Indexador para buscar agentes, o null si se lee siempre de la cadena. */
  readonly indexerUrl: string | null;

  constructor(options: PanalClientOptions = {}) {
    this.network = options.network ?? 'mainnet';
    const chain = chainFor(this.network);
    this.addresses = { ...addressesFor(this.network), ...options.addresses };

    if (this.addresses.registry === NATIVE_CURRENCY || this.addresses.escrow === NATIVE_CURRENCY) {
      throw new Error(
        `Panal no tiene contratos desplegados en ${this.network}. ` +
          'Usa network: "mainnet", o pasa `addresses` con los tuyos.',
      );
    }

    this.indexerUrl = options.indexerUrl === undefined ? 'https://api.panal.lat' : options.indexerUrl;

    const transport = http(options.rpcUrl ?? chain.rpcUrls.default.http[0]);
    this.publicClient = createPublicClient({ chain, transport });
    this.account = options.account;
    if (options.account) {
      this.walletClient = createWalletClient({ chain, transport, account: options.account });
    }
  }

  /** El wallet client, o un error que dice exactamente qué falta. */
  private wallet(): WalletClient {
    if (!this.walletClient || !this.account) {
      throw new Error('Esta operación firma una transacción: crea el cliente con `account`.');
    }
    return this.walletClient;
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  /** Todos los agentes del registry, activos e inactivos. */
  async listAgents(): Promise<Agent[]> {
    const count = (await this.publicClient.readContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'getAgentCount',
    })) as bigint;

    const addresses: Address[] = [];
    const total = Math.min(Number(count), REGISTRY_MAX);
    for (let offset = 0n; offset < BigInt(total); offset += REGISTRY_PAGE) {
      const page = (await this.publicClient.readContract({
        address: this.addresses.registry,
        abi: registryAbi,
        functionName: 'getAgents',
        args: [offset, REGISTRY_PAGE],
      })) as readonly Address[];
      addresses.push(...page);
      if (page.length < Number(REGISTRY_PAGE)) break;
    }

    // `leerAgente` y no `getAgent`: este listado ya son N lecturas en paralelo
    // contra un RPC que corta sobre 50 concurrentes, y buscar el nombre de cada
    // uno las triplicaria. Quien quiera el nombre de uno concreto llama a
    // getAgent(); quien quiera el de todos tiene el indexador, que ya lo trae.
    return Promise.all(addresses.map((address) => this.leerAgente(address)));
  }

  /**
   * Los agentes que dice el indexador, o null si no se puede contar con él.
   *
   * Devuelve null —y no una lista vacía— cuando no responde, va atrasado o
   * contesta algo raro: quien llama tiene que poder distinguir «no hay
   * ninguno» de «no lo sé», porque en el segundo caso toca leer la cadena.
   */
  private async buscarEnIndice(
    query: string | undefined,
    options: { includeInactive?: boolean; skill?: string; limit?: number },
  ): Promise<Agent[] | null> {
    if (!this.indexerUrl) return null;
    try {
      const url = new URL('/index/agents', this.indexerUrl);
      if (query?.trim()) url.searchParams.set('q', query.trim());
      if (options.skill?.trim()) url.searchParams.set('skill', options.skill.trim());
      if (options.includeInactive) url.searchParams.set('include_inactive', 'true');
      url.searchParams.set('limit', String(Math.min(options.limit ?? 50, 200)));

      const res = await fetchLimited(url.toString(), { timeoutMs: 8000 });
      if (res.status !== 200) return null;
      const cuerpo = JSON.parse(res.text) as { agents?: unknown; total?: unknown };
      if (!Array.isArray(cuerpo.agents)) return null;

      // `total` solo lo devuelve la respuesta del CATÁLOGO. Sin esta
      // comprobación, un indexador viejo —que no entiende `q` ni `skill` pero
      // responde igual con su lista de siempre— hacía creer que había filtrado:
      // toda búsqueda devolvía todos los agentes, incluida una imposible.
      // Un servidor que no entiende la pregunta y contesta es peor que uno que
      // calla, porque no hay forma de notarlo desde fuera. Aquí sí.
      if (typeof cuerpo.total !== 'number') return null;

      const out: Agent[] = [];
      for (const raw of cuerpo.agents as Record<string, unknown>[]) {
        // El indexador es un servicio, o sea que su respuesta se valida como
        // la de cualquier desconocido: una ficha rota se descarta sin llevarse
        // la búsqueda entera por delante.
        const address = typeof raw.address === 'string' ? raw.address : null;
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
        const skills = Array.isArray(raw.skills) ? raw.skills.filter((x): x is string => typeof x === 'string') : [];
        let pricePerTask: bigint;
        let registeredAt: bigint;
        try {
          pricePerTask = BigInt(String(raw.pricePerTask ?? '0'));
          registeredAt = BigInt(Number(raw.registeredAt ?? 0));
        } catch {
          continue;
        }
        const metadata: AgentMetadata = {
          name: typeof raw.name === 'string' ? raw.name : '',
          description: typeof raw.description === 'string' ? raw.description : '',
          skills,
          botUrl: typeof raw.botUrl === 'string' ? raw.botUrl : null,
        };
        out.push({
          address: getAddress(address),
          owner: getAddress(typeof raw.owner === 'string' && /^0x[0-9a-fA-F]{40}$/.test(raw.owner) ? raw.owner : address),
          pricePerTask,
          currency: getAddress(
            typeof raw.currency === 'string' && /^0x[0-9a-fA-F]{40}$/.test(raw.currency) ? raw.currency : NATIVE_CURRENCY,
          ),
          active: raw.active !== false,
          registeredAt,
          metadataURI: formatAgentMetadata(metadata),
          metadata,
          // Solo `true` cuenta como verificado. Un indexador viejo no manda el
          // campo, y tratar «no lo sé» como «sí» es justo al revés de lo que
          // hay que hacer con una insignia de confianza.
          verificado: raw.verificado === true,
          ...(esNombre(raw.nombre) ? { nombre: raw.nombre } : {}),
        });
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * Un agente concreto, con su metadata interpretada y su nombre único.
   *
   * El nombre se lee de PanalNames EN LA CADENA, y por eso está aquí y no solo
   * en la ruta del indexador: el nombre del perfil es texto libre y se repite
   * —ahora mismo hay tres direcciones anunciándose como "LexPanal"—, mientras
   * que un nombre de PanalNames lo tiene una sola dirección. Es la única señal
   * de identidad que sigue en pie si el indexador se cae, porque no depende de
   * que nadie esté levantado: es una llamada `view`.
   *
   * No sustituye a la verificación de dominio, que prueba más: control de un
   * servidor que declara esta misma dirección. Prueba unicidad, no quién hay
   * detrás. Y como los nombres se venden, `desdeTs` importa tanto como el
   * nombre — pero `origen` se queda sin saber por esta ruta, porque sale de los
   * eventos del contrato y no de una lectura.
   */
  async getAgent(address: Address): Promise<Agent> {
    const base = await this.leerAgente(address);
    const nombre = await this.nombreEnCadena(address);
    return nombre ? { ...base, nombre } : base;
  }

  /** La ficha del registry, sin las lecturas de más. Lo que usa `listAgents`. */
  private async leerAgente(address: Address): Promise<Agent> {
    const raw = (await this.publicClient.readContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'getAgent',
      args: [getAddress(address)],
    })) as {
      owner: Address;
      metadataURI: string;
      pricePerTask: bigint;
      active: boolean;
      registeredAt: bigint;
      currency: Address;
    };

    return {
      address: getAddress(address),
      owner: raw.owner,
      pricePerTask: raw.pricePerTask,
      currency: raw.currency,
      active: raw.active,
      registeredAt: raw.registeredAt,
      metadataURI: raw.metadataURI,
      metadata: parseAgentMetadata(raw.metadataURI),
    };
  }

  /**
   * El nombre de PanalNames de una dirección, o null si no tiene.
   *
   * Nunca lanza: un agente sin nombre es lo normal, y que el contrato de
   * nombres no esté desplegado —testnet— tampoco puede impedir leer una ficha.
   * Devolver null y seguir es lo correcto; caerse aquí convertiría un dato
   * adicional en un fallo de la operación entera.
   */
  private async nombreEnCadena(address: Address): Promise<NombreDeAgente | null> {
    const names = this.addresses.names;
    if (!names || names === '0x0000000000000000000000000000000000000000') return null;
    try {
      const nombre = (await this.publicClient.readContract({
        address: names,
        abi: namesAbi,
        functionName: 'nombreDe',
        args: [getAddress(address)],
      })) as string;
      if (!nombre) return null;

      const ficha = (await this.publicClient.readContract({
        address: names,
        abi: namesAbi,
        functionName: 'fichaDe',
        args: [nombre],
      })) as readonly [Address, bigint, bigint, boolean];

      // `origen` a propósito ausente: por esta ruta no se sabe, y ponerle
      // 'reclamado' seria inventarse justo la parte que avisa de una compra
      // reciente.
      return { nombre, desdeTs: Number(ficha[1]) };
    } catch {
      return null;
    }
  }

  /**
   * Busca agentes activos por texto libre sobre nombre, descripción y skills.
   *
   * Sin `query` devuelve todos los activos. La búsqueda es del lado del cliente
   * porque el registry no indexa texto: son pocos agentes y una lectura
   * paginada sale más barata que montar un índice.
   */
  async searchAgents(
    query?: string,
    options: { includeInactive?: boolean; skill?: string; limit?: number } = {},
  ): Promise<Agent[]> {
    // Por el indexador primero. Leer el registro entero para buscar deja de
    // funcionar justo cuando más falta hace: son 500 lecturas a la vez contra
    // un RPC que corta a partir de ~50 concurrentes, y con más de 500 agentes
    // ni siquiera los ve. Aquí es una petición.
    const delIndice = await this.buscarEnIndice(query, options);
    if (delIndice !== null) return delIndice;

    const all = await this.listAgents();
    const pool = options.includeInactive ? all : all.filter((a) => a.active);
    if (!query?.trim()) return pool;

    const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pool.filter((agent) => {
      const haystack = [agent.metadata.name, agent.metadata.description, ...agent.metadata.skills]
        .join(' ')
        .toLowerCase();
      return needles.every((n) => haystack.includes(n));
    });
  }

  /** Una tarea por su id. */
  async getTask(taskId: bigint): Promise<Task> {
    // El ABI declara los campos con nombre, así que viem devuelve un objeto y
    // no una tupla: desestructurar por posición aquí compilaría pero leería
    // basura si algún día cambia el orden.
    const raw = (await this.publicClient.readContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'tasks',
      args: [taskId],
    })) as {
      client: Address;
      worker: Address;
      amount: bigint;
      taskHash: Hex;
      resultHash: Hex;
      deadline: bigint;
      createdAt: bigint;
      status: number;
      currency: Address;
    };

    return { id: taskId, ...raw };
  }

  /** Cuántas tareas se han creado en total (los ids van de 0 a este número - 1). */
  async getTaskCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'getTaskCount',
    })) as bigint;
  }

  /** Saldo acreditado y pendiente de retirar, por moneda. */
  async getPendingWithdrawal(account: Address, currency: Address = NATIVE_CURRENCY): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'pendingWithdrawals',
      args: [currency, getAddress(account)],
    })) as bigint;
  }

  // -------------------------------------------------------------------------
  // Escritura
  // -------------------------------------------------------------------------

  /**
   * Contrata a un agente: bloquea el pago en el escrow y crea la tarea.
   *
   * El brief no se sube a ningún sitio; lo que va on-chain es su keccak256. Se
   * lo tienes que hacer llegar tú al agente (por su endpoint, por el dashboard
   * o como quieras), y el hash sirve para demostrar después qué se encargó.
   *
   * Si el agente cobra en $PANAL, esto hace dos transacciones: el `approve` por
   * el importe exacto y luego `createTask`. En MON nativo va en una sola.
   */
  async hire(params: HireParams): Promise<HireResult> {
    const wallet = this.wallet();
    const agent = await this.getAgent(params.agent);
    if (!agent.active) throw new Error(`El agente ${params.agent} está dado de baja: no acepta encargos.`);

    const amount = params.amount ?? agent.pricePerTask;
    if (amount <= 0n) throw new Error('El importe tiene que ser mayor que cero.');
    const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
    const taskHash = keccak256(toBytes(params.brief));
    const isNative = agent.currency.toLowerCase() === NATIVE_CURRENCY.toLowerCase();

    // Antes de nada: ¿hay saldo? Fallar aquí da un mensaje claro; fallar dentro
    // del contrato da un revert sin contexto.
    await this.assertFunds(agent.currency, amount, isNative);

    if (!isNative) {
      // approve por el importe exacto, no infinito: si el escrow tuviera un
      // fallo, la exposición se limita a este encargo.
      const approveHash = await wallet.writeContract({
        address: agent.currency,
        abi: erc20Abi,
        functionName: 'approve',
        args: [this.addresses.escrow, amount],
        chain: chainFor(this.network),
        account: this.account!,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const txHash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'createTask',
      args: [agent.address, taskHash, deadline, agent.currency, amount],
      value: isNative ? amount : 0n,
      chain: chainFor(this.network),
      account: this.account!,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`createTask revirtió (tx ${txHash}).`);

    // El id es el contador ANTES de crear: se relee del recibo para no asumirlo.
    const taskId = (await this.getTaskCount()) - 1n;
    return { taskId, txHash, amount, currency: agent.currency, taskHash };
  }

  /**
   * Aprueba el resultado y libera el pago, con una valoración de 1 a 5.
   *
   * Si no apruebas ni disputas, el escrow libera el pago solo a las 72 h. Este
   * método existe para cobrar antes y, sobre todo, para que la valoración quede
   * registrada: sin ella el agente no construye reputación.
   */
  async approveTask(taskId: bigint, rating: number): Promise<Hex> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('La valoración es un entero de 1 a 5.');
    }
    const wallet = this.wallet();
    const task = await this.getTask(taskId);
    if (task.status !== TaskStatus.Delivered) {
      throw new Error(`La tarea #${taskId} está "${TaskStatus[task.status]}": solo se aprueba lo entregado.`);
    }
    const hash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'approveAndRelease',
      args: [taskId, rating],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Cancela una tarea que nunca arrancó y recupera lo bloqueado.
   *
   * El escrow solo lo permite al cliente, con la tarea todavía `Open` —o sea
   * sin entrega— y además vencido el plazo o sin worker asignado. Con worker
   * asignado hay que esperar al deadline: si no, el cliente podría retirarle
   * el encargo a alguien que ya está trabajando.
   *
   * Hace falta cuando el encargo no llegó a su destino y el pago sí: el brief
   * se entrega después de crear la tarea, así que un endpoint caído o un texto
   * que el agente rechaza dejan dinero parado hasta el plazo. Sin esto, la
   * única salida era llamar al contrato a mano.
   *
   * OJO: el escrow es pull payment. Esto ACREDITA el reembolso, no lo envía.
   * Para tenerlo en la wallet hay que llamar después a `withdraw()`.
   */
  async cancelTask(taskId: bigint): Promise<Hex> {
    const wallet = this.wallet();
    const task = await this.getTask(taskId);
    if (task.status !== TaskStatus.Open) {
      throw new Error(`La tarea #${taskId} está "${TaskStatus[task.status]}": solo se cancela lo que sigue abierto.`);
    }
    const hash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'cancelTask',
      args: [taskId],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Abre una disputa sobre una entrega, y con ello para el reloj.
   *
   * Urge más de lo que parece: si no apruebas ni disputas, el escrow libera el
   * pago solo a los 3 días de la entrega, con un 5/5 implícito. O sea que ante
   * una entrega mala, no hacer nada NO es neutral: es pagar y además regalar la
   * mejor valoración. Disputar es lo único que detiene esa cuenta atrás.
   *
   * La resuelve el arbitrator repartiendo el importe. Si no lo hace en 14 días,
   * cualquiera puede llamar a `resolveStuckDispute` y el cliente recupera todo.
   */
  async openDispute(taskId: bigint): Promise<Hex> {
    const wallet = this.wallet();
    const task = await this.getTask(taskId);
    if (task.status !== TaskStatus.Delivered) {
      throw new Error(`La tarea #${taskId} está "${TaskStatus[task.status]}": solo se disputa lo entregado.`);
    }
    const hash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'openDispute',
      args: [taskId],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // -------------------------------------------------------------------------
  // Lado del AGENTE — darse de alta, trabajar y entregar.
  // -------------------------------------------------------------------------

  /**
   * Registra tu agente en el marketplace. Lo llama la wallet que trabajará y
   * cobrará: en Panal el agente ES una dirección, no una fila en una base de
   * datos de alguien.
   */
  async registerAgent(params: {
    metadata: AgentMetadata;
    pricePerTask: bigint;
    /** `NATIVE_CURRENCY` (MON) o la dirección de $PANAL. */
    currency?: Address;
  }): Promise<Hex> {
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'registerAgent',
      args: [formatAgentMetadata(params.metadata), params.pricePerTask, params.currency ?? NATIVE_CURRENCY],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Cambia el nombre, la descripción, las skills o el endpoint publicados. */
  async updateMetadata(metadata: AgentMetadata): Promise<Hex> {
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'updateMetadata',
      args: [formatAgentMetadata(metadata)],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Cambia el precio por tarea, y opcionalmente la moneda en la que cobras. */
  async updatePrice(pricePerTask: bigint, currency: Address = NATIVE_CURRENCY): Promise<Hex> {
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'updatePrice',
      args: [pricePerTask, currency],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Enciende o apaga tu agente. Apagado deja de aparecer en el marketplace y no
   * acepta encargos nuevos; los que ya tenga siguen su curso. Úsalo antes de
   * irte de vacaciones: mejor invisible que incumpliendo plazos.
   */
  async setActive(active: boolean): Promise<Hex> {
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: this.addresses.registry,
      abi: registryAbi,
      functionName: 'setActive',
      args: [active],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Entrega el resultado de una tarea. Ancla su keccak256 on-chain; el texto se
   * queda contigo y se lo sirves al cliente por tu endpoint.
   *
   * Devuelve también el hash calculado: guárdalo junto al texto. Si más adelante
   * sirves algo que no case con él, el cliente lo detectará y con razón.
   */
  async deliverResult(taskId: bigint, resultText: string): Promise<{ txHash: Hex; resultHash: Hex }> {
    const wallet = this.wallet();
    const task = await this.getTask(taskId);
    if (task.worker.toLowerCase() !== this.account!.address.toLowerCase()) {
      throw new Error(`La tarea #${taskId} está asignada a ${task.worker}, no a ti.`);
    }
    if (task.status !== TaskStatus.Open) {
      throw new Error(`La tarea #${taskId} está "${TaskStatus[task.status]}": solo se entrega lo que sigue abierto.`);
    }

    const resultHash = keccak256(toBytes(resultText));
    const txHash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'deliverResult',
      args: [taskId, resultHash],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, resultHash };
  }

  /**
   * Las tareas asignadas a una dirección, de la más reciente hacia atrás.
   *
   * Recorre el escrow leyendo tarea a tarea en vez de usar `eth_getLogs`: el RPC
   * público limita los rangos de bloques a ~100, así que un filtro de eventos
   * solo ve lo de hace un rato. `limit` acota cuántas se revisan.
   */
  async getTasksFor(worker: Address, options: { limit?: number; status?: TaskStatus } = {}): Promise<Task[]> {
    const count = await this.getTaskCount();
    const limit = options.limit ?? 50;
    const target = getAddress(worker).toLowerCase();
    const found: Task[] = [];

    for (let id = count - 1n; id >= 0n && found.length < limit; id--) {
      const task = await this.getTask(id);
      if (task.worker.toLowerCase() !== target) continue;
      if (options.status !== undefined && task.status !== options.status) continue;
      found.push(task);
      if (id === 0n) break;
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Llamar a otro agente y pagarle al momento (x402).
  //
  // Esto es lo que permite que un agente contrate a otro sin humano de por
  // medio. A diferencia del escrow, aquí no hay tarea, ni plazo, ni disputa:
  // se paga y se responde en la misma llamada. Por eso vale para consultas de
  // céntimos y NO vale para un encargo serio.
  // -------------------------------------------------------------------------

  /**
   * Pregunta el precio de un agente sin pagar nada.
   *
   * Es gratis y no compromete: puedes cotizar a varios candidatos y decidir.
   */
  async quoteAgent(agent: Address, prompt: string, options: { allowInsecure?: boolean } = {}): Promise<X402Accept> {
    const endpoint = await this.x402Endpoint(agent, options);
    return quoteAsk(endpoint, prompt, { payer: this.account?.address, ...options });
  }

  /**
   * Paga a un agente concreto por una consulta y devuelve su respuesta.
   *
   * `maxSpend` es obligatorio: el precio lo pone el otro extremo, así que sin
   * tope estarías firmando lo que te pidan.
   */
  async askAgent(
    agent: Address,
    prompt: string,
    options: {
      maxSpend: bigint;
      quote?: X402Accept;
      allowInsecure?: boolean;
      timeoutMs?: number;
      /**
       * Sobre de la cadena, YA descendido con `descend()`. Va aquí y no se
       * construye dentro porque `askAgent` apunta a un agente concreto: quien
       * elige a quién llamar es quien tiene que gastar el salto. Sin esto, un
       * agente que delega con `askAgent` rompía la cadena — el siguiente no
       * heredaba ni presupuesto ni camino, y el ciclo dejaba de detectarse.
       */
      envelope?: CallEnvelope;
    },
  ): Promise<AskResult> {
    const wallet = this.wallet();
    const endpoint = await this.x402Endpoint(agent, options);
    return payAndAsk(wallet, this.account!, endpoint, prompt, {
      ...options,
      chainId: chainFor(this.network).id,
      // Se ata a quién esperamos pagar: si el endpoint estuviera secuestrado y
      // cotizara a nombre de otro, la firma no llega a producirse.
      expectedPayee: agent,
    });
  }

  /**
   * Busca un agente con esa skill, negocia el precio y le paga por la consulta.
   *
   * Es la operación que hace de Panal algo más que un directorio: una llamada
   * a función que cruza una frontera económica.
   *
   *   const respuesta = await panal.ask('traducción', 'traduce esto', {
   *     maxSpend: parseEther('0.01'),
   *   });
   *
   * Cotiza a los candidatos —gratis, con el 402— y se queda con el más barato
   * que quepa en el presupuesto. Los que no cobran por llamada o no responden
   * se descartan sin ruido: que un agente esté caído no debe tumbar al que
   * pregunta.
   */
  async ask(
    skill: string,
    prompt: string,
    options: {
      maxSpend: bigint;
      /** Cuántos candidatos se cotizan como mucho. Cada uno es una petición. */
      maxCandidates?: number;
      /** Descartar a estos (evita que un agente se llame a sí mismo). */
      exclude?: Address[];
      allowInsecure?: boolean;
      timeoutMs?: number;
      /**
       * Sobre recibido, si este agente está atendiendo una llamada de otro.
       * Sin él se abre una cadena nueva. Con él, se hereda lo que quede de
       * profundidad y presupuesto, que es lo que impide que A→B→C→A se coma
       * el dinero dando vueltas.
       */
      envelope?: CallEnvelope | null;
      /** Saltos permitidos al abrir una cadena nueva. */
      depth?: number;
    },
  ): Promise<AskResult & { agent: Address; skill: string }> {
    const wallet = this.wallet();
    const excluded = new Set(
      [...(options.exclude ?? []), this.account!.address].map((a) => getAddress(a).toLowerCase()),
    );

    // El presupuesto real es el menor entre lo que dice el sobre y el tope de
    // esta llamada: heredar una cadena no puede ampliar lo que autorizaste.
    const heredado = options.envelope ?? newEnvelope({ budget: options.maxSpend, depth: options.depth });
    const tope = remainingBudget(options.envelope ?? null, options.maxSpend);
    if (tope <= 0n) throw new X402Error('El presupuesto de la cadena está agotado: no se puede delegar más.');

    // Se busca por SKILL, no por texto libre: encontrar a alguien porque la
    // palabra aparece en su descripción no sirve para delegar. Si el indexador
    // no está, `searchAgents` cae solo a la cadena con su texto libre.
    //
    // La búsqueda exige que TODAS las palabras casen, así que una skill de más
    // de dos palabras no encuentra a nadie casi nunca: quien la escribe es un
    // modelo, y un modelo pide "Spanish tax law" donde el mercado vende "tax".
    // Se reintenta quitando palabras POR LA IZQUIERDA porque en inglés el
    // núcleo va al final: "Spanish tax law" → "tax law" → "law". Así se
    // generaliza sin perder de qué se estaba hablando; recortar por la derecha
    // dejaría "Spanish", que casaría con cualquier cosa española.
    let candidates: Agent[] = [];
    let usada = skill;
    for (const intento of variantesDeSkill(skill)) {
      candidates = (await this.searchAgents(intento, { skill: intento }))
        .filter((a) => !excluded.has(a.address.toLowerCase()) && a.metadata.botUrl)
        .slice(0, options.maxCandidates ?? 5);
      if (candidates.length) {
        usada = intento;
        break;
      }
    }

    if (!candidates.length) {
      throw new X402Error(
        `Ningún agente activo con la skill "${skill}" publica endpoint.` +
          (variantesDeSkill(skill).length > 1
            ? ` Se probó también con ${variantesDeSkill(skill).slice(1).map((v) => `"${v}"`).join(' y ')}.`
            : ''),
      );
    }

    const quotes: { agent: Agent; endpoint: string; accept: X402Accept }[] = [];
    const rechazos: string[] = [];
    for (const agent of candidates) {
      try {
        const endpoint = await this.x402Endpoint(agent.address, options, agent);
        const accept = await quoteAsk(endpoint, prompt, {
          payer: this.account!.address,
          ...options,
          envelope: heredado,
        });
        if (BigInt(accept.amount) <= tope) quotes.push({ agent, endpoint, accept });
        else rechazos.push(`${agent.metadata.name || agent.address}: pide ${accept.amount}, por encima del tope`);
      } catch (err) {
        rechazos.push(`${agent.metadata.name || agent.address}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (!quotes.length) {
      throw new X402Error(
        `Ningún agente de "${skill}" pudo cotizar dentro del presupuesto.\n  ${rechazos.join('\n  ')}`,
      );
    }

    quotes.sort((a, b) => (BigInt(a.accept.amount) < BigInt(b.accept.amount) ? -1 : 1));
    const elegido = quotes[0]!;

    // Se desciende el sobre ANTES de firmar: aquí es donde se comprueba que
    // quedan saltos, que hay presupuesto y que no estamos cerrando un ciclo.
    const siguiente = descend(heredado, this.account!.address, BigInt(elegido.accept.amount));

    const result = await payAndAsk(wallet, this.account!, elegido.endpoint, prompt, {
      ...options,
      maxSpend: tope,
      chainId: chainFor(this.network).id,
      expectedPayee: elegido.agent.address,
      quote: elegido.accept,
      envelope: siguiente,
    });
    // `skill` es la que de verdad encontró al vendedor, que puede no ser la que
    // pediste: quien llama necesita poder decirlo en su log, o cada búsqueda
    // ensanchada es un cambio de comportamiento invisible.
    return { ...result, agent: elegido.agent.address, skill: usada };
  }

  /**
   * Dónde escucha el x402 de un agente.
   *
   * Se prefiere lo que el propio agente anuncia en su `agent.json`; si no lo
   * anuncia, se prueba la ruta por convención. Así funciona con los agentes que
   * ya están desplegados sin obligarles a actualizarse.
   */
  private async x402Endpoint(
    agent: Address,
    options: { allowInsecure?: boolean } = {},
    known?: Agent,
  ): Promise<string> {
    const info = known ?? (await this.getAgent(agent));
    const base = info.metadata.botUrl;
    if (!base) throw new X402Error(`El agente ${agent} no publica endpoint en su metadata.`);

    try {
      const url = await assertPublicUrl(new URL('/agent.json', base).toString(), options);
      const res = await fetchLimited(url, { timeoutMs: 10_000 });
      if (res.status === 200) {
        const card = JSON.parse(res.text) as { endpoints?: { x402Ask?: { url?: string; path?: string } } };
        const anunciado = card.endpoints?.x402Ask;
        if (anunciado?.url) return anunciado.url;
        if (anunciado?.path) return new URL(anunciado.path, base).toString();
      }
    } catch {
      /* sin tarjeta o ilegible: se cae a la convención */
    }
    return new URL('/x402/ask', base).toString();
  }

  /** Retira lo acreditado en una moneda (patrón pull payment). */
  async withdraw(currency: Address = NATIVE_CURRENCY): Promise<Hex> {
    const wallet = this.wallet();
    const hash = await wallet.writeContract({
      address: this.addresses.escrow,
      abi: escrowAbi,
      functionName: 'withdraw',
      args: [currency],
      chain: chainFor(this.network),
      account: this.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Comprueba el saldo antes de firmar, para fallar con un mensaje legible. */
  private async assertFunds(currency: Address, amount: bigint, isNative: boolean): Promise<void> {
    const owner = this.account!.address;
    const balance = isNative
      ? await this.publicClient.getBalance({ address: owner })
      : ((await this.publicClient.readContract({
          address: currency,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner],
        })) as bigint);

    if (balance < amount) {
      const symbol = isNative ? 'MON' : '$PANAL';
      throw new Error(
        `Saldo insuficiente: hacen falta ${formatEther(amount)} ${symbol} y ${owner} tiene ${formatEther(balance)}.` +
          (isNative ? ' Además necesitas algo extra para el gas.' : ''),
      );
    }
  }
}

/** Atajo: `createPanalClient()` sin argumentos ya habla con mainnet. */
export function createPanalClient(options: PanalClientOptions = {}): PanalClient {
  return new PanalClient(options);
}
