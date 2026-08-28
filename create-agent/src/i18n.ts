/**
 * Los diez idiomas del generador.
 *
 * Panal se usa desde sitios muy distintos y el alta de un agente es lo primero
 * que ve un desarrollador. Si eso llega en un idioma que no lee, la mitad de
 * las instrucciones se pierden justo donde más caro sale perderlas: la clave
 * privada, el endpoint público y el gas.
 *
 * Reglas del catálogo:
 *
 *   - Todas las claves existen en los diez idiomas. Hay un test que lo
 *     comprueba, porque una clave que falta se convierte en `undefined` en
 *     pantalla y eso es peor que estar en inglés.
 *   - Nada de concatenar frases sueltas: cada mensaje es una frase completa.
 *     El orden de las palabras cambia según el idioma y montar textos a trozos
 *     produce galimatías en la mitad de ellos.
 *   - Los marcadores son `{name}` y `{address}`. Se sustituyen tal cual, sin
 *     escapar: esto va a una terminal, no a una página.
 */

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ur', label: 'اردو' },
] as const;

export type Lang = (typeof LANGS)[number]['code'];

export const LANG_CODES = LANGS.map((l) => l.code) as readonly Lang[];

export function isLang(v: string): v is Lang {
  return (LANG_CODES as readonly string[]).includes(v);
}

/** Todo lo que el generador dice, en un idioma. */
export interface Catalog {
  /** Texto de `--help`. */
  usage: string;
  /** Pregunta del selector interactivo. */
  pickLang: string;
  errNoName: string;
  errBadName: string;
  errDirExists: string;
  errTemplateMissing: string;
  errBadLang: string;
  created: string;
  walletLabel: string;
  walletNote: string;
  stepsTitle: string;
  s1Title: string;
  s1Install: string;
  s1Fund: string;
  s2Title: string;
  s2Edit: string;
  s2Key: string;
  s3Title: string;
  s3Start: string;
  s3Register: string;
  warnLabel: string;
  warnBody: string;
  docs: string;
  /** Comentarios del `.env.example` generado. */
  /** Lo que se dice del logo que se escribe en el proyecto. */
  logoWritten: string;
  /**
   * Las preguntas del escaparate: el logo y los enlaces del creador.
   *
   * Se preguntan aquí y no en un `README` porque un campo que hay que ir a
   * buscar a un archivo no lo rellena nadie, y son justo los que dejan que un
   * cliente MIRE al agente antes de pagarle.
   */
  brand: {
    title: string;
    logo: string;
    web: string;
    github: string;
    x: string;
    telegram: string;
    /** Un valor que no se puede escribir en la plantilla. `{name}` = lo tecleado. */
    bad: string;
  };
  env: {
    key: string;
    port: string;
    model: string;
    rpc: string;
    data: string;
    x402: string;
    seguridad: string;
    subcontrata: string;
    vigilante: string;
    memoria: string;
  };
  /** README que se escribe dentro del proyecto generado. */
  readme: string;
}

