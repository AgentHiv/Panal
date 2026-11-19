/**
 * Panal — volver a la wallet de fuera cuando hay algo que firmar.
 *
 * Lo comparten la web y la app (`movil/src/lib/regreso.ts` cuenta la historia
 * entera del fallo). Con WalletConnect cada firma viaja por el relé hasta la
 * wallet, que está en segundo plano; si nadie la trae al frente, la petición
 * se queda esperando y la página parece parada. WalletConnect sabe hacerlo,
 * pero solo si encuentra la clave que escribe el modal de Reown, y ni la web
 * ni la app usan ese modal.
 *
 * Aquí está lo que no depende de dónde se ejecute: qué wallet se eligió al
 * conectar, con qué enlace se la trae de vuelta y qué peticiones lo merecen.
 * Cómo se abre el enlace sí cambia —`location.href` en los dos, por motivos
 * distintos— y eso lo decide cada lado.
 */

const CLAVE = 'panal:vuelta-a-la-wallet:v1';

/** Lo que la wallet dice de sí misma en los metadatos de la sesión. */
export interface Redireccion {
  native?: string;
  universal?: string;
}

/** Guarda por dónde se fue a la wallet al conectar. */
export function recordarWallet(base: string | null): void {
  try {
    if (base) localStorage.setItem(CLAVE, base);
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin localStorage se pierde la ayuda, no la app */
  }
}

export function walletRecordada(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

export function olvidarWallet(): void {
  recordarWallet(null);
}

/**
 * El enlace que trae la wallet al frente. `null` si no hay por dónde.
 *
 * Sin `peticion` devuelve la base a secas, que es lo que hay al envolver
 * `request`: el identificador JSON-RPC lo genera la librería por dentro y no
 * sale de ahí. Da igual — abrir la wallet basta, porque la petición ya está en
 * su cola y la enseña ella. El formato con `requestId` queda por si algún día
 * se puede saber, y es el mismo que arma WalletConnect.
 */
export function enlaceDeVuelta(
  redireccion: Redireccion | undefined | null,
  guardado: string | null,
  peticion?: { id: number | string; topic: string },
): string | null {
  // El esquema propio antes que el universal: la wallet está instalada —se
  // acaba de conectar a ella—, así que no hay riesgo de acabar en el
  // navegador, que es lo que sí pasa con un https si el sistema no lo asocia.
  const base = (redireccion?.native || redireccion?.universal || guardado || '').trim();
  if (!base) return null;
  if (!peticion) return base;

  const sinBarra = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${sinBarra}/wc?requestId=${peticion.id}&sessionTopic=${peticion.topic}`;
}

/**
 * Los métodos por los que hay que ir a buscar a la wallet.
 *
 * Solo estos: `eth_chainId` o `eth_accounts` los pide wagmi a cada rato y
 * contestan solos desde la sesión. Sacar a la persona de la app por una
 * lectura sería peor que no redirigir nunca.
 */
export const PIDE_FIRMA: ReadonlySet<string> = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
]);
