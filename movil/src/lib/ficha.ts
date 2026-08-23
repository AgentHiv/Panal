/**
 * Panal — la ficha de un agente, como texto.
 *
 * Separado de `agentes.ts` a propósito: esto no toca la cadena ni la red, así
 * que se puede probar en Node sin arrancar nada. `agentes.ts` sí importa la
 * configuración de los contratos, y esa arrastra `import.meta.env`, que fuera
 * de Vite no existe.
 */

/* ── a quién sigues ──────────────────────────────────────────────────────── */

const CLAVE_SEGUIDOS = 'panal:agentes-seguidos:v1';

export function seguidos(): string[] {
  try {
    const crudo = localStorage.getItem(CLAVE_SEGUIDOS);
    const lista = crudo ? (JSON.parse(crudo) as string[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function seguir(direccion: string): void {
  const dir = direccion.toLowerCase();
  const lista = seguidos().filter((d) => d !== dir);
  lista.unshift(dir);
  try {
    localStorage.setItem(CLAVE_SEGUIDOS, JSON.stringify(lista.slice(0, 20)));
  } catch {
    /* Sin sitio: se sigue pudiendo mirar, solo que no se recuerda. */
  }
}

export function dejarDeSeguir(direccion: string): void {
  const dir = direccion.toLowerCase();
  try {
    localStorage.setItem(CLAVE_SEGUIDOS, JSON.stringify(seguidos().filter((d) => d !== dir)));
  } catch {
    /* igual */
  }
}

/** Una dirección de Ethereum bien escrita. No comprueba que exista. */
export function esDireccion(texto: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(texto.trim());
}

/**
 * La ficha es TEXTO LIBRE, no un JSON.
 *
 * Las partes van separadas por «·» y la URL lleva `bot:` delante. Así están
 * escritas las nueve fichas de mainnet y así las lee `botEndpoint.ts`. Aquí se
 * parte por lo mismo para poder enseñar el nombre y la descripción por
 * separado; si alguien escribió otra cosa, el nombre es la primera parte y ya.
 */
export function partirFicha(uri: string): { nombre: string; descripcion: string } {
  const partes = uri.split('·').map((p) => p.trim());
  const sinBot = partes.filter((p) => !p.toLowerCase().startsWith('bot:'));
  return { nombre: sinBot[0] ?? '', descripcion: sinBot.slice(1).join(' · ') };
}

/** Arma la cadena que se va a escribir en la cadena, en ese orden. */
export function armarFicha(nombre: string, descripcion: string, botUrl: string): string {
  return [nombre.trim(), descripcion.trim(), botUrl.trim() ? `bot:${botUrl.trim()}` : '']
    .filter(Boolean)
    .join(' · ');
}
