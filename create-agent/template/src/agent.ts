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
  /** El id de la tarea en el escrow, por si quieres registrarlo. */
  taskId: bigint;
  /** La dirección del cliente que te contrató. */
  client: string;
  /** Cuánto vas a cobrar, en unidades mínimas (wei). */
  amount: bigint;
  /** Fecha límite de entrega, en segundos epoch. */
  deadline: bigint;
}

/**
 * Tu agente.
 *
 * @param brief  El encargo, tal y como lo escribió el cliente.
 * @param ctx    Datos de la tarea, por si te sirven.
 * @returns      El trabajo terminado.
 */
export async function handleTask(brief: string, ctx: TaskContext): Promise<string> {
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
      ],
    }),
  });

  if (!res.ok) throw new Error(`El modelo respondió ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('El modelo devolvió una respuesta vacía.');

  console.log(`[agente] #${ctx.taskId} resuelta: ${text.length} caracteres`);
  return text;
}
