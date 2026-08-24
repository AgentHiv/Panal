/**
 * Panal — cómo se vuelve a la wallet para firmar.
 *
 * EL FALLO QUE ARREGLA, dicho entero porque no se ve mirando nuestro código.
 *
 * Conectar funcionaba: la hoja saca la URI `wc:` y Android abre la wallet. Lo
 * que no funcionaba era todo lo demás. Una vez conectados, cada firma —pagar
 * un mensaje, bloquear un encargo, aprobar un pago— viaja por el relé hasta la
 * wallet, que está EN SEGUNDO PLANO. Nadie la trae al frente, así que la
 * petición se queda ahí esperando y la persona ve una app parada: ni firma, ni
 * error, ni nada. Justo lo que se dijo: «la aplicación no envía la firma».
 *
 * Sí la envía. Lo que no hace es ir a buscar a la wallet.
 *
 * WalletConnect trae eso resuelto y aquí estaba desactivado sin saberlo. En
 * `@walletconnect/utils` la función que redirige empieza así:
 *
 *     async function Si({ id, topic, wcDeepLink }) {
 *       if (!wcDeepLink) return;                       // ← se sale por aquí
 *
 * y `wcDeepLink` sale de `localStorage['WALLETCONNECT_DEEPLINK_CHOICE']`, que
 * escribe el modal de Reown al elegir wallet. Nosotros quitamos ese modal a
 * propósito —viene en inglés, trae su estética y descarga su catálogo— así que
 * nadie escribía esa clave y la redirección se salía en la primera línea, en
 * silencio.
 *
 * Y aunque se escribiera, la librería redirige con `window.open`, que dentro
 * de un WebView de Capacitor abre una ventana del propio WebView en vez de
 * entregarle la URL a Android. Por eso esto no rellena aquella clave: hace la
 * redirección por su cuenta, con `location.href`, que es lo que sí pasa por
 * `shouldOverrideUrlLoading` y sale como intent (ver `lib/wallets.ts`).
 *
 * DE DÓNDE SALE EL ENLACE
 *
 * De la propia wallet: al conectar manda su `redirect` en los metadatos de la
 * sesión, que es exactamente «así se vuelve a mí». Si no lo manda —las hay—,
 * queda el enlace que se tocó al conectar. Y si tampoco, la pantalla enseña un
 * botón para ir a mano, porque una redirección puede fallar siempre y quedarse
 * sin saber que hay algo esperando es el fallo que estamos arreglando.
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
