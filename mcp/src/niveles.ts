/**
 * Panal — los tamaños que vende un agente, para quien contrata desde aquí.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * Un agente puede vender el mismo trabajo a varios precios, cada uno con su
 * tope de texto. Este servidor no lo sabía: cotizaba y pagaba siempre el
 * `pricePerTask` del registro, así que un agente que vende tres tamaños se veía
 * desde una conversación con un precio suelto, y el encargo grande se
 * contrataba al precio del pequeño — que el agente rechaza, con el dinero ya
 * bloqueado y sin más salida que esperar a que venza el plazo.
 *
 * DE DÓNDE SALE CADA MITAD. El importe, de la cadena: es lo que se bloquea en
 * el escrow, es lo único que sigue ahí con el agente caído, y es lo único que
 * nadie puede cambiar entre que se mira el precio y se paga. El nombre y la
 * descripción, de la ficha que sirve el agente: es el único sitio donde pueden
 * estar traducidos, porque la cadena guarda una sola versión.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { formatEther } from 'viem';
import { conTextoDeLaFicha, leerNivelesDeMetadata, type Nivel } from '@panal/sdk';

/**
 * Los niveles de un agente: el precio de la CADENA, el texto de su ficha.
 *
 * La precedencia no es una preferencia de estilo, es la misma que aplica la
 * web y por el mismo motivo. El importe es lo que se bloquea en el escrow, así
 * que tiene que salir del sitio que sigue en pie con el agente caído y que
 * nadie puede cambiar entre que se mira y se paga. El nombre y la descripción
 * son una etiqueta, y la ficha es el único sitio donde pueden estar traducidas.
 *
 * Si la cadena no trae ninguno, valen los de la ficha: hay agentes que los
 * declaran solo ahí, y no enseñarlos sería esconder lo que sí venden.
 */
export function nivelesDeAgente(metadataURI: string | null | undefined, deLaFicha: Nivel[]): Nivel[] {
  const enCadena = leerNivelesDeMetadata(metadataURI);
  return enCadena.length > 0 ? conTextoDeLaFicha(enCadena, deLaFicha) : deLaFicha;
}

/** `0.3 MON` a partir del importe de un nivel. */
export function precioDeNivel(nivel: Nivel, symbol: string): string {
  return `${formatEther(nivel.wei)} ${symbol}`;
}

/**
 * Los niveles, para que un modelo pueda leerlos en voz alta y que se elija uno.
 *
 * Se enseñan SIEMPRE que existan, aunque nadie los haya pedido: sin esto un
 * agente que vende tres tamaños se veía con un precio suelto —el más barato— y
 * el encargo grande se contrataba al precio del pequeño.
 */
export function renderNiveles(niveles: Nivel[], symbol: string): string[] {
  if (niveles.length === 0) return [];
  return [
    `  Sizes (${niveles.length}) — pass the one the person picks as \`tier\` to panal_quote_hire:`,
    ...niveles.map((n) => {
      const partes = [`    · ${n.name ?? '(unnamed)'} — ${precioDeNivel(n, symbol)}`];
      if (n.description) partes.push(n.description);
      if (n.maxBriefChars) partes.push(`up to ${n.maxBriefChars} chars`);
      return partes.join(' — ');
    }),
    '  Without a tier the cheapest one is quoted, which is what hiring without choosing buys.',
  ];
}

/**
 * Los niveles en UNA línea, para las listas.
 *
 * En `panal_search_agents` no se puede hacer más: sacar el texto traducido de
 * cada ficha serían N llamadas HTTP a servidores ajenos por búsqueda, que es
 * justo lo que ya no se hace para el precio por consulta. Con el rango basta
 * para que se vea que ahí hay tamaños y se pregunte por la ficha completa.
 */
export function lineaDeNiveles(niveles: Nivel[], symbol: string): string | null {
  if (niveles.length === 0) return null;
  const barato = niveles[0]!;
  const caro = niveles[niveles.length - 1]!;
  const rango =
    niveles.length === 1
      ? precioDeNivel(barato, symbol)
      : `${formatEther(barato.wei)} to ${precioDeNivel(caro, symbol)}`;
  return `  Sizes: ${niveles.length} (${rango}) — panal_get_agent lists them`;
}

/**
 * El nivel que pidió quien llama, o `null` si no es ninguno de los que hay.
 *
 * Se acepta el nombre, el precio o el número de la lista porque quien escribe
 * este argumento es un modelo copiando de lo que se le enseñó dos mensajes
 * antes, y devolver «no existe» por un «0.3 MON» donde se esperaba «Libro»
 * mandaría a la persona a repetir su elección sin motivo. Lo que NO se hace es
 * adivinar: si no casa con ninguno, se dice y se listan.
 */
export function buscarNivel(niveles: Nivel[], pedido: string): Nivel | null {
  const limpio = pedido.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!limpio) return null;
  const porNombre = niveles.find((n) => (n.name ?? '').toLowerCase().replace(/\s+/g, ' ') === limpio);
  if (porNombre) return porNombre;
  // "0.3", "0.3 mon": el símbolo sobra, el número es la identidad del nivel.
  const soloNumero = limpio.replace(/[a-z$\s]+$/, '').trim();
  const porPrecio = niveles.find((n) => formatEther(n.wei) === soloNumero);
  if (porPrecio) return porPrecio;
  const i = Number(limpio);
  return Number.isInteger(i) && i >= 1 && i <= niveles.length ? niveles[i - 1]! : null;
}
