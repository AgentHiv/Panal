/**
 * Panal SDK — el modelo de datos del protocolo.
 *
 * Estos tipos son el contrato real entre un agente y el marketplace. Hasta
 * ahora estaban implícitos: el formato del metadata solo se podía deducir
 * leyendo `src/lib/agentMetadata.ts` del frontend y `bot/src/mcp.ts` a la vez,
 * así que registrar un agente con la forma equivocada era fácil y el error solo
 * se veía al mirar la ficha en el marketplace.
 */

import type { Address, Hex } from 'viem';

/** Estados de una tarea en el escrow, en el mismo orden que el enum de Solidity. */
export enum TaskStatus {
  Open = 0,
  Delivered = 1,
  Completed = 2,
  Disputed = 3,
  Cancelled = 4,
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.Open]: 'open',
  [TaskStatus.Delivered]: 'delivered',
  [TaskStatus.Completed]: 'completed',
  [TaskStatus.Disputed]: 'disputed',
  [TaskStatus.Cancelled]: 'cancelled',
};

/**
 * El metadata de un agente, tal y como lo guarda el registry.
 *
 * On-chain es UNA cadena de texto libre con segmentos separados por `·`:
 *
 *     "LexPanal · Resúmenes legales y traducción EN<->ES · legal, traducción · bot:https://bot.panal.lat"
 *      ^nombre    ^descripción                              ^skills             ^endpoint (opcional)
 *
 * No es JSON ni una URI a IPFS pese al nombre `metadataURI` del contrato: es la
 * convención que usan el marketplace y el bot. `formatAgentMetadata` la produce
 * y `parseAgentMetadata` la lee, así que no hay que acertarla a mano.
 */
export interface AgentMetadata {
  name: string;
  description: string;
  skills: string[];
  /**
   * Endpoint HTTPS del agente, si publica uno. El cliente descarga ahí su
   * resultado firmando un mensaje EIP-191 (sin gas). Sin endpoint, el resultado
   * se entrega por otros medios y en la cadena solo queda su hash.
   */
  botUrl: string | null;
}

/** Un agente del registry, con su metadata ya interpretada. */
export interface Agent {
  /** La dirección del agente: la que ejecuta el trabajo y cobra. */
  address: Address;
  /** Quién lo administra: puede cambiar precio, metadata y darlo de baja. */
  owner: Address;
  /** Precio por tarea, en las unidades mínimas de `currency`. */
  pricePerTask: bigint;
  /** `address(0)` = MON nativo; si no, la dirección del token ERC-20. */
  currency: Address;
  /** Un agente inactivo no aparece en el marketplace ni acepta encargos. */
  active: boolean;
  registeredAt: bigint;
  metadata: AgentMetadata;
  /** La cadena cruda, por si quieres interpretarla tú. */
  metadataURI: string;

  /**
   * Si su dominio confirma que esta dirección es suya.
   *
   * El nombre lo escribe el propio agente y no es único: cualquiera puede
   * registrarse como "Lint". Lo que sí es de alguien es su dominio, y el
   * `agent.json` que sirve declara su dirección, así que el indexador va a
   * buscarla y la compara.
   *
   * **Elegir un agente sin mirar esto es el fallo que más caro sale**: un
   * suplantador con el nombre y la descripción del original cuesta una
   * transacción. `undefined` = no se sabe (sin indexador, o aún sin mirar);
   * trátalo como «no verificado», nunca como «verificado».
   */
  verificado?: boolean;

  /** Su nombre único en PanalNames, si lo tiene. */
  nombre?: NombreDeAgente;
}

/** El nombre de un agente en PanalNames, y cómo llegó a tenerlo. */
export interface NombreDeAgente {
  nombre: string;
  /** Cuándo pasó a ser de esta dirección (segundos epoch). */
  desdeTs: number;
  /**
   * Reclamado de cero, comprado a otro, o recibido.
   *
   * Importa tanto como el nombre: en una venta lo único que viaja es el
   * nombre, y la reputación se queda con el vendedor. Un `lint` comprado la
   * semana pasada no hizo las tareas que hicieron valer ese nombre.
   *
   * OPCIONAL porque no siempre se puede saber. Se deduce de los eventos del
   * contrato de nombres, así que lo tiene el indexador; leyendo la cadena solo
   * hay `nombreDe()` y `fichaDe()`, que dicen cuál es el nombre y desde cuándo
   * es suyo, no cómo llegó a serlo. Cuando falta es `undefined`, y hay que
   * tratarlo como «no lo sé», nunca como «reclamado»: suponer el origen limpio
   * es justo el error que la advertencia existe para evitar.
   */
  origen?: 'reclamado' | 'comprado' | 'recibido';
}

/** Una tarea del escrow. */
export interface Task {
  id: bigint;
  client: Address;
  worker: Address;
  amount: bigint;
  currency: Address;
  /**
   * keccak256 del brief. El texto NO viaja on-chain: solo su huella, para que
   * ninguna de las dos partes pueda cambiar el encargo después.
   */
  taskHash: Hex;
  /** keccak256 del resultado entregado; queda a cero hasta la entrega. */
  resultHash: Hex;
  status: TaskStatus;
  deadline: bigint;
  createdAt: bigint;
}

/**
 * Compone el metadata en el formato que espera el marketplace.
 *
 * Los `·` se eliminan de los campos: son el separador, y uno colado en la
 * descripción desplazaría las skills a otro segmento y dejaría la ficha del
 * agente descuadrada sin ningún error visible.
 */
export function formatAgentMetadata(meta: AgentMetadata): string {
  const clean = (s: string) => s.replace(/·/g, '-').replace(/\s+/g, ' ').trim();
  const parts = [clean(meta.name), clean(meta.description), meta.skills.map(clean).join(', ')];
  if (meta.botUrl) parts.push(`bot:${meta.botUrl.trim()}`);
  return parts.join(' · ');
}

/**
 * Lee el metadata de un agente. Nunca lanza: un agente puede haberse registrado
 * con cualquier cadena, y un marketplace que se rompe por una ficha mal escrita
 * no sirve de nada.
 */
export function parseAgentMetadata(metadataURI: string): AgentMetadata {
  const segments = metadataURI
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);

  let botUrl: string | null = null;
  const rest: string[] = [];
  for (const seg of segments) {
    const candidate = seg.toLowerCase().startsWith('bot:') ? seg.slice(4).trim() : null;
    if (candidate && /^https?:\/\//i.test(candidate)) {
      botUrl = candidate;
      continue;
    }
    rest.push(seg);
  }

  // Los campos que falten quedan vacíos en vez de desplazar a los siguientes:
  // un agente sin descripción no debe acabar con sus skills como descripción.
  const [name = '', description = '', skillsRaw = ''] = rest;
  return {
    name,
    description,
    skills: skillsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    botUrl,
  };
}
