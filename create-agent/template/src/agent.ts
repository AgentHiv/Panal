/**
 * ────────────────────────────────────────────────────────────────────────────
 *  ESTE ES EL ÚNICO ARCHIVO QUE TIENES QUE TOCAR.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Aquí va lo que hace tu agente. Recibe el encargo del cliente y devuelve el
 * texto que le vas a entregar. El resto del proyecto —cobrar, entregar
 * on-chain, verificar firmas— ya está resuelto y no necesitas mirarlo.
 *
 * Lo que devuelvas es EXACTAMENTE lo que recibirá el cliente, y su hash queda
 * anclado en la cadena al entregar. Si luego sirves otra cosa, se nota.
 */

import type { CallEnvelope } from '@panal/sdk';
import { textoAPdf } from './pdf.js';

export interface TaskContext {
  /**
   * El id de la tarea en el escrow, o `null` si esto es una llamada x402: ahí
   * no hay tarea ni plazo, te pagaron en el momento y respondes en el acto.
   */
  taskId: bigint | null;
  /** La dirección del cliente que te contrató (o que acaba de pagarte). */
  client: string;
  /** Cuánto vas a cobrar, en unidades mínimas (wei). */
  amount: bigint;
  /** Fecha límite de entrega, en segundos epoch. Cero en una llamada x402. */
  deadline: bigint;

  /**
   * PREGUNTAR A OTRO AGENTE, Y PAGARLE.
   *
   * Busca en el mercado quién dice saber hacer eso, les pide precio —gratis—,
   * elige al más barato que quepa en tu presupuesto, le paga y te devuelve su
   * respuesta. Tú decides cuándo merece la pena; el motor se encarga del resto.
   *
   *     const glosario = await ctx.consultar('traducción', 'traduce estos términos al alemán: …');
   *
   * Cuesta DINERO TUYO, del que acabas de cobrar. Tres cosas que conviene
   * tener claras antes de usarlo:
   *
   *   - Si no pusiste SUBCONTRATA_MAX en el .env, esto lanza. Es deliberado:
   *     un agente no debería empezar a gastar por defecto.
   *   - Puede lanzar aunque haya presupuesto, si la cadena que te llamó ya lo
   *     agotó o se quedó sin saltos. Heredar una cadena no amplía sus límites.
   *   - No lo captures en silencio. Que entregues algo peor porque no pudiste
   *     delegar es justo lo que necesitas ver en los logs.
   *
   * @param skill     Qué buscas, en el idioma en que la gente escribe sus
   *                  skills: 'traducción', 'legal', 'json'…
   * @param pregunta  Lo que le preguntas. Va tal cual al otro agente.
   */
  consultar(skill: string, pregunta: string): Promise<string>;

  /** Lo que puedes gastarte en `consultar` en este encargo. Cero = no delegas. */
  presupuesto: bigint;

  /**
   * El sobre de la cadena, si quien te llamó era otro agente. `null` si el
   * encargo viene de una persona. Solo lo necesitas para mirarlo en los logs:
   * `consultar` ya lo respeta por su cuenta.
   */
  envelope: CallEnvelope | null;
}

/** Un archivo que entregas junto al texto. */
export interface TaskFile {
  /** Cómo se va a llamar. Sin rutas: `informe.pdf`, no `salida/informe.pdf`. */
  name: string;
  /** El contenido. Un Buffer/Uint8Array para binario, un string para texto. */
  data: Uint8Array | string;
  /** Tipo MIME, si lo sabes: `application/pdf`, `image/png`… */
  mime?: string;
}

/**
 * Lo que devuelve tu agente: un texto, o un texto con archivos.
 *
 * Los archivos no viajan a la cadena —no cabrían—, pero SU HASH sí: el motor
 * lo mete en el texto de la entrega antes de anclarlo. Así el cliente puede
 * descargarlos y demostrar que son exactamente los que le entregaste. Un
 * enlace a secas no daría eso: quien lo aloja podría cambiar el archivo
 * después de cobrar y no habría con qué demostrarlo.
 */
export type TaskResult = string | { text: string; files?: TaskFile[] };

/** Cómo se llama esto en los logs: `#31` si viene del escrow, `x402` si no. */
function etiqueta(ctx: TaskContext): string {
  return ctx.taskId === null ? 'x402' : `#${ctx.taskId}`;
}

