import { WALLETS_MOVIL, enlaceWallet } from '@/lib/deepLinks';

/**
 * Cómo se abre una wallet desde dentro del APK.
 *
 * POR QUÉ NO FUNCIONABA EL BOTÓN
 * ------------------------------
 * `ProveedorWallet` conectaba con `connectors[0]`, y `connectors[0]` es
 * `injected()` (config.ts:174). Una wallet inyectada es una EXTENSIÓN que
 * escribe `window.ethereum` en la página; dentro de un WebView de Android no
 * hay extensiones y ese objeto no existe nunca. Así que `connect()` lanzaba
 * `ConnectorNotFoundError`, wagmi lo guardaba en el estado de la mutación, y
 * como nadie miraba ese estado el botón se quedaba mudo: ni conectaba, ni
 * fallaba, ni decía nada.
 *
 * Y el conector de WalletConnect —el único que sirve aquí— ni siquiera estaba
 * en el paquete: solo se añade si hay `VITE_WALLETCONNECT_PROJECT_ID` al
 * compilar, y el workflow del APK no la pasaba.
 *
 * DE DÓNDE SALEN LOS ENLACES
 * --------------------------
 * De `@/lib/deepLinks`, la capa compartida, que ya tiene resuelto lo difícil
 * —escapar la URI entera, y usar enlaces universales en vez de esquemas
 * propios— y sus pruebas en `scripts/test-deeplinks.ts`. Aquí NO se reescribe
 * nada de eso: se le pone cara y se añaden dos wallets más que la app ofrece y
 * la web no. La web no se toca.
 *
 * Se ofrecen tres vías, en este orden, porque cada una tapa el fallo de la
 * anterior:
 *
 *   1. La URI `wc:` a secas. Android busca qué app la sabe abrir y saca el
 *      selector con todas las wallets instaladas. Es lo correcto y no exige
 *      saberse ninguna wallet de memoria.
 *   2. Enlaces con nombre, para las wallets que solo registraron su https.
 *   3. Copiar. Cuando no hay nada registrado no pasa NADA al tocar —Capacitor
 *      se traga `ActivityNotFoundException` sin avisar (Bridge.java:415)—, y
 *      sin esta salida volveríamos justo al botón mudo del principio.
 */

export type Wallet = {
  id: string;
  nombre: string;
  /** Las siglas del hexágono, que no hay logos dentro del paquete. */
  sigla: string;
  color: string;
  /** El enlace que abre esa wallet con esta sesión. */
  enlace: (uri: string) => string;
};

/** Cómo se pinta cada una de las que ya trae la capa compartida. */
const SELLO: Record<string, { sigla: string; color: string }> = {
  metamask: { sigla: 'M', color: '#E29A2E' },
  trust: { sigla: 'T', color: '#836EF9' },
};

/**
 * Las que añade la app, y solo la app.
 *
 * No van en `@/lib/deepLinks` porque esa lista la pinta también el diálogo de
 * la web, y la web se queda exactamente como está. Mismo criterio que allí:
 * enlace universal `https`, nunca esquema propio — con un esquema propio, si la
 * wallet no está instalada Android lanza `ActivityNotFoundException`, Capacitor
 * la descarta en silencio y el botón se queda mudo otra vez.
 */
const EXTRA: Wallet[] = [
  {
    id: 'rainbow',
    nombre: 'Rainbow',
    sigla: 'R',
    color: '#C9653B',
    enlace: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}`,
  },
  {
    id: 'zerion',
    nombre: 'Zerion',
    sigla: 'Z',
    color: '#B7A8FC',
    enlace: (uri) => `https://wallet.zerion.io/wc?uri=${encodeURIComponent(uri)}`,
  },
];

export const WALLETS: Wallet[] = [
  ...WALLETS_MOVIL.map((w) => ({
    id: w.id,
    nombre: w.nombre,
    sigla: SELLO[w.id]?.sigla ?? w.nombre.slice(0, 1),
    color: SELLO[w.id]?.color ?? '#948DAE',
    enlace: (uri: string) => enlaceWallet(w.id, uri),
  })),
  ...EXTRA,
];

/**
 * Salir del WebView hacia otra app.
 *
 * `location.href` y no `window.open`: en Capacitor la navegación de la ventana
 * principal pasa por `shouldOverrideUrlLoading`, que reconoce que el destino no
 * es `panal.lat` y lo entrega a Android como intent (Bridge.java:407-419).
 * `window.open` abriría una ventana del WebView, que no es lo que queremos.
 */
export function abrirFuera(url: string): void {
  window.location.href = url;
}

/** El portapapeles del WebView necesita origen seguro; el nuestro es https. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
