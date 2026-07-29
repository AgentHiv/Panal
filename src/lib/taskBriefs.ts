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
