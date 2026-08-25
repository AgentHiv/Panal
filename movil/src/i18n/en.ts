/**
 * Panal — the app's text, in English.
 *
 * Translated from `es.ts`, which is the original. Declaring this `: Textos`
 * is what keeps it honest: leave a line out and the build stops, instead of a
 * gap that only shows up on somebody else's phone.
 *
 * Names stay as they are — Panal, MON, $PANAL, Monad, WalletConnect, x402,
 * nad.fun — and so does the plain, unsold tone of the Spanish. Nothing here
 * promises more than the screen does.
 */

import type { Textos } from '~/i18n/es';

export const en: Textos = {
  comun: {
    cancelar: 'Cancel',
    listo: 'Done',
    cerrar: 'Close',
    atras: 'Back',
    borrar: 'Delete',
    ahoraNo: 'Not now',
    copiar: 'Copy',
    copiada: 'Copied',
    copiarDireccion: 'Copy address',
    conectarWallet: 'Connect wallet',
    conectando: 'Connecting…',
    desconectar: 'Disconnect',
    tuDireccion: 'Your address',
    suDireccion: 'Its address',
    verEnElExplorador: 'See it on the explorer',
    menu: 'Menu',
    sinNombre: 'Unnamed',
    walletDelTelefono: 'The wallet on this phone',
    llaveroCerrado: 'The keyring is locked. Open it with your PIN.',
    abriendo: 'Opening…',
  },

  pestanas: {
    chats: 'Chats',
    mercado: 'Market',
    archivo: 'Records',
    saldo: 'Balance',
  },

  menu: {
    sinWallet: 'No wallet connected',
    firmaAqui: 'Signs on this phone',
    firmaFuera: 'Signs in your wallet',
    llavero: 'Your keyring',
    agentes: 'Your agents',
    cartera: 'Your portfolio',
    avisos: 'Phone notifications',
    idioma: 'Language',
    red: (nombre: string, id: number) => `Panal · ${nombre} (${id})`,
    version: (v: string) => `Version ${v}`,
    sinVersion: 'Development build',
  },

  barraRed: {
    otraRed: 'Your wallet is on another network',
    cambiar: (red: string) => `Switch to ${red}`,
  },

  avisoFirma: {
    titulo: 'Sign it in your wallet',
    conEnlace: "The request is already there. If your wallet didn't open by itself, open it and approve.",
    sinEnlace: 'The request is already there. Switch to your wallet and approve it; this will still be here.',
    abrir: 'Open my wallet',
  },

  hojaWallet: {
    titulo: 'Connect your wallet',
    entradilla: 'Your wallet is your account. Panal stores no keys and asks for no email.',
    deEsteTelefono: 'The one on this phone',
    crearAqui: 'Create a wallet here',
    crearAquiPie: 'Generated on the phone, and it signs without leaving the app. One minute.',
    dentroPie:
      "Signs right here, nothing else opens. What you approve is what Panal shows you: there's no second screen repeating it.",
    oLaQueYaUsas: 'or the one you already use',
    fueraPie:
      'Your wallet opens, you approve there and come back. Every signature takes you out of Panal, but your wallet shows you what you sign.',
    abrirMiWallet: 'Open my wallet',
    abrirMiWalletPie: 'Whichever wallet you have installed opens, you approve there and come back here.',
    copiarEnlace: 'Copy the link',
    enlaceCopiado: 'Link copied',
    copiarPie: 'To paste it by hand into your wallet, under "scan" or "connect".',
    preparando: 'Preparing the connection…',
    noSePudo: "Couldn't connect",
    sinWalletConnect:
      'This build was compiled without WalletConnect, so there is no way to open a wallet from here. The APK needs to be built with',
    usarOtra: 'Use another',
    pinTitulo: 'Your keyring PIN. With it, signing stops taking you out of the app.',
    fueraEnAgentes:
      'Administering an agent means signing with the agent’s own wallet. That one connects from «Your agents», in the menu.',
  },

  saldo: {
    titulo: 'Balance',
    conectaTitulo: 'Connect your wallet',
    conectaTexto: 'It is your account and your balance at once. No sign-up, no email, no password to remember.',
    panalParaQue: 'Pays for every message you send an agent.',
    panalPie: 'Talking costs no gas: in x402 you sign and whoever charges sends the transaction.',
    monParaQue: 'Pays for escrowed jobs, and the gas to lock them.',
    monPie: 'Without MON you can talk, but not commission work.',
    dondeSeCompra:
      '$PANAL is traded on nad.fun, and you bring MON here from wherever you already have it. Panal sells neither.',
    llavero: 'Your keyring',
    llaveroPie:
      "Wallets on this phone: see their balance, send, receive and bring in ones you already have. The key is encrypted with a PIN and never leaves.",
    agentes: 'Your agents',
    agentesPie: 'Follow one or run your own: withdraw, price, pause and profile.',
    desconectar: (dir: string) => `Disconnect ${dir}`,
    otraRedTitulo: 'Wallet on another network',
    otraRedTexto: (red: string) =>
      `Panal lives on ${red}. While your wallet is on another network nothing can be signed.`,
  },

  llavero: {
    titulo: 'Your keyring',
    vacio: 'Empty, for now',
    cuantas: (n: number) => `${n} ${n === 1 ? 'wallet' : 'wallets'} on this phone`,
    bloquear: 'Lock the keyring',
    refrescar: 'Check the balances again',
    crear: 'Create one',
    creando: 'Creating…',
    crearPie: 'Generated here and seen by nobody else',
    traer: 'Bring one in',
    traerPie: 'With its words or its private key',
    sinCopia: 'No backup — lose the phone and it is gone',
    noSePudoLeer: "Couldn't read the balance. That's the network, not the wallet: whatever is inside is still there.",
    noSePudoGuardar: "Couldn't save the wallet. The phone may be out of room.",
    noSePudoCrear: "Couldn't create the keyring on this phone.",
    pinTitulo: 'Set a PIN',
    pinOtraVez: 'Again, to confirm',
    pinExplicacion:
      'Six digits. They encrypt the wallets you create here, and there is no way to recover it: forget it and they are gone.',
    pinRepite: 'Type the same six digits.',
    pinNoCoinciden: "They don't match. Start again.",
    pinMalo: "That's not the PIN",
    bloqueadoTitulo: 'Your keyring',
    bloqueadoExplicacion: 'The wallets you keep on this phone. Nothing leaves here.',
    hastaDonde: 'How far this PIN goes',
    hastaDondeTexto:
      "The keys are encrypted with it inside the app's private storage: no other app reads them, and they no longer travel in Google's backup. What the PIN does NOT stop is somebody with your phone unlocked and time to spare. That needs the phone's secure chip, and the WebView cannot reach it without writing native code. Keep here what you use, not what you keep.",
    palabrasTitulo: (n: number) => `Your ${n} words`,
    claveTitulo: 'Its private key',
    palabrasTexto: (nombre: string) =>
      `Write them on paper and keep them off the phone. They are the only way to recover ${nombre} if you lose it — nobody else has a copy, not even Panal.`,
    claveTexto: (nombre: string) =>
      `This controls ${nombre} from anywhere. Keep it where you keep what matters, not in a photo.`,
    peligro:
      'Do not keep it in a photo, in notes, or in a chat. Whoever has it can empty this wallet from anywhere, without the phone and without the PIN.',
    yaApuntadas: 'I have written them down',
    mandar: 'Send',
    recibir: 'Receive',
    vaciaPie: 'Nothing to send yet. Tap "Receive" to see where to send it.',
    verPalabras: 'See the 12 words',
    verClave: 'See the private key',
    importada: 'Brought in from outside. It still exists where it was: deleting it here does not delete it there.',
    creadaAqui: 'Created on this phone. Its backup is its 12 words and there is no other.',
    borrarDelTelefono: 'Delete from the phone',
    seguro: 'Sure?',
    sinApuntar: 'You have not written down its 12 words',
    seguroTexto:
      'It leaves this phone. With its words — or its key — you recover it in any wallet; without them, you do not.',
    sinApuntarTexto: 'Delete it now and whatever is inside is recoverable by nobody. Not you, not Panal.',
  },

  enviar: {
    titulo: (nombre: string) => `Send from ${nombre}`,
    tienes: (cantidad: string, moneda: string) => `You have ${cantidad} ${moneda} in this wallet.`,
    aQuien: 'To whom',
    cuanto: 'How much',
    pegar: 'Paste',
    todo: 'All',
    todoPie: '"All" leaves a sliver of MON for the network fee. Without it the transaction does not go out.',
    continuar: 'Continue',
    repasa: 'Check it over',
    repasaTexto:
      'It is signed with this phone\'s key, so no other app is going to open and show it to you. This is what gets sent.',
    aEstaDireccion: 'To this address',
    cantidad: 'Amount',
    desde: 'From',
    red: 'Network',
    comision: 'Network fee',
    comisionPie: 'Paid by this wallet',
    enMon: 'In MON',
    sinVuelta:
      'Once sent, nobody can give it back, not Panal and not anyone. If that address is wrong, the money stays wherever it lands.',
    firmar: 'Sign and send',
    mandando: 'Sending…',
    mandado: 'Sent',
    a: (dir: string) => `to ${dir}`,
    noCierres:
      'Do not close the app. If it takes a while, the transaction is already sent: the link above shows it on the explorer.',
    revertida: 'The network rejected it on execution. Nothing moved.',
  },

  recibir: {
    titulo: (nombre: string) => `Top up ${nombre}`,
    texto:
      'Send MON or $PANAL to this address from wherever you already have them: your other wallet, an exchange, another person.',
    compartir: 'Share',
    redAviso: (red: string, id: number) =>
      `It has to arrive over ${red} (${id}). The same address exists on other networks, and anything arriving over another one does not show up here and cannot be recovered from the app.`,
    gasAviso:
      'Leave some MON even if you only plan to move $PANAL: the network fee is paid in MON, and a wallet with $PANAL and no MON cannot send anything.',
  },

  importar: {
    titulo: 'Bring in a wallet',
    texto:
      'Paste its 12 or 24 words, or its private key. It is stored encrypted with the same PIN as the rest of the keyring.',
    etiqueta: 'Words or key',
    hueco: 'abandon ability able…  ·  or  0x…',
    pareceClave: 'Looks like a private key.',
    parecenPalabras: 'Looks like recovery words.',
    comoLaLlamas: 'What you call it',
    huecoNombre: 'Imported',
    aviso:
      'Only type this if the phone is yours and nobody is watching. Whoever has these words can empty the wallet from anywhere, without the phone and without the PIN.',
    boton: 'Bring it into the keyring',
    comprobando: 'Checking…',
    noSePudo: "Couldn't save it on this phone.",
    noSePudoAbrir: "Couldn't open that wallet.",
  },

  chats: {
    titulo: 'Chats',
    buscarAgente: 'Find an agent',
    tu: 'You: ',
    encargoNumero: (id: string) => `Job #${id}`,
    entregado: 'Delivered · your turn to approve',
    enMarcha: 'Job under way',
  },

  mercado: {
    titulo: 'Market',
    buscar: 'Find an agent',
    limpiar: 'Clear',
    sinAgentes: 'No agent is registered on the chain yet.',
    sinResultados: 'None is called that or does that.',
    porEncargo: 'per job',
    sinPrecio: 'no job price',
    tareas: (n: number) => `· ${n} ${n === 1 ? 'task' : 'tasks'}`,
    sinValoraciones: '· no reviews',
  },

  archivo: {
    titulo: 'Your records',
    subtitulo: "What the chain does not keep about each job",
    conectaTitulo: 'Connect your wallet',
    conectaTexto: 'Records belong to an address: they are its jobs and its conversations.',
    holgado: 'The archive has room',
    apretado: (quedan: number) => `${quedan} left before it starts losing them`,
    deTantos: (n: number, tope: number) => `${n} of ${tope}`,
    salud: (briefsTope: number, hilosTope: number, hilos: number) =>
      `The app keeps ${briefsTope} briefs and, once there, drops the oldest without warning. Threads have their own cap: ${hilosTope} conversations (${hilos} stored). And all of this lives on this phone: clearing the app's data loses it, and changing phones does not bring it along.`,
    sacarCopia: 'Export a copy of everything',
    preparando: 'Preparing…',
    sacarCopiaPie: 'A file that opens without the app and does not expire',
    copiaLista: (donde: string) => `Copy ready in ${donde}.`,
    copiaFallo: (porque: string) => `Couldn't export the copy: ${porque}`,
    todos: (n: number) => `All · ${n}`,
    completos: (n: number) => `Complete · ${n}`,
    conHuecos: (n: number) => `With gaps · ${n}`,
    leyendo: 'Reading the chain…',
    sinNada:
      'You have not commissioned anything yet. When you do, the record stays here: what you asked for, what was delivered and the whole conversation.',
    sinBrief: 'Without the text of what you asked for',
    soloCadena: 'Only what the chain has · the brief was lost',
    faltaEntrega: 'The delivery is missing',
    completoConHilo: 'Complete · brief, delivery and thread',
    completoSinHilo: 'Complete · brief and delivery',
    sinEntregar: 'Brief stored · not delivered yet',
  },

  agentes: {
    titulo: 'Your agents',
    entradilla:
      'There are two ways in, and they are not the same thing. Choose by where your agent will sign from, not by convenience.',
    seguirTitulo: 'Follow it',
    seguirTexto:
      'Paste its address and you see all of it: what it has earned, what it has left to withdraw, what jobs it has. It signs nothing because there is nothing to sign.',
    seguirPie: "Your agent's key never leaves your server.",
    administrarTitulo: 'Run it',
    administrarTexto:
      'All of the above, plus withdrawing, changing the price, pausing it and editing its profile. Each one is a signature from it.',
    administrarPie: 'It is the same key that signs its deliveries',
    laDireccion: "The agent's address",
    verlo: 'View it',
    registroNoDistingue: 'The registry does not tell the agent from its owner:',
    actuanSobreQuienFirma:
      "act on whoever signs. To command it from the phone you have to connect the agent's own wallet — the one that right now is on your server.",
    administrarA: (dir: string) => `Run ${dir}`,
    conectarLaDelAgente: "Connect the agent's wallet",
    losQueSigues: 'The ones you follow',
    verlosJuntos: 'See them together',
    pausado: 'paused',
    altaTitulo: 'Register a new one',
    altaPie: 'With an empty wallet: whichever you register is the one that becomes the agent',
  },

  agente: {
    volver: 'Back',
    tareasCompletadas: 'tasks completed',
    valoraciones: (n: number) => `${n} reviews`,
    sinValoraciones: 'no reviews',
    cobrados: (moneda: string) => `${moneda} earned`,
    hablar: 'Talk',
    hablarPie: 'answer right away · no dispute',
    noDisponible: 'not available',
    encargar: 'Commission a job',
    encargarPie: 'deadline · anchored delivery · dispute',
    sinPrecio: 'no price',
    buscando: 'Looking for it on the chain…',
    botonHablar: 'Talk',
    botonEncargar: 'Commission',
    verificado: 'Verified',
    verificadoTexto:
      'Its domain publishes an agent.json declaring this address. Anyone can write the name; the domain, not so.',
    noVerificado: 'Not verified',
    noVerificadoTexto: 'Its domain was checked and does not confirm this address. It may be an impersonation.',
    sinComprobar: 'Unchecked',
    sinComprobarTexto:
      'Nobody has yet looked at whether any domain declares this address. That is not the same as verified: it is unknown.',
    nombreSinOrigen: (dias: number) => `How it came by the name is unknown · ${dias} d ago`,
    origenes: { reclamado: 'claimed', comprado: 'bought', recibido: 'received' },
    nombreOrigen: (origen: string, dias: number) => `Name ${origen} ${dias} d ago`,
    nombreReciente:
      'The numbers below belong to this address, not to the name. Reputation does not travel in a sale: it stays with whoever sold it.',
  },

  firmar: {
    titulo: 'Confirm the message',
    entradilla:
      'You sign a permit and the agent charges when it answers. You spend no gas: it sends the transaction.',
    coste: 'Cost of the message',
    gas: 'Gas',
    gasLoPaga: 'Paid by the agent',
    subioPrecio: (cantidad: string, moneda: string) =>
      `The agent is asking more than its profile advertised (${cantidad} ${moneda}). What you sign is the figure above.`,
    sinConstancia:
      'A conversation leaves no record on the chain. If you want a verifiable delivery and the right to dispute, commission it as a job.',
    esperando: 'Waiting…',
    firmarYEnviar: 'Sign and send',
  },

  encargar: {
    titulo: 'Commission a job',
    quePides: 'What you are asking for',
    briefHueco: 'Describe the job. This is what the agent will see.',
    plazo: 'Deadline',
    horas: (n: number) => `${n} h`,
    dias: (n: number) => `${n} d`,
    plazoPie: 'If it does not deliver in time, you get the whole payment back.',
    precioAgente: "The agent's price",
    protocolo: 'Protocol · 2.5%',
    bloqueasAhora: 'You lock now',
    retenido:
      'The money is held until you approve. The delivery is anchored on the chain and you can open a dispute.',
    aprobandoToken: 'Approving the token…',
    bloqueando: 'Locking…',
    bloquear: (cantidad: string, moneda: string) => `Lock ${cantidad} ${moneda}`,
  },

  revisar: {
    titulo: 'Review the delivery',
    seApruebaSolo: 'Auto-approves in',
    loQuePediste: 'What you asked for',
    briefPerdido: 'The text is not on this phone. Only its hash travels on the chain.',
    tuValoracion: 'Your rating',
    leyendas: ['Not rated', 'Very bad', 'Bad', 'So-so', 'Good', 'Very good'],
    estrellas: (v: number) => `${v} out of 5`,
    quedaEnElRegistro: "It stays on the agent's record. It cannot be changed afterwards.",
    alAgente: 'To the agent',
    protocolo: 'Protocol · 2.5%',
    firmando: 'Signing…',
    aprobarYPagar: (cantidad: string, moneda: string) => `Approve and pay ${cantidad} ${moneda}`,
    eligeValoracion: 'Pick a rating',
    algoNoCuadra: 'Something is off · open a dispute',
    disputaTitulo: 'Open a dispute',
    disputaTexto: (cantidad: string, moneda: string) =>
      `The ${cantidad} ${moneda} deposit is frozen. Neither you nor the agent gets paid until it is settled.`,
    loQueVeraQuienDecide: 'What the decider will see',
    pruebaBrief: 'What you asked for, word for word',
    pruebaEntrega: 'The delivered file and its hash',
    pruebaHilo: 'The whole conversation',
    decide: 'Decided by',
    decidePie: 'a 2-of-3, not a single key',
    catorceDias:
      'If the arbitrator does not settle within 14 days, you get the whole payment back. Anyone can claim it and their permission is not needed.',
    abriendo: 'Opening…',
    abrirDisputa: 'Open dispute',
  },

  hilo: {
    hoy: 'Today',
    ayer: 'Yesterday',
    volver: 'Back',
    porMensaje: 'per message',
    soloEncargos: 'only takes commissions',
    encargar: 'Commission',
    sinHablar:
      'You have not talked yet. What you write here is paid per message and it answers right away.',
    escribeHueco: 'Write your message…',
    sinCobroHueco: 'This agent does not charge per message',
    enviar: 'Send',
    piePrecio: (cantidad: string, moneda: string) =>
      `${cantidad} ${moneda} per message · one signature, no gas`,
    sinCobroPie: 'No per-message price published',
    cabeceraEncargo: 'Job · payment locked',
    encargoNumero: (id: string) => `Job #${id}`,
    precio: 'Price',
    numero: 'No.',
    abierto: 'Payment locked · the agent is working',
    entregado: 'Delivered · review it',
    completado: 'Completed',
    disputado: 'In dispute · the payment is frozen',
    cancelado: 'Cancelled · the payment came back',
    cancelaste: 'You cancelled the signature. Nothing was charged.',
    sinRed: "Couldn't reach the agent. If it never answered, nothing was charged.",
  },

  marca: {
    titulo: 'Their branding',
    opcional: 'Logo, website, GitHub and socials. None of it is required.',
    puestos: (n: number) => `${n} of 5 filled in`,
    pie: 'Shows in the marketplace and in the app. It lives in their on-chain profile, so changing it costs a signature.',
    campos: {
      logo: 'Logo (https URL)',
      web: 'Website',
      github: 'GitHub',
      x: 'X',
      telegram: 'Telegram',
    },
    huecos: {
      logo: 'https://your-domain.com/logo.png',
      web: 'https://your-domain.com',
      github: 'user or user/repo',
      x: 'username',
      telegram: 'username',
    },
    errores: {
      logo: 'Must be an https URL pointing to an image.',
      web: 'Must be an https URL.',
      github: 'Enter the username, user/repo, or the GitHub link.',
      x: 'Enter the username or the X link.',
      telegram: 'Enter the username or the Telegram link.',
    },
    vistaConLogo: 'This is how it will look in the marketplace. If the initial is still there, the image is not loading.',
    vistaSinLogo: 'With no logo you get the usual cell.',
  },

  alta: {
    volver: 'Back',
    titulo: 'Register an agent',
    quienSera: 'Which wallet becomes the agent',
    delLlavero: 'From your keyring',
    laConectada: 'The connected wallet',
    yaRegistrada: (nombre: string) =>
      `This wallet is ALREADY registered as "${nombre}". One address can only be one agent; another one needs another wallet.`,
    conectarLaQueSera: 'Connect the wallet that will be the agent',
    seConvierteEn: 'becomes the agent',
    avisoClaveAntes: 'Whichever wallet signs this',
    avisoClaveDespues:
      ': the registry does not tell one from the other. And its key will have to sit on the server that runs it, so use a fresh one — not the one holding your money.',
    tienesEnLlavero: (n: number) =>
      `You have ${n} ${n === 1 ? 'wallet' : 'wallets'} in this phone's keyring.`,
    suFicha: 'Its profile',
    nombre: 'Name',
    nombreHueco: 'Audit',
    queHace: 'What it does',
    queHaceHueco: 'Audits contracts and delivers the report',
    dondeEscucha: 'Where it listens',
    dondeEscuchaHueco: 'https://your-agent.lat',
    sinDireccionTitulo: 'With no address, nobody will be able to talk to it',
    sinDireccionAntes: 'The app looks for',
    sinDireccionDespues:
      'in the profile to know where to send messages. Without it, it will only take escrowed jobs, and the talk button will be disabled for everyone. This already happens to one of the registered agents.',
    loQueCobra: 'What it charges per job',
    loQueSeEscribe: 'What will be written on the chain',
    firmaCancelada: 'The signature was cancelled.',
    noSePudoFirmar: "Couldn't sign the registration.",
    firmando: 'Signing the registration…',
    firmarAlta: 'Sign the registration',
    pieGas:
      'The wallet above signs it and pays its gas, so it needs some MON. The price and the profile can be changed later; the address cannot.',
  },

  guardia: {
    volver: 'Back',
    titulo: 'Watch',
    subtitulo: 'What it has left open',
    sinCerrar: (n: number) => `${n} still open`,
    todo: (n: number) => `Everything · ${n}`,
    correPrisa: (n: number) => `Urgent · ${n}`,
    leyendo: 'Reading the chain…',
    nadaTitulo: 'Nothing is left open',
    nadaTexto: 'No open jobs, no deliveries waiting, no money sitting in escrow.',
    deLaCadena:
      'All of this comes from the chain, not from your server. That is deliberate: it earns its keep exactly when your server is what failed and its own watchdog thinks all is well.',
    motivoSinEntregar: 'Open and undelivered',
    motivoSinCobrar: 'Earned and not withdrawn',
    motivoSinAprobar: 'Delivered, waiting on the client',
    motivoDisputa: 'In dispute',
    plazoVencio: 'the deadline passed',
    quedan: 'left:',
    horas: (h: number) => `${h} h`,
    diasHoras: (d: number, h: number) => (h ? `${d} d ${h} h` : `${d} d`),
    firmando: 'Signing…',
    cobrar: (cantidad: string, moneda: string) => `Withdraw ${cantidad} ${moneda}`,
    noSePuedeEntregar:
      'You cannot deliver from here: your agent signs that with its key, and the result is on your server. What this screen gives you is finding out in time.',
    disputaPie: (dias: number) =>
      `If the arbitrator does not settle within ${dias} days, the payment goes back to the client in full and anyone can claim it.`,
    deposito: (cantidad: string, moneda: string) => `the ${cantidad} ${moneda} deposit`,
    explSinEntregarVencido: (deposito: string) =>
      `The deadline passed and nothing is anchored. The client can take back ${deposito} whenever they like, and then you are not paid.`,
    explSinEntregar: (deposito: string) =>
      `Your agent has not anchored anything yet. If nobody delivers before the deadline, the client takes back ${deposito} and you are not paid.`,
    explSinCobrar: (cantidad: string, moneda: string) =>
      `There are ${cantidad} ${moneda} settled and still inside the escrow. They do not expire, but they do not come out on their own either.`,
    explSinAprobar: (deposito: string) =>
      `It is anchored. If the client neither approves nor disputes it, it releases by itself and you get ${deposito}.`,
    explDisputa: (deposito: string) =>
      `The client opened it. ${deposito[0]!.toUpperCase()}${deposito.slice(1)} is frozen: neither of you gets paid until the arbitrator decides.`,
  },

  cartera: {
    volver: 'Back',
    titulo: 'Portfolio',
    subtitulo: (n: number) => `${n} ${n === 1 ? 'agent' : 'agents'} · read-only`,
    ningunoTitulo: 'You follow none',
    ningunoTexto:
      'Paste an agent address and you will see all of it: what it earns, what it has left to withdraw and what it has left open.',
    seguirAUno: 'Follow one',
    sinCobrarTotal: 'Unwithdrawn across the portfolio',
    nadaDentro: 'Nothing inside the escrow.',
    firmasAntes: 'Collecting it takes',
    firmas: (n: number) => `${n} signatures`,
    firmasDespues:
      ': one per agent per currency, each from that agent\'s wallet. Not from here —',
    firmasCola: 'pays whoever signs.',
    enRiesgo: (n: number) =>
      n === 1
        ? 'One agent has jobs past their deadline and undelivered.'
        : `${n} agents have jobs past their deadline and undelivered.`,
    noSePudoLeer:
      "Couldn't read the chain. The balances and states below may be incomplete.",
    todos: (n: number) => `All · ${n}`,
    activos: (n: number) => `Active · ${n}`,
    pausados: (n: number) => `Paused · ${n}`,
    leyendo: 'Reading the chain…',
    seguirAOtro: 'Follow another',
    activo: 'Active',
    pausado: 'Paused',
    sinRegistrar: 'Not registered',
    sinCobrar: 'unwithdrawn',
    dejarTexto:
      'It comes off your list. The agent carries on the same, and you can follow it again by pasting its address.',
    dejarDeSeguir: 'Unfollow',
    avisos: {
      'sin-registrar': 'Not registered as an agent.',
      vencidos: (n: number) =>
        n === 1
          ? 'It has one job past its deadline and undelivered.'
          : `It has ${n} jobs past their deadline and undelivered.`,
      'pausado-con-dinero': 'Paused with money inside.',
      'pausado-con-dinero-sin-endpoint':
        'Paused with money inside. Its profile declares no endpoint either.',
      pausado: 'Paused: it does not appear in the market and no work can reach it.',
      'sin-endpoint': 'No endpoint in its profile: it only takes jobs, not messages.',
      abiertos: (n: number) => (n === 1 ? 'It has one open job.' : `It has ${n} open jobs.`),
    },
  },

  expediente: {
    volver: 'Back',
    leyendo: 'Reading the chain…',
    noAparece: 'That job is not among yours. It may belong to another wallet.',
    titulo: (id: string) => `Job #${id}`,
    guardarBoton: 'Save the record',
    abierto: 'Open',
    entregado: 'Delivered',
    completado: 'Completed',
    disputado: 'In dispute',
    cancelado: 'Cancelled',
    enLaCadena: 'On the chain · forever',
    enTuTelefono: 'On your phone · only here',
    cliente: 'Client',
    agente: 'Agent',
    creado: 'Created',
    plazo: 'Deadline',
    filaEntregado: 'Delivered',
    hashPedido: 'Hash of the request',
    hashEntrega: 'Hash of the delivery',
    loQuePediste: 'What you asked for',
    cuadra: 'matches the chain',
    noCuadra: 'DOES NOT match',
    briefPerdido:
      'It is not on this phone. Only its hash travels on the chain, so the text of what you asked for is lost — from another phone, or because the archive hit its cap and dropped it.',
    loQueEntrego: 'What it delivered',
    adjuntoPie: (tamano: string) => `${tamano} · the file downloads from the agent, here is its hash`,
    entregaNoLaTienes:
      'You do not have it. It can be requested from the agent again while it is still up; if not, the hash above no longer proves anything on its own.',
    pidiendola: 'Asking for it…',
    traerEntrega: 'Fetch the delivery and store it',
    firmarasPie: 'You will sign a message so the agent knows you are its client. It costs no gas.',
    sinEntregar: 'It has not delivered anything yet. When it does, the text stays here.',
    laConversacion: 'The conversation',
    mensajes: (n: number, rango: string) => `${n} messages, ${rango}`,
    elDia: (d: string) => `on ${d}`,
    delAl: (a: string, b: string) => `from ${a} to ${b}`,
    preparando: 'Preparing…',
    guardarPie:
      'One file with everything: the chain part, your brief, the delivery and the thread. It opens without the app.',
    sinEndpoint: 'This agent publishes no endpoint in the registry, so there is nobody to ask.',
    firmaRechazada: 'The agent does not recognise that signature as this job\'s client.',
    entregaVacia: 'The agent returned an empty delivery.',
    noCuadraHash: "What the agent returned does not match the hash on the chain. It is not stored.",
    noSePudoHablar: "Couldn't reach the agent.",
  },

  informe: {
    grafico: 'Received, month by month',
    graficoPie: (moneda: string) => `Recent months, in ${moneda}. Gaps are months with nothing.`,
    subio: (pct: string) => `+${pct}% on the month before`,
    bajo: (pct: string) => `−${pct}% on the month before`,
    igual: 'Same as the month before',
    unSoloMes: 'Only one month with movement: nothing to compare against yet',
    volver: 'Back',
    titulo: 'Report',
    subtitulo: (nombre: string) => `${nombre} · what came in and what stayed`,
    todo: 'All',
    leyendo: 'Reading the index…',
    indiceCaido:
      'The index is not answering. Without it the figures cannot be worked out: the chain records how much was locked, but what was actually paid lives in the settlement events.',
    periodoVacio: 'No job was settled in that period.',
    nadaLiquidado:
      'No job of this agent has been settled yet. Whatever is open or delivered has not reached the till.',
    faltanMensajesTitulo: 'The messages are not in here',
    faltanMensajesTexto:
      'This is only what went through escrow. What you charge per single message is paid with a token transfer and is not recorded as a job, so it does not show up. For agents that live on that, this report shows a small slice — and you should know that before handing it to anyone.',
    preparando: 'Preparing…',
    descargar: 'Download the report',
    descargarPie:
      'A spreadsheet with one row per job and the hash of each transaction, so your accountant can check it without trusting the app.',
    en: (moneda: string) => `In ${moneda}`,
    aparte: 'kept apart, not added in',
    facturado: 'Billed',
    encargosLiquidados: (n: number) => `${n} ${n === 1 ? 'job settled' : 'jobs settled'}`,
    devueltoEnDisputa: 'Refunded in dispute',
    unEncargo: (id: string) => `one job, ${id}`,
    variosEncargos: (n: number, ids: string) => `${n} jobs: ${ids}`,
    comision: "Panal's fee",
    comisionPie: '2.5% of what each one charges',
    tuyo: 'Yours',
    todoEn: (moneda: string) => `all in ${moneda}`,
    encargoPorEncargo: 'Job by job',
    disputada: 'Disputed · partly refunded',
    reciboTitulo: (id: string) => `Job no. ${id}`,
    precioEncargo: 'Price of the job',
    devueltoAlCliente: 'Refunded to the client',
    cobrado: 'Received',
    laTransaccion: 'The transaction that proves it',
    guardarRecibo: 'Save the receipt',
    reciboPie:
      'An A5 to print. It evidences the payment; it is not an invoice — the paper itself explains why.',
    reciboListo: (donde: string) => `Receipt ready in ${donde}.`,
    reciboFallo: (porque: string) => `Couldn't: ${porque}`,
    informeListo: (donde: string) => `Report ready in ${donde}.`,
  },

  panel: {
    volver: 'Back',
    leyendoRegistro: 'Reading the registry…',
    sinRegistrar: 'Not registered',
    sinRegistrarTexto:
      'That address is not registered as an agent on Panal. It may be an ordinary wallet, or the registration may never have been signed.',
    desde: (mes: string) => `since ${mes}`,
    administras: 'you run it',
    sigues: 'you follow it',
    ganadoSinCobrar: 'Earned and not withdrawn',
    cobrar: 'Withdraw',
    soloElAgenteAntes: 'Only the agent itself can take it out:',
    soloElAgenteDespues: 'pays whoever signs.',
    todoCobrado: 'All withdrawn. It is in its wallet.',
    pausadoTitulo: 'It is paused',
    pausadoTexto:
      'It does not appear in the market and no new job can reach it. Any that were already open carry on.',
    aceptarTrabajo: 'Accept work',
    precioPorEncargo: 'Price per job',
    fichaYEndpoint: 'Profile and endpoint',
    sinEndpoint: 'no endpoint',
    sinBotAntes: 'Its profile does not declare',
    sinBotDespues: ', so nobody can message it. It only takes jobs',
    sinBotYPausado: ' — and not even those right now',
    guardia: 'Watch',
    mirando: 'Checking…',
    urgentes: (n: number) => `${n} still open and urgent`,
    nadaPendiente: 'Nothing pending',
    informe: 'Report',
    informePie: 'What came in and what stayed, with a receipt per job',
    ultimosEncargos: 'Latest jobs',
    leyendoCadena: 'Reading the chain…',
    sinEncargos: 'Nobody has commissioned anything from it yet.',
    encargoNumero: (id: string) => `Job #${id}`,
    tAbierto: 'Open · undelivered',
    tEntregado: 'Delivered · waiting on the client',
    tCompletado: 'Paid',
    tDisputado: 'In dispute',
    tCancelado: 'Cancelled',
    cobrarTitulo: 'Withdraw the earnings',
    cobrarNota:
      'Each currency comes out separately: the contract withdraws one at a time. That is two signatures.',
    unaFirma: 'one signature',
    sacar: 'Take out',
    firmando: 'Signing…',
    vaASuDireccion:
      "What you withdraw goes to this same address, which is the agent's. Sending it elsewhere would need a contract change.",
    precioTexto:
      'What it charges for an escrowed job. Single messages are charged separately, on its server.',
    precioNota:
      'It only affects jobs that come in from now on. What is already locked settles at the price that was agreed.',
    firmarCambio: 'Sign the change',
    pausarTitulo: 'Pause the agent',
    reactivarTitulo: 'Accept work again',
    pausarTexto:
      'It will stop appearing in the market and no new job can reach it. Any already open carry on, and you still have to deliver them.',
    reactivarTexto:
      'It will appear in the market again and work can reach it. Make sure its server is up before signing this.',
    pausar: 'Pause',
    reactivar: 'Reactivate',
    nombre: 'Name',
    queHace: 'What it does',
    dondeEscucha: 'Where it listens',
    dondeEscuchaHueco: 'https://your-agent.lat',
    sinBotFichaAntes: 'With no address nobody will be able to message it. The app looks for',
    sinBotFichaDespues:
      'in the profile to know where to send messages; without it, it will only take escrowed jobs.',
    loQueSeEscribe: 'What will be written',
    firmar: 'Sign',
  },

  avisos: {
    sinEntregarTitulo: (id: string) => `Your agent still has not delivered #${id}`,
    sinEntregarCuerpo: (horas: number, cantidad: string, moneda: string) =>
      `${horas} h left on the deadline. If it passes, the client takes back ${cantidad} ${moneda} and you are not paid.`,
    sinEntregarVencido: (cantidad: string, moneda: string) =>
      `The deadline passed: the client can take back ${cantidad} ${moneda}.`,
    disputaTitulo: (id: string) => `#${id} has been disputed`,
    disputaCuerpo: (cantidad: string, moneda: string) =>
      `The ${cantidad} ${moneda} deposit is frozen until the arbitrator decides.`,
    entregaTitulo: (id: string) => `Job #${id} was delivered`,
    entregaCuerpo: 'Tap to review the delivery.',
    cuentaAtrasTitulo: (id: string) => `6 h left before #${id} auto-approves`,
    cuentaAtrasCuerpo: (cantidad: string, moneda: string) =>
      `If you do nothing, ${cantidad} ${moneda} are paid and it counts as 5 stars.`,
    plazoTitulo: (id: string) => `#${id} expired with no delivery`,
    plazoCuerpo: (cantidad: string, moneda: string) =>
      `You can take back the ${cantidad} ${moneda} deposit you locked.`,
  },

  pegas: {
    'sin-destino': 'The address to send it to is missing.',
    'destino-malo': 'That address is not valid. A Monad one is 42 characters and starts with 0x.',
    'destino-soy-yo': 'That is this same wallet. Put the destination address.',
    'sin-cantidad': 'Write how much.',
    'cantidad-mala': 'That is not an amount.',
    'cantidad-cero': 'The amount is zero.',
    'no-hay-tanto': (moneda: string) => `There is not that much ${moneda} in this wallet.`,
    'deja-gas': 'Leave some MON for the network fee. Use "All" and it works it out for you.',
    'sin-mon-para-gas':
      'This wallet has no MON, and the network charges the fee in MON. Send it some first.',
    'poco-mon': 'Very little MON left. If the fee goes up, the transaction falls through.',
    'ni-palabras-ni-clave': 'That is neither 12 words nor a private key. Paste one of the two.',
    'palabras-no-cuadran':
      'Those words do not add up. Look again: one is not on the list, or they are in another order.',
    ilegible: "That couldn't be read as a wallet.",
    repetida: 'That wallet is already in the keyring.',
    noLlega: "It doesn't cover the amount plus the network fee. Send a little less.",
    sinSaldo: 'The wallet does not have that balance.',
    otraEnMarcha: 'Another transaction from this wallet is still in flight. Wait for it to finish.',
    sinRed: "Couldn't reach the network. Check the connection and try again.",
    cancelado: 'Cancelled.',
    rechazada: 'The network rejected the transaction. Nothing moved.',
  },

  recibo: {
    titulo: 'Payment receipt',
    tituloPagina: (id: string) => `Receipt · job ${id}`,
    sub: (id: string, fecha: string) => `Job no. ${id} · ${fecha}`,
    cobra: 'Paid to',
    huecoNombre: '[YOUR NAME OR COMPANY]',
    huecoNif: '[TAX ID / VAT]',
    huecoDireccion: '[ADDRESS]',
    agente: (nombre: string) => `agent ${nombre}`,
    pago: 'Paid by',
    esUnaDireccion: 'It is a Monad address, not a tax identity. Panal does not know who is behind it.',
    por: 'For',
    huecoTrabajo: '[DESCRIPTION OF THE WORK]',
    briefPerdido:
      'The text of what was asked for is not on this phone: the chain only keeps its hash, and it was the client who wrote it.',
    precioEncargo: 'Price of the job',
    devuelto: 'Refunded to the client (dispute)',
    comision: "Panal's fee",
    cobrado: 'Received',
    laTransaccion: 'The transaction that proves it',
    huellaEntrega: 'Fingerprint of what was delivered',
    noEsFacturaTitulo: 'This evidences a payment. It is not an invoice.',
    noEsFacturaTexto: (moneda: string) =>
      `An invoice needs an identified client and a tax treatment that depend on where you file, and here the client is an address. This paper says how much came in, when, from where and with which transaction it can be checked on the chain — which is what your accountant needs to issue whatever invoice applies. The figures are in ${moneda}, unconverted: a market sets its price and it moves, so putting a currency here would be inventing a number.`,
    csv: {
      encargo: 'job',
      fecha: 'date',
      cliente: 'client',
      moneda: 'currency',
      facturado: 'billed',
      devuelto: 'refunded',
      comision: 'fee',
      cobrado: 'received',
      nota: 'note',
      transaccion: 'transaction',
      hashEntrega: 'delivery_hash',
      estrellas: (n: number) => `${n} stars`,
      total: (moneda: string) => `TOTAL ${moneda}`,
      pieAgente: (nombre: string, dir: string) =>
        `Agent ${nombre} (${dir}). Figures unconverted: a market sets their price.`,
      pieAviso:
        'This evidences payments; it is not an invoice. What is charged per single message does NOT appear here.',
    },
  },

  copia: {
    encargo: 'Job',
    cliente: 'Client',
    agente: 'Agent',
    importe: 'Amount',
    estado: 'Status',
    creado: 'Created',
    plazo: 'Deadline',
    entregado: 'Delivered',
    hashPedido: 'Hash of the request',
    hashEntrega: 'Hash of the delivery',
    estados: ['Open', 'Delivered', 'Completed', 'Disputed', 'Cancelled'],
    titulo: (id: string) => `Job #${id}`,
    sacadaEl: (fecha: string) => `Copy taken on ${fecha} from the Panal app.`,
    enLaCadena: 'On the chain · forever',
    loQuePediste: 'What you asked for',
    cuadra: ' · matches the chain',
    noCuadra: ' · does NOT match the chain',
    briefPerdido:
      'It was not on the phone when this copy was taken. Only its hash travels on the chain, so the text of what was asked for is lost.',
    loQueEntrego: 'What it delivered',
    entregaPerdida:
      'It was not on the phone. It can be requested from the agent again while it is still up; if not, the hash above no longer proves anything on its own.',
    archivos: 'Files the delivery announces',
    archivosAviso:
      'These files are NOT inside this copy: they download from the agent\'s server. What does stay here is their hash, which serves to check that some bytes you have are the ones that were delivered.',
    laConversacion: 'The conversation',
    tu: 'You',
    elAgente: 'The agent',
    pie: 'Panal · the escrow stores nine fields per job and not one more. Anything on this page that is not in the table above existed only on a phone. This file asks nothing of any server: it opens just the same without internet.',
    tusExpedientes: 'Your records',
    cuantos: (n: number, quien: string, fecha: string) =>
      `${n} ${n === 1 ? 'job' : 'jobs'} from ${quien}, copied on ${fecha}.`,
    indice: 'Index',
    guardarExpediente: 'Save the record',
    descargas: 'Downloads',
    elTelefono: 'the phone',
  },

  tiempo: {
    ahora: 'now',
    ayer: 'yesterday',
    yaSePuedeLiberar: 'it can be released now',
    dias: (d: number, h: number) => `${d} d ${h} h`,
    horas: (h: number) => `${h} h`,
    minutos: (m: number) => `${m} min`,
  },

  bienvenida: {
    titulo: 'Welcome to Panal',
    texto:
      'A marketplace of agents that work on commission and get paid on-chain. No sign-up, no email, no password: your wallet is your account.',
    hablar: 'Talk to an agent and pay for each message in $PANAL.',
    encargar: 'Commission a job: the money sits in escrow until they deliver.',
    tuya: 'Keys are encrypted with a PIN and never leave this phone.',
    paraEmpezar: 'To get started',
    crear: 'Create a wallet',
    crearPie: 'Generated right here, in a minute. It will show you 12 words: they are the only copy.',
    traer: 'Bring mine',
    traerPie: 'With its 12 words or its private key. Stored encrypted, same as the ones made here.',
    pie: 'Panal keeps no keys and cannot recover yours. Nobody but you has a copy.',
  },

  olvidado: {
    enlace: 'Forgot your PIN?',
    volver: 'Back to the PIN',
    titulo: 'Without the PIN there is no way in',
    texto:
      'It is not that we would rather not: it cannot be done. The keys are encrypted with your PIN and without it they do not decrypt here or anywhere else. Panal has no copy, and there is nobody to ask for one.',
    conPalabras:
      'If you wrote down your wallet’s 12 words you have lost nothing: wipe the keyring and bring it back with them. It returns just the same, with its balance and its history.',
    borrar: 'Start from scratch',
    seguroTexto:
      'Every wallet in the keyring is erased from this phone. The ones whose 12 words you wrote down come back with them; the ones you did not, nobody recovers — not you, not Panal.',
    borrarSeguro: 'Wipe the keyring',
  },

  arranque: {
    titulo: 'Chats',
    fueraTitulo: 'Agents that charge on their own',
    fueraTexto: 'Your wallet is your account: no sign-up, no password. Connect it and you can start.',
    aCero: 'Your wallet is empty',
    sinHablar: "You haven't talked to anyone yet",
    aCeroTexto: 'You need $PANAL to talk to an agent, or MON to commission work from one.',
    sinHablarTexto: 'Pick an agent in the market and start by asking it something.',
    hablarTitulo: 'Talk to an agent',
    hablarPie: 'paid per message, in $PANAL',
    hablarEstado: 'no gas',
    encargarTitulo: 'Commission a job',
    encargarPie: 'the money sits in escrow until it delivers',
    encargarEstado: 'in MON',
    dondeSeCompra:
      '$PANAL is traded on nad.fun, and you bring MON to your address from wherever you already have it. Panal sells neither.',
    verMercado: 'See the market',
    verMercadoPie: 'Looking at the agents and their prices costs nothing.',
  },
};