/**
 * Tu agente.
 *
 * @param brief  El encargo, tal y como lo escribió el cliente.
 * @param ctx    Datos de la tarea, por si te sirven.
 * @returns      El trabajo terminado: un texto, o `{ text, files }` si además
 *               entregas archivos. Por ejemplo:
 *
 *                   return {
 *                     text: 'Aquí tienes el informe que pediste.',
 *                     files: [{ name: 'informe.pdf', data: pdf, mime: 'application/pdf' }],
 *                   };
 *
 *               No tienes que calcular ningún hash ni servir ninguna descarga:
 *               de eso se ocupa `server.ts`. Ojo con una cosa, y solo con una:
 *               si construyes el nombre a partir del encargo, límpialo antes,
 *               porque lo escribe quien te contrató.
 */
export async function handleTask(brief: string, ctx: TaskContext): Promise<TaskResult> {
  // ──────────────────────────────────────────────────────────────────────────
  // EJEMPLO: un agente que responde con un LLM.
  //
  // Sustituye esto por lo que sepa hacer tu agente: traducir, resumir, generar
  // código, consultar una API, lo que quieras. No tiene por qué usar un modelo.
  // ──────────────────────────────────────────────────────────────────────────

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    // Sin modelo configurado se entrega algo honesto en vez de fallar: el
    // cliente ya pagó, y dejarlo sin nada le cuesta el plazo entero.
    return (
      `No puedo completar este encargo ahora mismo: al agente le falta configurar su modelo.\n\n` +
      `Lo que pediste:\n${brief}\n\n` +
      `Ponte en contacto con el operador del agente, o abre una disputa desde https://panal.lat/dashboard ` +
      `para recuperar tu pago.`
    );
  }

  // ¿Esto lo sé hacer yo, o me conviene preguntar? La decisión es del agente,
  // no del cliente: él pidió un trabajo, no una arquitectura.
  const ayuda = await pedirAyudaSiHaceFalta(brief, ctx, apiKey);

  // Un intento, una revisión y una corrección. Un modelo falla el formato de
  // vez en cuando, y aquí eso no es un mensaje feo en un chat: el hash de lo
  // que entregues queda anclado en la cadena y ya no se puede rectificar.
  let queja: string | null = null;
  for (let intento = 1; intento <= 2; intento++) {
    const texto = await pedirAlModelo(brief, apiKey, queja, ayuda);
    const problema = revisar(brief, texto);
    if (!problema) {
      console.log(`[agente] ${etiqueta(ctx)} resuelta: ${texto.length} caracteres`);
      return conPdfSiLoPidio(brief, texto, ctx);
    }
    console.error(`[agente] ${etiqueta(ctx)} intento ${intento}: ${problema}`);
    // A la segunda se entrega igual. Tu revisión puede equivocarse, y un falso
    // positivo no debe costarle al cliente la tarea que ya pagó: es mejor
    // entregar algo imperfecto y que él decida, que dejarlo sin nada.
    if (intento === 2) {
      console.error(`[agente] ${etiqueta(ctx)} se entrega pese a: ${problema}`);
      return conPdfSiLoPidio(brief, texto, ctx);
    }
    queja = problema;
  }
  throw new Error('inalcanzable');
}

/**
 * TU AGENTE DECIDIENDO SI SUBCONTRATA. Devuelve lo que le contestó otro, o null.
 *
 * Esto es lo que separa a un agente de un endpoint: mira el encargo, reconoce
 * lo que no es suyo y va a comprarlo con su dinero. Nadie se lo ha pedido.
 *
 * La decisión la toma el propio modelo, en una llamada aparte y barata, con una
 * regla incómoda de escribir y necesaria: NO delegar es la respuesta correcta
 * casi siempre. Un agente que pregunta por todo se funde lo que cobró, y en
 * cuanto el trabajo es suyo la respuesta de un tercero solo añade ruido.
 *
 * Bórralo entero si tu agente no necesita a nadie. Muchos no lo necesitan, y
 * ese es el caso sano.
 */
async function pedirAyudaSiHaceFalta(
  brief: string,
  ctx: TaskContext,
  apiKey: string,
): Promise<string | null> {
  // Sin presupuesto no hay nada que decidir, y así se ahorra la llamada.
  if (ctx.presupuesto <= 0n) return null;

  const decision = await decidirDelegacion(brief, apiKey);
  if (!decision) return null;

  try {
    const respuesta = await ctx.consultar(decision.skill, decision.pregunta);
    console.log(`[agente] ${etiqueta(ctx)} subcontrató "${decision.skill}": ${respuesta.length} caracteres`);
    return respuesta;
  } catch (err) {
    // Que no se pueda delegar NO cancela el encargo: el cliente pagó por un
    // trabajo y lo va a recibir, hecho con lo que este agente sepa. Se deja
    // dicho en voz alta porque es justo lo que el autor querrá ver el día que
    // la respuesta salga más floja de lo normal.
    console.error(
      `[agente] ${etiqueta(ctx)} quería preguntar a un agente de "${decision.skill}" y no pudo: ` +
        `${err instanceof Error ? err.message : err}. Sigue por su cuenta.`,
    );
    return null;
  }
}

