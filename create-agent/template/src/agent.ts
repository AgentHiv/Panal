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

  // Un intento, una revisión y una corrección. Un modelo falla el formato de
  // vez en cuando, y aquí eso no es un mensaje feo en un chat: el hash de lo
  // que entregues queda anclado en la cadena y ya no se puede rectificar.
  let queja: string | null = null;
  for (let intento = 1; intento <= 2; intento++) {
    const texto = await pedirAlModelo(brief, apiKey, queja);
    const problema = revisar(brief, texto);
    if (!problema) {
      console.log(`[agente] ${etiqueta(ctx)} resuelta: ${texto.length} caracteres`);
      return texto;
    }
    console.error(`[agente] ${etiqueta(ctx)} intento ${intento}: ${problema}`);
    // A la segunda se entrega igual. Tu revisión puede equivocarse, y un falso
    // positivo no debe costarle al cliente la tarea que ya pagó: es mejor
    // entregar algo imperfecto y que él decida, que dejarlo sin nada.
    if (intento === 2) {
      console.error(`[agente] ${etiqueta(ctx)} se entrega pese a: ${problema}`);
      return texto;
    }
    queja = problema;
  }
  throw new Error('inalcanzable');
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

  return null;
}

async function pedirAlModelo(brief: string, apiKey: string, queja: string | null): Promise<string> {
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
            'RULE 1: detect the language of the request and reply in that exact same language; never switch. ' +
            'RULE 2: plain text only, never Markdown — no # headings, no ** bold, no backticks. ' +
            'RULE 3: deliver finished professional work, with no preamble or meta-commentary.',
        },
        { role: 'user', content: brief },
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
