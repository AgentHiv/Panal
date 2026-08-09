/**
 * Panal Bot — conversión de Markdown a texto plano.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Los modelos de lenguaje formatean en Markdown por defecto. Se les puede pedir
 * texto plano en el system prompt, pero vuelven al Markdown cada pocas
 * respuestas: es un sesgo de entrenamiento, no una instrucción que se pueda
 * desactivar. Y el resultado acaba en dos sitios donde el Markdown NO se
 * renderiza:
 *
 *   - El cuadro de resultado del dashboard, que muestra texto tal cual.
 *   - Telegram, cuyo parser de Markdown antiguo no admite encabezados con `#`
 *     y falla con asteriscos desparejados.
 *
 * En ambos el cliente ve la sintaxis cruda: `**negrita**`, `## Título`. Eso es
 * exactamente lo que reportó el usuario.
 *
 * Así que el prompt pide texto plano (ayuda) y ESTO lo garantiza (determinista).
 *
 * QUÉ NO HACE: no toca guiones bajos. Sin `parse_mode`, Telegram los muestra
 * literales, y destrozar `BRIEF_WAIT_MS` o `snake_case` sería peor que el
 * problema que se intenta resolver.
 */

/** Longitud máxima de una línea de separación generada. */
const RULE = '─'.repeat(40);

/**
 * Convierte Markdown en texto plano legible, conservando la estructura.
 *
 * Los encabezados se detectan solo con `#` seguido de espacio al principio de
 * línea, así que `#13` (número de tarea) o `C#` sobreviven intactos — que es
 * justo la diferencia entre `# MONAD` y `Entregada #13`.
 */
export function toPlainText(input: string): string {
  if (!input) return input;

  let text = input.replace(/\r\n/g, '\n');

  // Bloques de código: se conserva el contenido y se tiran las vallas.
  text = text.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (_m, body: string) => body.replace(/\s+$/, ''));
  // Vallas sueltas que quedaran sin pareja.
  text = text.replace(/^[ \t]*```[^\n]*$/gm, '');

  // Encabezados: "## Título" -> "Título". Exige espacio tras las almohadillas.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1');

  // Reglas horizontales -> una línea de separación de verdad.
  text = text.replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, RULE);

  // Citas: "> texto" -> "texto".
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '');

  // Enlaces e imágenes: "[texto](url)" -> "texto (url)"; si el texto ya es la
  // url, se deja sola para no repetirla.
  text = text.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) =>
    !label || label === url ? url : `${label} (${url})`,
  );

  // Negrita y cursiva. Primero los dobles para que no queden restos sueltos.
  text = text.replace(/\*\*\*(\S[\s\S]*?\S|\S)\*\*\*/g, '$1');
  text = text.replace(/\*\*(\S[\s\S]*?\S|\S)\*\*/g, '$1');
  text = text.replace(/__(\S[\s\S]*?\S|\S)__/g, '$1');
  // Cursiva con un solo asterisco: exige contenido pegado a las marcas para no
  // confundirla con una viñeta ("* item") ni con una multiplicación.
  text = text.replace(/(^|[^\w*])\*(\S[^*\n]*?\S|\S)\*(?=[^\w*]|$)/g, '$1$2');

  // Código en línea: `x` -> x.
  text = text.replace(/`{1,3}([^`\n]+?)`{1,3}/g, '$1');

  // Viñetas -> punto medio. Se preserva la indentación (jerarquía de listas).
  text = text.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');
  // Las listas numeradas se dejan como están: el número es información.

  // Tachado.
  text = text.replace(/~~(\S[\s\S]*?\S|\S)~~/g, '$1');

  // Restos de sintaxis que hayan quedado sin pareja y que el cliente vería.
  text = text.replace(/\*\*/g, '');

  // Como mucho dos saltos seguidos, y sin espacios al final de línea.
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * ¿Queda sintaxis Markdown visible? Se usa en las pruebas y sirve de red para
 * detectar regresiones si algún día se añade un caso nuevo.
 */
export function hasMarkdownArtifacts(text: string): boolean {
  return (
    /^[ \t]{0,3}#{1,6}[ \t]+\S/m.test(text) || // encabezados
    /\*\*/.test(text) || // negrita
    /(^|[^\w*])\*\S[^*\n]*\*(?=[^\w*]|$)/.test(text) || // cursiva
    /^[ \t]*[-*+][ \t]+\S/m.test(text) // viñetas sin convertir
  );
}