const en: Catalog = {
  usage: `create-panal-agent — scaffold a Panal agent that is ready to earn.

  npx create-panal-agent <name> [options]

Options:
  --lang <code>   Interface language: ${LANG_CODES.join(', ')}
  --no-input      Never prompt. For CI and scripted setups.
  --logo, --web, --github, --x, --telegram   Your links. All optional.
  --help          Show this help.
  --version       Show the version.

The language is taken from --lang, then PANAL_LANG, then your system locale.`,
  pickLang: 'Choose your language:',
  errNoName: 'Give your agent a name:  npx create-panal-agent my-agent',
  errBadName: '"{name}" is not a valid name.\nUse lowercase letters, numbers and dashes: my-agent, tech-translator, summarizer.',
  errDirExists: 'The folder {name}/ already exists and is not empty. Pick another name or delete it.',
  errTemplateMissing: 'Template not found at {name}. The package is installed incorrectly.',
  errBadLang: '"{name}" is not a supported language. Available: ' + LANG_CODES.join(', '),
  created: '{name} created.',
  walletLabel: 'Agent wallet:',
  walletNote: 'Its private key is in {name}/.env, which is already gitignored.',
  stepsTitle: 'What is left:',
  s1Title: 'Install it and send it some MON for gas',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'send ~0.5 MON to {address}',
  s2Title: 'Write what your agent does',
  s2Edit: 'edit src/agent.ts  (the only file you have to touch)',
  s2Key: 'if it uses a model, put LLM_API_KEY in .env',
  s3Title: 'Publish it on an https URL and register',
  s3Start: 'npm start           (and expose the port over https)',
  s3Register: 'PUBLIC_URL=https://your-domain npm run register',
  warnLabel: 'Careful:',
  warnBody: 'the endpoint must be public https. Without it the client cannot send you\nthe brief or download the result, and the agent is decoration.',
  docs: 'Full guide: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Logo: logo.svg, with your initial. Overwrite it with yours.',
  brand: {
    title: 'Your shop window. All optional — press Enter to skip.',
    logo: 'Logo URL (Enter: publish the one your agent serves)',
    web: 'Website',
    github: 'GitHub (user or user/repo)',
    x: 'X (username)',
    telegram: 'Telegram (username)',
    bad: 'I cannot use "{name}", leaving it empty.',
  },
  env: {
    key: 'Private key of your agent\'s DEDICATED wallet.\nIt is the one that gets paid and signs deliveries. Do not use your personal\nwallet: this one lives on a server. It only needs a little MON for gas.',
    port: 'Server port. Many hosts inject it themselves.',
    model: 'Your model, if your agent uses one. Pick a provider by name and put its key below.\nLLM_MODEL overrides the suggested one; LLM_BASE_URL is for any provider not on the list.\nTo read images a client attaches, the model has to be a multimodal one.',
    rpc: 'Your own RPC, if the public one falls short (it caps at ~15 calls/s).',
    data: 'Where to store delivered results.',
    x402: 'Charge per call (optional). Leave it empty and your agent only takes escrow jobs.\nThe price is per request, in an EIP-2612 token — it cannot be MON, the scheme needs `permit`.',
    subcontrata: "Subcontracting (optional, off by default). Your agent can pay another one for what it cannot do itself (see ctx.consultar in agent.ts). Without a number here it never delegates.\nIt is in the x402 currency, NOT a cut of what you charge per task: a task is paid in MON and a question in $PANAL, and converting one into the other by eye would be inventing the budget. Put it BELOW what you charge per question (X402_PRICE): at or above it, every job where you delegate leaves you nothing and you still pay the gas — and that punishes exactly what you want your agent to do, because the better it recognises what it does not know, the more often it works for free. A third of your price is a sane start. The number alone is not enough: you also need the SUBCONTRATA_SKILLS list in agent.ts, which says WHAT it may buy. Empty — as it ships — it never delegates, because the marketplace search generalises when it finds nobody, and a code agent asking for \"python video encoding\" would end up searching \"video\" and paying an agent that makes videos.",
    vigilante: "The watchman. Every 60 s it reviews your open tasks and recovers what got stuck: a delivery that was never anchored, work that died halfway, or a job that was paid for and never arrived.\nVIGILANTE=off turns it off. PUBLIC_URL is your https endpoint, used in the lost-job warning.",
    memoria: "Conversation memory (x402 only). Without it every paid call is independent: the client asks, you answer, and next time you do not know what it was about -- that is a search box with an invoice, not a chat.\nMEMORIA_TURNOS=0 turns it off. Both caps exist because the history goes INTO the prompt, and you pay for the prompt while the client pays a fixed price per message.",
    seguridad: "Hardening. LIMITE_POR_MINUTO caps requests per IP (0 disables it); every unauthenticated request costs one RPC call, so without a cap a curl loop leaves your agent unable to deliver.\nTRAS_PROXY=1 if a reverse proxy sits in front (Caddy, nginx) — the usual case, since your endpoint must be https. Without it every request arrives with the proxy's IP, so the cap above stops being per client and becomes a single global one shared by the indexer, browsers and your clients; once it fills, your agent answers 429 to everyone, and a client who cannot send you their brief waits out the deadline with their payment already locked. With no proxy, leave it off: trusting that header without one lets anyone invent an IP per request. AUTH_ESTRICTA=1 rejects download signatures with no expiry (the old format).",
  },
  readme: `# {name}

A Panal agent. It takes paid jobs on Monad mainnet, does the work and delivers
a result whose hash is anchored on-chain, so the client can verify it.

Wallet: \`{address}\`

## The three steps

\`\`\`bash
npm install
# send ~0.5 MON to the wallet above, for gas
npm start                                  # expose this port over https
PUBLIC_URL=https://your-domain npm run register
\`\`\`

## The files

| File | What it is |
|---|---|
| \`src/agent.ts\` | **The only one you edit.** Your work goes in \`handleTask()\`. |
| \`src/server.ts\` | Receives the brief, verifies signatures, delivers on-chain. |
| \`src/register.ts\` | Your listing: name, description, skills, price. |
| \`src/pdf.ts\` | Turns text into a PDF, with no dependencies. Delete it if you deliver no files. |
| \`src/vigilante.ts\` | Recovers tasks left hanging: a delivery never anchored, work that died halfway. |
| \`.env\` | Your private key and your model key. Never commit it. |

## How you get paid

The client locks your fee in escrow **before** you work. When you deliver, the
hash of your result is written on-chain. The client approves and the money is
credited to you; if they do nothing it is released automatically after 72 h.

The escrow does not push payments: it credits them. Call \`withdraw()\` to move
your balance to your wallet.

The protocol keeps 2.5%.

## Two things that break agents

**A brief that does not match.** The client's request is committed on-chain as
a hash. If the text you receive does not match it, the agent rejects it. That
is deliberate: it is what an arbitrator relies on in a dispute.

**No https.** The client sends the brief to your endpoint and downloads the
result from it. Without a public certificate, neither happens.

Guide: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const es: Catalog = {
  usage: `create-panal-agent — genera un agente de Panal listo para cobrar.

  npx create-panal-agent <nombre> [opciones]

Opciones:
  --lang <código>  Idioma de la interfaz: ${LANG_CODES.join(', ')}
  --no-input       No preguntar nunca. Para CI y instalaciones automatizadas.
  --logo, --web, --github, --x, --telegram   Tus enlaces. Todos opcionales.
  --help           Muestra esta ayuda.
  --version        Muestra la versión.

El idioma sale de --lang, luego de PANAL_LANG, y si no del locale del sistema.`,
  pickLang: 'Elige tu idioma:',
  errNoName: 'Dile cómo se llama tu agente:  npx create-panal-agent mi-agente',
  errBadName: '"{name}" no vale como nombre.\nUsa minúsculas, números y guiones: mi-agente, traductor-tecnico, resumidor.',
  errDirExists: 'La carpeta {name}/ ya existe y no está vacía. Elige otro nombre o bórrala.',
  errTemplateMissing: 'No encuentro la plantilla en {name}. El paquete está mal instalado.',
  errBadLang: '"{name}" no es un idioma disponible. Están: ' + LANG_CODES.join(', '),
  created: '{name} creado.',
  walletLabel: 'Wallet del agente:',
  walletNote: 'Su clave está en {name}/.env, que ya está en el .gitignore.',
  stepsTitle: 'Lo que falta:',
  s1Title: 'Instalar y darle algo de MON para el gas',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'manda ~0.5 MON a {address}',
  s2Title: 'Escribir lo que hace tu agente',
  s2Edit: 'edita src/agent.ts  (es el único archivo que tienes que tocar)',
  s2Key: 'si usa un modelo, pon LLM_API_KEY en el .env',
  s3Title: 'Publicarlo en una URL https y registrarte',
  s3Start: 'npm start           (y expón el puerto con https)',
  s3Register: 'PUBLIC_URL=https://tu-dominio npm run register',
  warnLabel: 'Ojo:',
  warnBody: 'el endpoint tiene que ser https y público. Sin él el cliente no puede\nmandarte el encargo ni descargar su resultado, y el agente queda de adorno.',
  docs: 'Guía completa: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Logo: logo.svg, con tu inicial. Sobrescríbelo con el tuyo.',
  brand: {
    title: 'Tu escaparate. Todo es opcional: pulsa Enter para saltar.',
    logo: 'URL de tu logo (Enter: publica el que sirve tu agente)',
    web: 'Tu web',
    github: 'GitHub (usuario o usuario/repo)',
    x: 'X (usuario)',
    telegram: 'Telegram (usuario)',
    bad: 'No puedo usar «{name}», lo dejo vacío.',
  },
  env: {
    key: 'Clave privada de la wallet DEDICADA de tu agente.\nEs la que cobra y la que firma las entregas. No uses tu wallet personal:\nesta vive en un servidor. Solo necesita un poco de MON para el gas.',
    port: 'Puerto del servidor. Muchos hostings lo inyectan solos.',
    model: 'Tu modelo, si tu agente usa uno. Elige proveedor por su nombre y pon su clave abajo.\nLLM_MODEL manda sobre el sugerido; LLM_BASE_URL es para cualquiera que no esté en la lista.\nPara leer las imágenes que adjunte un cliente, el modelo tiene que ser multimodal.',
    rpc: 'RPC propio, si el público se te queda corto (limita a ~15 llamadas/s).',
    data: 'Dónde guardar los resultados entregados.',
    x402: 'Cobro por llamada (opcional). Déjalo vacío y tu agente solo acepta encargos del escrow.\nEl precio es por petición, en un token EIP-2612: no puede ser MON, el esquema necesita `permit`.',
    subcontrata: "Subcontratar (opcional, apagado por defecto). Tu agente puede pagar a otro por lo que no sepa hacer (ver ctx.consultar en agent.ts). Sin un numero aqui, no delega nunca.\nVa en la moneda del x402 y NO se deduce de lo que cobras por tarea: una tarea se cobra en MON y una consulta en $PANAL, y convertir una en otra a ojo seria inventarse el presupuesto. Ponlo POR DEBAJO de lo que cobras por consulta (X402_PRICE): igual o por encima, cada encargo en el que delegues no te deja nada y encima pones el gas — y eso castiga justo lo que quieres que haga, porque cuanto mejor reconozca lo que no sabe, más veces trabaja gratis. Un tercio de tu precio es un buen punto de partida. Con el número no basta: hace falta además la lista SUBCONTRATA_SKILLS en agent.ts, que dice QUÉ puede comprar. Vacía —como viene— no delega nunca, porque el buscador del mercado generaliza cuando no encuentra a nadie, y un agente de código que pida \"python video encoding\" acabaría buscando \"video\" y pagándole a uno que hace vídeos.",
    vigilante: "El vigilante. Cada 60 s repasa tus tareas abiertas y recupera lo que se quedo colgado: una entrega que no llego a anclarse, un trabajo que murio a medias, o un encargo pagado que nunca llego.\nVIGILANTE=off lo apaga. PUBLIC_URL es tu endpoint https, para el aviso de encargo perdido.",
    memoria: "Memoria de la conversación (sólo x402). Sin ella cada llamada cobrada es independiente: el cliente pregunta, contestas, y a la siguiente no sabes de qué se hablaba — eso es un buscador con factura, no un chat.\nMEMORIA_TURNOS=0 la apaga. Los dos topes existen porque el historial entra EN el prompt, y el prompt lo pagas tú mientras el cliente paga un precio fijo por mensaje.",
    seguridad: "Endurecimiento. LIMITE_POR_MINUTO acota las peticiones por IP (0 lo desactiva); cada petición sin autenticar cuesta una llamada al RPC, así que sin tope un bucle de curl deja a tu agente sin poder entregar.\nTRAS_PROXY=1 si tienes un proxy delante (Caddy, nginx), que es lo normal porque tu endpoint tiene que ser https. Sin esto todas las peticiones llegan con la IP del proxy, así que el tope de arriba deja de ser por cliente y pasa a ser uno global que comparten el indexador, los navegadores y tus clientes; cuando se llena, tu agente responde 429 a todo el mundo, y un cliente que no puede mandarte su brief se queda esperando al plazo con el pago ya bloqueado. Sin proxy, déjalo apagado: fiarse de esa cabecera sin proxy permite inventarse una IP por petición. AUTH_ESTRICTA=1 rechaza las firmas de descarga sin caducidad (el formato antiguo).",
  },
  readme: `# {name}

Un agente de Panal. Acepta encargos pagados en Monad mainnet, hace el trabajo y
entrega un resultado cuyo hash queda anclado en la cadena, para que el cliente
pueda comprobarlo.

Wallet: \`{address}\`

## Los tres pasos

\`\`\`bash
npm install
# manda ~0.5 MON a la wallet de arriba, para el gas
npm start                                  # expón este puerto con https
PUBLIC_URL=https://tu-dominio npm run register
\`\`\`

## Los archivos

| Archivo | Qué es |
|---|---|
| \`src/agent.ts\` | **El único que tocas.** Tu trabajo va en \`handleTask()\`. |
| \`src/server.ts\` | Recibe el encargo, verifica firmas y entrega en la cadena. |
| \`src/register.ts\` | Tu ficha: nombre, descripción, skills y precio. |
| \`src/pdf.ts\` | Convierte texto en PDF, sin dependencias. Bórralo si no entregas archivos. |
| \`src/vigilante.ts\` | Recupera lo que se quedó colgado: una entrega sin anclar, un trabajo a medias. |
| \`.env\` | Tu clave privada y la de tu modelo. No lo subas nunca. |

## Cómo cobras

El cliente bloquea tu tarifa en el escrow **antes** de que trabajes. Al
entregar, el hash de tu resultado queda escrito en la cadena. El cliente
aprueba y el dinero se te acredita; si no hace nada, se libera solo a las 72 h.

El escrow no paga empujando: acredita. Llama a \`withdraw()\` para mover tu
saldo a tu wallet.

El protocolo se queda el 2,5 %.

## Dos cosas que rompen agentes

**Un brief que no cuadra.** Lo que el cliente encargó quedó en la cadena como
hash. Si el texto que recibes no coincide, el agente lo rechaza. Es a
propósito: es lo que mira un árbitro en una disputa.

**No tener https.** El cliente manda el encargo a tu endpoint y descarga de él
el resultado. Sin certificado público, no ocurre ninguna de las dos cosas.

Guía: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const zh: Catalog = {
  usage: `create-panal-agent — 生成一个可以立即接单赚钱的 Panal 代理。

  npx create-panal-agent <名称> [选项]

选项:
  --lang <代码>   界面语言: ${LANG_CODES.join(', ')}
  --no-input      从不提问。适用于 CI 和脚本化部署。
  --logo, --web, --github, --x, --telegram   你的链接。全部可选。
  --help          显示此帮助。
  --version       显示版本号。

语言依次取自 --lang、PANAL_LANG，最后是系统区域设置。`,
  pickLang: '请选择语言：',
  errNoName: '请给你的代理起个名字：  npx create-panal-agent my-agent',
  errBadName: '"{name}" 不是有效的名称。\n请使用小写字母、数字和连字符：my-agent、tech-translator、summarizer。',
  errDirExists: '文件夹 {name}/ 已存在且不为空。请换个名称或删除它。',
  errTemplateMissing: '在 {name} 找不到模板。此软件包安装不正确。',
  errBadLang: '"{name}" 不是受支持的语言。可选：' + LANG_CODES.join(', '),
  created: '{name} 已创建。',
  walletLabel: '代理钱包：',
  walletNote: '私钥保存在 {name}/.env 中，该文件已被 gitignore 忽略。',
  stepsTitle: '接下来要做的：',
  s1Title: '安装依赖，并转入一些 MON 作为 gas',
  s1Install: 'cd {name} && npm install',
  s1Fund: '向 {address} 转入约 0.5 MON',
  s2Title: '编写你的代理要做的事',
  s2Edit: '编辑 src/agent.ts（唯一需要你修改的文件）',
  s2Key: '如果用到模型，请在 .env 中填写 LLM_API_KEY',
  s3Title: '发布到 https 网址并注册',
  s3Start: 'npm start           （并用 https 暴露该端口）',
  s3Register: 'PUBLIC_URL=https://你的域名 npm run register',
  warnLabel: '注意：',
  warnBody: '端点必须是公网 https。否则客户既无法把任务发给你，也无法下载结果，\n这个代理就只是摆设。',
  docs: '完整指南：https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Logo：logo.svg，用了你名字的首字母。换成你自己的即可。',
  brand: {
    title: '你的门面。全部可选——直接回车跳过。',
    logo: 'Logo 链接（回车：使用你的代理自己提供的）',
    web: '你的网站',
    github: 'GitHub（用户名，或 用户名/仓库）',
    x: 'X（用户名）',
    telegram: 'Telegram（用户名）',
    bad: '「{name}」用不了，留空。',
  },
  env: {
    key: '你的代理【专用】钱包的私钥。\n它负责收款并为交付签名。不要使用你的个人钱包：这个私钥要放在服务器上。\n它只需要少量 MON 用于支付 gas。',
    port: '服务端口。很多托管平台会自动注入。',
    model: '你的模型（如果代理需要）。按名称选择服务商，并在下面填入其密钥。\nLLM_MODEL 优先于建议的模型；LLM_BASE_URL 用于列表之外的任何服务商。\n若要读取客户附带的图片，模型必须支持多模态。',
    rpc: '你自己的 RPC，当公共节点不够用时（其上限约为每秒 15 次调用）。',
    data: '交付结果的存放位置。',
    x402: '按次收费（可选）。留空则你的代理只接受托管订单。\n价格按每次请求计算，使用支持 EIP-2612 的代币——不能是 MON，该方案依赖 `permit`。',
    subcontrata: "转包（可选，默认关闭）。你的代理可以为自己做不了的事付钱给另一个代理（见 agent.ts 的 ctx.consultar）。这里没有数字就永远不会转包。\n它使用 x402 的币种，不是按任务收入的比例：任务用 MON 结算，提问用 $PANAL，凭感觉换算等于凭空编造预算。 把它设得低于你每次提问的收费（X402_PRICE）：等于或高于该值时，每一笔你转包出去的活都赚不到钱，还要自付 gas——而这恰恰惩罚了你希望它做的事，因为它越善于识别自己不懂的部分，就越经常白干。取你价格的三分之一是个合理的起点。 光有数字还不够：还需要 agent.ts 里的 SUBCONTRATA_SKILLS 列表，它规定了可以买什么。默认为空，也就永远不会转包；因为市场搜索在找不到人时会自动泛化，一个请求 \"python video encoding\" 的代码代理最后会搜索 \"video\"，把钱付给做视频的代理。",
    vigilante: "守望者。每 60 秒检查一次你未完成的任务，并挽回卡住的部分：没有上链的交付、中途死掉的工作，或已付款却从未送达的委托。\nVIGILANTE=off 可关闭。PUBLIC_URL 是你的 https 端点，用于丢失委托的提醒。",
    memoria: "对话记忆（仅限 x402）。没有它，每次付费调用都是独立的：客户提问，你回答，下一次你不知道之前在谈什么——那是带账单的搜索框，不是聊天。\nMEMORIA_TURNOS=0 可关闭。两个上限的存在是因为历史会进入提示词，而提示词由你付费，客户只付固定的每条消息价格。",
    seguridad: "加固。LIMITE_POR_MINUTO 限制每个 IP 的请求数（0 表示关闭）；每个未认证请求都要消耗一次 RPC 调用，没有上限时一个 curl 循环就能让你的代理无法交付。\nTRAS_PROXY=1 前面有反向代理时使用（Caddy、nginx）——这是常态，因为你的端点必须是 https。不设置时所有请求都带着代理的 IP，上面的上限就不再是每个客户端的，而变成由索引器、浏览器和你的客户共用的全局上限；一旦填满，你的代理会对所有人返回 429，而无法发送任务书的客户只能带着已锁定的付款等到期限。没有代理时请保持关闭：无代理却信任该请求头，任何人都能为每个请求伪造 IP。 AUTH_ESTRICTA=1 拒绝没有有效期的下载签名（旧格式）。",
  },
  readme: `# {name}

一个 Panal 代理。它在 Monad 主网上接受付费任务，完成工作并交付结果，
结果的哈希会被写入链上，客户可以据此验证。

钱包：\`{address}\`

## 三个步骤

\`\`\`bash
npm install
# 向上面的钱包转入约 0.5 MON，用于支付 gas
npm start                                  # 用 https 暴露此端口
PUBLIC_URL=https://你的域名 npm run register
\`\`\`

## 文件说明

| 文件 | 作用 |
|---|---|
| \`src/agent.ts\` | **唯一需要你修改的文件。** 你的业务逻辑写在 \`handleTask()\` 里。 |
| \`src/server.ts\` | 接收任务、验证签名、在链上交付。 |
| \`src/register.ts\` | 你的名片：名称、描述、技能、价格。 |
| \`src/pdf.ts\` | 把文本转成 PDF，无依赖。不交付文件就删掉它。 |
| \`src/vigilante.ts\` | 挽回卡住的任务：没有上链的交付、中途死掉的工作。 |
| \`.env\` | 你的私钥和模型密钥。绝不要提交到仓库。 |

## 你如何收款

客户会在你开始工作【之前】把费用锁进托管合约。你交付时，结果的哈希会写入链上。
客户确认后款项即记入你的账户；若客户什么都不做，72 小时后自动释放。

托管合约不会主动打款，而是记账。调用 \`withdraw()\` 把余额转到你的钱包。

协议抽取 2.5%。

## 两个常见的致命问题

**任务内容对不上。** 客户所下的订单以哈希形式记录在链上。如果你收到的文本与之
不符，代理会拒绝执行。这是刻意设计：争议发生时仲裁者正是依据它来判断。

**没有 https。** 客户通过你的端点发送任务并下载结果。没有公开证书，两者都无法完成。

指南：https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const hi: Catalog = {
  usage: `create-panal-agent — कमाई के लिए तैयार Panal एजेंट बनाता है।

  npx create-panal-agent <नाम> [विकल्प]

विकल्प:
  --lang <कोड>    इंटरफ़ेस की भाषा: ${LANG_CODES.join(', ')}
  --no-input      कभी न पूछें। CI और स्क्रिप्टेड सेटअप के लिए।
  --logo, --web, --github, --x, --telegram   आपके लिंक। सभी वैकल्पिक।
  --help          यह मदद दिखाएँ।
  --version       संस्करण दिखाएँ।

भाषा पहले --lang से, फिर PANAL_LANG से, और अंत में सिस्टम लोकेल से ली जाती है।`,
  pickLang: 'अपनी भाषा चुनें:',
  errNoName: 'अपने एजेंट को एक नाम दें:  npx create-panal-agent my-agent',
  errBadName: '"{name}" मान्य नाम नहीं है।\nछोटे अक्षर, अंक और डैश इस्तेमाल करें: my-agent, tech-translator, summarizer।',
  errDirExists: 'फ़ोल्डर {name}/ पहले से मौजूद है और खाली नहीं है। दूसरा नाम चुनें या उसे हटाएँ।',
  errTemplateMissing: '{name} पर टेम्पलेट नहीं मिला। पैकेज ठीक से इंस्टॉल नहीं हुआ है।',
  errBadLang: '"{name}" समर्थित भाषा नहीं है। उपलब्ध: ' + LANG_CODES.join(', '),
  created: '{name} बन गया।',
  walletLabel: 'एजेंट का वॉलेट:',
  walletNote: 'इसकी निजी कुंजी {name}/.env में है, जो पहले से gitignore में है।',
  stepsTitle: 'अब यह बाकी है:',
  s1Title: 'इंस्टॉल करें और गैस के लिए कुछ MON भेजें',
  s1Install: 'cd {name} && npm install',
  s1Fund: '{address} पर लगभग 0.5 MON भेजें',
  s2Title: 'लिखें कि आपका एजेंट क्या करता है',
  s2Edit: 'src/agent.ts संपादित करें (यही एकमात्र फ़ाइल है जिसे आपको छूना है)',
  s2Key: 'अगर मॉडल इस्तेमाल होता है, तो .env में LLM_API_KEY डालें',
  s3Title: 'इसे https URL पर प्रकाशित करें और रजिस्टर करें',
  s3Start: 'npm start           (और पोर्ट को https से बाहर लाएँ)',
  s3Register: 'PUBLIC_URL=https://आपका-डोमेन npm run register',
  warnLabel: 'ध्यान दें:',
  warnBody: 'एंडपॉइंट सार्वजनिक https होना चाहिए। इसके बिना क्लाइंट न आपको काम भेज सकता है\nन परिणाम डाउनलोड कर सकता है, और एजेंट बेकार रह जाता है।',
  docs: 'पूरी गाइड: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'लोगो: logo.svg, आपके नाम के पहले अक्षर के साथ। अपना डालने के लिए इसे बदल दें।',
  brand: {
    title: 'आपकी पहचान। सब वैकल्पिक — छोड़ने के लिए Enter दबाएँ।',
    logo: 'लोगो का URL (Enter: आपका एजेंट अपना खुद देता है)',
    web: 'आपकी वेबसाइट',
    github: 'GitHub (उपयोगकर्ता या उपयोगकर्ता/रेपो)',
    x: 'X (उपयोगकर्ता नाम)',
    telegram: 'Telegram (उपयोगकर्ता नाम)',
    bad: '"{name}" काम नहीं आएगा, इसे खाली छोड़ रहा हूँ।',
  },
  env: {
    key: 'आपके एजेंट के लिए समर्पित (DEDICATED) वॉलेट की निजी कुंजी।\nयही भुगतान पाती है और डिलीवरी पर हस्ताक्षर करती है। अपना निजी वॉलेट न लगाएँ:\nयह कुंजी सर्वर पर रहती है। इसे गैस के लिए बस थोड़ा MON चाहिए।',
    port: 'सर्वर पोर्ट। कई होस्टिंग इसे खुद भेजते हैं।',
    model: 'आपका मॉडल, अगर एजेंट किसी का उपयोग करता है। नाम से प्रदाता चुनें और नीचे उसकी कुंजी डालें।\nLLM_MODEL सुझाए गए मॉडल पर भारी पड़ता है; सूची से बाहर के किसी भी प्रदाता के लिए LLM_BASE_URL है।\nक्लाइंट द्वारा भेजी गई छवियाँ पढ़ने के लिए मॉडल मल्टीमॉडल होना चाहिए।',
    rpc: 'अपना RPC, अगर सार्वजनिक कम पड़े (इसकी सीमा ~15 कॉल/सेकंड है)।',
    data: 'दिए गए परिणाम कहाँ सहेजें।',
    x402: 'प्रति कॉल शुल्क (वैकल्पिक)। खाली छोड़ें तो आपका एजेंट केवल एस्क्रो वाले काम लेगा।\nकीमत प्रति अनुरोध है, EIP-2612 टोकन में — MON नहीं चल सकता, इस योजना को `permit` चाहिए।',
    subcontrata: "सबकॉन्ट्रैक्टिंग (वैकल्पिक, डिफ़ॉल्ट रूप से बंद)। आपका एजेंट जो खुद नहीं कर सकता, उसके लिए दूसरे को भुगतान कर सकता है (agent.ts में ctx.consultar देखें)। यहाँ संख्या के बिना वह कभी नहीं सौंपता।\nयह x402 की मुद्रा में है, प्रति कार्य आय का हिस्सा नहीं: कार्य MON में और प्रश्न $PANAL में चुकाया जाता है। इसे अपने प्रति-प्रश्न शुल्क (X402_PRICE) से कम रखें: बराबर या अधिक होने पर, जिस भी काम में आप दूसरे को सौंपेंगे उसमें कुछ नहीं बचेगा और गैस भी आपकी जेब से जाएगी — और यह ठीक उसी व्यवहार को दंडित करता है जो आप चाहते हैं, क्योंकि आपका एजेंट जितना बेहतर पहचानेगा कि उसे क्या नहीं आता, उतनी ही बार वह मुफ़्त काम करेगा। अपने दाम का एक तिहाई एक समझदार शुरुआत है। सिर्फ़ संख्या काफ़ी नहीं: agent.ts में SUBCONTRATA_SKILLS सूची भी चाहिए, जो बताती है कि वह क्या खरीद सकता है। खाली — जैसा यह आता है — तो वह कभी नहीं सौंपता, क्योंकि कोई न मिलने पर बाज़ार की खोज सामान्यीकरण कर देती है, और \"python video encoding\" माँगने वाला कोड एजेंट अंत में \"video\" खोजकर वीडियो बनाने वाले को भुगतान कर देगा।",
    vigilante: "प्रहरी। हर 60 सेकंड में आपके खुले कार्यों की जाँच करता है और जो अटक गया उसे वापस लाता है: वह डिलीवरी जो चेन पर दर्ज नहीं हुई, अधूरा रह गया काम, या भुगतान किया गया आदेश जो कभी नहीं पहुँचा।\nVIGILANTE=off इसे बंद करता है। PUBLIC_URL आपका https एंडपॉइंट है।",
    memoria: "बातचीत की स्मृति (केवल x402)। इसके बिना हर सशुल्क कॉल स्वतंत्र होती है: ग्राहक पूछता है, आप उत्तर देते हैं, और अगली बार आपको पता नहीं होता कि बात किस बारे में थी — वह चैट नहीं, बिल वाला सर्च बॉक्स है।\nMEMORIA_TURNOS=0 इसे बंद कर देता है। दोनों सीमाएँ इसलिए हैं कि इतिहास प्रॉम्प्ट में जाता है, और प्रॉम्प्ट का भुगतान आप करते हैं जबकि ग्राहक प्रति संदेश निश्चित मूल्य देता है।",
    seguridad: "सुरक्षा सख्ती। LIMITE_POR_MINUTO प्रति IP अनुरोध सीमित करता है (0 से बंद); हर बिना प्रमाणित अनुरोध एक RPC कॉल खर्च करता है, इसलिए बिना सीमा के एक curl लूप आपके एजेंट को डिलीवर करने से रोक सकता है।\nTRAS_PROXY=1 अगर आगे रिवर्स प्रॉक्सी हो (Caddy, nginx) — यही सामान्य है, क्योंकि आपका एंडपॉइंट https होना चाहिए। इसके बिना हर अनुरोध प्रॉक्सी के IP के साथ आता है, इसलिए ऊपर की सीमा प्रति-क्लाइंट नहीं रहती और एक वैश्विक सीमा बन जाती है जिसे इंडेक्सर, ब्राउज़र और आपके क्लाइंट साझा करते हैं; भर जाने पर आपका एजेंट सबको 429 देता है, और जो क्लाइंट अपना ब्रीफ़ नहीं भेज पाता वह भुगतान लॉक होने के बावजूद समय-सीमा तक इंतज़ार करता है। प्रॉक्सी न हो तो बंद रखें: बिना प्रॉक्सी उस हेडर पर भरोसा करने से कोई भी हर अनुरोध में मनमाना IP भेज सकता है। AUTH_ESTRICTA=1 बिना समय-सीमा वाले डाउनलोड हस्ताक्षर अस्वीकार करता है।",
  },
  readme: `# {name}

एक Panal एजेंट। यह Monad मेननेट पर भुगतान वाले काम स्वीकार करता है, काम पूरा करता
है और ऐसा परिणाम देता है जिसका हैश चेन पर दर्ज होता है, ताकि क्लाइंट उसे जाँच सके।

वॉलेट: \`{address}\`

## तीन चरण

\`\`\`bash
npm install
# ऊपर दिए वॉलेट पर गैस के लिए लगभग 0.5 MON भेजें
npm start                                  # इस पोर्ट को https से बाहर लाएँ
PUBLIC_URL=https://आपका-डोमेन npm run register
\`\`\`

## फ़ाइलें

| फ़ाइल | यह क्या है |
|---|---|
| \`src/agent.ts\` | **केवल यही आप बदलते हैं।** आपका काम \`handleTask()\` में जाता है। |
| \`src/server.ts\` | काम प्राप्त करता है, हस्ताक्षर जाँचता है, चेन पर डिलीवर करता है। |
| \`src/register.ts\` | आपकी प्रोफ़ाइल: नाम, विवरण, कौशल, कीमत। |
| \`src/pdf.ts\` | टेक्स्ट को PDF में बदलता है, बिना निर्भरता के। फाइलें न भेजें तो हटा दें। |
| \`src/vigilante.ts\` | अटके हुए कार्य वापस लाता है: चेन पर दर्ज न हुई डिलीवरी, अधूरा काम। |
| \`.env\` | आपकी निजी कुंजी और मॉडल कुंजी। इसे कभी कमिट न करें। |

## भुगतान कैसे मिलता है

क्लाइंट आपका शुल्क काम शुरू होने से **पहले** एस्क्रो में लॉक करता है। डिलीवरी पर
आपके परिणाम का हैश चेन पर लिखा जाता है। क्लाइंट स्वीकृति देता है और राशि आपके
खाते में जमा हो जाती है; अगर वह कुछ न करे तो 72 घंटे बाद अपने आप जारी हो जाती है।

एस्क्रो पैसा धकेलता नहीं, जमा करता है। अपने वॉलेट में लाने के लिए \`withdraw()\`
बुलाएँ।

प्रोटोकॉल 2.5% रखता है।

## दो चीज़ें जो एजेंट तोड़ देती हैं

**काम का विवरण मेल न खाना।** क्लाइंट ने जो माँगा वह हैश के रूप में चेन पर दर्ज है।
अगर आपको मिला पाठ उससे मेल नहीं खाता, एजेंट उसे अस्वीकार कर देता है। यह जानबूझकर
है: विवाद में मध्यस्थ इसी को देखता है।

**https न होना।** क्लाइंट आपके एंडपॉइंट पर काम भेजता है और वहीं से परिणाम लेता है।
सार्वजनिक प्रमाणपत्र के बिना दोनों में से कुछ नहीं होता।

गाइड: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const ar: Catalog = {
  usage: `create-panal-agent — يُنشئ وكيل Panal جاهزًا للعمل والكسب.

  npx create-panal-agent <الاسم> [خيارات]

الخيارات:
  --lang <رمز>    لغة الواجهة: ${LANG_CODES.join(', ')}
  --no-input      لا تسأل أبدًا. للتكامل المستمر والإعداد الآلي.
  --logo, --web, --github, --x, --telegram   روابطك. كلها اختيارية.
  --help          إظهار هذه المساعدة.
  --version       إظهار الإصدار.

تُؤخذ اللغة من ‎--lang ثم من PANAL_LANG ثم من إعدادات النظام.`,
  pickLang: 'اختر لغتك:',
  errNoName: 'أعطِ وكيلك اسمًا:  npx create-panal-agent my-agent',
  errBadName: '"{name}" ليس اسمًا صالحًا.\nاستخدم أحرفًا صغيرة وأرقامًا وشرطات: my-agent، tech-translator، summarizer.',
  errDirExists: 'المجلد {name}/ موجود بالفعل وليس فارغًا. اختر اسمًا آخر أو احذفه.',
  errTemplateMissing: 'لم أجد القالب في {name}. الحزمة مثبّتة بشكل خاطئ.',
  errBadLang: '"{name}" ليست لغة مدعومة. المتاح: ' + LANG_CODES.join(', '),
  created: 'تم إنشاء {name}.',
  walletLabel: 'محفظة الوكيل:',
  walletNote: 'مفتاحها الخاص في {name}/.env، وهو مُستثنى في .gitignore بالفعل.',
  stepsTitle: 'ما تبقّى:',
  s1Title: 'ثبّت الاعتماديات وأرسل بعض MON للرسوم',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'أرسل نحو 0.5 MON إلى {address}',
  s2Title: 'اكتب ما يفعله وكيلك',
  s2Edit: 'عدّل src/agent.ts (الملف الوحيد الذي عليك تعديله)',
  s2Key: 'إذا كان يستخدم نموذجًا، ضع LLM_API_KEY في ملف .env',
  s3Title: 'انشره على عنوان https وسجّله',
  s3Start: 'npm start           (وافتح المنفذ عبر https)',
  s3Register: 'PUBLIC_URL=https://نطاقك npm run register',
  warnLabel: 'انتبه:',
  warnBody: 'يجب أن تكون نقطة النهاية https وعامة. بدونها لا يستطيع العميل إرسال الطلب\nإليك ولا تنزيل النتيجة، ويبقى الوكيل بلا فائدة.',
  docs: 'الدليل الكامل: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'الشعار: logo.svg بالحرف الأول من اسمك. استبدله بشعارك.',
  brand: {
    title: 'واجهتك. كل هذا اختياري — اضغط Enter للتخطي.',
    logo: 'رابط شعارك (Enter: يُنشر الشعار الذي يقدّمه وكيلك)',
    web: 'موقعك',
    github: 'GitHub (المستخدم أو المستخدم/المستودع)',
    x: 'X (اسم المستخدم)',
    telegram: 'Telegram (اسم المستخدم)',
    bad: 'لا يمكنني استخدام «{name}»، سأتركه فارغًا.',
  },
  env: {
    key: 'المفتاح الخاص بمحفظة وكيلك المخصّصة.\nهي التي تتقاضى الأجر وتوقّع عمليات التسليم. لا تستخدم محفظتك الشخصية:\nهذا المفتاح يعيش على خادم. يكفيه قليل من MON لدفع الرسوم.',
    port: 'منفذ الخادم. كثير من الاستضافات تضبطه تلقائيًا.',
    model: 'نموذجك، إن كان وكيلك يستخدم واحدًا. اختر المزوّد بالاسم وضع مفتاحه أدناه.\nمتغيّر LLM_MODEL يتقدّم على النموذج المقترح، و LLM_BASE_URL لأي مزوّد ليس في القائمة.\nلقراءة الصور التي يرفقها العميل، يجب أن يكون النموذج متعدّد الوسائط.',
    rpc: 'عقدة RPC خاصة بك، إن لم تكفِ العامة (حدّها نحو 15 طلبًا في الثانية).',
    data: 'مكان حفظ النتائج المُسلَّمة.',
    x402: 'التحصيل لكل استدعاء (اختياري). اتركه فارغًا فيقبل وكيلك مهام الضمان فقط.\nالسعر لكل طلب، بعملة تدعم EIP-2612 — لا يصلح MON، فالمخطط يحتاج `permit`.',
    subcontrata: "التعاقد من الباطن (اختياري، معطل افتراضيا). يمكن لوكيلك ان يدفع لوكيل اخر مقابل ما لا يجيده (انظر ctx.consultar في agent.ts). بدون رقم هنا لن يفوض ابدا.\nيكون بعملة x402، وليس نسبة مما تتقاضاه عن المهمة: المهمة تدفع بـ MON والسؤال بـ $PANAL. اجعله أقل من سعر السؤال لديك (X402_PRICE): فعند التساوي أو الزيادة، كل مهمة تُسنِد فيها جزءًا إلى غيرك لا تُبقي لك شيئًا وتدفع الغاز من جيبك — وهذا يعاقب تحديدًا ما تريده منه، لأنه كلما أحسن إدراك ما يجهله عمل مجانًا أكثر. ثلث سعرك بداية معقولة. الرقم وحده لا يكفي: تحتاج أيضًا إلى قائمة SUBCONTRATA_SKILLS في agent.ts، التي تحدد ما الذي يُسمح بشرائه. وهي فارغة كما تأتي، فلا يفوّض أبدًا؛ لأن بحث السوق يعمّم عندما لا يجد أحدًا، فوكيل برمجة يطلب \"python video encoding\" ينتهي به الأمر باحثًا عن \"video\" ودافعًا لوكيل يصنع الفيديو.",
    vigilante: "الحارس. كل 60 ثانية يراجع مهامك المفتوحة ويستعيد ما تعطل: تسليم لم يثبت على السلسلة، او عمل مات في منتصفه، او طلب مدفوع لم يصل قط.\nVIGILANTE=off يوقفه. PUBLIC_URL هو نقطة الوصول https لديك.",
    memoria: "ذاكرة المحادثة (في x402 فقط). بدونها تكون كل مكالمة مدفوعة مستقلة: يسأل العميل، تجيب، وفي المرة التالية لا تعرف عمّا كان الحديث — هذا مربع بحث بفاتورة، لا محادثة.\nالقيمة MEMORIA_TURNOS=0 تُعطّلها. الحدّان موجودان لأن السجل يدخل في التوجيه، والتوجيه تدفعه أنت بينما يدفع العميل سعرًا ثابتًا لكل رسالة.",
    seguridad: "تقوية. LIMITE_POR_MINUTO يحد الطلبات لكل IP (0 يعطله)؛ كل طلب غير موثق يكلف استدعاء RPC، فبدون حد يكفي حلقة curl لتترك وكيلك عاجزا عن التسليم.\nTRAS_PROXY=1 إذا كان أمامه بروكسي عكسي (Caddy أو nginx) — وهو الوضع المعتاد لأن نقطة النهاية يجب أن تكون https. بدونه تصل كل الطلبات بعنوان IP الخاص بالبروكسي، فيتوقف الحد أعلاه عن كونه لكل عميل ويصبح حدًا عامًا واحدًا يتقاسمه المفهرس والمتصفحات وعملاؤك؛ وعند امتلائه يرد وكيلك بـ 429 على الجميع، ويظل العميل الذي تعذر عليه إرسال مهمته ينتظر انتهاء المهلة ودفعته محجوزة بالفعل. بلا بروكسي اتركه معطلًا: الوثوق بهذه الترويسة دون بروكسي يتيح لأي شخص اختلاق عنوان IP لكل طلب. AUTH_ESTRICTA=1 يرفض تواقيع التنزيل بلا انتهاء صلاحية.",
  },
  readme: `# {name}

وكيل على Panal. يقبل مهامًا مدفوعة على شبكة Monad الرئيسية، ينفّذ العمل ويسلّم
نتيجة يُسجَّل تجزئتها (hash) على السلسلة، ليتمكن العميل من التحقق منها.

المحفظة: \`{address}\`

## الخطوات الثلاث

\`\`\`bash
npm install
# أرسل نحو 0.5 MON إلى المحفظة أعلاه، لدفع الرسوم
npm start                                  # افتح هذا المنفذ عبر https
PUBLIC_URL=https://نطاقك npm run register
\`\`\`

## الملفات

| الملف | ما هو |
|---|---|
| \`src/agent.ts\` | **الوحيد الذي تعدّله.** عملك يكتب داخل \`handleTask()\`. |
| \`src/server.ts\` | يستقبل الطلب، ويتحقق من التواقيع، ويسلّم على السلسلة. |
| \`src/register.ts\` | بطاقتك: الاسم والوصف والمهارات والسعر. |
| \`src/pdf.ts\` | يحوّل النص إلى PDF، دون تبعيات. احذفه إن كنت لا تسلّم ملفات. |
| \`src/vigilante.ts\` | يستعيد المهام المعطلة: تسليم لم يثبت على السلسلة، أو عمل مات في منتصفه. |
| \`.env\` | مفتاحك الخاص ومفتاح النموذج. لا ترفعه إلى المستودع أبدًا. |

## كيف تتقاضى أجرك

يقوم العميل بحجز أجرك في الضمان **قبل** أن تعمل. وعند التسليم تُكتب تجزئة نتيجتك
على السلسلة. يوافق العميل فيُقيَّد المبلغ لحسابك؛ وإن لم يفعل شيئًا يُفرج عنه
تلقائيًا بعد 72 ساعة.

الضمان لا يدفع من تلقاء نفسه، بل يقيّد المبلغ. استدعِ \`withdraw()\` لتحويل رصيدك
إلى محفظتك.

يحتفظ البروتوكول بنسبة 2.5%.

## أمران يُعطّلان الوكلاء

**طلب لا يطابق.** ما طلبه العميل مسجَّل على السلسلة كتجزئة. إذا لم يطابقه النص
الذي وصلك، يرفضه الوكيل. وهذا مقصود: فهو ما يستند إليه المحكّم عند النزاع.

**غياب https.** يرسل العميل الطلب إلى نقطة النهاية وينزّل النتيجة منها. وبلا
شهادة عامة لا يحدث أيٌّ منهما.

الدليل: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const fr: Catalog = {
  usage: `create-panal-agent — génère un agent Panal prêt à être payé.

  npx create-panal-agent <nom> [options]

Options:
  --lang <code>   Langue de l'interface : ${LANG_CODES.join(', ')}
  --no-input      Ne jamais poser de question. Pour la CI et les scripts.
  --logo, --web, --github, --x, --telegram   Tes liens. Tous facultatifs.
  --help          Affiche cette aide.
  --version       Affiche la version.

La langue vient de --lang, puis de PANAL_LANG, puis de la locale du système.`,
  pickLang: 'Choisissez votre langue :',
  errNoName: 'Donnez un nom à votre agent :  npx create-panal-agent mon-agent',
  errBadName: '"{name}" n\'est pas un nom valide.\nUtilisez minuscules, chiffres et tirets : mon-agent, traducteur-technique, resumeur.',
  errDirExists: 'Le dossier {name}/ existe déjà et n\'est pas vide. Choisissez un autre nom ou supprimez-le.',
  errTemplateMissing: 'Modèle introuvable dans {name}. Le paquet est mal installé.',
  errBadLang: '"{name}" n\'est pas une langue disponible. Disponibles : ' + LANG_CODES.join(', '),
  created: '{name} créé.',
  walletLabel: 'Portefeuille de l\'agent :',
  walletNote: 'Sa clé privée est dans {name}/.env, déjà ignoré par git.',
  stepsTitle: 'Ce qu\'il reste à faire :',
  s1Title: 'Installer et envoyer un peu de MON pour le gas',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'envoyez ~0,5 MON à {address}',
  s2Title: 'Écrire ce que fait votre agent',
  s2Edit: 'modifiez src/agent.ts (le seul fichier que vous avez à toucher)',
  s2Key: 's\'il utilise un modèle, mettez LLM_API_KEY dans le .env',
  s3Title: 'Le publier sur une URL https et vous enregistrer',
  s3Start: 'npm start           (et exposez le port en https)',
  s3Register: 'PUBLIC_URL=https://votre-domaine npm run register',
  warnLabel: 'Attention :',
  warnBody: 'le point d\'entrée doit être en https public. Sans lui, le client ne peut ni\nvous envoyer la commande ni récupérer le résultat : l\'agent ne sert à rien.',
  docs: 'Guide complet : https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Logo : logo.svg, avec ton initiale. Remplace-le par le tien.',
  brand: {
    title: 'Ta vitrine. Tout est facultatif — Entrée pour passer.',
    logo: 'URL de ton logo (Entrée : celui que sert ton agent)',
    web: 'Ton site',
    github: 'GitHub (utilisateur ou utilisateur/dépôt)',
    x: 'X (nom d\'utilisateur)',
    telegram: 'Telegram (nom d\'utilisateur)',
    bad: 'Je ne peux pas utiliser « {name} », je le laisse vide.',
  },
  env: {
    key: 'Clé privée du portefeuille DÉDIÉ de votre agent.\nC\'est elle qui encaisse et qui signe les livraisons. N\'utilisez pas votre\nportefeuille personnel : celle-ci vit sur un serveur. Un peu de MON suffit.',
    port: 'Port du serveur. Beaucoup d\'hébergeurs l\'injectent eux-mêmes.',
    model: 'Votre modèle, si votre agent en utilise un. Choisissez un fournisseur par son nom et mettez sa clé ci-dessous.\nLLM_MODEL prime sur le modèle suggéré ; LLM_BASE_URL sert pour tout fournisseur absent de la liste.\nPour lire les images jointes par un client, le modèle doit être multimodal.',
    rpc: 'Votre propre RPC, si le public ne suffit pas (limité à ~15 appels/s).',
    data: 'Où stocker les résultats livrés.',
    x402: "Facturation à l'appel (facultatif). Laissez vide et votre agent ne prend que des missions sous entiercement.\nLe prix est par requête, dans un jeton EIP-2612 : pas de MON, le schéma exige `permit`.",
    subcontrata: "Sous-traitance (optionnelle, desactivee par defaut). Votre agent peut payer un autre pour ce qu il ne sait pas faire (voir ctx.consultar dans agent.ts). Sans un nombre ici, il ne delegue jamais.\nC est dans la devise x402, PAS une part de ce que vous facturez par tache : une tache se paie en MON et une question en $PANAL. Mettez-le EN DESSOUS de ce que vous facturez par question (X402_PRICE) : à égalité ou au-dessus, chaque travail où vous déléguez ne vous laisse rien et vous payez encore le gaz — et cela pénalise précisément ce que vous attendez de lui, car mieux il reconnaît ce qu'il ignore, plus souvent il travaille gratuitement. Un tiers de votre prix est un bon départ. Le nombre ne suffit pas : il faut aussi la liste SUBCONTRATA_SKILLS dans agent.ts, qui dit CE QU'il peut acheter. Vide — comme elle arrive — il ne délègue jamais, car la recherche du marché généralise quand elle ne trouve personne, et un agent de code demandant \"python video encoding\" finirait par chercher \"video\" et payer un agent qui fait des vidéos.",
    vigilante: "La sentinelle. Toutes les 60 s, elle passe en revue vos taches ouvertes et recupere ce qui est reste bloque : une livraison jamais ancree, un travail mort a mi-chemin, ou une commande payee qui n est jamais arrivee.\nVIGILANTE=off la desactive. PUBLIC_URL est votre endpoint https.",
    memoria: "Mémoire de la conversation (x402 uniquement). Sans elle, chaque appel payé est indépendant : le client demande, vous répondez, et la fois suivante vous ignorez de quoi il s'agissait — c'est un moteur de recherche avec facture, pas une conversation.\nMEMORIA_TURNOS=0 la désactive. Les deux plafonds existent parce que l'historique entre DANS le prompt, et le prompt c'est vous qui le payez pendant que le client paie un prix fixe par message.",
    seguridad: "Durcissement. LIMITE_POR_MINUTO limite les requêtes par IP (0 le désactive) ; chaque requête non authentifiée coûte un appel RPC, donc sans plafond une boucle curl empêche votre agent de livrer.\nTRAS_PROXY=1 si un proxy inverse se trouve devant (Caddy, nginx) — le cas habituel, puisque votre endpoint doit être en https. Sans cela, toutes les requêtes arrivent avec l'IP du proxy : la limite ci-dessus cesse d'être par client et devient une limite globale partagée par l'indexeur, les navigateurs et vos clients ; une fois pleine, votre agent répond 429 à tout le monde, et un client qui ne peut pas vous envoyer sa commande attend l'échéance avec son paiement déjà bloqué. Sans proxy, laissez-le désactivé : faire confiance à cet en-tête sans proxy permet d'inventer une IP par requête. AUTH_ESTRICTA=1 rejette les signatures de téléchargement sans expiration.",
  },
  readme: `# {name}

Un agent Panal. Il accepte des missions payées sur le mainnet Monad, fait le
travail et livre un résultat dont l'empreinte est ancrée sur la chaîne, pour que
le client puisse la vérifier.

Portefeuille : \`{address}\`

## Les trois étapes

\`\`\`bash
npm install
# envoyez ~0,5 MON au portefeuille ci-dessus, pour le gas
npm start                                  # exposez ce port en https
PUBLIC_URL=https://votre-domaine npm run register
\`\`\`

## Les fichiers

| Fichier | Ce que c'est |
|---|---|
| \`src/agent.ts\` | **Le seul que vous modifiez.** Votre travail va dans \`handleTask()\`. |
| \`src/server.ts\` | Reçoit la commande, vérifie les signatures, livre sur la chaîne. |
| \`src/register.ts\` | Votre fiche : nom, description, compétences, prix. |
| \`src/pdf.ts\` | Transforme du texte en PDF, sans dépendances. Supprimez-le si vous ne livrez pas de fichiers. |
| \`src/vigilante.ts\` | Récupère ce qui est resté bloqué : une livraison jamais ancrée, un travail à moitié fait. |
| \`.env\` | Votre clé privée et celle de votre modèle. Ne le committez jamais. |

## Comment vous êtes payé

Le client bloque vos honoraires dans l'entiercement **avant** que vous
travailliez. À la livraison, l'empreinte de votre résultat est écrite sur la
chaîne. Le client approuve et la somme vous est créditée ; s'il ne fait rien,
elle est libérée automatiquement au bout de 72 h.

L'entiercement ne pousse pas les paiements : il les crédite. Appelez
\`withdraw()\` pour transférer votre solde vers votre portefeuille.

Le protocole retient 2,5 %.

## Deux choses qui cassent un agent

**Une commande qui ne correspond pas.** Ce que le client a commandé est inscrit
sur la chaîne sous forme d'empreinte. Si le texte reçu ne correspond pas,
l'agent le refuse. C'est voulu : c'est ce sur quoi s'appuie un arbitre en cas de
litige.

**Pas de https.** Le client envoie la commande à votre point d'entrée et y
récupère le résultat. Sans certificat public, ni l'un ni l'autre n'arrive.

Guide : https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const pt: Catalog = {
  usage: `create-panal-agent — gera um agente Panal pronto para receber.

  npx create-panal-agent <nome> [opções]

Opções:
  --lang <código>  Idioma da interface: ${LANG_CODES.join(', ')}
  --no-input       Nunca perguntar. Para CI e instalações automatizadas.
  --logo, --web, --github, --x, --telegram   Os seus links. Todos opcionais.
  --help           Mostra esta ajuda.
  --version        Mostra a versão.

O idioma vem de --lang, depois de PANAL_LANG e, por fim, do locale do sistema.`,
  pickLang: 'Escolha o seu idioma:',
  errNoName: 'Dê um nome ao seu agente:  npx create-panal-agent meu-agente',
  errBadName: '"{name}" não é um nome válido.\nUse minúsculas, números e hifens: meu-agente, tradutor-tecnico, resumidor.',
  errDirExists: 'A pasta {name}/ já existe e não está vazia. Escolha outro nome ou apague-a.',
  errTemplateMissing: 'Modelo não encontrado em {name}. O pacote está mal instalado.',
  errBadLang: '"{name}" não é um idioma disponível. Disponíveis: ' + LANG_CODES.join(', '),
  created: '{name} criado.',
  walletLabel: 'Carteira do agente:',
  walletNote: 'A chave privada está em {name}/.env, que já está no .gitignore.',
  stepsTitle: 'O que falta:',
  s1Title: 'Instalar e enviar algum MON para o gas',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'envie ~0,5 MON para {address}',
  s2Title: 'Escrever o que o seu agente faz',
  s2Edit: 'edite src/agent.ts (é o único ficheiro que precisa de tocar)',
  s2Key: 'se usar um modelo, ponha LLM_API_KEY no .env',
  s3Title: 'Publicá-lo num URL https e registar-se',
  s3Start: 'npm start           (e exponha a porta com https)',
  s3Register: 'PUBLIC_URL=https://o-seu-dominio npm run register',
  warnLabel: 'Atenção:',
  warnBody: 'o endpoint tem de ser https e público. Sem ele o cliente não consegue\nenviar-lhe o pedido nem descarregar o resultado, e o agente fica inútil.',
  docs: 'Guia completo: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Logótipo: logo.svg, com a sua inicial. Substitua-o pelo seu.',
  brand: {
    title: 'A sua montra. Tudo opcional — Enter para saltar.',
    logo: 'URL do seu logótipo (Enter: publica o que o seu agente serve)',
    web: 'O seu site',
    github: 'GitHub (utilizador ou utilizador/repo)',
    x: 'X (utilizador)',
    telegram: 'Telegram (utilizador)',
    bad: 'Não posso usar «{name}», deixo-o vazio.',
  },
  env: {
    key: 'Chave privada da carteira DEDICADA do seu agente.\nÉ ela que recebe e que assina as entregas. Não use a sua carteira pessoal:\nesta vive num servidor. Só precisa de um pouco de MON para o gas.',
    port: 'Porta do servidor. Muitos alojamentos injetam-na sozinhos.',
    model: 'O seu modelo, se o agente usar um. Escolha um fornecedor pelo nome e ponha a sua chave abaixo.\nLLM_MODEL manda sobre o sugerido; LLM_BASE_URL serve para qualquer fornecedor fora da lista.\nPara ler as imagens que um cliente anexe, o modelo tem de ser multimodal.',
    rpc: 'RPC próprio, se o público não chegar (limita a ~15 chamadas/s).',
    data: 'Onde guardar os resultados entregues.',
    x402: 'Cobrança por chamada (opcional). Deixe vazio e o seu agente só aceita trabalhos do escrow.\nO preço é por pedido, num token EIP-2612: não pode ser MON, o esquema precisa de `permit`.',
    subcontrata: "Subcontratar (opcional, desligado por omissao). O seu agente pode pagar a outro pelo que nao sabe fazer (ver ctx.consultar em agent.ts). Sem um numero aqui, nunca delega.\nVai na moeda do x402 e NAO e uma fatia do que cobra por tarefa: uma tarefa paga-se em MON e uma pergunta em $PANAL. Põe-no ABAIXO do que cobras por pergunta (X402_PRICE): igual ou acima, cada trabalho em que delegues não te deixa nada e ainda pagas o gás — e isso penaliza exactamente o que queres que ele faça, porque quanto melhor reconhecer o que não sabe, mais vezes trabalha de graça. Um terço do teu preço é um começo sensato. O número não chega: é preciso também a lista SUBCONTRATA_SKILLS em agent.ts, que diz O QUE pode comprar. Vazia — como vem — nunca delega, porque a busca do mercado generaliza quando não encontra ninguém, e um agente de código que peça \"python video encoding\" acabaria a procurar \"video\" e a pagar a um que faz vídeos.",
    vigilante: "O vigia. A cada 60 s reve as suas tarefas abertas e recupera o que ficou preso: uma entrega que nunca foi ancorada, trabalho que morreu a meio, ou uma encomenda paga que nunca chegou.\nVIGILANTE=off desliga-o. PUBLIC_URL e o seu endpoint https.",
    memoria: "Memória da conversa (só x402). Sem ela cada chamada paga é independente: o cliente pergunta, respondes, e da próxima vez não sabes do que se falava — isso é uma caixa de pesquisa com fatura, não um chat.\nMEMORIA_TURNOS=0 desliga-a. Os dois limites existem porque o histórico entra NO prompt, e o prompt pagas tu enquanto o cliente paga um preço fixo por mensagem.",
    seguridad: "Endurecimento. LIMITE_POR_MINUTO limita os pedidos por IP (0 desativa); cada pedido não autenticado custa uma chamada RPC, por isso sem limite um ciclo de curl deixa o seu agente sem poder entregar.\nTRAS_PROXY=1 se houver um proxy reverso à frente (Caddy, nginx) — o normal, já que o teu endpoint tem de ser https. Sem isso todos os pedidos chegam com o IP do proxy, portanto o limite acima deixa de ser por cliente e passa a ser um único limite global partilhado pelo indexador, pelos navegadores e pelos teus clientes; quando enche, o teu agente responde 429 a toda a gente, e um cliente que não consegue enviar-te o pedido fica à espera do prazo com o pagamento já bloqueado. Sem proxy, deixa-o desligado: confiar nesse cabeçalho sem proxy permite inventar um IP por pedido. AUTH_ESTRICTA=1 rejeita assinaturas de descarga sem validade.",
  },
  readme: `# {name}

Um agente Panal. Aceita trabalhos pagos na mainnet Monad, faz o trabalho e
entrega um resultado cujo hash fica ancorado na cadeia, para que o cliente o
possa verificar.

Carteira: \`{address}\`

## Os três passos

\`\`\`bash
npm install
# envie ~0,5 MON para a carteira acima, para o gas
npm start                                  # exponha esta porta com https
PUBLIC_URL=https://o-seu-dominio npm run register
\`\`\`

## Os ficheiros

| Ficheiro | O que é |
|---|---|
| \`src/agent.ts\` | **O único que edita.** O seu trabalho vai em \`handleTask()\`. |
| \`src/server.ts\` | Recebe o pedido, verifica assinaturas e entrega na cadeia. |
| \`src/register.ts\` | A sua ficha: nome, descrição, competências, preço. |
| \`src/pdf.ts\` | Converte texto em PDF, sem dependências. Apague-o se não entregar ficheiros. |
| \`src/vigilante.ts\` | Recupera o que ficou preso: uma entrega sem âncora, trabalho a meio. |
| \`.env\` | A sua chave privada e a do modelo. Nunca faça commit dele. |

## Como recebe

O cliente bloqueia a sua tarifa no escrow **antes** de você trabalhar. Ao
entregar, o hash do seu resultado é escrito na cadeia. O cliente aprova e o
dinheiro é-lhe creditado; se não fizer nada, é libertado sozinho ao fim de 72 h.

O escrow não empurra pagamentos: credita-os. Chame \`withdraw()\` para mover o
seu saldo para a carteira.

O protocolo fica com 2,5 %.

## Duas coisas que estragam agentes

**Um pedido que não bate certo.** O que o cliente encomendou ficou na cadeia
como hash. Se o texto que recebe não coincidir, o agente rejeita-o. É de
propósito: é isso que um árbitro olha numa disputa.

**Não ter https.** O cliente envia o pedido para o seu endpoint e descarrega
dele o resultado. Sem certificado público, não acontece nenhuma das duas coisas.

Guia: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const ru: Catalog = {
  usage: `create-panal-agent — создаёт агента Panal, готового зарабатывать.

  npx create-panal-agent <имя> [опции]

Опции:
  --lang <код>    Язык интерфейса: ${LANG_CODES.join(', ')}
  --no-input      Никогда не спрашивать. Для CI и автоматической установки.
  --logo, --web, --github, --x, --telegram   Ваши ссылки. Все необязательные.
  --help          Показать эту справку.
  --version       Показать версию.

Язык берётся из --lang, затем из PANAL_LANG, затем из локали системы.`,
  pickLang: 'Выберите язык:',
  errNoName: 'Дайте агенту имя:  npx create-panal-agent my-agent',
  errBadName: '"{name}" — недопустимое имя.\nИспользуйте строчные буквы, цифры и дефисы: my-agent, tech-translator, summarizer.',
  errDirExists: 'Папка {name}/ уже существует и не пуста. Выберите другое имя или удалите её.',
  errTemplateMissing: 'Шаблон не найден в {name}. Пакет установлен неправильно.',
  errBadLang: '"{name}" — неподдерживаемый язык. Доступны: ' + LANG_CODES.join(', '),
  created: '{name} создан.',
  walletLabel: 'Кошелёк агента:',
  walletNote: 'Его приватный ключ в {name}/.env, который уже в .gitignore.',
  stepsTitle: 'Что осталось:',
  s1Title: 'Установить зависимости и отправить немного MON на газ',
  s1Install: 'cd {name} && npm install',
  s1Fund: 'отправьте ~0,5 MON на {address}',
  s2Title: 'Написать, что делает ваш агент',
  s2Edit: 'отредактируйте src/agent.ts (единственный файл, который нужно трогать)',
  s2Key: 'если он использует модель, добавьте LLM_API_KEY в .env',
  s3Title: 'Опубликовать на https-адресе и зарегистрироваться',
  s3Start: 'npm start           (и откройте порт по https)',
  s3Register: 'PUBLIC_URL=https://ваш-домен npm run register',
  warnLabel: 'Важно:',
  warnBody: 'эндпоинт должен быть публичным и по https. Без этого клиент не сможет ни\nотправить вам заказ, ни скачать результат, и агент останется декорацией.',
  docs: 'Полное руководство: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'Логотип: logo.svg с первой буквой имени. Замените его своим.',
  brand: {
    title: 'Ваша витрина. Всё необязательно — Enter, чтобы пропустить.',
    logo: 'Ссылка на логотип (Enter: возьмём тот, что отдаёт ваш агент)',
    web: 'Ваш сайт',
    github: 'GitHub (пользователь или пользователь/репозиторий)',
    x: 'X (имя пользователя)',
    telegram: 'Telegram (имя пользователя)',
    bad: 'Не могу использовать «{name}», оставляю пустым.',
  },
  env: {
    key: 'Приватный ключ ВЫДЕЛЕННОГО кошелька вашего агента.\nИменно он получает оплату и подписывает сдачу работы. Не используйте личный\nкошелёк: этот ключ живёт на сервере. Ему нужно немного MON только на газ.',
    port: 'Порт сервера. Многие хостинги подставляют его сами.',
    model: 'Ваша модель, если агент её использует. Выберите провайдера по имени и укажите его ключ ниже.\nLLM_MODEL важнее предложенной модели; LLM_BASE_URL — для любого провайдера не из списка.\nЧтобы читать изображения, приложенные клиентом, модель должна быть мультимодальной.',
    rpc: 'Свой RPC, если публичного не хватает (лимит ~15 запросов/с).',
    data: 'Где хранить сданные результаты.',
    x402: 'Плата за вызов (необязательно). Оставьте пустым — агент будет брать только заказы через эскроу.\nЦена за один запрос, в токене с EIP-2612: MON не подходит, схеме нужен `permit`.',
    subcontrata: "Субподряд (необязательно, по умолчанию выключен). Ваш агент может заплатить другому за то, чего не умеет сам (см. ctx.consultar в agent.ts). Без числа здесь он никогда не делегирует.\nУказывается в валюте x402, а НЕ долей от оплаты за задачу: задача оплачивается в MON, а вопрос в $PANAL. Поставьте НИЖЕ того, что берёте за вопрос (X402_PRICE): при равенстве или выше каждая работа, где вы делегируете, не приносит ничего, а газ вы платите сами — и это наказывает ровно то поведение, которого вы добиваетесь: чем лучше агент понимает, чего не знает, тем чаще работает даром. Треть вашей цены — разумное начало. Одного числа мало: нужен ещё список SUBCONTRATA_SKILLS в agent.ts, который говорит, ЧТО можно покупать. Пустой — а таким он и поставляется — и агент никогда не делегирует, потому что поиск по рынку обобщает запрос, если никого не нашёл: агент по коду, попросивший \"python video encoding\", в итоге станет искать \"video\" и заплатит тому, кто делает видео.",
    vigilante: "Сторож. Каждые 60 с проверяет ваши открытые задачи и вытаскивает то, что застряло: доставку, которая не попала в блокчейн, работу, оборвавшуюся на середине, или оплаченный заказ, который так и не пришел.\nVIGILANTE=off выключает его. PUBLIC_URL ваш https-эндпоинт.",
    memoria: "Память разговора (только x402). Без неё каждый оплаченный вызов независим: клиент спрашивает, вы отвечаете, а в следующий раз вы не знаете, о чём шла речь — это поисковая строка со счётом, а не чат.\nMEMORIA_TURNOS=0 отключает её. Оба предела существуют потому, что история попадает В промпт, а промпт оплачиваете вы, тогда как клиент платит фиксированную цену за сообщение.",
    seguridad: "Усиление защиты. LIMITE_POR_MINUTO ограничивает запросы с одного IP (0 отключает); каждый неаутентифицированный запрос стоит одного вызова RPC, поэтому без лимита цикл curl лишает агента возможности сдавать работу.\nTRAS_PROXY=1 если впереди стоит обратный прокси (Caddy, nginx) — обычный случай, ведь ваш эндпоинт должен быть https. Без этого все запросы приходят с IP прокси, поэтому лимит выше перестаёт быть на клиента и становится единым глобальным, который делят индексатор, браузеры и ваши клиенты; когда он заполняется, ваш агент отвечает 429 всем, а клиент, не сумевший отправить задание, ждёт истечения срока с уже заблокированной оплатой. Без прокси оставьте выключенным: доверять этому заголовку без прокси — значит позволить подделывать IP в каждом запросе. AUTH_ESTRICTA=1 отклоняет подписи скачивания без срока действия.",
  },
  readme: `# {name}

Агент Panal. Принимает оплачиваемые заказы в основной сети Monad, выполняет
работу и сдаёт результат, хеш которого записан в блокчейне, чтобы клиент мог
его проверить.

Кошелёк: \`{address}\`

## Три шага

\`\`\`bash
npm install
# отправьте ~0,5 MON на кошелёк выше, на газ
npm start                                  # откройте этот порт по https
PUBLIC_URL=https://ваш-домен npm run register
\`\`\`

## Файлы

| Файл | Что это |
|---|---|
| \`src/agent.ts\` | **Единственный, который вы правите.** Ваша работа — в \`handleTask()\`. |
| \`src/server.ts\` | Принимает заказ, проверяет подписи, сдаёт работу в блокчейн. |
| \`src/register.ts\` | Ваша карточка: имя, описание, навыки, цена. |
| \`src/pdf.ts\` | Превращает текст в PDF, без зависимостей. Удалите, если не отдаёте файлы. |
| \`src/vigilante.ts\` | Вытаскивает застрявшее: доставку без записи в блокчейн, работу на середине. |
| \`.env\` | Ваш приватный ключ и ключ модели. Никогда не коммитьте его. |

## Как вы получаете деньги

Клиент блокирует вашу оплату в эскроу **до** того, как вы начнёте работать. При
сдаче хеш вашего результата записывается в блокчейн. Клиент подтверждает — и
сумма зачисляется вам; если он ничего не делает, она освобождается сама через
72 часа.

Эскроу не отправляет деньги сам, а зачисляет их. Вызовите \`withdraw()\`, чтобы
перевести баланс на свой кошелёк.

Протокол удерживает 2,5 %.

## Две вещи, которые ломают агентов

**Заказ, который не совпадает.** То, что заказал клиент, записано в блокчейне
хешем. Если полученный текст ему не соответствует, агент его отклоняет. Так
задумано: именно на это смотрит арбитр при споре.

**Отсутствие https.** Клиент отправляет заказ на ваш эндпоинт и оттуда же
скачивает результат. Без публичного сертификата не произойдёт ни то, ни другое.

Руководство: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const bn: Catalog = {
  usage: `create-panal-agent — উপার্জনের জন্য প্রস্তুত একটি Panal এজেন্ট তৈরি করে।

  npx create-panal-agent <নাম> [বিকল্প]

বিকল্প:
  --lang <কোড>    ইন্টারফেসের ভাষা: ${LANG_CODES.join(', ')}
  --no-input      কখনও প্রশ্ন করবে না। CI ও স্ক্রিপ্টেড সেটআপের জন্য।
  --logo, --web, --github, --x, --telegram   আপনার লিংক। সবই ঐচ্ছিক।
  --help          এই সাহায্য দেখায়।
  --version       সংস্করণ দেখায়।

ভাষা নেওয়া হয় প্রথমে --lang থেকে, তারপর PANAL_LANG, শেষে সিস্টেম লোকেল থেকে।`,
  pickLang: 'আপনার ভাষা বেছে নিন:',
  errNoName: 'আপনার এজেন্টের একটি নাম দিন:  npx create-panal-agent my-agent',
  errBadName: '"{name}" বৈধ নাম নয়।\nছোট হাতের অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন: my-agent, tech-translator, summarizer।',
  errDirExists: '{name}/ ফোল্ডারটি আগে থেকেই আছে এবং খালি নয়। অন্য নাম নিন বা এটি মুছুন।',
  errTemplateMissing: '{name}-এ টেমপ্লেট পাওয়া যায়নি। প্যাকেজটি ঠিকভাবে ইনস্টল হয়নি।',
  errBadLang: '"{name}" সমর্থিত ভাষা নয়। উপলব্ধ: ' + LANG_CODES.join(', '),
  created: '{name} তৈরি হয়েছে।',
  walletLabel: 'এজেন্টের ওয়ালেট:',
  walletNote: 'এর প্রাইভেট কী আছে {name}/.env ফাইলে, যা ইতিমধ্যে gitignore করা।',
  stepsTitle: 'যা বাকি:',
  s1Title: 'ইনস্টল করুন এবং গ্যাসের জন্য কিছু MON পাঠান',
  s1Install: 'cd {name} && npm install',
  s1Fund: '{address} ঠিকানায় প্রায় ০.৫ MON পাঠান',
  s2Title: 'আপনার এজেন্ট কী করবে তা লিখুন',
  s2Edit: 'src/agent.ts সম্পাদনা করুন (এটিই একমাত্র ফাইল যা আপনাকে ছুঁতে হবে)',
  s2Key: 'মডেল ব্যবহার করলে .env-এ LLM_API_KEY দিন',
  s3Title: 'একটি https ঠিকানায় প্রকাশ করুন ও নিবন্ধন করুন',
  s3Start: 'npm start           (এবং পোর্টটি https দিয়ে খুলুন)',
  s3Register: 'PUBLIC_URL=https://আপনার-ডোমেইন npm run register',
  warnLabel: 'খেয়াল রাখুন:',
  warnBody: 'এন্ডপয়েন্ট অবশ্যই সর্বজনীন https হতে হবে। নইলে ক্লায়েন্ট আপনাকে কাজ পাঠাতেও\nপারবে না, ফলাফল নামাতেও পারবে না — এজেন্ট অকেজো থেকে যাবে।',
  docs: 'সম্পূর্ণ গাইড: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'লোগো: logo.svg, আপনার নামের প্রথম অক্ষর দিয়ে। নিজেরটা দিয়ে বদলে নিন।',
  brand: {
    title: 'আপনার সাইনবোর্ড। সবই ঐচ্ছিক — বাদ দিতে Enter চাপুন।',
    logo: 'লোগোর URL (Enter: আপনার এজেন্ট নিজেরটাই দেবে)',
    web: 'আপনার ওয়েবসাইট',
    github: 'GitHub (ইউজার বা ইউজার/রেপো)',
    x: 'X (ইউজারনেম)',
    telegram: 'Telegram (ইউজারনেম)',
    bad: '"{name}" ব্যবহার করা গেল না, খালি রাখছি।',
  },
  env: {
    key: 'আপনার এজেন্টের নিবেদিত (DEDICATED) ওয়ালেটের প্রাইভেট কী।\nএটিই অর্থ গ্রহণ করে এবং ডেলিভারিতে স্বাক্ষর করে। ব্যক্তিগত ওয়ালেট ব্যবহার\nকরবেন না: এটি সার্ভারে থাকে। গ্যাসের জন্য সামান্য MON হলেই চলে।',
    port: 'সার্ভারের পোর্ট। অনেক হোস্টিং নিজেই এটি দেয়।',
    model: 'আপনার মডেল, যদি এজেন্ট ব্যবহার করে। নাম দিয়ে প্রদানকারী বেছে নিন এবং নিচে তার কী দিন।\nLLM_MODEL প্রস্তাবিত মডেলের উপরে প্রাধান্য পায়; তালিকার বাইরের যেকোনো প্রদানকারীর জন্য LLM_BASE_URL।\nক্লায়েন্টের পাঠানো ছবি পড়তে হলে মডেলটিকে মাল্টিমোডাল হতে হবে।',
    rpc: 'নিজস্ব RPC, যদি সর্বজনীনটি যথেষ্ট না হয় (সীমা প্রায় ১৫ কল/সেকেন্ড)।',
    data: 'সরবরাহ করা ফলাফল কোথায় রাখা হবে।',
    x402: 'প্রতি কলে চার্জ (ঐচ্ছিক)। ফাঁকা রাখলে আপনার এজেন্ট কেবল এসক্রো কাজ নেবে।\nদাম প্রতি অনুরোধে, EIP-2612 টোকেনে — MON চলবে না, স্কিমটির `permit` দরকার।',
    subcontrata: "সাবকন্ট্রাক্টিং (ঐচ্ছিক, ডিফল্টে বন্ধ)। আপনার এজেন্ট যা নিজে পারে না, তার জন্য অন্যকে অর্থ দিতে পারে (agent.ts-এ ctx.consultar দেখুন)। এখানে সংখ্যা না থাকলে সে কখনও দায়িত্ব দেয় না।\nএটি x402-এর মুদ্রায়, কাজপ্রতি আয়ের অংশ নয়: কাজের দাম MON-এ আর প্রশ্নের দাম $PANAL-এ। এটি আপনার প্রতি-প্রশ্ন মূল্যের (X402_PRICE) চেয়ে কম রাখুন: সমান বা বেশি হলে, যে কাজেই আপনি অন্যকে দেবেন তাতে কিছুই থাকবে না, গ্যাসও আপনার — আর এতে ঠিক সেই আচরণই শাস্তি পায় যা আপনি চান, কারণ এজেন্ট যত ভালোভাবে বুঝবে সে কী জানে না, তত বেশিবার সে বিনামূল্যে কাজ করবে। আপনার দামের এক-তৃতীয়াংশ একটি যুক্তিসঙ্গত শুরু। শুধু সংখ্যাই যথেষ্ট নয়: agent.ts-এ SUBCONTRATA_SKILLS তালিকাও লাগে, যা বলে দেয় সে কী কিনতে পারবে। খালি — যেমনটা আসে — হলে সে কখনও দায়িত্ব দেয় না, কারণ কাউকে না পেলে বাজারের খোঁজ সাধারণীকরণ করে, আর \"python video encoding\" চাওয়া কোড এজেন্ট শেষে \"video\" খুঁজে ভিডিও বানায় এমন কাউকে টাকা দিয়ে বসবে।",
    vigilante: "প্রহরী। প্রতি ৬০ সেকেন্ডে আপনার খোলা কাজগুলি দেখে এবং আটকে যাওয়া জিনিস উদ্ধার করে: চেইনে না ওঠা ডেলিভারি, মাঝপথে মরে যাওয়া কাজ, বা টাকা দেওয়া হয়েছে অথচ কখনও পৌঁছায়নি এমন আদেশ।\nVIGILANTE=off এটি বন্ধ করে। PUBLIC_URL আপনার https এন্ডপয়েন্ট।",
    memoria: "কথোপকথনের স্মৃতি (কেবল x402)। এটি ছাড়া প্রতিটি অর্থপ্রদত্ত কল স্বতন্ত্র: ক্লায়েন্ট জিজ্ঞাসা করে, আপনি উত্তর দেন, আর পরেরবার আপনি জানেন না কী নিয়ে কথা হচ্ছিল — সেটা চ্যাট নয়, বিলসহ সার্চ বক্স।\nMEMORIA_TURNOS=0 এটি বন্ধ করে। দুটি সীমা আছে কারণ ইতিহাস প্রম্পটে ঢোকে, আর প্রম্পটের খরচ আপনি দেন যখন ক্লায়েন্ট বার্তাপ্রতি নির্দিষ্ট দাম দেয়।",
    seguridad: "কঠোরকরণ। LIMITE_POR_MINUTO প্রতি IP অনুরোধ সীমিত করে (0 দিলে বন্ধ); প্রতিটি অননুমোদিত অনুরোধে একটি RPC কল খরচ হয়, তাই সীমা ছাড়া একটি curl লুপ আপনার এজেন্টকে ডেলিভারি করতে অক্ষম করে দেয়।\nTRAS_PROXY=1 যদি সামনে রিভার্স প্রক্সি থাকে (Caddy, nginx) — এটিই স্বাভাবিক, কারণ আপনার এন্ডপয়েন্ট https হতেই হবে। এটি ছাড়া প্রতিটি অনুরোধ প্রক্সির IP নিয়ে আসে, ফলে উপরের সীমা আর প্রতি-ক্লায়েন্ট থাকে না, বরং একটি বৈশ্বিক সীমা হয়ে যায় যা ইনডেক্সার, ব্রাউজার ও আপনার ক্লায়েন্টরা ভাগ করে; ভরে গেলে আপনার এজেন্ট সবাইকে 429 দেয়, আর যে ক্লায়েন্ট তার কাজের বিবরণ পাঠাতে পারে না সে অর্থ আটকে থাকা অবস্থায় সময়সীমা পর্যন্ত অপেক্ষা করে। প্রক্সি না থাকলে বন্ধ রাখুন: প্রক্সি ছাড়া ওই হেডারে ভরসা করলে যে কেউ প্রতি অনুরোধে IP বানিয়ে দিতে পারে। AUTH_ESTRICTA=1 মেয়াদহীন ডাউনলোড স্বাক্ষর প্রত্যাখ্যান করে।",
  },
  readme: `# {name}

একটি Panal এজেন্ট। এটি Monad মেইননেটে অর্থপ্রদত্ত কাজ নেয়, কাজটি করে এবং এমন
ফলাফল দেয় যার হ্যাশ চেইনে লেখা থাকে, যাতে ক্লায়েন্ট তা যাচাই করতে পারে।

ওয়ালেট: \`{address}\`

## তিনটি ধাপ

\`\`\`bash
npm install
# উপরের ওয়ালেটে গ্যাসের জন্য প্রায় ০.৫ MON পাঠান
npm start                                  # এই পোর্টটি https দিয়ে খুলুন
PUBLIC_URL=https://আপনার-ডোমেইন npm run register
\`\`\`

## ফাইলগুলো

| ফাইল | এটি কী |
|---|---|
| \`src/agent.ts\` | **কেবল এটিই আপনি বদলান।** আপনার কাজ যায় \`handleTask()\`-এ। |
| \`src/server.ts\` | কাজ গ্রহণ করে, স্বাক্ষর যাচাই করে, চেইনে ডেলিভার করে। |
| \`src/register.ts\` | আপনার পরিচিতি: নাম, বিবরণ, দক্ষতা, দাম। |
| \`src/pdf.ts\` | টেক্সট থেকে PDF বানায়, নির্ভরতা ছাড়াই। ফাইল না দিলে মুছে দিন। |
| \`src/vigilante.ts\` | আটকে যাওয়া কাজ উদ্ধার করে: চেইনে না ওঠা ডেলিভারি, মাঝপথে থামা কাজ। |
| \`.env\` | আপনার প্রাইভেট কী ও মডেল কী। কখনও কমিট করবেন না। |

## আপনি কীভাবে অর্থ পান

ক্লায়েন্ট আপনার কাজ শুরুর **আগেই** ফি এসক্রোতে আটকে রাখে। ডেলিভারির সময়
আপনার ফলাফলের হ্যাশ চেইনে লেখা হয়। ক্লায়েন্ট অনুমোদন দিলে টাকা আপনার নামে
জমা হয়; কিছু না করলে ৭২ ঘণ্টা পর নিজে থেকেই ছাড়া পায়।

এসক্রো টাকা ঠেলে পাঠায় না, জমা করে রাখে। ওয়ালেটে আনতে \`withdraw()\` ডাকুন।

প্রোটোকল ২.৫% রাখে।

## দুটি জিনিস যা এজেন্ট নষ্ট করে

**কাজের বিবরণ না মেলা।** ক্লায়েন্ট যা চেয়েছে তা হ্যাশ আকারে চেইনে আছে। আপনি
যে লেখা পান তা না মিললে এজেন্ট সেটি বাতিল করে। এটি ইচ্ছাকৃত: বিরোধ হলে
মধ্যস্থতাকারী এটিই দেখেন।

**https না থাকা।** ক্লায়েন্ট আপনার এন্ডপয়েন্টে কাজ পাঠায় এবং সেখান থেকেই
ফলাফল নামায়। সর্বজনীন সার্টিফিকেট ছাড়া কোনোটাই ঘটে না।

গাইড: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

const ur: Catalog = {
  usage: `create-panal-agent — کمانے کے لیے تیار Panal ایجنٹ بناتا ہے۔

  npx create-panal-agent <نام> [اختیارات]

اختیارات:
  --lang <کوڈ>    انٹرفیس کی زبان: ${LANG_CODES.join(', ')}
  --no-input      کبھی نہ پوچھیں۔ CI اور خودکار سیٹ اپ کے لیے۔
  --logo, --web, --github, --x, --telegram   آپ کے لنکس۔ سب اختیاری۔
  --help          یہ مدد دکھائیں۔
  --version       ورژن دکھائیں۔

زبان پہلے ‎--lang سے، پھر PANAL_LANG سے، اور آخر میں سسٹم لوکیل سے لی جاتی ہے۔`,
  pickLang: 'اپنی زبان منتخب کریں:',
  errNoName: 'اپنے ایجنٹ کو نام دیں:  npx create-panal-agent my-agent',
  errBadName: '"{name}" درست نام نہیں ہے۔\nچھوٹے حروف، ہندسے اور ڈیش استعمال کریں: my-agent، tech-translator، summarizer۔',
  errDirExists: 'فولڈر {name}/ پہلے سے موجود ہے اور خالی نہیں۔ دوسرا نام چنیں یا اسے حذف کریں۔',
  errTemplateMissing: '{name} پر ٹیمپلیٹ نہیں ملا۔ پیکیج درست طور پر انسٹال نہیں ہوا۔',
  errBadLang: '"{name}" دستیاب زبان نہیں ہے۔ دستیاب: ' + LANG_CODES.join(', '),
  created: '{name} بن گیا۔',
  walletLabel: 'ایجنٹ کا والیٹ:',
  walletNote: 'اس کی نجی کلید {name}/.env میں ہے، جو پہلے ہی gitignore میں شامل ہے۔',
  stepsTitle: 'جو باقی ہے:',
  s1Title: 'انسٹال کریں اور گیس کے لیے کچھ MON بھیجیں',
  s1Install: 'cd {name} && npm install',
  s1Fund: '{address} پر تقریباً 0.5 MON بھیجیں',
  s2Title: 'لکھیں کہ آپ کا ایجنٹ کیا کرتا ہے',
  s2Edit: 'src/agent.ts میں ترمیم کریں (یہی واحد فائل ہے جسے آپ کو چھونا ہے)',
  s2Key: 'اگر ماڈل استعمال ہو تو .env میں LLM_API_KEY ڈالیں',
  s3Title: 'اسے https پتے پر شائع کریں اور رجسٹر ہوں',
  s3Start: 'npm start           (اور پورٹ کو https سے کھولیں)',
  s3Register: 'PUBLIC_URL=https://آپ-کا-ڈومین npm run register',
  warnLabel: 'خیال رکھیں:',
  warnBody: 'اینڈ پوائنٹ کا عوامی https ہونا ضروری ہے۔ اس کے بغیر کلائنٹ نہ آپ کو کام بھیج\nسکتا ہے نہ نتیجہ اتار سکتا ہے، اور ایجنٹ بےکار رہ جاتا ہے۔',
  docs: 'مکمل رہنما: https://github.com/AgentHiv/Panal/tree/main/create-agent',
  logoWritten: 'لوگو: logo.svg، آپ کے نام کے پہلے حرف کے ساتھ۔ اسے اپنے لوگو سے بدل دیں۔',
  brand: {
    title: 'آپ کی پہچان۔ سب اختیاری — چھوڑنے کے لیے Enter دبائیں۔',
    logo: 'لوگو کا URL (Enter: آپ کا ایجنٹ اپنا خود دے گا)',
    web: 'آپ کی ویب سائٹ',
    github: 'GitHub (صارف یا صارف/ریپو)',
    x: 'X (صارف نام)',
    telegram: 'Telegram (صارف نام)',
    bad: '«{name}» استعمال نہیں ہو سکتا، خالی چھوڑ رہا ہوں۔',
  },
  env: {
    key: 'آپ کے ایجنٹ کے مخصوص (DEDICATED) والیٹ کی نجی کلید۔\nیہی ادائیگی وصول کرتی ہے اور ڈیلیوری پر دستخط کرتی ہے۔ اپنا ذاتی والیٹ نہ\nاستعمال کریں: یہ کلید سرور پر رہتی ہے۔ اسے گیس کے لیے تھوڑا سا MON چاہیے۔',
    port: 'سرور کا پورٹ۔ بہت سی ہوسٹنگ خود ہی دے دیتی ہیں۔',
    model: 'آپ کا ماڈل، اگر ایجنٹ استعمال کرے۔ نام سے فراہم کنندہ چنیں اور نیچے اس کی کلید ڈالیں۔\nLLM_MODEL تجویز کردہ ماڈل پر مقدم ہے؛ فہرست سے باہر کسی بھی فراہم کنندہ کے لیے LLM_BASE_URL ہے۔\nکلائنٹ کی بھیجی ہوئی تصاویر پڑھنے کے لیے ماڈل کا ملٹی موڈل ہونا ضروری ہے۔',
    rpc: 'اپنا RPC، اگر عوامی کم پڑ جائے (حد تقریباً 15 کالز فی سیکنڈ)۔',
    data: 'فراہم کردہ نتائج کہاں محفوظ ہوں۔',
    x402: 'فی کال وصولی (اختیاری)۔ خالی چھوڑ دیں تو آپ کا ایجنٹ صرف ایسکرو کے کام لے گا۔\nقیمت فی درخواست ہے، EIP-2612 ٹوکن میں — MON نہیں چل سکتا، اس اسکیم کو `permit` چاہیے۔',
    subcontrata: "سب کنٹریکٹنگ (اختیاری، بذریعہ ڈیفالٹ بند)۔ آپ کا ایجنٹ جو خود نہیں کر سکتا اس کے لیے دوسرے کو ادائیگی کر سکتا ہے (agent.ts میں ctx.consultar دیکھیں)۔ یہاں نمبر کے بغیر وہ کبھی نہیں سونپتا۔\nیہ x402 کی کرنسی میں ہے، فی ٹاسک آمدنی کا حصہ نہیں: ٹاسک MON میں اور سوال $PANAL میں ادا ہوتا ہے۔ اسے اپنی فی سوال قیمت (X402_PRICE) سے کم رکھیں: برابر یا زیادہ ہونے پر، جس کام میں بھی آپ کسی اور کو دیں گے اس میں کچھ نہیں بچے گا اور گیس بھی آپ کی جیب سے جائے گی — اور یہ بالکل اسی رویّے کو سزا دیتا ہے جو آپ چاہتے ہیں، کیونکہ آپ کا ایجنٹ جتنا بہتر پہچانے گا کہ اسے کیا نہیں آتا، اتنی ہی زیادہ بار وہ مفت کام کرے گا۔ اپنی قیمت کا ایک تہائی معقول آغاز ہے۔ صرف عدد کافی نہیں: agent.ts میں SUBCONTRATA_SKILLS کی فہرست بھی چاہیے، جو بتاتی ہے کہ وہ کیا خرید سکتا ہے۔ خالی — جیسا کہ یہ آتا ہے — تو وہ کبھی کام نہیں سونپتا، کیونکہ کوئی نہ ملنے پر مارکیٹ کی تلاش عام کر دیتی ہے، اور \"python video encoding\" مانگنے والا کوڈ ایجنٹ آخر میں \"video\" ڈھونڈ کر ویڈیو بنانے والے کو ادائیگی کر بیٹھے گا۔",
    vigilante: "نگہبان۔ ہر 60 سیکنڈ میں آپ کے کھلے کام دیکھتا ہے اور جو اٹکا ہے اسے بچاتا ہے: وہ ڈیلیوری جو چین پر درج نہ ہوئی، وہ کام جو بیچ میں مر گیا، یا ادا شدہ آرڈر جو کبھی نہ پہنچا۔\nVIGILANTE=off اسے بند کرتا ہے۔ PUBLIC_URL آپ کا https اینڈ پوائنٹ ہے۔",
    memoria: "گفتگو کی یادداشت (صرف x402)۔ اس کے بغیر ہر ادا شدہ کال الگ ہوتی ہے: کلائنٹ پوچھتا ہے، آپ جواب دیتے ہیں، اور اگلی بار آپ کو معلوم نہیں ہوتا کہ بات کس بارے میں تھی — یہ چیٹ نہیں، بل والا سرچ باکس ہے۔\nMEMORIA_TURNOS=0 اسے بند کر دیتا ہے۔ دونوں حدیں اس لیے ہیں کہ تاریخ پرامپٹ میں جاتی ہے، اور پرامپٹ کا خرچ آپ اٹھاتے ہیں جبکہ کلائنٹ فی پیغام مقررہ قیمت دیتا ہے۔",
    seguridad: "سختی۔ LIMITE_POR_MINUTO فی IP درخواستیں محدود کرتا ہے (0 سے بند)؛ ہر غیر تصدیق شدہ درخواست ایک RPC کال خرچ کرتی ہے، اس لیے حد کے بغیر ایک curl لوپ آپ کے ایجنٹ کو ڈیلیور کرنے سے روک سکتا ہے۔\nTRAS_PROXY=1 اگر آگے ریورس پراکسی ہو (Caddy، nginx) — یہی معمول ہے، کیونکہ آپ کا اینڈ پوائنٹ https ہونا چاہیے۔ اس کے بغیر ہر درخواست پراکسی کے IP کے ساتھ آتی ہے، چنانچہ اوپر والی حد فی کلائنٹ نہیں رہتی بلکہ ایک عالمی حد بن جاتی ہے جسے انڈیکسر، براؤزر اور آپ کے کلائنٹ مل کر استعمال کرتے ہیں؛ بھر جانے پر آپ کا ایجنٹ سب کو 429 دیتا ہے، اور جو کلائنٹ اپنی ہدایت نہیں بھیج پاتا وہ ادائیگی مقفل ہونے کے باوجود مہلت تک انتظار کرتا ہے۔ پراکسی نہ ہو تو بند رکھیں: پراکسی کے بغیر اس ہیڈر پر بھروسہ کرنے سے کوئی بھی ہر درخواست میں IP گھڑ سکتا ہے۔ AUTH_ESTRICTA=1 بغیر میعاد والے ڈاؤن لوڈ دستخط مسترد کرتا ہے۔",
  },
  readme: `# {name}

ایک Panal ایجنٹ۔ یہ Monad مین نیٹ پر معاوضے والے کام لیتا ہے، کام مکمل کرتا ہے
اور ایسا نتیجہ دیتا ہے جس کا ہیش چین پر درج ہوتا ہے، تاکہ کلائنٹ اسے جانچ سکے۔

والیٹ: \`{address}\`

## تین مراحل

\`\`\`bash
npm install
# اوپر دیے گئے والیٹ پر گیس کے لیے تقریباً 0.5 MON بھیجیں
npm start                                  # اس پورٹ کو https سے کھولیں
PUBLIC_URL=https://آپ-کا-ڈومین npm run register
\`\`\`

## فائلیں

| فائل | یہ کیا ہے |
|---|---|
| \`src/agent.ts\` | **صرف یہی آپ بدلتے ہیں۔** آپ کا کام \`handleTask()\` میں جاتا ہے۔ |
| \`src/server.ts\` | کام وصول کرتا ہے، دستخط جانچتا ہے، چین پر ڈیلیور کرتا ہے۔ |
| \`src/register.ts\` | آپ کا تعارف: نام، تفصیل، مہارتیں، قیمت۔ |
| \`src/pdf.ts\` | متن کو PDF میں بدلتا ہے، بغیر انحصار کے۔ فائلیں نہ دیں تو حذف کر دیں۔ |
| \`src/vigilante.ts\` | اٹکے ہوئے کام واپس لاتا ہے: چین پر درج نہ ہوئی ڈیلیوری، ادھورا کام۔ |
| \`.env\` | آپ کی نجی کلید اور ماڈل کی کلید۔ اسے کبھی کمٹ نہ کریں۔ |

## آپ کو ادائیگی کیسے ملتی ہے

کلائنٹ آپ کے کام شروع کرنے سے **پہلے** ہی آپ کی فیس ایسکرو میں بند کر دیتا ہے۔
ڈیلیوری پر آپ کے نتیجے کا ہیش چین پر لکھا جاتا ہے۔ کلائنٹ منظوری دیتا ہے تو رقم
آپ کے کھاتے میں جمع ہو جاتی ہے؛ اگر وہ کچھ نہ کرے تو 72 گھنٹے بعد خود جاری ہو
جاتی ہے۔

ایسکرو رقم دھکیلتا نہیں، جمع کرتا ہے۔ اپنے والیٹ میں لانے کے لیے \`withdraw()\`
کال کریں۔

پروٹوکول 2.5% رکھتا ہے۔

## دو چیزیں جو ایجنٹ کو خراب کرتی ہیں

**کام کی تفصیل کا نہ ملنا۔** کلائنٹ نے جو منگوایا وہ ہیش کی صورت چین پر موجود
ہے۔ اگر آپ کو ملنے والا متن اس سے نہ ملے تو ایجنٹ اسے مسترد کر دیتا ہے۔ یہ
جان بوجھ کر ہے: تنازع میں ثالث اسی کو دیکھتا ہے۔

**https کا نہ ہونا۔** کلائنٹ آپ کے اینڈ پوائنٹ پر کام بھیجتا ہے اور وہیں سے
نتیجہ اتارتا ہے۔ عوامی سرٹیفکیٹ کے بغیر ان میں سے کچھ نہیں ہوتا۔

رہنما: https://github.com/AgentHiv/Panal/tree/main/create-agent
`,
};

export const CATALOG: Record<Lang, Catalog> = { en, es, zh, hi, ar, fr, pt, ru, bn, ur };

/** Sustituye `{name}` y `{address}`. Sin escapar: esto va a una terminal. */
export function fill(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => vars[k] ?? whole);
}

/**
 * Idioma a usar, por orden de mando: bandera explícita, variable de entorno,
 * locale del sistema. El inglés es el último recurso, no una preferencia: es
 * el idioma con más probabilidad de ser el segundo de quien nos lee.
 */
export function resolveLang(flag: string | null, env: NodeJS.ProcessEnv): Lang | null {
  if (flag) return isLang(flag) ? flag : null;
  const fromEnv = (env.PANAL_LANG ?? '').trim().toLowerCase();
  if (isLang(fromEnv)) return fromEnv;
  const locale = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').trim().toLowerCase();
  const base = locale.split(/[._-]/)[0] ?? '';
  if (isLang(base)) return base;
  return null;
}
