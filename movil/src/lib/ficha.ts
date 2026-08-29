/**
 * Panal — la ficha de un agente, como texto.
 *
 * Separado de `agentes.ts` a propósito: esto no toca la cadena ni la red, así
 * que se puede probar en Node sin arrancar nada. `agentes.ts` sí importa la
 * configuración de los contratos, y esa arrastra `import.meta.env`, que fuera
 * de Vite no existe.
 */

import { componerNivel, esTokenDeNivel, leerNivelesDeMetadata, weiAPrecio, type Nivel } from '@panal/sdk';
import { esTokenDeMarca, leerMarca, tokensDeMarca, type Marca } from '@/lib/marca';

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
 *
 * Los tokens de MARCA —`logo:`, `github:`…— se apartan como el `bot:`. Sin eso
 * el logo de un agente saldría escrito dentro de su descripción, en la lista y
 * en su pantalla, como un `logo:https://…` a medio leer.
 *
 * Y los NIVELES igual, que aquí muerde el doble: la descripción se arma con
 * TODO lo que sobra, así que los tres `nivel:0.03|Un archivo|…` de un agente
 * se pegarían enteros al final de su descripción en la lista del mercado.
 */
export function partirFicha(uri: string): {
  nombre: string;
  descripcion: string;
  marca: Marca;
  niveles: Nivel[];
} {
  const partes = uri.split('·').map((p) => p.trim());
  const texto = partes.filter(
    (p) => !p.toLowerCase().startsWith('bot:') && !esTokenDeMarca(p) && !esTokenDeNivel(p),
  );
  return {
    nombre: texto[0] ?? '',
    descripcion: texto.slice(1).join(' · '),
    marca: leerMarca(uri),
    niveles: leerNivelesDeMetadata(uri),
  };
}

/**
 * Arma la cadena que se va a escribir en la cadena, en ese orden.
 *
 * La marca va al final y solo lo que esté relleno: una ficha sin logo sale
 * carácter por carácter igual que antes de que esto existiera, que es lo que
 * permite editar desde el móvil un agente registrado desde la web sin
 * reescribirle nada por el camino.
 *
 * `niveles` NO se edita desde aquí: la app no tiene ese formulario. Se recibe
 * para volver a escribirlo TAL CUAL. Sin ese arrastre, cambiar una coma de la
 * descripción desde el teléfono borraría los tres niveles que su dueño montó
 * en la web, sin preguntar y sin que nada lo dijera — y lo siguiente sería un
 * cliente pagando el precio suelto por un encargo del tamaño grande.
 */
export function armarFicha(
  nombre: string,
  descripcion: string,
  botUrl: string,
  marca: Partial<Marca> = {},
  niveles: Nivel[] = [],
): string {
  return [
    nombre.trim(),
    descripcion.trim(),
    botUrl.trim() ? `bot:${botUrl.trim()}` : '',
    ...tokensDeMarca(marca),
    ...niveles.map((n) =>
      componerNivel({
        name: n.name ?? '',
        description: n.description,
        precio: weiAPrecio(n.wei),
        maxBriefChars: n.maxBriefChars,
        maxAttachChars: n.maxAttachChars,
        maxAttachCharsTotal: n.maxAttachCharsTotal,
      }),
    ),
  ]
    .filter(Boolean)
    .join(' · ');
}
