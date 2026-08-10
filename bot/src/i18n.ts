/**
 * Panal Bot — mensajes en los 10 idiomas del proyecto.
 *
 * El bot le habla a UNA persona: el dueño del agente (TELEGRAM_CHAT_ID). Por
 * eso el idioma es una opción del operador (`BOT_LANG` en el .env) y no se
 * detecta por mensaje. El idioma de las ENTREGAS al cliente es otra cosa
 * distinta y la sigue decidiendo el system prompt del LLM, que refleja el
 * idioma en que escribió el cliente.
 *
 * Formato: las plantillas llevan HTML de Telegram (`<b>`, `<code>`, `<a>`).
 * Telegram lo renderiza y el usuario NUNCA ve la etiqueta —a diferencia del
 * Markdown, que se colaba crudo en pantalla con asteriscos y almohadillas—.
 * Los valores interpolados se escapan en `t()`, así que un brief con `<` o un
 * mensaje de error con `&` no puede romper el parser ni inyectar formato.
 *
 * Los placeholders `{{nombre}}` se sustituyen en `t()`. `scripts/test-i18n.ts`
 * comprueba que los 10 idiomas tengan las mismas claves y los mismos
 * placeholders: una traducción a medias no llega a producción.
 */

export const BOT_LANGS = ['es', 'en', 'zh', 'hi', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur'] as const;
export type BotLang = (typeof BOT_LANGS)[number];

export const DEFAULT_LANG: BotLang = 'es';

export function isBotLang(value: string): value is BotLang {
  return (BOT_LANGS as readonly string[]).includes(value);
}

/** Escapa lo que Telegram interpreta como HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type MsgKey =
  // menú de comandos (setMyCommands)
  | 'menu.start'
  | 'menu.status'
  | 'menu.brief'
  | 'menu.result'
  // comandos
  | 'cmd.help'
  | 'cmd.unknown'
  | 'cmd.result.usage'
  | 'cmd.result.missing'
  | 'cmd.result.header'
  | 'cmd.brief.usage'
  | 'cmd.brief.saved'
  // /status
  | 'status.title'
  | 'status.open'
  | 'status.delivered'
  | 'status.disputed'
  | 'status.completed'
  | 'status.briefs'
  | 'status.pending'
  | 'status.panel'
  // tarea nueva
  | 'task.new.title'
  | 'task.new.amount'
  | 'task.new.client'
  | 'task.new.hash'
  | 'task.new.deadline'
  | 'task.new.hint'
  // transiciones de estado
  | 'task.completed'
  | 'task.delivered'
  | 'task.disputed'
  | 'task.cancelled'
  // worker
  | 'worker.delivered'
  | 'worker.result.header'
  | 'worker.result.truncated'
  | 'worker.failed'
  | 'worker.waitingBrief'
  // A2A (escuadras)
  | 'a2a.deadlineTooClose'
  | 'a2a.noCandidate'
  | 'a2a.tooExpensive'
  | 'a2a.budgetExhausted'
  | 'a2a.insufficientFunds'
  | 'a2a.subLate'
  | 'a2a.subApproved'
  | 'a2a.subCancelled'
  | 'a2a.subDisputed'
  | 'a2a.subRejected'
  | 'a2a.subcontracted'
  | 'worker.withdrawn';

type Catalog = Record<MsgKey, string>;

const es: Catalog = {
  'menu.start': 'Ayuda y comandos disponibles',
  'menu.status': 'Tus tareas y pagos pendientes',
  'menu.brief': 'Guardar el pedido del cliente para una tarea',
  'menu.result': 'Ver el resultado entregado de una tarea',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'Estos son tus comandos:\n\n' +
    '📝 <code>/brief #N texto</code>\n' +
    'Guarda el pedido del cliente para la tarea N. El brief no viaja on-chain, solo su hash: reenvíalo aquí cuando el cliente te lo pase.\n\n' +
    '📊 <code>/status</code>\n' +
    'Resumen de tus tareas y de lo que tienes pendiente de cobrar.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'Te devuelve el resultado que entregaste en esa tarea.\n\n' +
    '🔗 <a href="{{dashboard}}">Abrir el panel</a>',
  'cmd.unknown': '🤔 No conozco ese comando. Escribe /start para ver la lista.',
  'cmd.result.usage': '⚠️ Formato: <code>/result #N</code>\nEjemplo: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ No tengo guardado ningún resultado para la tarea <b>#{{id}}</b>.\n' +
    'Si el agente ya la entregó on-chain, pídele al operador su resultado.',
  'cmd.result.header': '📄 <b>Resultado de #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ Formato: <code>/brief #N texto del pedido</code>\n' +
    'Ejemplo: <code>/brief #3 Redacta un hilo de 5 tuits sobre Monad</code>',
  'cmd.brief.saved': '📝 Brief guardado para la tarea <b>#{{id}}</b> ({{chars}} caracteres).',

  'status.title': '🐝 <b>Estado de tu agente</b>',
  'status.open': '📥 Abiertas ({{count}}): {{ids}}',
  'status.delivered': '📦 Entregadas, esperando aprobación ({{count}}): {{ids}}',
  'status.disputed': '⚠️ En disputa ({{count}}): {{ids}}',
  'status.completed': '✅ Completadas (histórico local): {{count}}',
  'status.briefs': '📝 Briefs guardados: {{count}}',
  'status.pending': '💰 <b>Pendiente de retirar:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">Abrir el panel</a>',

  'task.new.title': '🐝 <b>Nueva tarea #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 Cliente: <code>{{client}}</code>',
  'task.new.hash': '🔒 Hash del pedido: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ Vence: {{deadline}} UTC',
  'task.new.hint':
    'El brief no viaja on-chain, solo su hash. Cuando el cliente te lo pase, guárdalo con:\n' +
    '<code>/brief #{{id}} texto del pedido</code>',

  'task.completed':
    '💰 <b>Pago liberado de #{{id}}</b> ({{amount}})\n\n' +
    'Los fondos ya son tuyos. Retíralos desde <a href="{{dashboard}}">el panel</a>, o activa AUTO_WITHDRAW en el worker.',
  'task.delivered':
    '📦 <b>Tarea #{{id}} entregada</b> ({{amount}})\n\n' +
    'Esperando la aprobación del cliente, o auto-release en 72 h.',
  'task.disputed':
    '⚠️ <b>Tarea #{{id}} en disputa</b> ({{amount}})\n\n' +
    'Revisa el resultado que entregaste y habla con el cliente.',
  'task.cancelled': '❌ <b>Tarea #{{id}} cancelada</b> por el cliente.',

  'worker.delivered':
    '✅ <b>Entregada #{{id}}</b>\n\n' +
    'Esperando la aprobación del cliente, o auto-release en 72 h.\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>Resultado de #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>Resultado de #{{id}}</b> ({{chars}} caracteres: demasiado para Telegram, va recortado)\n\n' +
    'El texto completo está en <code>results/{{id}}.md</code> o con <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>Falló la entrega de #{{id}}</b>\n\n' +
    '{{error}}\n\n' +
    'Se reintentará solo en unos 10 minutos.',
  'worker.waitingBrief':
    '⏳ <b>Tarea #{{id}} todavía sin brief</b>\n\n' +
    'Espero unos {{minutes}} min a que el cliente lo envíe. También puedes cargarlo tú:\n' +
    '<code>/brief #{{id}} texto del pedido</code>\n\n' +
    'Si no llega, generaré un resultado genérico.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} pediría subcontratar «{{skill}}», pero su plazo está demasiado cerca. Se resuelve sin subcontratar.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · quise subcontratar «{{skill}}» para #{{id}}, pero no hay ningún agente activo con esa skill. Se resuelve sin subcontratar.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · el candidato más barato para «{{skill}}» cobra {{price}} {{symbol}}, por encima de tu límite por sub-tarea. #{{id}} se resuelve sin subcontratar.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · presupuesto diario agotado ({{spent}} de {{budget}}). #{{id}} se resuelve sin subcontratar.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · no tienes {{symbol}} suficiente para subcontratar «{{skill}}» ({{price}} {{symbol}}). #{{id}} se resuelve sin subcontratar.',
  'a2a.subLate':
    '⏱️ <b>Sub-#{{childId}}</b> ({{skill}}, {{amount}}) no entregó a tiempo. El padre #{{parentId}} se entrega sin esa parte.',
  'a2a.subApproved':
    '⭐ <b>Sub-#{{childId}} aprobada</b> con {{rating}}/5 ({{amount}}). Integrando su resultado en el padre #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>Sub-#{{childId}}</b> ({{skill}}) fue cancelada. El padre #{{parentId}} se entrega sin esa parte.',
  'a2a.subDisputed':
    '⚠️ <b>Sub-#{{childId}} en disputa</b> ({{amount}}). Revísala en <a href="{{dashboard}}">el panel</a>; el padre #{{parentId}} sigue aparcado.',
  'a2a.subRejected':
    '⚠️ <b>Sub-#{{childId}} NO aprobada</b> · el evaluador le dio {{rating}}/5, por debajo de tu mínimo de {{min}}.\n\nMotivo: {{comment}}\n\nNo se libera el pago; al hijo lo cubre el auto-release de 72 h. <b>Conviene que lo mires tú</b>: si el resultado vale, apruébala desde <a href="{{dashboard}}">el panel</a>. El padre #{{parentId}} se entrega sin esa parte.',
  'a2a.subcontracted':
    '🤝 <b>Subcontraté parte de #{{id}}</b>\n\n👤 Agente: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · sub-#{{childId}}\n🧩 Skill: {{skill}}\n⏰ Vence: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>Retirados {{amount}} {{symbol}}</b> a la wallet del agente.\n🔗 tx: <code>{{tx}}</code>',
};

const en: Catalog = {
  'menu.start': 'Help and available commands',
  'menu.status': 'Your tasks and pending payments',
  'menu.brief': 'Save the client brief for a task',
  'menu.result': 'View the delivered result of a task',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'Here are your commands:\n\n' +
    '📝 <code>/brief #N text</code>\n' +
    'Saves the client brief for task N. The brief never goes on-chain, only its hash: forward it here once the client sends it to you.\n\n' +
    '📊 <code>/status</code>\n' +
    'A summary of your tasks and what you have left to collect.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'Returns the result you delivered for that task.\n\n' +
    '🔗 <a href="{{dashboard}}">Open the dashboard</a>',
  'cmd.unknown': "🤔 I don't know that command. Send /start to see the list.",
  'cmd.result.usage': '⚠️ Format: <code>/result #N</code>\nExample: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ I have no stored result for task <b>#{{id}}</b>.\n' +
    'If the agent already delivered it on-chain, ask its operator for the result.',
  'cmd.result.header': '📄 <b>Result of #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ Format: <code>/brief #N brief text</code>\n' +
    'Example: <code>/brief #3 Write a 5-tweet thread about Monad</code>',
  'cmd.brief.saved': '📝 Brief saved for task <b>#{{id}}</b> ({{chars}} characters).',

  'status.title': '🐝 <b>Your agent at a glance</b>',
  'status.open': '📥 Open ({{count}}): {{ids}}',
  'status.delivered': '📦 Delivered, awaiting approval ({{count}}): {{ids}}',
  'status.disputed': '⚠️ Disputed ({{count}}): {{ids}}',
  'status.completed': '✅ Completed (local history): {{count}}',
  'status.briefs': '📝 Briefs stored: {{count}}',
  'status.pending': '💰 <b>Ready to withdraw:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">Open the dashboard</a>',

  'task.new.title': '🐝 <b>New task #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 Client: <code>{{client}}</code>',
  'task.new.hash': '🔒 Brief hash: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ Due: {{deadline}} UTC',
  'task.new.hint':
    'The brief never goes on-chain, only its hash. Once the client sends it to you, store it with:\n' +
    '<code>/brief #{{id}} brief text</code>',

  'task.completed':
    '💰 <b>Payment released for #{{id}}</b> ({{amount}})\n\n' +
    'The funds are yours. Withdraw them from <a href="{{dashboard}}">the dashboard</a>, or turn on AUTO_WITHDRAW in the worker.',
  'task.delivered':
    '📦 <b>Task #{{id}} delivered</b> ({{amount}})\n\n' +
    'Waiting for the client to approve, or auto-release in 72 h.',
  'task.disputed':
    '⚠️ <b>Task #{{id}} disputed</b> ({{amount}})\n\n' +
    'Review what you delivered and talk to the client.',
  'task.cancelled': '❌ <b>Task #{{id}} cancelled</b> by the client.',

  'worker.delivered':
    '✅ <b>Delivered #{{id}}</b>\n\n' +
    'Waiting for the client to approve, or auto-release in 72 h.\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>Result of #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>Result of #{{id}}</b> ({{chars}} characters: too long for Telegram, shown trimmed)\n\n' +
    'The full text is in <code>results/{{id}}.md</code> or via <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>Delivery of #{{id}} failed</b>\n\n' +
    '{{error}}\n\n' +
    'It will retry on its own in about 10 minutes.',
  'worker.waitingBrief':
    '⏳ <b>Task #{{id}} still has no brief</b>\n\n' +
    'I will wait about {{minutes}} min for the client to send it. You can also load it yourself:\n' +
    '<code>/brief #{{id}} brief text</code>\n\n' +
    'If it never arrives, I will produce a generic result.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} would subcontract “{{skill}}”, but its deadline is too close. Resolving without subcontracting.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · I wanted to subcontract “{{skill}}” for #{{id}}, but no active agent has that skill. Resolving without subcontracting.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · the cheapest candidate for “{{skill}}” charges {{price}} {{symbol}}, above your per-subtask cap. #{{id}} resolves without subcontracting.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · daily budget spent ({{spent}} of {{budget}}). #{{id}} resolves without subcontracting.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · not enough {{symbol}} to subcontract “{{skill}}” ({{price}} {{symbol}}). #{{id}} resolves without subcontracting.',
  'a2a.subLate':
    '⏱️ <b>Sub-#{{childId}}</b> ({{skill}}, {{amount}}) missed its deadline. Parent #{{parentId}} ships without that part.',
  'a2a.subApproved':
    '⭐ <b>Sub-#{{childId}} approved</b> at {{rating}}/5 ({{amount}}). Folding its result into parent #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>Sub-#{{childId}}</b> ({{skill}}) was cancelled. Parent #{{parentId}} ships without that part.',
  'a2a.subDisputed':
    '⚠️ <b>Sub-#{{childId}} disputed</b> ({{amount}}). Review it on <a href="{{dashboard}}">the dashboard</a>; parent #{{parentId}} stays parked.',
  'a2a.subRejected':
    '⚠️ <b>Sub-#{{childId}} not approved</b> · the reviewer rated it {{rating}}/5, below your minimum of {{min}}.\n\nReason: {{comment}}\n\nPayment stays locked; the child is covered by the 72 h auto-release. <b>Worth a human look</b>: if the work is fine, approve it from <a href="{{dashboard}}">the dashboard</a>. Parent #{{parentId}} ships without that part.',
  'a2a.subcontracted':
    '🤝 <b>Subcontracted part of #{{id}}</b>\n\n👤 Agent: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · sub-#{{childId}}\n🧩 Skill: {{skill}}\n⏰ Due: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>Withdrew {{amount}} {{symbol}}</b> to the agent wallet.\n🔗 tx: <code>{{tx}}</code>',
};

const pt: Catalog = {
  'menu.start': 'Ajuda e comandos disponíveis',
  'menu.status': 'Suas tarefas e pagamentos pendentes',
  'menu.brief': 'Salvar o pedido do cliente para uma tarefa',
  'menu.result': 'Ver o resultado entregue de uma tarefa',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'Estes são os seus comandos:\n\n' +
    '📝 <code>/brief #N texto</code>\n' +
    'Salva o pedido do cliente para a tarefa N. O brief não vai para a blockchain, apenas o seu hash: encaminhe-o aqui quando o cliente enviar.\n\n' +
    '📊 <code>/status</code>\n' +
    'Resumo das suas tarefas e do que falta receber.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'Devolve o resultado que você entregou nessa tarefa.\n\n' +
    '🔗 <a href="{{dashboard}}">Abrir o painel</a>',
  'cmd.unknown': '🤔 Não conheço esse comando. Envie /start para ver a lista.',
  'cmd.result.usage': '⚠️ Formato: <code>/result #N</code>\nExemplo: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ Não tenho nenhum resultado salvo para a tarefa <b>#{{id}}</b>.\n' +
    'Se o agente já entregou on-chain, peça o resultado ao operador dele.',
  'cmd.result.header': '📄 <b>Resultado de #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ Formato: <code>/brief #N texto do pedido</code>\n' +
    'Exemplo: <code>/brief #3 Escreva uma thread de 5 tuítes sobre Monad</code>',
  'cmd.brief.saved': '📝 Brief salvo para a tarefa <b>#{{id}}</b> ({{chars}} caracteres).',

  'status.title': '🐝 <b>Situação do seu agente</b>',
  'status.open': '📥 Abertas ({{count}}): {{ids}}',
  'status.delivered': '📦 Entregues, aguardando aprovação ({{count}}): {{ids}}',
  'status.disputed': '⚠️ Em disputa ({{count}}): {{ids}}',
  'status.completed': '✅ Concluídas (histórico local): {{count}}',
  'status.briefs': '📝 Briefs salvos: {{count}}',
  'status.pending': '💰 <b>Disponível para sacar:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">Abrir o painel</a>',

  'task.new.title': '🐝 <b>Nova tarefa #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 Cliente: <code>{{client}}</code>',
  'task.new.hash': '🔒 Hash do pedido: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ Vence: {{deadline}} UTC',
  'task.new.hint':
    'O brief não vai para a blockchain, apenas o seu hash. Quando o cliente enviar, salve com:\n' +
    '<code>/brief #{{id}} texto do pedido</code>',

  'task.completed':
    '💰 <b>Pagamento liberado de #{{id}}</b> ({{amount}})\n\n' +
    'Os fundos já são seus. Saque pelo <a href="{{dashboard}}">painel</a>, ou ative AUTO_WITHDRAW no worker.',
  'task.delivered':
    '📦 <b>Tarefa #{{id}} entregue</b> ({{amount}})\n\n' +
    'Aguardando a aprovação do cliente, ou auto-release em 72 h.',
  'task.disputed':
    '⚠️ <b>Tarefa #{{id}} em disputa</b> ({{amount}})\n\n' +
    'Revise o que você entregou e fale com o cliente.',
  'task.cancelled': '❌ <b>Tarefa #{{id}} cancelada</b> pelo cliente.',

  'worker.delivered':
    '✅ <b>Entregue #{{id}}</b>\n\n' +
    'Aguardando a aprovação do cliente, ou auto-release em 72 h.\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>Resultado de #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>Resultado de #{{id}}</b> ({{chars}} caracteres: longo demais para o Telegram, vai cortado)\n\n' +
    'O texto completo está em <code>results/{{id}}.md</code> ou com <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>Falha ao entregar #{{id}}</b>\n\n' +
    '{{error}}\n\n' +
    'Vai tentar de novo sozinho em uns 10 minutos.',
  'worker.waitingBrief':
    '⏳ <b>Tarefa #{{id}} ainda sem brief</b>\n\n' +
    'Vou esperar uns {{minutes}} min para o cliente enviar. Você também pode carregá-lo:\n' +
    '<code>/brief #{{id}} texto do pedido</code>\n\n' +
    'Se não chegar, vou gerar um resultado genérico.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} subcontrataria «{{skill}}», mas o prazo está perto demais. Resolvendo sem subcontratar.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · quis subcontratar «{{skill}}» para #{{id}}, mas não há agente ativo com essa skill. Resolvendo sem subcontratar.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · o candidato mais barato para «{{skill}}» cobra {{price}} {{symbol}}, acima do seu limite por subtarefa. #{{id}} resolve sem subcontratar.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · orçamento diário esgotado ({{spent}} de {{budget}}). #{{id}} resolve sem subcontratar.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · {{symbol}} insuficiente para subcontratar «{{skill}}» ({{price}} {{symbol}}). #{{id}} resolve sem subcontratar.',
  'a2a.subLate':
    '⏱️ <b>Sub-#{{childId}}</b> ({{skill}}, {{amount}}) não entregou a tempo. O pai #{{parentId}} vai sem essa parte.',
  'a2a.subApproved':
    '⭐ <b>Sub-#{{childId}} aprovada</b> com {{rating}}/5 ({{amount}}). Integrando o resultado no pai #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>Sub-#{{childId}}</b> ({{skill}}) foi cancelada. O pai #{{parentId}} vai sem essa parte.',
  'a2a.subDisputed':
    '⚠️ <b>Sub-#{{childId}} em disputa</b> ({{amount}}). Revise no <a href="{{dashboard}}">painel</a>; o pai #{{parentId}} segue parado.',
  'a2a.subRejected':
    '⚠️ <b>Sub-#{{childId}} não aprovada</b> · o avaliador deu {{rating}}/5, abaixo do seu mínimo de {{min}}.\n\nMotivo: {{comment}}\n\nO pagamento não é liberado; o filho fica coberto pelo auto-release de 72 h. <b>Vale você olhar</b>: se o resultado presta, aprove pelo <a href="{{dashboard}}">painel</a>. O pai #{{parentId}} vai sem essa parte.',
  'a2a.subcontracted':
    '🤝 <b>Subcontratei parte de #{{id}}</b>\n\n👤 Agente: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · sub-#{{childId}}\n🧩 Skill: {{skill}}\n⏰ Vence: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>Sacados {{amount}} {{symbol}}</b> para a wallet do agente.\n🔗 tx: <code>{{tx}}</code>',
};

const fr: Catalog = {
  'menu.start': 'Aide et commandes disponibles',
  'menu.status': 'Vos tâches et paiements en attente',
  'menu.brief': 'Enregistrer le brief du client pour une tâche',
  'menu.result': "Voir le résultat livré d'une tâche",

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'Voici vos commandes :\n\n' +
    '📝 <code>/brief #N texte</code>\n' +
    "Enregistre le brief du client pour la tâche N. Le brief ne va jamais on-chain, seulement son hash : transférez-le ici dès que le client vous l'envoie.\n\n" +
    '📊 <code>/status</code>\n' +
    'Un résumé de vos tâches et de ce qu’il vous reste à encaisser.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'Renvoie le résultat que vous avez livré pour cette tâche.\n\n' +
    '🔗 <a href="{{dashboard}}">Ouvrir le tableau de bord</a>',
  'cmd.unknown': '🤔 Je ne connais pas cette commande. Envoyez /start pour voir la liste.',
  'cmd.result.usage': '⚠️ Format : <code>/result #N</code>\nExemple : <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ Je n’ai aucun résultat enregistré pour la tâche <b>#{{id}}</b>.\n' +
    'Si l’agent l’a déjà livrée on-chain, demandez le résultat à son opérateur.',
  'cmd.result.header': '📄 <b>Résultat de #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ Format : <code>/brief #N texte du brief</code>\n' +
    'Exemple : <code>/brief #3 Rédige un fil de 5 tweets sur Monad</code>',
  'cmd.brief.saved': '📝 Brief enregistré pour la tâche <b>#{{id}}</b> ({{chars}} caractères).',

  'status.title': '🐝 <b>État de votre agent</b>',
  'status.open': '📥 Ouvertes ({{count}}) : {{ids}}',
  'status.delivered': '📦 Livrées, en attente de validation ({{count}}) : {{ids}}',
  'status.disputed': '⚠️ En litige ({{count}}) : {{ids}}',
  'status.completed': '✅ Terminées (historique local) : {{count}}',
  'status.briefs': '📝 Briefs enregistrés : {{count}}',
  'status.pending': '💰 <b>À retirer :</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">Ouvrir le tableau de bord</a>',

  'task.new.title': '🐝 <b>Nouvelle tâche #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 Client : <code>{{client}}</code>',
  'task.new.hash': '🔒 Hash du brief : <code>{{hash}}</code>',
  'task.new.deadline': '⏰ Échéance : {{deadline}} UTC',
  'task.new.hint':
    'Le brief ne va jamais on-chain, seulement son hash. Dès que le client vous l’envoie, enregistrez-le avec :\n' +
    '<code>/brief #{{id}} texte du brief</code>',

  'task.completed':
    '💰 <b>Paiement libéré pour #{{id}}</b> ({{amount}})\n\n' +
    'Les fonds sont à vous. Retirez-les depuis <a href="{{dashboard}}">le tableau de bord</a>, ou activez AUTO_WITHDRAW dans le worker.',
  'task.delivered':
    '📦 <b>Tâche #{{id}} livrée</b> ({{amount}})\n\n' +
    'En attente de la validation du client, ou libération automatique sous 72 h.',
  'task.disputed':
    '⚠️ <b>Tâche #{{id}} en litige</b> ({{amount}})\n\n' +
    'Relisez ce que vous avez livré et contactez le client.',
  'task.cancelled': '❌ <b>Tâche #{{id}} annulée</b> par le client.',

  'worker.delivered':
    '✅ <b>Livrée #{{id}}</b>\n\n' +
    'En attente de la validation du client, ou libération automatique sous 72 h.\n' +
    '🔗 tx : <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>Résultat de #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>Résultat de #{{id}}</b> ({{chars}} caractères : trop long pour Telegram, affiché tronqué)\n\n' +
    'Le texte complet est dans <code>results/{{id}}.md</code> ou via <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>Échec de la livraison de #{{id}}</b>\n\n' +
    '{{error}}\n\n' +
    'Une nouvelle tentative aura lieu automatiquement dans une dizaine de minutes.',
  'worker.waitingBrief':
    '⏳ <b>La tâche #{{id}} n’a toujours pas de brief</b>\n\n' +
    'J’attends environ {{minutes}} min que le client l’envoie. Vous pouvez aussi le charger vous-même :\n' +
    '<code>/brief #{{id}} texte du brief</code>\n\n' +
    'S’il n’arrive pas, je produirai un résultat générique.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} sous-traiterait « {{skill}} », mais son échéance est trop proche. Résolution sans sous-traitance.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · je voulais sous-traiter « {{skill}} » pour #{{id}}, mais aucun agent actif n’a cette compétence. Résolution sans sous-traitance.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · le candidat le moins cher pour « {{skill}} » demande {{price}} {{symbol}}, au-dessus de votre plafond par sous-tâche. #{{id}} se résout sans sous-traitance.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · budget quotidien épuisé ({{spent}} sur {{budget}}). #{{id}} se résout sans sous-traitance.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · pas assez de {{symbol}} pour sous-traiter « {{skill}} » ({{price}} {{symbol}}). #{{id}} se résout sans sous-traitance.',
  'a2a.subLate':
    '⏱️ <b>Sous-#{{childId}}</b> ({{skill}}, {{amount}}) n’a pas livré à temps. Le parent #{{parentId}} part sans cette partie.',
  'a2a.subApproved':
    '⭐ <b>Sous-#{{childId}} approuvée</b> à {{rating}}/5 ({{amount}}). Intégration du résultat dans le parent #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>Sous-#{{childId}}</b> ({{skill}}) a été annulée. Le parent #{{parentId}} part sans cette partie.',
  'a2a.subDisputed':
    '⚠️ <b>Sous-#{{childId}} en litige</b> ({{amount}}). Examinez-la sur <a href="{{dashboard}}">le tableau de bord</a> ; le parent #{{parentId}} reste en attente.',
  'a2a.subRejected':
    '⚠️ <b>Sous-#{{childId}} non approuvée</b> · l’évaluateur lui a mis {{rating}}/5, sous votre minimum de {{min}}.\n\nMotif : {{comment}}\n\nLe paiement reste bloqué ; l’enfant est couvert par la libération automatique de 72 h. <b>Un œil humain serait utile</b> : si le travail tient la route, approuvez-le depuis <a href="{{dashboard}}">le tableau de bord</a>. Le parent #{{parentId}} part sans cette partie.',
  'a2a.subcontracted':
    '🤝 <b>Sous-traité une partie de #{{id}}</b>\n\n👤 Agent : <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · sous-#{{childId}}\n🧩 Compétence : {{skill}}\n⏰ Échéance : {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>{{amount}} {{symbol}} retirés</b> vers le wallet de l’agent.\n🔗 tx : <code>{{tx}}</code>',
};

const ru: Catalog = {
  'menu.start': 'Справка и доступные команды',
  'menu.status': 'Ваши задачи и ожидающие выплаты',
  'menu.brief': 'Сохранить задание клиента для задачи',
  'menu.result': 'Посмотреть сданный результат задачи',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'Ваши команды:\n\n' +
    '📝 <code>/brief #N текст</code>\n' +
    'Сохраняет задание клиента для задачи N. Само задание в блокчейн не попадает — только его хеш: перешлите его сюда, когда клиент его пришлёт.\n\n' +
    '📊 <code>/status</code>\n' +
    'Сводка по вашим задачам и по тому, что осталось получить.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'Вернёт результат, который вы сдали по этой задаче.\n\n' +
    '🔗 <a href="{{dashboard}}">Открыть панель</a>',
  'cmd.unknown': '🤔 Такой команды я не знаю. Отправьте /start, чтобы увидеть список.',
  'cmd.result.usage': '⚠️ Формат: <code>/result #N</code>\nПример: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ У меня нет сохранённого результата по задаче <b>#{{id}}</b>.\n' +
    'Если агент уже сдал её в сети, запросите результат у его оператора.',
  'cmd.result.header': '📄 <b>Результат задачи #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ Формат: <code>/brief #N текст задания</code>\n' +
    'Пример: <code>/brief #3 Напиши тред из 5 твитов про Monad</code>',
  'cmd.brief.saved': '📝 Задание сохранено для задачи <b>#{{id}}</b> ({{chars}} символов).',

  'status.title': '🐝 <b>Состояние вашего агента</b>',
  'status.open': '📥 Открытые ({{count}}): {{ids}}',
  'status.delivered': '📦 Сданы, ждут подтверждения ({{count}}): {{ids}}',
  'status.disputed': '⚠️ В споре ({{count}}): {{ids}}',
  'status.completed': '✅ Завершено (локальная история): {{count}}',
  'status.briefs': '📝 Сохранённых заданий: {{count}}',
  'status.pending': '💰 <b>Доступно к выводу:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">Открыть панель</a>',

  'task.new.title': '🐝 <b>Новая задача #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 Клиент: <code>{{client}}</code>',
  'task.new.hash': '🔒 Хеш задания: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ Срок: {{deadline}} UTC',
  'task.new.hint':
    'Само задание в блокчейн не попадает — только его хеш. Когда клиент пришлёт его, сохраните так:\n' +
    '<code>/brief #{{id}} текст задания</code>',

  'task.completed':
    '💰 <b>Оплата по #{{id}} разблокирована</b> ({{amount}})\n\n' +
    'Средства ваши. Выведите их через <a href="{{dashboard}}">панель</a> или включите AUTO_WITHDRAW в worker.',
  'task.delivered':
    '📦 <b>Задача #{{id}} сдана</b> ({{amount}})\n\n' +
    'Ждём подтверждения клиента или автоматического release через 72 ч.',
  'task.disputed':
    '⚠️ <b>Задача #{{id}} в споре</b> ({{amount}})\n\n' +
    'Перечитайте то, что сдали, и свяжитесь с клиентом.',
  'task.cancelled': '❌ <b>Задача #{{id}} отменена</b> клиентом.',

  'worker.delivered':
    '✅ <b>Сдано #{{id}}</b>\n\n' +
    'Ждём подтверждения клиента или автоматического release через 72 ч.\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>Результат задачи #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>Результат задачи #{{id}}</b> ({{chars}} символов — слишком длинно для Telegram, показано с обрезкой)\n\n' +
    'Полный текст в <code>results/{{id}}.md</code> или по <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>Не удалось сдать #{{id}}</b>\n\n' +
    '{{error}}\n\n' +
    'Повторю попытку сам примерно через 10 минут.',
  'worker.waitingBrief':
    '⏳ <b>По задаче #{{id}} всё ещё нет задания</b>\n\n' +
    'Подожду около {{minutes}} мин, пока клиент его пришлёт. Вы можете загрузить его и сами:\n' +
    '<code>/brief #{{id}} текст задания</code>\n\n' +
    'Если не придёт, сделаю общий результат.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · по #{{id}} стоило бы передать «{{skill}}» субподрядчику, но срок слишком близко. Решаю без субподряда.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · хотел передать «{{skill}}» по #{{id}}, но активных агентов с таким навыком нет. Решаю без субподряда.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · самый дешёвый исполнитель «{{skill}}» просит {{price}} {{symbol}} — выше вашего лимита на подзадачу. #{{id}} решается без субподряда.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · дневной бюджет исчерпан ({{spent}} из {{budget}}). #{{id}} решается без субподряда.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · не хватает {{symbol}}, чтобы передать «{{skill}}» ({{price}} {{symbol}}). #{{id}} решается без субподряда.',
  'a2a.subLate':
    '⏱️ <b>Под-#{{childId}}</b> ({{skill}}, {{amount}}) не сдал в срок. Родительская #{{parentId}} уходит без этой части.',
  'a2a.subApproved':
    '⭐ <b>Под-#{{childId}} принята</b> с оценкой {{rating}}/5 ({{amount}}). Встраиваю результат в родительскую #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>Под-#{{childId}}</b> ({{skill}}) отменена. Родительская #{{parentId}} уходит без этой части.',
  'a2a.subDisputed':
    '⚠️ <b>Под-#{{childId}} в споре</b> ({{amount}}). Посмотрите её в <a href="{{dashboard}}">панели</a>; родительская #{{parentId}} пока на паузе.',
  'a2a.subRejected':
    '⚠️ <b>Под-#{{childId}} не принята</b> · оценщик поставил {{rating}}/5, ниже вашего минимума {{min}}.\n\nПричина: {{comment}}\n\nОплата не разблокируется; исполнителя прикрывает автоматический release через 72 ч. <b>Стоит взглянуть самому</b>: если работа годная, примите её в <a href="{{dashboard}}">панели</a>. Родительская #{{parentId}} уходит без этой части.',
  'a2a.subcontracted':
    '🤝 <b>Часть задачи #{{id}} передана субподрядчику</b>\n\n👤 Агент: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · под-#{{childId}}\n🧩 Навык: {{skill}}\n⏰ Срок: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>Выведено {{amount}} {{symbol}}</b> на кошелёк агента.\n🔗 tx: <code>{{tx}}</code>',
};

const zh: Catalog = {
  'menu.start': '帮助与可用命令',
  'menu.status': '你的任务与待收款项',
  'menu.brief': '保存某个任务的客户需求',
  'menu.result': '查看某个任务已交付的结果',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    '你可以使用这些命令：\n\n' +
    '📝 <code>/brief #N 内容</code>\n' +
    '保存任务 N 的客户需求。需求本身不会上链，只有哈希会：客户发给你之后转发到这里即可。\n\n' +
    '📊 <code>/status</code>\n' +
    '你的任务概览，以及还有多少款项待收。\n\n' +
    '📄 <code>/result #N</code>\n' +
    '返回你在该任务中交付的结果。\n\n' +
    '🔗 <a href="{{dashboard}}">打开面板</a>',
  'cmd.unknown': '🤔 我不认识这个命令。发送 /start 查看列表。',
  'cmd.result.usage': '⚠️ 格式：<code>/result #N</code>\n例如：<code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ 我没有保存任务 <b>#{{id}}</b> 的结果。\n' +
    '如果代理已经在链上交付，请向其运营者索取结果。',
  'cmd.result.header': '📄 <b>#{{id}} 的结果</b>',
  'cmd.brief.usage':
    '⚠️ 格式：<code>/brief #N 需求内容</code>\n' +
    '例如：<code>/brief #3 写一条关于 Monad 的五条推文串</code>',
  'cmd.brief.saved': '📝 已保存任务 <b>#{{id}}</b> 的需求（{{chars}} 个字符）。',

  'status.title': '🐝 <b>你的代理概览</b>',
  'status.open': '📥 进行中（{{count}}）：{{ids}}',
  'status.delivered': '📦 已交付，等待确认（{{count}}）：{{ids}}',
  'status.disputed': '⚠️ 争议中（{{count}}）：{{ids}}',
  'status.completed': '✅ 已完成（本地记录）：{{count}}',
  'status.briefs': '📝 已保存需求：{{count}}',
  'status.pending': '💰 <b>可提现：</b>{{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">打开面板</a>',

  'task.new.title': '🐝 <b>新任务 #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 客户：<code>{{client}}</code>',
  'task.new.hash': '🔒 需求哈希：<code>{{hash}}</code>',
  'task.new.deadline': '⏰ 截止：{{deadline}} UTC',
  'task.new.hint':
    '需求本身不会上链，只有哈希会。客户发给你之后，用这个命令保存：\n' +
    '<code>/brief #{{id}} 需求内容</code>',

  'task.completed':
    '💰 <b>#{{id}} 的款项已释放</b>（{{amount}}）\n\n' +
    '这笔钱已经是你的了。到<a href="{{dashboard}}">面板</a>提现，或在 worker 中打开 AUTO_WITHDRAW。',
  'task.delivered':
    '📦 <b>任务 #{{id}} 已交付</b>（{{amount}}）\n\n' +
    '等待客户确认，或 72 小时后自动放款。',
  'task.disputed':
    '⚠️ <b>任务 #{{id}} 进入争议</b>（{{amount}}）\n\n' +
    '请复查你交付的内容，并联系客户。',
  'task.cancelled': '❌ <b>任务 #{{id}} 已被客户取消</b>。',

  'worker.delivered':
    '✅ <b>已交付 #{{id}}</b>\n\n' +
    '等待客户确认，或 72 小时后自动放款。\n' +
    '🔗 tx：<code>{{tx}}</code>',
  'worker.result.header': '📄 <b>#{{id}} 的结果</b>',
  'worker.result.truncated':
    '📄 <b>#{{id}} 的结果</b>（{{chars}} 个字符，超出 Telegram 上限，已截断）\n\n' +
    '完整内容在 <code>results/{{id}}.md</code>，或使用 <code>/result #{{id}}</code>。',
  'worker.failed':
    '🚨 <b>#{{id}} 交付失败</b>\n\n' +
    '{{error}}\n\n' +
    '大约 10 分钟后会自动重试。',
  'worker.waitingBrief':
    '⏳ <b>任务 #{{id}} 还没有需求</b>\n\n' +
    '我会等大约 {{minutes}} 分钟让客户发送。你也可以自己录入：\n' +
    '<code>/brief #{{id}} 需求内容</code>\n\n' +
    '如果一直没有，我会生成一份通用结果。',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} 本想把「{{skill}}」外包出去，但截止时间太近了。改为不外包直接完成。',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · 想为 #{{id}} 外包「{{skill}}」，但没有具备该技能的活跃代理。改为不外包直接完成。',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> ·「{{skill}}」最便宜的候选要价 {{price}} {{symbol}}，超过你的单个子任务上限。#{{id}} 不外包直接完成。',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · 今日预算已用尽（{{spent}} / {{budget}}）。#{{id}} 不外包直接完成。',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · {{symbol}} 余额不足，无法外包「{{skill}}」（{{price}} {{symbol}}）。#{{id}} 不外包直接完成。',
  'a2a.subLate':
    '⏱️ <b>子任务 #{{childId}}</b>（{{skill}}，{{amount}}）逾期未交付。父任务 #{{parentId}} 将缺少这一部分。',
  'a2a.subApproved':
    '⭐ <b>子任务 #{{childId}} 已通过</b>，评分 {{rating}}/5（{{amount}}）。正在并入父任务 #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>子任务 #{{childId}}</b>（{{skill}}）已取消。父任务 #{{parentId}} 将缺少这一部分。',
  'a2a.subDisputed':
    '⚠️ <b>子任务 #{{childId}} 进入争议</b>（{{amount}}）。到<a href="{{dashboard}}">面板</a>查看；父任务 #{{parentId}} 继续挂起。',
  'a2a.subRejected':
    '⚠️ <b>子任务 #{{childId}} 未通过</b> · 评审给了 {{rating}}/5，低于你设定的最低 {{min}}。\n\n原因：{{comment}}\n\n款项不会释放；子任务由 72 小时自动放款兜底。<b>建议你亲自看一眼</b>：如果结果没问题，到<a href="{{dashboard}}">面板</a>手动通过。父任务 #{{parentId}} 将缺少这一部分。',
  'a2a.subcontracted':
    '🤝 <b>已将 #{{id}} 的一部分外包</b>\n\n👤 代理：<code>{{agent}}</code>\n💰 {{price}} {{symbol}} · 子任务 #{{childId}}\n🧩 技能：{{skill}}\n⏰ 截止：{{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>已提取 {{amount}} {{symbol}}</b> 到代理钱包。\n🔗 tx：<code>{{tx}}</code>',
};

const hi: Catalog = {
  'menu.start': 'सहायता और उपलब्ध कमांड',
  'menu.status': 'आपके कार्य और लंबित भुगतान',
  'menu.brief': 'किसी कार्य के लिए ग्राहक का ब्रीफ सहेजें',
  'menu.result': 'किसी कार्य का दिया गया परिणाम देखें',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'आपके कमांड ये हैं:\n\n' +
    '📝 <code>/brief #N पाठ</code>\n' +
    'कार्य N के लिए ग्राहक का ब्रीफ सहेजता है। ब्रीफ कभी ऑन-चेन नहीं जाता, केवल उसका हैश: ग्राहक भेजे तो उसे यहाँ फ़ॉरवर्ड कर दें।\n\n' +
    '📊 <code>/status</code>\n' +
    'आपके कार्यों का सारांश और कितना पैसा बाकी है।\n\n' +
    '📄 <code>/result #N</code>\n' +
    'उस कार्य में आपने जो परिणाम दिया था, वह लौटाता है।\n\n' +
    '🔗 <a href="{{dashboard}}">पैनल खोलें</a>',
  'cmd.unknown': '🤔 यह कमांड मुझे नहीं पता। सूची देखने के लिए /start भेजें।',
  'cmd.result.usage': '⚠️ प्रारूप: <code>/result #N</code>\nउदाहरण: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ कार्य <b>#{{id}}</b> का कोई परिणाम मेरे पास सहेजा नहीं है।\n' +
    'यदि एजेंट पहले ही ऑन-चेन दे चुका है, तो उसके संचालक से परिणाम माँगें।',
  'cmd.result.header': '📄 <b>#{{id}} का परिणाम</b>',
  'cmd.brief.usage':
    '⚠️ प्रारूप: <code>/brief #N ब्रीफ का पाठ</code>\n' +
    'उदाहरण: <code>/brief #3 Monad पर 5 ट्वीट की थ्रेड लिखो</code>',
  'cmd.brief.saved': '📝 कार्य <b>#{{id}}</b> के लिए ब्रीफ सहेजा गया ({{chars}} अक्षर)।',

  'status.title': '🐝 <b>आपके एजेंट की स्थिति</b>',
  'status.open': '📥 खुले ({{count}}): {{ids}}',
  'status.delivered': '📦 दिए गए, स्वीकृति की प्रतीक्षा ({{count}}): {{ids}}',
  'status.disputed': '⚠️ विवाद में ({{count}}): {{ids}}',
  'status.completed': '✅ पूर्ण (स्थानीय इतिहास): {{count}}',
  'status.briefs': '📝 सहेजे गए ब्रीफ: {{count}}',
  'status.pending': '💰 <b>निकालने योग्य:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">पैनल खोलें</a>',

  'task.new.title': '🐝 <b>नया कार्य #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 ग्राहक: <code>{{client}}</code>',
  'task.new.hash': '🔒 ब्रीफ का हैश: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ समय सीमा: {{deadline}} UTC',
  'task.new.hint':
    'ब्रीफ कभी ऑन-चेन नहीं जाता, केवल उसका हैश। ग्राहक भेजे तो इससे सहेजें:\n' +
    '<code>/brief #{{id}} ब्रीफ का पाठ</code>',

  'task.completed':
    '💰 <b>#{{id}} का भुगतान जारी</b> ({{amount}})\n\n' +
    'यह राशि अब आपकी है। <a href="{{dashboard}}">पैनल</a> से निकालें, या worker में AUTO_WITHDRAW चालू करें।',
  'task.delivered':
    '📦 <b>कार्य #{{id}} सौंपा गया</b> ({{amount}})\n\n' +
    'ग्राहक की स्वीकृति की प्रतीक्षा, या 72 घंटे में स्वतः रिलीज़।',
  'task.disputed':
    '⚠️ <b>कार्य #{{id}} विवाद में</b> ({{amount}})\n\n' +
    'आपने जो सौंपा था उसे दोबारा देखें और ग्राहक से बात करें।',
  'task.cancelled': '❌ <b>कार्य #{{id}} ग्राहक द्वारा रद्द</b>।',

  'worker.delivered':
    '✅ <b>#{{id}} सौंपा गया</b>\n\n' +
    'ग्राहक की स्वीकृति की प्रतीक्षा, या 72 घंटे में स्वतः रिलीज़।\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>#{{id}} का परिणाम</b>',
  'worker.result.truncated':
    '📄 <b>#{{id}} का परिणाम</b> ({{chars}} अक्षर: Telegram के लिए बहुत लंबा, कटा हुआ दिखाया गया)\n\n' +
    'पूरा पाठ <code>results/{{id}}.md</code> में है, या <code>/result #{{id}}</code> से।',
  'worker.failed':
    '🚨 <b>#{{id}} सौंपने में विफल</b>\n\n' +
    '{{error}}\n\n' +
    'लगभग 10 मिनट में अपने आप दोबारा कोशिश होगी।',
  'worker.waitingBrief':
    '⏳ <b>कार्य #{{id}} का ब्रीफ अब तक नहीं आया</b>\n\n' +
    'ग्राहक के भेजने का लगभग {{minutes}} मिनट इंतज़ार करूँगा। आप खुद भी डाल सकते हैं:\n' +
    '<code>/brief #{{id}} ब्रीफ का पाठ</code>\n\n' +
    'न आया तो मैं एक सामान्य परिणाम बना दूँगा।',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} में «{{skill}}» उपठेके पर देना था, पर समय सीमा बहुत पास है। बिना उपठेके के पूरा कर रहा हूँ।',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · #{{id}} के लिए «{{skill}}» उपठेके पर देना चाहा, पर उस स्किल वाला कोई सक्रिय एजेंट नहीं है। बिना उपठेके के पूरा कर रहा हूँ।',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · «{{skill}}» के लिए सबसे सस्ता उम्मीदवार {{price}} {{symbol}} माँगता है, जो आपकी उप-कार्य सीमा से ऊपर है। #{{id}} बिना उपठेके के पूरा होगा।',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · दैनिक बजट समाप्त ({{budget}} में से {{spent}})। #{{id}} बिना उपठेके के पूरा होगा।',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · «{{skill}}» उपठेके पर देने के लिए {{symbol}} पर्याप्त नहीं ({{price}} {{symbol}})। #{{id}} बिना उपठेके के पूरा होगा।',
  'a2a.subLate':
    '⏱️ <b>उप-#{{childId}}</b> ({{skill}}, {{amount}}) समय पर नहीं सौंपा। मूल #{{parentId}} उस हिस्से के बिना जाएगा।',
  'a2a.subApproved':
    '⭐ <b>उप-#{{childId}} स्वीकृत</b>, रेटिंग {{rating}}/5 ({{amount}})। उसका परिणाम मूल #{{parentId}} में जोड़ रहा हूँ…',
  'a2a.subCancelled':
    '❌ <b>उप-#{{childId}}</b> ({{skill}}) रद्द हो गया। मूल #{{parentId}} उस हिस्से के बिना जाएगा।',
  'a2a.subDisputed':
    '⚠️ <b>उप-#{{childId}} विवाद में</b> ({{amount}})। <a href="{{dashboard}}">पैनल</a> में देखें; मूल #{{parentId}} फ़िलहाल रुका है।',
  'a2a.subRejected':
    '⚠️ <b>उप-#{{childId}} स्वीकृत नहीं</b> · मूल्यांकनकर्ता ने {{rating}}/5 दिया, आपके न्यूनतम {{min}} से कम।\n\nकारण: {{comment}}\n\nभुगतान जारी नहीं होगा; उप-एजेंट को 72 घंटे का स्वतः रिलीज़ कवर करता है। <b>आप खुद देख लें तो बेहतर</b>: परिणाम ठीक हो तो <a href="{{dashboard}}">पैनल</a> से स्वीकृत करें। मूल #{{parentId}} उस हिस्से के बिना जाएगा।',
  'a2a.subcontracted':
    '🤝 <b>#{{id}} का एक हिस्सा उपठेके पर दिया</b>\n\n👤 एजेंट: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · उप-#{{childId}}\n🧩 स्किल: {{skill}}\n⏰ समय सीमा: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>{{amount}} {{symbol}} निकाले</b> एजेंट की वॉलेट में।\n🔗 tx: <code>{{tx}}</code>',
};

const bn: Catalog = {
  'menu.start': 'সহায়তা ও উপলব্ধ কমান্ড',
  'menu.status': 'আপনার কাজ ও বকেয়া পেমেন্ট',
  'menu.brief': 'কোনো কাজের জন্য ক্লায়েন্টের ব্রিফ সংরক্ষণ করুন',
  'menu.result': 'কোনো কাজের জমা দেওয়া ফলাফল দেখুন',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'আপনার কমান্ডগুলি:\n\n' +
    '📝 <code>/brief #N লেখা</code>\n' +
    'কাজ N-এর জন্য ক্লায়েন্টের ব্রিফ সংরক্ষণ করে। ব্রিফ কখনও অন-চেইনে যায় না, কেবল তার হ্যাশ: ক্লায়েন্ট পাঠালে এখানে ফরওয়ার্ড করুন।\n\n' +
    '📊 <code>/status</code>\n' +
    'আপনার কাজের সারসংক্ষেপ এবং কত টাকা বাকি আছে।\n\n' +
    '📄 <code>/result #N</code>\n' +
    'ওই কাজে আপনি যে ফলাফল দিয়েছিলেন তা ফিরিয়ে দেয়।\n\n' +
    '🔗 <a href="{{dashboard}}">প্যানেল খুলুন</a>',
  'cmd.unknown': '🤔 এই কমান্ডটি আমি চিনি না। তালিকা দেখতে /start পাঠান।',
  'cmd.result.usage': '⚠️ ফরম্যাট: <code>/result #N</code>\nউদাহরণ: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ কাজ <b>#{{id}}</b>-এর কোনো ফলাফল আমার কাছে সংরক্ষিত নেই।\n' +
    'এজেন্ট ইতিমধ্যেই অন-চেইনে জমা দিয়ে থাকলে তার অপারেটরের কাছে ফলাফল চান।',
  'cmd.result.header': '📄 <b>#{{id}}-এর ফলাফল</b>',
  'cmd.brief.usage':
    '⚠️ ফরম্যাট: <code>/brief #N ব্রিফের লেখা</code>\n' +
    'উদাহরণ: <code>/brief #3 Monad নিয়ে ৫টি টুইটের থ্রেড লেখো</code>',
  'cmd.brief.saved': '📝 কাজ <b>#{{id}}</b>-এর ব্রিফ সংরক্ষিত হয়েছে ({{chars}} অক্ষর)।',

  'status.title': '🐝 <b>আপনার এজেন্টের অবস্থা</b>',
  'status.open': '📥 চলমান ({{count}}): {{ids}}',
  'status.delivered': '📦 জমা দেওয়া, অনুমোদনের অপেক্ষায় ({{count}}): {{ids}}',
  'status.disputed': '⚠️ বিরোধে ({{count}}): {{ids}}',
  'status.completed': '✅ সম্পন্ন (স্থানীয় ইতিহাস): {{count}}',
  'status.briefs': '📝 সংরক্ষিত ব্রিফ: {{count}}',
  'status.pending': '💰 <b>তোলার জন্য প্রস্তুত:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">প্যানেল খুলুন</a>',

  'task.new.title': '🐝 <b>নতুন কাজ #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 ক্লায়েন্ট: <code>{{client}}</code>',
  'task.new.hash': '🔒 ব্রিফের হ্যাশ: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ সময়সীমা: {{deadline}} UTC',
  'task.new.hint':
    'ব্রিফ কখনও অন-চেইনে যায় না, কেবল তার হ্যাশ। ক্লায়েন্ট পাঠালে এভাবে সংরক্ষণ করুন:\n' +
    '<code>/brief #{{id}} ব্রিফের লেখা</code>',

  'task.completed':
    '💰 <b>#{{id}}-এর পেমেন্ট মুক্ত হয়েছে</b> ({{amount}})\n\n' +
    'টাকাটা এখন আপনার। <a href="{{dashboard}}">প্যানেল</a> থেকে তুলে নিন, বা worker-এ AUTO_WITHDRAW চালু করুন।',
  'task.delivered':
    '📦 <b>কাজ #{{id}} জমা দেওয়া হয়েছে</b> ({{amount}})\n\n' +
    'ক্লায়েন্টের অনুমোদনের অপেক্ষা, বা ৭২ ঘণ্টায় স্বয়ংক্রিয় রিলিজ।',
  'task.disputed':
    '⚠️ <b>কাজ #{{id}} বিরোধে</b> ({{amount}})\n\n' +
    'আপনি যা জমা দিয়েছেন তা আবার দেখুন এবং ক্লায়েন্টের সঙ্গে কথা বলুন।',
  'task.cancelled': '❌ <b>কাজ #{{id}} ক্লায়েন্ট বাতিল করেছেন</b>।',

  'worker.delivered':
    '✅ <b>#{{id}} জমা দেওয়া হয়েছে</b>\n\n' +
    'ক্লায়েন্টের অনুমোদনের অপেক্ষা, বা ৭২ ঘণ্টায় স্বয়ংক্রিয় রিলিজ।\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>#{{id}}-এর ফলাফল</b>',
  'worker.result.truncated':
    '📄 <b>#{{id}}-এর ফলাফল</b> ({{chars}} অক্ষর: Telegram-এর জন্য অনেক বড়, কেটে দেখানো হলো)\n\n' +
    'পুরো লেখা <code>results/{{id}}.md</code>-এ, অথবা <code>/result #{{id}}</code> দিয়ে।',
  'worker.failed':
    '🚨 <b>#{{id}} জমা দিতে ব্যর্থ</b>\n\n' +
    '{{error}}\n\n' +
    'প্রায় ১০ মিনিট পরে নিজে থেকেই আবার চেষ্টা করবে।',
  'worker.waitingBrief':
    '⏳ <b>কাজ #{{id}}-এর ব্রিফ এখনও আসেনি</b>\n\n' +
    'ক্লায়েন্ট পাঠানোর জন্য প্রায় {{minutes}} মিনিট অপেক্ষা করব। আপনি নিজেও দিতে পারেন:\n' +
    '<code>/brief #{{id}} ব্রিফের লেখা</code>\n\n' +
    'না এলে আমি একটি সাধারণ ফলাফল তৈরি করব।',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}}-এ «{{skill}}» সাব-কন্ট্রাক্ট করা যেত, কিন্তু সময়সীমা খুব কাছে। সাব-কন্ট্রাক্ট ছাড়াই সমাধান করছি।',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · #{{id}}-এর জন্য «{{skill}}» সাব-কন্ট্রাক্ট করতে চেয়েছিলাম, কিন্তু ওই দক্ষতার কোনো সক্রিয় এজেন্ট নেই। সাব-কন্ট্রাক্ট ছাড়াই সমাধান করছি।',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · «{{skill}}»-এর সবচেয়ে সস্তা প্রার্থী নেয় {{price}} {{symbol}}, যা আপনার সাব-টাস্ক সীমার বেশি। #{{id}} সাব-কন্ট্রাক্ট ছাড়াই সম্পন্ন হবে।',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · দৈনিক বাজেট শেষ ({{budget}}-এর মধ্যে {{spent}})। #{{id}} সাব-কন্ট্রাক্ট ছাড়াই সম্পন্ন হবে।',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · «{{skill}}» সাব-কন্ট্রাক্ট করার মতো {{symbol}} নেই ({{price}} {{symbol}})। #{{id}} সাব-কন্ট্রাক্ট ছাড়াই সম্পন্ন হবে।',
  'a2a.subLate':
    '⏱️ <b>সাব-#{{childId}}</b> ({{skill}}, {{amount}}) সময়মতো জমা দেয়নি। মূল #{{parentId}} ওই অংশ ছাড়াই যাবে।',
  'a2a.subApproved':
    '⭐ <b>সাব-#{{childId}} অনুমোদিত</b>, রেটিং {{rating}}/5 ({{amount}})। ফলাফলটি মূল #{{parentId}}-এ যুক্ত করছি…',
  'a2a.subCancelled':
    '❌ <b>সাব-#{{childId}}</b> ({{skill}}) বাতিল হয়েছে। মূল #{{parentId}} ওই অংশ ছাড়াই যাবে।',
  'a2a.subDisputed':
    '⚠️ <b>সাব-#{{childId}} বিরোধে</b> ({{amount}})। <a href="{{dashboard}}">প্যানেলে</a> দেখুন; মূল #{{parentId}} আপাতত থেমে আছে।',
  'a2a.subRejected':
    '⚠️ <b>সাব-#{{childId}} অনুমোদিত হয়নি</b> · মূল্যায়নকারী দিয়েছেন {{rating}}/5, আপনার ন্যূনতম {{min}}-এর নিচে।\n\nকারণ: {{comment}}\n\nপেমেন্ট ছাড়া হবে না; সাব-এজেন্টকে ৭২ ঘণ্টার স্বয়ংক্রিয় রিলিজ রক্ষা করে। <b>আপনি নিজে দেখলে ভালো</b>: ফলাফল ঠিক থাকলে <a href="{{dashboard}}">প্যানেল</a> থেকে অনুমোদন দিন। মূল #{{parentId}} ওই অংশ ছাড়াই যাবে।',
  'a2a.subcontracted':
    '🤝 <b>#{{id}}-এর একটি অংশ সাব-কন্ট্রাক্ট করা হয়েছে</b>\n\n👤 এজেন্ট: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · সাব-#{{childId}}\n🧩 স্কিল: {{skill}}\n⏰ সময়সীমা: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>{{amount}} {{symbol}} তোলা হয়েছে</b> এজেন্টের ওয়ালেটে।\n🔗 tx: <code>{{tx}}</code>',
};

const ar: Catalog = {
  'menu.start': 'المساعدة والأوامر المتاحة',
  'menu.status': 'مهامك والمدفوعات المعلّقة',
  'menu.brief': 'حفظ طلب العميل لمهمة ما',
  'menu.result': 'عرض النتيجة المسلّمة لمهمة ما',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'هذه أوامرك:\n\n' +
    '📝 <code>/brief #N نص</code>\n' +
    'يحفظ طلب العميل للمهمة N. الطلب لا يُسجَّل على السلسلة، بل بصمته فقط: أعِد توجيهه هنا حين يرسله العميل.\n\n' +
    '📊 <code>/status</code>\n' +
    'ملخّص مهامك وما تبقّى لك من مستحقات.\n\n' +
    '📄 <code>/result #N</code>\n' +
    'يعيد النتيجة التي سلّمتها في تلك المهمة.\n\n' +
    '🔗 <a href="{{dashboard}}">فتح اللوحة</a>',
  'cmd.unknown': '🤔 لا أعرف هذا الأمر. أرسل /start لعرض القائمة.',
  'cmd.result.usage': '⚠️ الصيغة: <code>/result #N</code>\nمثال: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ لا توجد لدي نتيجة محفوظة للمهمة <b>#{{id}}</b>.\n' +
    'إن كان الوكيل قد سلّمها على السلسلة، فاطلب النتيجة من مشغّله.',
  'cmd.result.header': '📄 <b>نتيجة المهمة #{{id}}</b>',
  'cmd.brief.usage':
    '⚠️ الصيغة: <code>/brief #N نص الطلب</code>\n' +
    'مثال: <code>/brief #3 اكتب سلسلة من 5 تغريدات عن Monad</code>',
  'cmd.brief.saved': '📝 حُفظ طلب المهمة <b>#{{id}}</b> ({{chars}} حرفًا).',

  'status.title': '🐝 <b>حالة وكيلك</b>',
  'status.open': '📥 مفتوحة ({{count}}): {{ids}}',
  'status.delivered': '📦 مُسلَّمة بانتظار الموافقة ({{count}}): {{ids}}',
  'status.disputed': '⚠️ في نزاع ({{count}}): {{ids}}',
  'status.completed': '✅ مكتملة (سجل محلي): {{count}}',
  'status.briefs': '📝 الطلبات المحفوظة: {{count}}',
  'status.pending': '💰 <b>جاهز للسحب:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">فتح اللوحة</a>',

  'task.new.title': '🐝 <b>مهمة جديدة #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 العميل: <code>{{client}}</code>',
  'task.new.hash': '🔒 بصمة الطلب: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ الموعد النهائي: {{deadline}} UTC',
  'task.new.hint':
    'الطلب لا يُسجَّل على السلسلة، بل بصمته فقط. حين يرسله العميل، احفظه بـ:\n' +
    '<code>/brief #{{id}} نص الطلب</code>',

  'task.completed':
    '💰 <b>حُرِّرت دفعة المهمة #{{id}}</b> ({{amount}})\n\n' +
    'المبلغ لك الآن. اسحبه من <a href="{{dashboard}}">اللوحة</a>، أو فعّل AUTO_WITHDRAW في الـ worker.',
  'task.delivered':
    '📦 <b>سُلِّمت المهمة #{{id}}</b> ({{amount}})\n\n' +
    'بانتظار موافقة العميل، أو التحرير التلقائي خلال 72 ساعة.',
  'task.disputed':
    '⚠️ <b>المهمة #{{id}} في نزاع</b> ({{amount}})\n\n' +
    'راجِع ما سلّمته وتواصل مع العميل.',
  'task.cancelled': '❌ <b>ألغى العميل المهمة #{{id}}</b>.',

  'worker.delivered':
    '✅ <b>سُلِّمت #{{id}}</b>\n\n' +
    'بانتظار موافقة العميل، أو التحرير التلقائي خلال 72 ساعة.\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>نتيجة المهمة #{{id}}</b>',
  'worker.result.truncated':
    '📄 <b>نتيجة المهمة #{{id}}</b> ({{chars}} حرفًا: أطول مما يسمح به Telegram، معروضة مقتطعة)\n\n' +
    'النص الكامل في <code>results/{{id}}.md</code> أو عبر <code>/result #{{id}}</code>.',
  'worker.failed':
    '🚨 <b>فشل تسليم #{{id}}</b>\n\n' +
    '{{error}}\n\n' +
    'ستُعاد المحاولة تلقائيًا بعد نحو 10 دقائق.',
  'worker.waitingBrief':
    '⏳ <b>المهمة #{{id}} بلا طلب حتى الآن</b>\n\n' +
    'سأنتظر نحو {{minutes}} دقيقة ريثما يرسله العميل. ويمكنك إدخاله بنفسك:\n' +
    '<code>/brief #{{id}} نص الطلب</code>\n\n' +
    'وإن لم يصل، سأنتج نتيجة عامة.',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · كانت #{{id}} ستتعاقد من الباطن على «{{skill}}»، لكن موعدها قريب جدًا. ستُنجَز دون تعاقد من الباطن.',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · أردت التعاقد من الباطن على «{{skill}}» لأجل #{{id}}، لكن لا يوجد وكيل نشط بهذه المهارة. ستُنجَز دون تعاقد من الباطن.',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · أرخص مرشّح لـ«{{skill}}» يطلب {{price}} {{symbol}}، وهو فوق حدّك لكل مهمة فرعية. ستُنجَز #{{id}} دون تعاقد من الباطن.',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · نفدت الميزانية اليومية ({{spent}} من {{budget}}). ستُنجَز #{{id}} دون تعاقد من الباطن.',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · لا يكفي رصيد {{symbol}} للتعاقد على «{{skill}}» ({{price}} {{symbol}}). ستُنجَز #{{id}} دون تعاقد من الباطن.',
  'a2a.subLate':
    '⏱️ <b>المهمة الفرعية #{{childId}}</b> ({{skill}}، {{amount}}) لم تُسلَّم في الوقت. ستُسلَّم الأصلية #{{parentId}} دون ذلك الجزء.',
  'a2a.subApproved':
    '⭐ <b>اعتُمدت المهمة الفرعية #{{childId}}</b> بتقييم {{rating}}/5 ({{amount}}). يجري دمج نتيجتها في الأصلية #{{parentId}}…',
  'a2a.subCancelled':
    '❌ <b>أُلغيت المهمة الفرعية #{{childId}}</b> ({{skill}}). ستُسلَّم الأصلية #{{parentId}} دون ذلك الجزء.',
  'a2a.subDisputed':
    '⚠️ <b>المهمة الفرعية #{{childId}} في نزاع</b> ({{amount}}). راجعها في <a href="{{dashboard}}">اللوحة</a>؛ الأصلية #{{parentId}} ما تزال متوقفة.',
  'a2a.subRejected':
    '⚠️ <b>لم تُعتمد المهمة الفرعية #{{childId}}</b> · منحها المقيّم {{rating}}/5، دون حدّك الأدنى {{min}}.\n\nالسبب: {{comment}}\n\nلن يُحرَّر المبلغ؛ والمنفّذ يغطيه التحرير التلقائي خلال 72 ساعة. <b>يُستحسن أن تراجعها بنفسك</b>: إن كان العمل سليمًا فاعتمده من <a href="{{dashboard}}">اللوحة</a>. وستُسلَّم الأصلية #{{parentId}} دون ذلك الجزء.',
  'a2a.subcontracted':
    '🤝 <b>تم التعاقد من الباطن على جزء من #{{id}}</b>\n\n👤 الوكيل: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · فرعية #{{childId}}\n🧩 المهارة: {{skill}}\n⏰ الموعد النهائي: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>سُحب {{amount}} {{symbol}}</b> إلى محفظة الوكيل.\n🔗 tx: <code>{{tx}}</code>',
};

const ur: Catalog = {
  'menu.start': 'مدد اور دستیاب کمانڈز',
  'menu.status': 'آپ کے کام اور زیرِ التوا ادائیگیاں',
  'menu.brief': 'کسی کام کے لیے کلائنٹ کا بریف محفوظ کریں',
  'menu.result': 'کسی کام کا جمع کرایا گیا نتیجہ دیکھیں',

  'cmd.help':
    '🐝 <b>Panal Bot</b>\n\n' +
    'آپ کی کمانڈز یہ ہیں:\n\n' +
    '📝 <code>/brief #N متن</code>\n' +
    'کام N کے لیے کلائنٹ کا بریف محفوظ کرتا ہے۔ بریف کبھی آن چین نہیں جاتا، صرف اس کا ہیش: کلائنٹ بھیجے تو یہاں فارورڈ کر دیں۔\n\n' +
    '📊 <code>/status</code>\n' +
    'آپ کے کاموں کا خلاصہ اور کتنی رقم وصول کرنا باقی ہے۔\n\n' +
    '📄 <code>/result #N</code>\n' +
    'اُس کام میں آپ نے جو نتیجہ دیا تھا وہ واپس کرتا ہے۔\n\n' +
    '🔗 <a href="{{dashboard}}">پینل کھولیں</a>',
  'cmd.unknown': '🤔 یہ کمانڈ مجھے معلوم نہیں۔ فہرست دیکھنے کے لیے /start بھیجیں۔',
  'cmd.result.usage': '⚠️ فارمیٹ: <code>/result #N</code>\nمثال: <code>/result #3</code>',
  'cmd.result.missing':
    'ℹ️ کام <b>#{{id}}</b> کا کوئی نتیجہ میرے پاس محفوظ نہیں۔\n' +
    'اگر ایجنٹ پہلے ہی آن چین جمع کرا چکا ہے تو اس کے آپریٹر سے نتیجہ طلب کریں۔',
  'cmd.result.header': '📄 <b>#{{id}} کا نتیجہ</b>',
  'cmd.brief.usage':
    '⚠️ فارمیٹ: <code>/brief #N بریف کا متن</code>\n' +
    'مثال: <code>/brief #3 Monad پر 5 ٹویٹس کی تھریڈ لکھیں</code>',
  'cmd.brief.saved': '📝 کام <b>#{{id}}</b> کا بریف محفوظ ہو گیا ({{chars}} حروف)۔',

  'status.title': '🐝 <b>آپ کے ایجنٹ کی صورتحال</b>',
  'status.open': '📥 کھلے ({{count}}): {{ids}}',
  'status.delivered': '📦 جمع شدہ، منظوری کے منتظر ({{count}}): {{ids}}',
  'status.disputed': '⚠️ تنازع میں ({{count}}): {{ids}}',
  'status.completed': '✅ مکمل (مقامی ریکارڈ): {{count}}',
  'status.briefs': '📝 محفوظ بریف: {{count}}',
  'status.pending': '💰 <b>نکالنے کے لیے تیار:</b> {{mon}} MON · {{panal}} $PANAL',
  'status.panel': '🔗 <a href="{{dashboard}}">پینل کھولیں</a>',

  'task.new.title': '🐝 <b>نیا کام #{{id}}</b>',
  'task.new.amount': '💰 <b>{{amount}} {{symbol}}</b>',
  'task.new.client': '👤 کلائنٹ: <code>{{client}}</code>',
  'task.new.hash': '🔒 بریف کا ہیش: <code>{{hash}}</code>',
  'task.new.deadline': '⏰ آخری تاریخ: {{deadline}} UTC',
  'task.new.hint':
    'بریف کبھی آن چین نہیں جاتا، صرف اس کا ہیش۔ کلائنٹ بھیجے تو یوں محفوظ کریں:\n' +
    '<code>/brief #{{id}} بریف کا متن</code>',

  'task.completed':
    '💰 <b>#{{id}} کی ادائیگی جاری ہو گئی</b> ({{amount}})\n\n' +
    'یہ رقم اب آپ کی ہے۔ <a href="{{dashboard}}">پینل</a> سے نکال لیں، یا worker میں AUTO_WITHDRAW آن کریں۔',
  'task.delivered':
    '📦 <b>کام #{{id}} جمع کرا دیا گیا</b> ({{amount}})\n\n' +
    'کلائنٹ کی منظوری کا انتظار، یا 72 گھنٹوں میں خودکار ریلیز۔',
  'task.disputed':
    '⚠️ <b>کام #{{id}} تنازع میں</b> ({{amount}})\n\n' +
    'آپ نے جو جمع کرایا تھا اسے دوبارہ دیکھیں اور کلائنٹ سے بات کریں۔',
  'task.cancelled': '❌ <b>کام #{{id}} کلائنٹ نے منسوخ کر دیا</b>۔',

  'worker.delivered':
    '✅ <b>#{{id}} جمع کرا دیا گیا</b>\n\n' +
    'کلائنٹ کی منظوری کا انتظار، یا 72 گھنٹوں میں خودکار ریلیز۔\n' +
    '🔗 tx: <code>{{tx}}</code>',
  'worker.result.header': '📄 <b>#{{id}} کا نتیجہ</b>',
  'worker.result.truncated':
    '📄 <b>#{{id}} کا نتیجہ</b> ({{chars}} حروف: Telegram کے لیے بہت طویل، کاٹ کر دکھایا گیا)\n\n' +
    'مکمل متن <code>results/{{id}}.md</code> میں ہے، یا <code>/result #{{id}}</code> سے۔',
  'worker.failed':
    '🚨 <b>#{{id}} جمع کرانے میں ناکامی</b>\n\n' +
    '{{error}}\n\n' +
    'تقریباً 10 منٹ میں خود بخود دوبارہ کوشش ہوگی۔',
  'worker.waitingBrief':
    '⏳ <b>کام #{{id}} کا بریف اب تک نہیں آیا</b>\n\n' +
    'کلائنٹ کے بھیجنے کا تقریباً {{minutes}} منٹ انتظار کروں گا۔ آپ خود بھی درج کر سکتے ہیں:\n' +
    '<code>/brief #{{id}} بریف کا متن</code>\n\n' +
    'اگر نہ آیا تو میں ایک عمومی نتیجہ بنا دوں گا۔',

  'a2a.deadlineTooClose':
    'ℹ️ <b>A2A</b> · #{{id}} میں «{{skill}}» ذیلی ٹھیکے پر دینا تھا، مگر مدت بہت قریب ہے۔ ذیلی ٹھیکے کے بغیر مکمل کر رہا ہوں۔',
  'a2a.noCandidate':
    'ℹ️ <b>A2A</b> · #{{id}} کے لیے «{{skill}}» ذیلی ٹھیکے پر دینا چاہا، مگر اس مہارت والا کوئی فعال ایجنٹ نہیں۔ ذیلی ٹھیکے کے بغیر مکمل کر رہا ہوں۔',
  'a2a.tooExpensive':
    'ℹ️ <b>A2A</b> · «{{skill}}» کے لیے سستا ترین امیدوار {{price}} {{symbol}} مانگتا ہے، جو آپ کی فی ذیلی کام حد سے زیادہ ہے۔ #{{id}} ذیلی ٹھیکے کے بغیر مکمل ہوگا۔',
  'a2a.budgetExhausted':
    'ℹ️ <b>A2A</b> · روزانہ بجٹ ختم ({{budget}} میں سے {{spent}})۔ #{{id}} ذیلی ٹھیکے کے بغیر مکمل ہوگا۔',
  'a2a.insufficientFunds':
    'ℹ️ <b>A2A</b> · «{{skill}}» ذیلی ٹھیکے پر دینے کے لیے {{symbol}} ناکافی ہے ({{price}} {{symbol}})۔ #{{id}} ذیلی ٹھیکے کے بغیر مکمل ہوگا۔',
  'a2a.subLate':
    '⏱️ <b>ذیلی #{{childId}}</b> ({{skill}}، {{amount}}) وقت پر جمع نہیں ہوا۔ بنیادی #{{parentId}} اس حصے کے بغیر جائے گا۔',
  'a2a.subApproved':
    '⭐ <b>ذیلی #{{childId}} منظور</b>، درجہ بندی {{rating}}/5 ({{amount}})۔ نتیجہ بنیادی #{{parentId}} میں شامل کر رہا ہوں…',
  'a2a.subCancelled':
    '❌ <b>ذیلی #{{childId}}</b> ({{skill}}) منسوخ ہو گیا۔ بنیادی #{{parentId}} اس حصے کے بغیر جائے گا۔',
  'a2a.subDisputed':
    '⚠️ <b>ذیلی #{{childId}} تنازع میں</b> ({{amount}})۔ <a href="{{dashboard}}">پینل</a> میں دیکھیں؛ بنیادی #{{parentId}} فی الحال رکا ہوا ہے۔',
  'a2a.subRejected':
    '⚠️ <b>ذیلی #{{childId}} منظور نہیں ہوئی</b> · جانچنے والے نے {{rating}}/5 دیا، جو آپ کی کم از کم حد {{min}} سے نیچے ہے۔\n\nوجہ: {{comment}}\n\nادائیگی جاری نہیں ہوگی؛ ذیلی ایجنٹ کو 72 گھنٹے کا خودکار ریلیز پورا کرتا ہے۔ <b>بہتر ہے آپ خود دیکھ لیں</b>: اگر کام ٹھیک ہے تو <a href="{{dashboard}}">پینل</a> سے منظور کر دیں۔ بنیادی #{{parentId}} اس حصے کے بغیر جائے گا۔',
  'a2a.subcontracted':
    '🤝 <b>#{{id}} کا ایک حصہ ذیلی ٹھیکے پر دیا</b>\n\n👤 ایجنٹ: <code>{{agent}}</code>\n💰 {{price}} {{symbol}} · ذیلی #{{childId}}\n🧩 مہارت: {{skill}}\n⏰ آخری تاریخ: {{deadline}} UTC',
  'worker.withdrawn':
    '🏧 <b>{{amount}} {{symbol}} نکالے</b> ایجنٹ کی والٹ میں۔\n🔗 tx: <code>{{tx}}</code>',
};

const CATALOG: Record<BotLang, Catalog> = { es, en, pt, fr, ru, zh, hi, bn, ar, ur };

/** Idiomas que Telegram etiqueta distinto de nuestro código ISO. */
const TELEGRAM_LANG_CODE: Partial<Record<BotLang, string>> = { zh: 'zh-hans' };

/** El `language_code` que espera setMyCommands. */
export function telegramLangCode(lang: BotLang): string {
  return TELEGRAM_LANG_CODE[lang] ?? lang;
}

/**
 * Devuelve el mensaje ya interpolado. Los valores se escapan como HTML: la
 * plantilla trae el formato y el dato nunca puede inyectar etiquetas.
 */
export function t(lang: BotLang, key: MsgKey, vars: Record<string, string | number> = {}): string {
  // Doble red a propósito. `CATALOG[lang][key]` explota si `lang` no es un
  // idioma conocido, y estas llamadas viven DENTRO del try que entrega la tarea
  // on-chain: un catálogo incompleto revertía el estado de la sub-tarea y
  // dejaba la entrega a medias. Redactar un aviso nunca debe poder hacer eso.
  const catalog = CATALOG[lang] ?? CATALOG[DEFAULT_LANG];
  const template = catalog[key] ?? CATALOG[DEFAULT_LANG][key];
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : escapeHtml(String(value));
  });
}

/**
 * Une líneas con saltos. Descarta null/undefined/false —para líneas
 * condicionales— pero CONSERVA la cadena vacía, que es como se piden los
 * separadores en blanco entre bloques del mensaje.
 */
export function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

/** Solo para los tests de paridad. */
export const _CATALOG = CATALOG;
