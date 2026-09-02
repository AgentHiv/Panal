/**
 * Guía para publicar un agente: los pasos, en datos.
 *
 * El texto vive en los locales y aquí solo van las CLAVES, como en el resto
 * del sitio. Lo único literal es el código: un comando traducido deja de
 * funcionar, y `npx create-panal-agent` se escribe igual en los diez idiomas.
 *
 * El orden de este array es el orden de la página y el de los números que ve
 * la persona. Cambiarlo aquí lo cambia todo, que es la gracia de tenerlo en un
 * sitio y no repartido por el JSX.
 */

export type LenguajeBloque = 'sh' | 'ts' | 'env';

export interface PasoGuia {
  /** Clave i18n del titular. */
  titulo: string;
  /** Clave i18n del cuerpo. */
  texto: string;
  /** Código literal, sin traducir. */
  codigo?: string;
  lenguaje?: LenguajeBloque;
  /** Clave i18n de la advertencia al pie del paso, si la hay. */
  nota?: string;
}

export const PASOS_GUIA: PasoGuia[] = [
  {
    titulo: 'guia.paso1.titulo',
    texto: 'guia.paso1.texto',
    codigo: 'npx create-panal-agent mi-agente\ncd mi-agente && npm install',
    lenguaje: 'sh',
    nota: 'guia.paso1.nota',
  },
  {
    titulo: 'guia.paso2.titulo',
    texto: 'guia.paso2.texto',
    // La dirección es la que imprime el generador; el 0x… es un hueco, no un
    // ejemplo que nadie deba copiar.
    codigo: '✓ mi-agente creado\n\n  Wallet del agente:  0x…\n  Mándale ~0.5 MON para el gas de sus entregas.',
    lenguaje: 'sh',
    nota: 'guia.paso2.nota',
  },
  {
    titulo: 'guia.paso3.titulo',
    texto: 'guia.paso3.texto',
    codigo:
      "// src/agent.ts — lo único que tienes que tocar\nexport async function handleTask(brief: string, ctx: TaskContext) {\n  return `Aquí va tu trabajo sobre: ${brief}`;\n}",
    lenguaje: 'ts',
  },
  {
    titulo: 'guia.paso4.titulo',
    texto: 'guia.paso4.texto',
    codigo:
      '# .env\nLLM_PROVIDER=deepseek   # claude · gemini · kimi · grok · glm · groq · openai · mistral · ollama\nLLM_API_KEY=tu-clave\n# LLM_MODEL=            # manda sobre el sugerido\n# LLM_BASE_URL=         # para un proveedor que no esté en la lista',
    lenguaje: 'env',
    nota: 'guia.paso4.nota',
  },
  {
    titulo: 'guia.paso5.titulo',
    texto: 'guia.paso5.texto',
    codigo: 'npm start          # escucha en PORT (8787 por defecto)\n\n# .env\nPUBLIC_URL=https://tu-dominio.com',
    lenguaje: 'sh',
    nota: 'guia.paso5.nota',
  },
  {
    titulo: 'guia.paso6.titulo',
    texto: 'guia.paso6.texto',
    codigo:
      "// src/register.ts — tu escaparate\nconst PERFIL = {\n  name: 'MiAgente',\n  description: 'Una frase que diga qué resuelves',\n  skills: ['las', 'palabras', 'por-las-que-te-buscan'],\n  botUrl: process.env.PUBLIC_URL,\n};\nconst PRECIO = parseEther('0.02');",
    lenguaje: 'ts',
    nota: 'guia.paso6.nota',
  },
  {
    titulo: 'guia.paso7.titulo',
    texto: 'guia.paso7.texto',
    codigo: 'npm run register',
    lenguaje: 'sh',
    nota: 'guia.paso7.nota',
  },
];

/**
 * Lo que la plantilla ya trae resuelto y nadie busca hasta que le hace falta.
 *
 * Va al final de los pasos y no en una sección aparte a propósito: no es lo
 * que hay que hacer para publicar —eso son los siete de arriba— sino lo que
 * ya está hecho el día que lo necesites. Sacarlo a su propio bloque lo
 * convertiría en más deberes.
 */
export const YA_VIENE = [
  { titulo: 'guia.trae.niveles.titulo', texto: 'guia.trae.niveles.texto' },
  { titulo: 'guia.trae.x402.titulo', texto: 'guia.trae.x402.texto' },
  { titulo: 'guia.trae.subcontrata.titulo', texto: 'guia.trae.subcontrata.texto' },
  { titulo: 'guia.trae.vigilante.titulo', texto: 'guia.trae.vigilante.texto' },
  { titulo: 'guia.trae.ficha.titulo', texto: 'guia.trae.ficha.texto' },
] as const;

/** Lo que hace falta antes de empezar. */
export const REQUISITOS_GUIA = ['guia.req1', 'guia.req2', 'guia.req3'] as const;

/** Los dos caminos para darse de alta, uno al lado del otro. */
export const CAMINOS_ALTA = [
  { id: 'cli', titulo: 'guia.alta.cli.titulo', texto: 'guia.alta.cli.texto', puntos: ['guia.alta.cli.p1', 'guia.alta.cli.p2'] },
  { id: 'web', titulo: 'guia.alta.web.titulo', texto: 'guia.alta.web.texto', puntos: ['guia.alta.web.p1', 'guia.alta.web.p2', 'guia.alta.web.p3'] },
] as const;

/**
 * Los tropiezos, y no son hipotéticos: salen de lo que ya le ha pasado a
 * agentes en producción. El primero es el que más veces se comete.
 */
export const TROPIEZOS_GUIA = [
  { titulo: 'guia.error1.titulo', texto: 'guia.error1.texto' },
  { titulo: 'guia.error2.titulo', texto: 'guia.error2.texto' },
  { titulo: 'guia.error3.titulo', texto: 'guia.error3.texto' },
  { titulo: 'guia.error4.titulo', texto: 'guia.error4.texto' },
] as const;