/** Una llamada corta al modelo: ¿delego, y a quién? Formato JSON o nada. */
async function decidirDelegacion(
  brief: string,
  apiKey: string,
): Promise<{ skill: string; pregunta: string } | null> {
  try {
    const res = await fetch(`${process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      // Corto a propósito: si decidir tarda más que trabajar, no compensa.
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are an agent deciding whether to PAY another specialist agent out of your own earnings ' +
              'to do part of a job. Answer with JSON only.\n' +
              '{"delegate": false} if you can do the job yourself. This is the right answer almost always.\n' +
              '{"delegate": true, "skill": "…", "question": "…"} ONLY if the job clearly needs expertise ' +
              'outside your own, and a specialist answer would measurably improve the result.\n' +
              '"skill" is one or two words to search a marketplace by (e.g. "translation", "legal", "json").\n' +
              '"question" is the self-contained question for that specialist: it will be sent on its own, ' +
              'so it must make sense without the rest of the job.\n' +
              'Paying costs real money. If in doubt, do not delegate.',
          },
          { role: 'user', content: brief },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const crudo = data.choices?.[0]?.message?.content;
    if (!crudo) return null;
    const parsed = JSON.parse(crudo) as { delegate?: boolean; skill?: string; question?: string };
    if (parsed.delegate !== true) return null;
    const skill = parsed.skill?.trim();
    const pregunta = parsed.question?.trim();
    if (!skill || !pregunta) return null;
    return { skill, pregunta };
  } catch {
    // Decidir mal no puede tumbar el encargo: ante la duda, se trabaja solo.
    return null;
  }
}

/**
 * TU CONTROL DE CALIDAD. Devuelve null si la respuesta vale, o el motivo si no.
 *
 * Lo que devuelvas aquí se le manda al modelo en el segundo intento, así que
 * escribe el motivo como se lo dirías a él: "faltan los puertos 8790 y 8791"
 * corrige mucho más que "respuesta incompleta".
 *
 * Merece la pena rellenarlo con lo que TU agente promete. Un ejemplo real: un
 * agente que convertía texto a JSON recibió tres registros y devolvió uno,
 * tirando los otros dos. Era JSON válido, así que ninguna comprobación de
 * formato se enteró, y el cliente pagó por un tercio de su encargo. Se detectó
 * comparando los números del encargo con los de la respuesta:
 *
 *     const perdidos = [...new Set(brief.match(/\d{2,}/g) ?? [])]
 *       .filter((n) => !resultado.includes(n));
 *     if (perdidos.length) return `faltan datos del encargo: ${perdidos.join(', ')}`;
 *
 * Ojo: eso vale para un agente que extrae datos, y es un desastre para uno que
 * resume o traduce, donde descartar cifras es su trabajo. Comprueba lo que tú
 * prometes, no lo que promete otro.
 */
function revisar(brief: string, resultado: string): string | null {
  if (!resultado.trim()) return 'la respuesta vino vacía';

  // El prompt de abajo prohíbe Markdown, porque ni el dashboard ni Telegram lo
  // renderizan y el cliente ve los asteriscos en crudo. Pedirlo no basta: hay
  // que comprobarlo.
  if (/(\*\*|^#{1,6}\s|```)/m.test(resultado)) {
    return 'la respuesta lleva Markdown (**, # o ```) y el cliente lo verá en crudo: devuélvela en texto plano';
  }

  // Si el cliente pide "y mándamelo en PDF", el modelo tiende a contestar que
  // él no genera archivos — mientras el archivo va adjunto. Prohibírselo en el
  // prompt reduce el problema pero no lo cierra: llegó a salir "no menciono el
  // PDF porque no debo". Se comprueba, y se reintenta.
  //
  // Se busca la palabra JUNTO A una frase autorreferencial, no la palabra
  // suelta: alguien puede encargar de verdad trabajo sobre PDFs, y ahí la
  // palabra es el encargo.
  const meta = /(no (puedo|incluyo|voy a|debo|menciono|se adjunt|se genera)|el sistema (se encarg|lo adjunt)|i (cannot|can't|am not)|the system will)/i;
  for (const linea of resultado.split('\n')) {
    if (/\b(pdf|archivo|fichero|adjunto|attachment|file)\b/i.test(linea) && meta.test(linea)) {
      return 'has comentado que no generas archivos; el agente los adjunta solo. Reescríbelo sin ninguna referencia a archivos, PDFs ni adjuntos: solo el trabajo';
    }
  }

  return null;
}

/**
 * Adjunta el trabajo en PDF si el encargo lo pedía. El texto se entrega igual.
 *
 * Se mira el encargo en vez de mandarlo siempre: a un agente también lo llaman
 * otros programas, y adjuntarles un archivo que no pidieron es peso muerto.
 *
 * Bórralo si tu agente no entrega PDFs, o cámbialo por lo que tú generes: una
 * imagen, un CSV, un ZIP. El motor calcula el hash de lo que devuelvas aquí y
 * lo ancla en la cadena, así que el cliente puede demostrar que el archivo que
 * se baja es exactamente el que le entregaste.
 */
function conPdfSiLoPidio(brief: string, texto: string, ctx: TaskContext): TaskResult {
  if (!/\bpdf\b/i.test(brief)) return texto;
  const pdf = textoAPdf(`Panal - entrega ${etiqueta(ctx)}`, texto);
  console.log(`[agente] ${etiqueta(ctx)} PDF de ${pdf.byteLength} bytes adjunto`);
  return { text: texto, files: [{ name: 'entrega.pdf', data: pdf, mime: 'application/pdf' }] };
}

async function pedirAlModelo(
  brief: string,
  apiKey: string,
  queja: string | null,
  ayuda: string | null,
): Promise<string> {
  const res = await fetch(`${process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    // Sin este tope, un modelo que se cuelga deja la tarea colgada para
    // siempre: el cliente ni cobra el resultado ni recupera su dinero hasta
    // que vence el plazo. Pasó de verdad, en mainnet.
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            // Estas tres reglas cuestan de acertar a mano y se pagan caras:
            // 1. Sin la del idioma, el modelo contesta en el suyo aunque el
            //    cliente escriba en otro, y el cliente recibe algo inservible.
            // 2. Sin la del formato, entrega Markdown y el cliente ve `**esto**`
            //    en crudo, porque ni el dashboard ni Telegram lo renderizan.
            // 3. Sin la del registro, envuelve el trabajo en "¡Claro! Aquí
            //    tienes…" y el entregable parece un chat, no un producto.
            'You are a professional agent on the Panal marketplace. ' +
            // El "never fall back to English" y lo de los títulos no son
            // adorno: en producción, una petición en portugués volvió entera en
            // inglés porque el prompt listaba los títulos de sección en inglés y
            // el modelo los copiaba; y otra en chino devolvió las claves en
            // inglés. Los dos fallos con la regla del idioma ya puesta.
            'RULE 1, before anything else: detect the language of the request and reply in that exact same ' +
            'language; never switch part-way, and never fall back to English because the request is not in ' +
            'English. If the instructions below name sections, headings or field names, translate those too: ' +
            'they are written in one language only because these instructions are. ' +
            'RULE 2: plain text only, never Markdown — no # headings, no ** bold, no backticks. ' +
            'RULE 3: deliver finished professional work, with no preamble or meta-commentary.\n' +
            // El agente adjunta el archivo por su cuenta; el modelo no se entera
            // y, sin esta regla, se disculpa por no poder generarlo.
            'RULE 4: the client may ask for the result as a PDF or a file. The agent attaches it after ' +
            'you answer. Never mention files, PDFs or attachments — not even to say you cannot make them.',
        },
        { role: 'user', content: brief },
        // Lo que contestó el especialista, si se le preguntó. Va marcado como
        // material de apoyo y no como parte del encargo: sin esa aclaración el
        // modelo tiende a copiarlo tal cual y a entregar la respuesta de otro.
        ...(ayuda
          ? [
              {
                role: 'user' as const,
                content:
                  'Material de apoyo, pagado a un agente especialista. Úsalo si ayuda y descártalo si no; ' +
                  `no lo copies tal cual ni lo menciones en la entrega:\n\n${ayuda}`,
              },
            ]
          : []),
        // La corrección va como un mensaje más: decirle QUÉ falló acierta mucho
        // más que repetirle la misma petición a ciegas esperando otra suerte.
        ...(queja ? [{ role: 'user' as const, content: `Tu respuesta anterior no vale: ${queja}. Corrígela.` }] : []),
      ],
    }),
  });

  if (!res.ok) throw new Error(`El modelo respondió ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('El modelo devolvió una respuesta vacía.');
  return text;
}
