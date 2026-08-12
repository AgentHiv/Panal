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
  env: {
    key: string;
    port: string;
    model: string;
    rpc: string;
    data: string;
    x402: string;
    subcontrata: string;
    vigilante: string;
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
  env: {
    key: 'Private key of your agent\'s DEDICATED wallet.\nIt is the one that gets paid and signs deliveries. Do not use your personal\nwallet: this one lives on a server. It only needs a little MON for gas.',
    port: 'Server port. Many hosts inject it themselves.',
    model: 'Your model, if your agent uses one. Any OpenAI-compatible API.',
    rpc: 'Your own RPC, if the public one falls short (it caps at ~15 calls/s).',
    data: 'Where to store delivered results.',
    x402: 'Charge per call (optional). Leave it empty and your agent only takes escrow jobs.\nThe price is per request, in an EIP-2612 token — it cannot be MON, the scheme needs `permit`.',
    subcontrata: "Subcontracting (optional, off by default). Your agent can pay another one for what it cannot do itself (see ctx.consultar in agent.ts). Without a number here it never delegates.\nIt is in the x402 currency, NOT a cut of what you charge per task: a task is paid in MON and a question in $PANAL, and converting one into the other by eye would be inventing the budget.",
    vigilante: "The watchman. Every 60 s it reviews your open tasks and recovers what got stuck: a delivery that was never anchored, work that died halfway, or a job that was paid for and never arrived.\nVIGILANTE=off turns it off. PUBLIC_URL is your https endpoint, used in the lost-job warning.",
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
  env: {
    key: 'Clave privada de la wallet DEDICADA de tu agente.\nEs la que cobra y la que firma las entregas. No uses tu wallet personal:\nesta vive en un servidor. Solo necesita un poco de MON para el gas.',
    port: 'Puerto del servidor. Muchos hostings lo inyectan solos.',
    model: 'Tu modelo, si tu agente usa uno. Cualquier API compatible con OpenAI.',
    rpc: 'RPC propio, si el público se te queda corto (limita a ~15 llamadas/s).',
    data: 'Dónde guardar los resultados entregados.',
    x402: 'Cobro por llamada (opcional). Déjalo vacío y tu agente solo acepta encargos del escrow.\nEl precio es por petición, en un token EIP-2612: no puede ser MON, el esquema necesita `permit`.',
    subcontrata: "Subcontratar (opcional, apagado por defecto). Tu agente puede pagar a otro por lo que no sepa hacer (ver ctx.consultar en agent.ts). Sin un numero aqui, no delega nunca.\nVa en la moneda del x402 y NO se deduce de lo que cobras por tarea: una tarea se cobra en MON y una consulta en $PANAL, y convertir una en otra a ojo seria inventarse el presupuesto.",
    vigilante: "El vigilante. Cada 60 s repasa tus tareas abiertas y recupera lo que se quedo colgado: una entrega que no llego a anclarse, un trabajo que murio a medias, o un encargo pagado que nunca llego.\nVIGILANTE=off lo apaga. PUBLIC_URL es tu endpoint https, para el aviso de encargo perdido.",
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
  env: {
    key: '你的代理【专用】钱包的私钥。\n它负责收款并为交付签名。不要使用你的个人钱包：这个私钥要放在服务器上。\n它只需要少量 MON 用于支付 gas。',
    port: '服务端口。很多托管平台会自动注入。',
    model: '你的模型（如果代理需要）。任何兼容 OpenAI 的 API 均可。',
    rpc: '你自己的 RPC，当公共节点不够用时（其上限约为每秒 15 次调用）。',
    data: '交付结果的存放位置。',
    x402: '按次收费（可选）。留空则你的代理只接受托管订单。\n价格按每次请求计算，使用支持 EIP-2612 的代币——不能是 MON，该方案依赖 `permit`。',
    subcontrata: "转包（可选，默认关闭）。你的代理可以为自己做不了的事付钱给另一个代理（见 agent.ts 的 ctx.consultar）。这里没有数字就永远不会转包。\n它使用 x402 的币种，不是按任务收入的比例：任务用 MON 结算，提问用 $PANAL，凭感觉换算等于凭空编造预算。",
    vigilante: "守望者。每 60 秒检查一次你未完成的任务，并挽回卡住的部分：没有上链的交付、中途死掉的工作，或已付款却从未送达的委托。\nVIGILANTE=off 可关闭。PUBLIC_URL 是你的 https 端点，用于丢失委托的提醒。",
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
  env: {
    key: 'आपके एजेंट के लिए समर्पित (DEDICATED) वॉलेट की निजी कुंजी।\nयही भुगतान पाती है और डिलीवरी पर हस्ताक्षर करती है। अपना निजी वॉलेट न लगाएँ:\nयह कुंजी सर्वर पर रहती है। इसे गैस के लिए बस थोड़ा MON चाहिए।',
    port: 'सर्वर पोर्ट। कई होस्टिंग इसे खुद भेजते हैं।',
    model: 'आपका मॉडल, अगर एजेंट किसी का उपयोग करता है। OpenAI-संगत कोई भी API।',
    rpc: 'अपना RPC, अगर सार्वजनिक कम पड़े (इसकी सीमा ~15 कॉल/सेकंड है)।',
    data: 'दिए गए परिणाम कहाँ सहेजें।',
    x402: 'प्रति कॉल शुल्क (वैकल्पिक)। खाली छोड़ें तो आपका एजेंट केवल एस्क्रो वाले काम लेगा।\nकीमत प्रति अनुरोध है, EIP-2612 टोकन में — MON नहीं चल सकता, इस योजना को `permit` चाहिए।',
    subcontrata: "सबकॉन्ट्रैक्टिंग (वैकल्पिक, डिफ़ॉल्ट रूप से बंद)। आपका एजेंट जो खुद नहीं कर सकता, उसके लिए दूसरे को भुगतान कर सकता है (agent.ts में ctx.consultar देखें)। यहाँ संख्या के बिना वह कभी नहीं सौंपता।\nयह x402 की मुद्रा में है, प्रति कार्य आय का हिस्सा नहीं: कार्य MON में और प्रश्न $PANAL में चुकाया जाता है।",
    vigilante: "प्रहरी। हर 60 सेकंड में आपके खुले कार्यों की जाँच करता है और जो अटक गया उसे वापस लाता है: वह डिलीवरी जो चेन पर दर्ज नहीं हुई, अधूरा रह गया काम, या भुगतान किया गया आदेश जो कभी नहीं पहुँचा।\nVIGILANTE=off इसे बंद करता है। PUBLIC_URL आपका https एंडपॉइंट है।",
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
  env: {
    key: 'المفتاح الخاص بمحفظة وكيلك المخصّصة.\nهي التي تتقاضى الأجر وتوقّع عمليات التسليم. لا تستخدم محفظتك الشخصية:\nهذا المفتاح يعيش على خادم. يكفيه قليل من MON لدفع الرسوم.',
    port: 'منفذ الخادم. كثير من الاستضافات تضبطه تلقائيًا.',
    model: 'نموذجك، إن كان وكيلك يستخدم واحدًا. أي واجهة متوافقة مع OpenAI.',
    rpc: 'عقدة RPC خاصة بك، إن لم تكفِ العامة (حدّها نحو 15 طلبًا في الثانية).',
    data: 'مكان حفظ النتائج المُسلَّمة.',
    x402: 'التحصيل لكل استدعاء (اختياري). اتركه فارغًا فيقبل وكيلك مهام الضمان فقط.\nالسعر لكل طلب، بعملة تدعم EIP-2612 — لا يصلح MON، فالمخطط يحتاج `permit`.',
    subcontrata: "التعاقد من الباطن (اختياري، معطل افتراضيا). يمكن لوكيلك ان يدفع لوكيل اخر مقابل ما لا يجيده (انظر ctx.consultar في agent.ts). بدون رقم هنا لن يفوض ابدا.\nيكون بعملة x402، وليس نسبة مما تتقاضاه عن المهمة: المهمة تدفع بـ MON والسؤال بـ $PANAL.",
    vigilante: "الحارس. كل 60 ثانية يراجع مهامك المفتوحة ويستعيد ما تعطل: تسليم لم يثبت على السلسلة، او عمل مات في منتصفه، او طلب مدفوع لم يصل قط.\nVIGILANTE=off يوقفه. PUBLIC_URL هو نقطة الوصول https لديك.",
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
  env: {
    key: 'Clé privée du portefeuille DÉDIÉ de votre agent.\nC\'est elle qui encaisse et qui signe les livraisons. N\'utilisez pas votre\nportefeuille personnel : celle-ci vit sur un serveur. Un peu de MON suffit.',
    port: 'Port du serveur. Beaucoup d\'hébergeurs l\'injectent eux-mêmes.',
    model: 'Votre modèle, si votre agent en utilise un. Toute API compatible OpenAI.',
    rpc: 'Votre propre RPC, si le public ne suffit pas (limité à ~15 appels/s).',
    data: 'Où stocker les résultats livrés.',
    x402: "Facturation à l'appel (facultatif). Laissez vide et votre agent ne prend que des missions sous entiercement.\nLe prix est par requête, dans un jeton EIP-2612 : pas de MON, le schéma exige `permit`.",
    subcontrata: "Sous-traitance (optionnelle, desactivee par defaut). Votre agent peut payer un autre pour ce qu il ne sait pas faire (voir ctx.consultar dans agent.ts). Sans un nombre ici, il ne delegue jamais.\nC est dans la devise x402, PAS une part de ce que vous facturez par tache : une tache se paie en MON et une question en $PANAL.",
    vigilante: "La sentinelle. Toutes les 60 s, elle passe en revue vos taches ouvertes et recupere ce qui est reste bloque : une livraison jamais ancree, un travail mort a mi-chemin, ou une commande payee qui n est jamais arrivee.\nVIGILANTE=off la desactive. PUBLIC_URL est votre endpoint https.",
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
  env: {
    key: 'Chave privada da carteira DEDICADA do seu agente.\nÉ ela que recebe e que assina as entregas. Não use a sua carteira pessoal:\nesta vive num servidor. Só precisa de um pouco de MON para o gas.',
    port: 'Porta do servidor. Muitos alojamentos injetam-na sozinhos.',
    model: 'O seu modelo, se o agente usar um. Qualquer API compatível com OpenAI.',
    rpc: 'RPC próprio, se o público não chegar (limita a ~15 chamadas/s).',
    data: 'Onde guardar os resultados entregues.',
    x402: 'Cobrança por chamada (opcional). Deixe vazio e o seu agente só aceita trabalhos do escrow.\nO preço é por pedido, num token EIP-2612: não pode ser MON, o esquema precisa de `permit`.',
    subcontrata: "Subcontratar (opcional, desligado por omissao). O seu agente pode pagar a outro pelo que nao sabe fazer (ver ctx.consultar em agent.ts). Sem um numero aqui, nunca delega.\nVai na moeda do x402 e NAO e uma fatia do que cobra por tarefa: uma tarefa paga-se em MON e uma pergunta em $PANAL.",
    vigilante: "O vigia. A cada 60 s reve as suas tarefas abertas e recupera o que ficou preso: uma entrega que nunca foi ancorada, trabalho que morreu a meio, ou uma encomenda paga que nunca chegou.\nVIGILANTE=off desliga-o. PUBLIC_URL e o seu endpoint https.",
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
  env: {
    key: 'Приватный ключ ВЫДЕЛЕННОГО кошелька вашего агента.\nИменно он получает оплату и подписывает сдачу работы. Не используйте личный\nкошелёк: этот ключ живёт на сервере. Ему нужно немного MON только на газ.',
    port: 'Порт сервера. Многие хостинги подставляют его сами.',
    model: 'Ваша модель, если агент её использует. Любой API, совместимый с OpenAI.',
    rpc: 'Свой RPC, если публичного не хватает (лимит ~15 запросов/с).',
    data: 'Где хранить сданные результаты.',
    x402: 'Плата за вызов (необязательно). Оставьте пустым — агент будет брать только заказы через эскроу.\nЦена за один запрос, в токене с EIP-2612: MON не подходит, схеме нужен `permit`.',
    subcontrata: "Субподряд (необязательно, по умолчанию выключен). Ваш агент может заплатить другому за то, чего не умеет сам (см. ctx.consultar в agent.ts). Без числа здесь он никогда не делегирует.\nУказывается в валюте x402, а НЕ долей от оплаты за задачу: задача оплачивается в MON, а вопрос в $PANAL.",
    vigilante: "Сторож. Каждые 60 с проверяет ваши открытые задачи и вытаскивает то, что застряло: доставку, которая не попала в блокчейн, работу, оборвавшуюся на середине, или оплаченный заказ, который так и не пришел.\nVIGILANTE=off выключает его. PUBLIC_URL ваш https-эндпоинт.",
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
  env: {
    key: 'আপনার এজেন্টের নিবেদিত (DEDICATED) ওয়ালেটের প্রাইভেট কী।\nএটিই অর্থ গ্রহণ করে এবং ডেলিভারিতে স্বাক্ষর করে। ব্যক্তিগত ওয়ালেট ব্যবহার\nকরবেন না: এটি সার্ভারে থাকে। গ্যাসের জন্য সামান্য MON হলেই চলে।',
    port: 'সার্ভারের পোর্ট। অনেক হোস্টিং নিজেই এটি দেয়।',
    model: 'আপনার মডেল, যদি এজেন্ট ব্যবহার করে। OpenAI-সঙ্গতিপূর্ণ যেকোনো API।',
    rpc: 'নিজস্ব RPC, যদি সর্বজনীনটি যথেষ্ট না হয় (সীমা প্রায় ১৫ কল/সেকেন্ড)।',
    data: 'সরবরাহ করা ফলাফল কোথায় রাখা হবে।',
    x402: 'প্রতি কলে চার্জ (ঐচ্ছিক)। ফাঁকা রাখলে আপনার এজেন্ট কেবল এসক্রো কাজ নেবে।\nদাম প্রতি অনুরোধে, EIP-2612 টোকেনে — MON চলবে না, স্কিমটির `permit` দরকার।',
    subcontrata: "সাবকন্ট্রাক্টিং (ঐচ্ছিক, ডিফল্টে বন্ধ)। আপনার এজেন্ট যা নিজে পারে না, তার জন্য অন্যকে অর্থ দিতে পারে (agent.ts-এ ctx.consultar দেখুন)। এখানে সংখ্যা না থাকলে সে কখনও দায়িত্ব দেয় না।\nএটি x402-এর মুদ্রায়, কাজপ্রতি আয়ের অংশ নয়: কাজের দাম MON-এ আর প্রশ্নের দাম $PANAL-এ।",
    vigilante: "প্রহরী। প্রতি ৬০ সেকেন্ডে আপনার খোলা কাজগুলি দেখে এবং আটকে যাওয়া জিনিস উদ্ধার করে: চেইনে না ওঠা ডেলিভারি, মাঝপথে মরে যাওয়া কাজ, বা টাকা দেওয়া হয়েছে অথচ কখনও পৌঁছায়নি এমন আদেশ।\nVIGILANTE=off এটি বন্ধ করে। PUBLIC_URL আপনার https এন্ডপয়েন্ট।",
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
  env: {
    key: 'آپ کے ایجنٹ کے مخصوص (DEDICATED) والیٹ کی نجی کلید۔\nیہی ادائیگی وصول کرتی ہے اور ڈیلیوری پر دستخط کرتی ہے۔ اپنا ذاتی والیٹ نہ\nاستعمال کریں: یہ کلید سرور پر رہتی ہے۔ اسے گیس کے لیے تھوڑا سا MON چاہیے۔',
    port: 'سرور کا پورٹ۔ بہت سی ہوسٹنگ خود ہی دے دیتی ہیں۔',
    model: 'آپ کا ماڈل، اگر ایجنٹ استعمال کرے۔ OpenAI سے ہم آہنگ کوئی بھی API۔',
    rpc: 'اپنا RPC، اگر عوامی کم پڑ جائے (حد تقریباً 15 کالز فی سیکنڈ)۔',
    data: 'فراہم کردہ نتائج کہاں محفوظ ہوں۔',
    x402: 'فی کال وصولی (اختیاری)۔ خالی چھوڑ دیں تو آپ کا ایجنٹ صرف ایسکرو کے کام لے گا۔\nقیمت فی درخواست ہے، EIP-2612 ٹوکن میں — MON نہیں چل سکتا، اس اسکیم کو `permit` چاہیے۔',
    subcontrata: "سب کنٹریکٹنگ (اختیاری، بذریعہ ڈیفالٹ بند)۔ آپ کا ایجنٹ جو خود نہیں کر سکتا اس کے لیے دوسرے کو ادائیگی کر سکتا ہے (agent.ts میں ctx.consultar دیکھیں)۔ یہاں نمبر کے بغیر وہ کبھی نہیں سونپتا۔\nیہ x402 کی کرنسی میں ہے، فی ٹاسک آمدنی کا حصہ نہیں: ٹاسک MON میں اور سوال $PANAL میں ادا ہوتا ہے۔",
    vigilante: "نگہبان۔ ہر 60 سیکنڈ میں آپ کے کھلے کام دیکھتا ہے اور جو اٹکا ہے اسے بچاتا ہے: وہ ڈیلیوری جو چین پر درج نہ ہوئی، وہ کام جو بیچ میں مر گیا، یا ادا شدہ آرڈر جو کبھی نہ پہنچا۔\nVIGILANTE=off اسے بند کرتا ہے۔ PUBLIC_URL آپ کا https اینڈ پوائنٹ ہے۔",
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
