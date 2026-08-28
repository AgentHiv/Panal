/**
 * El logo con el que nace un agente.
 *
 * Un agente recién generado salía en el mercado con el hexágono gris que se
 * dibuja a partir de su wallet, igual que todos los demás. No es que quedara
 * feo: es que en una lista de agentes indistinguibles nadie recuerda cuál era
 * el suyo, y el sitio donde eso importa es justo el escaparate.
 *
 * Así que se escribe un `logo.svg` en el proyecto. No hace falta hacer nada
 * más: el servidor de la plantilla ya lo sirve en `/logo` y el registro lo
 * publica solo. Y es un archivo normal en la carpeta, así que cambiarlo por el
 * de verdad es sobrescribirlo.
 *
 * POR QUÉ UNA LETRA Y NO EL HEXÁGONO GENERADO. El avatar que ya pinta el
 * mercado sale de la dirección, y copiarlo aquí daría exactamente la misma
 * imagen: un logo que no se distingue del hueco que rellena no es un logo. La
 * inicial del nombre distingue de un vistazo y funciona en cualquier alfabeto,
 * que es más de lo que se puede decir de un icono elegido por nosotros.
 */

/** La paleta de Panal, la misma que usa el avatar del mercado. */
const FONDOS = ['#E29A2E', '#836EF9', '#6E7B4E', '#1B1814'] as const;
/** Sobre cualquiera de esos cuatro, este contraste vale. */
const TINTA = '#F2EFFA';

/** Hash estable (djb2), el mismo que el avatar del mercado. */
function semilla(texto: string): number {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
  return h;
}

/** Un hexágono de lado plano centrado en 48,48. */
function hexagono(r: number): string {
  const puntos: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    puntos.push(`${(48 + r * Math.cos(a)).toFixed(2)},${(48 + r * Math.sin(a)).toFixed(2)}`);
  }
  return puntos.join(' ');
}

/** `&`, `<` y `"` dentro de un nombre romperían el SVG. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * La inicial del nombre.
 *
 * Se coge el primer PUNTO DE CÓDIGO, no el primer `char`: un nombre que empiece
 * por un emoji o por un ideograma fuera del plano básico son dos `char`, y
 * quedarse con el primero produce media letra —un carácter de reemplazo— que ni
 * siquiera se puede pintar.
 */
export function inicial(nombre: string): string {
  const primero = [...nombre.trim()][0] ?? '?';
  return primero.toLocaleUpperCase();
}

/** El SVG del logo con el que arranca un agente, listo para escribir. */
export function logoSvg(nombre: string, direccion: string): string {
  const h = semilla(direccion || nombre);
  const fondo = FONDOS[h % FONDOS.length];
  const letra = escapar(inicial(nombre));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"',
    ` role="img" aria-label="${escapar(nombre)}">`,
    `<title>${escapar(nombre)}</title>`,
    `<polygon points="${hexagono(46)}" fill="${fondo}"/>`,
    `<text x="48" y="49" text-anchor="middle" dominant-baseline="central"`,
    ` font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"`,
    ` font-size="44" font-weight="700" fill="${TINTA}">${letra}</text>`,
    '</svg>',
    '',
  ].join('\n');
}
