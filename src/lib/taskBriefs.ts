/**
 * Panal — Caché local de briefs de tarea.
 *
 * On-chain solo viaja `taskHash = keccak256(brief)` (el texto NO cabe en el
 * contrato v2). Para que el trabajador vea QUÉ le están pidiendo, guardamos
 * el texto en localStorage vinculado a su hash cuando el pedido se crea en
 * este navegador. Limitación honesta: si cliente y trabajador usan navegadores
 * distintos, el brief no estará en caché (la UI lo indica y sugiere pedirlo).
 */

const KEY = 'panal:taskBriefs:v1';
const MAX_ENTRIES = 200;

type BriefMap = Record<string, string>;

function readAll(): BriefMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BriefMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: BriefMap): void {
  try {
    const entries = Object.entries(map);
    // FIFO simple: conserva las últimas MAX_ENTRIES
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* almacenamiento lleno o bloqueado: no crítico */
  }
}

export function saveTaskBrief(taskHash: string, brief: string): void {
  if (!taskHash || !brief.trim()) return;
  const map = readAll();
  map[taskHash.toLowerCase()] = brief;
  writeAll(map);
}

export function getTaskBrief(taskHash: string | null | undefined): string | null {
  if (!taskHash) return null;
  return readAll()[taskHash.toLowerCase()] ?? null;
}

/*
 * El SOBRE de un encargo cifrado, aparte del texto.
 *
 * Arriba se guarda lo que dice —para enseñarlo—; aquí, lo que se ancló, que es
 * lo único que se puede reenviar: el agente compara su keccak256 con el
 * `taskHash`, y el texto en claro no lo da. Se guardan los dos porque se usan
 * para cosas distintas, y el sobre solo existe si el encargo iba cifrado.
 */
const KEY_SOBRES = 'panal:taskSobres:v1';

export function saveTaskSobre(taskHash: string, sobre: string): void {
  if (!taskHash || !sobre) return;
  try {
    const map = JSON.parse(localStorage.getItem(KEY_SOBRES) ?? '{}') as BriefMap;
    map[taskHash.toLowerCase()] = sobre;
    const recortado = Object.entries(map).slice(-MAX_ENTRIES);
    localStorage.setItem(KEY_SOBRES, JSON.stringify(Object.fromEntries(recortado)));
  } catch {
    /* almacenamiento lleno o bloqueado: no crítico */
  }
}

export function getTaskSobre(taskHash: string | null | undefined): string | null {
  if (!taskHash) return null;
  try {
    return (JSON.parse(localStorage.getItem(KEY_SOBRES) ?? '{}') as BriefMap)[taskHash.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}
