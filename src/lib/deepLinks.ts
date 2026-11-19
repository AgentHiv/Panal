/**
 * Panal — abrir la wallet del teléfono con una sesión de WalletConnect.
 *
 * En un móvil el QR no sirve: el teléfono no puede escanear su propia
 * pantalla. Lo que se hace es meter la URI de la sesión —esa cadena
 * `wc:...@2?relay-protocol=irn&symKey=...` que emite el conector— dentro de un
 * enlace que el sistema operativo sabe redirigir a la app instalada.
 *
 * Se usan los enlaces UNIVERSALES (https://…) y no los esquemas propios
 * (`metamask://`): si la app no está instalada, un esquema propio deja al
 * usuario mirando un error del navegador, mientras que el universal abre la
 * web de la wallet, que al menos explica qué es y cómo instalarla.
 *
 * La lista es corta a propósito. Un directorio completo de wallets es
 * exactamente lo que hay que mantener al día —cambian de esquema, se renombran,
 * aparecen y desaparecen— y es la razón por la que existe AppKit. Aquí se
 * ofrecen las dos que esta web ya nombra en el resto de sus diálogos, más la
 * copia manual, que funciona con cualquiera.
 */

export interface WalletMovil {
  /** Clave estable, para la lista de React y para el icono. */
  id: 'metamask' | 'trust';
  /** Cómo se llama, tal cual. Los nombres de producto no se traducen. */
  nombre: string;
}

export const WALLETS_MOVIL: readonly WalletMovil[] = [
  { id: 'metamask', nombre: 'MetaMask' },
  { id: 'trust', nombre: 'Trust Wallet' },
] as const;

/**
 * El enlace que abre esa wallet con esta sesión.
 *
 * La URI va percent-encoded ENTERA: lleva `?`, `&` y `=` dentro, y sin escapar
 * el sistema operativo se queda con el primer tramo y la wallet recibe una
 * sesión incompleta — que falla más tarde, al aprobar, y parece un fallo de la
 * wallet en vez de un enlace mal formado.
 */
export function enlaceWallet(id: WalletMovil['id'], uri: string): string {
  const wc = encodeURIComponent(uri);
  switch (id) {
    case 'metamask':
      return `https://metamask.app.link/wc?uri=${wc}`;
    case 'trust':
      return `https://link.trustwallet.com/wc?uri=${wc}`;
  }
}

/**
 * Con qué se trae cada wallet al frente cuando ya está conectada.
 *
 * Para CONECTAR se usan los enlaces universales de arriba: si la app no está,
 * al menos se abre su web. Para VOLVER a firmar ya no hace falta, porque la
 * wallet está instalada (acabamos de conectar con ella), y el esquema propio
 * no deja una pestaña en blanco por el camino como sí hace el universal.
 *
 * Es el respaldo de lo que la wallet manda de sí misma al conectar (su
 * `redirect`): la mayoría lo manda, y entonces manda lo suyo.
 */
export const VUELTA: Readonly<Record<WalletMovil['id'] | 'panal', string>> = {
  metamask: 'metamask://',
  trust: 'trust://',
  panal: 'panal://',
};

/**
 * La app de Panal para Android, como wallet de esta web.
 *
 * No está en `WALLETS_MOVIL` a propósito: esa lista la usa también la app para
 * ofrecer wallets de fuera, y ofrecerse a sí misma sería un botón que abre la
 * app que ya está abierta.
 *
 * El enlace es un `intent:` de Chrome para Android y no un `panal://` a secas:
 * si la app no está instalada, un esquema propio deja un error del navegador,
 * y el `intent:` cae en `browser_fallback_url`, que es la página para
 * descargarla. Lleva el paquete del APK directo (`lat.panal.app`) porque es la
 * única que firma para la web: la de Google Play no puede cobrar ni pagar.
 */
export const PAQUETE_APP_PANAL = 'lat.panal.app';
export const DESCARGAR_APP_PANAL = 'https://panal.lat/app';

export function enlaceAppPanal(uri: string): string {
  return (
    `intent://wc?uri=${encodeURIComponent(uri)}` +
    `#Intent;scheme=panal;package=${PAQUETE_APP_PANAL};` +
    `S.browser_fallback_url=${encodeURIComponent(DESCARGAR_APP_PANAL)};end`
  );
}

/**
 * ¿Es Android? La app de Panal solo existe ahí, así que en un iPhone no se
 * ofrece: sería un botón que lleva a una página que dice «no hay app».
 */
export function esAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * ¿Estamos en un teléfono?
 *
 * Decide si se enseña el QR o los enlaces, y no hay forma no fea de saberlo:
 * el user agent es lo que hay. Equivocarse no rompe nada —queda la copia
 * manual—, así que se prefiere el criterio simple al que intenta ser listo.
 */
export function esMovil(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
