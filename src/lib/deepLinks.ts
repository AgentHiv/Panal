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
 * ¿Estamos en un teléfono?
 *
 * Decide si se enseña el QR o los enlaces, y no hay forma no fea de saberlo:
 * el user agent es lo que hay. Equivocarse no rompe nada —queda la copia
 * manual—, así que se prefiere el criterio simple al que intenta ser listo.
 */
export function esMovil(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
