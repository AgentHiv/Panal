/**
 * Panal — os textos da app, em português.
 *
 * Traduzidos de `es.ts`, que é o original. Declarar isto como `: Textos` é o
 * que o mantém honesto: se faltar uma linha, a compilação pára, em vez de
 * ficar um buraco que só aparece no telemóvel de outra pessoa.
 *
 * Os nomes próprios ficam como estão — Panal, MON, $PANAL, Monad,
 * WalletConnect, x402, nad.fun — e o tom seco do espanhol também. Nada aqui
 * promete mais do que o ecrã faz.
 */

import type { Textos } from '~/i18n/es';

export const pt: Textos = {
  comun: {
    cancelar: 'Cancelar',
    listo: 'Pronto',
    cerrar: 'Fechar',
    atras: 'Voltar',
    borrar: 'Apagar',
    ahoraNo: 'Agora não',
    copiar: 'Copiar',
    copiada: 'Copiado',
    copiarDireccion: 'Copiar endereço',
    conectarWallet: 'Ligar wallet',
    conectando: 'A ligar…',
    desconectar: 'Desligar',
    tuDireccion: 'O teu endereço',
    suDireccion: 'O endereço dela',
    verEnElExplorador: 'Ver no explorador',
    menu: 'Menu',
    sinNombre: 'Sem nome',
    walletDelTelefono: 'A wallet deste telemóvel',
    llaveroCerrado: 'O porta-chaves está bloqueado. Abre-o com o teu PIN.',
    abriendo: 'A abrir…',
  },

  pestanas: {
    chats: 'Conversas',
    mercado: 'Mercado',
    archivo: 'Arquivo',
    saldo: 'Saldo',
  },

  menu: {
    sinWallet: 'Sem wallet ligada',
    firmaAqui: 'Assina neste telemóvel',
    firmaFuera: 'Assina na tua wallet',
    llavero: 'O teu porta-chaves',
    agentes: 'Os teus agentes',
    cartera: 'A tua carteira',
    avisos: 'Avisos do telemóvel',
    idioma: 'Idioma',
    red: (nombre: string, id: number) => `Panal · ${nombre} (${id})`,
    version: (v: string) => `Versão ${v}`,
    sinVersion: 'Compilação de desenvolvimento',
  },

  barraRed: {
    otraRed: 'A tua wallet está noutra rede',
    cambiar: (red: string) => `Mudar para ${red}`,
  },

  avisoFirma: {
    titulo: 'Assina na tua wallet',
    conEnlace: 'O pedido já lá está. Se a tua wallet não abriu sozinha, abre-a e aprova.',
    sinEnlace: 'O pedido já lá está. Muda para a tua wallet e aprova; ao voltar, isto continua aqui.',
    abrir: 'Abrir a minha wallet',
  },

  hojaWallet: {
    titulo: 'Ligar a tua wallet',
    entradilla: 'A tua wallet é a tua conta. O Panal não guarda nenhuma chave nem te pede email.',
    deEsteTelefono: 'A deste telemóvel',
    crearAqui: 'Criar uma wallet aqui',
    crearAquiPie: 'É gerada no telemóvel e assina sem sair da app. Um minuto.',
    dentroPie:
      'Assina aqui dentro, sem abrir mais nada. O que aprovas é o que o Panal te mostra: não há um segundo ecrã a repeti-lo.',
    oLaQueYaUsas: 'ou a que já usas',
    fueraPie:
      'Abre-se a tua wallet, aprovas lá e voltas. Cada assinatura tira-te do Panal, mas é ela que te mostra o que assinas.',
    abrirMiWallet: 'Abrir a minha wallet',
    abrirMiWalletPie: 'Abre-se a wallet que tiveres instalada, aprovas lá e voltas para aqui.',
    copiarEnlace: 'Copiar a ligação',
    enlaceCopiado: 'Ligação copiada',
    copiarPie: 'Para a colares à mão na tua wallet, em «digitalizar» ou «ligar».',
    preparando: 'A preparar a ligação…',
    noSePudo: 'Não foi possível ligar',
    sinWalletConnect:
      'Esta versão foi compilada sem WalletConnect, por isso não há forma de abrir uma wallet a partir daqui. É preciso compilar o APK com',
    usarOtra: 'Usar outra',
    pinTitulo: 'O PIN do teu porta-chaves. Com ele, assinar deixa de te tirar da app.',
  },

  saldo: {
    titulo: 'Saldo',
    conectaTitulo: 'Liga a tua wallet',
    conectaTexto: 'É a tua conta e o teu saldo ao mesmo tempo. Não há registo, nem email, nem palavra-passe para decorar.',
    panalParaQue: 'Paga cada mensagem que mandas a um agente.',
    panalPie: 'Falar não gasta gas: no x402 assinas tu e a transação é enviada por quem cobra.',
    monParaQue: 'Paga as encomendas com depósito, e o gas de as bloquear.',
    monPie: 'Sem MON podes falar, mas não encomendar um trabalho.',
    dondeSeCompra:
      '$PANAL troca-se na nad.fun, e o MON trá-lo para aqui de onde já o tenhas. O Panal não vende nenhum dos dois.',
    llavero: 'O teu porta-chaves',
    llaveroPie:
      'Wallets deste telemóvel: ver o saldo, mandar, receber e trazer as que já tens. A chave é cifrada com um PIN e não sai daqui.',
    agentes: 'Os teus agentes',
    agentesPie: 'Segue um ou administra o teu: cobrar, preço, pausa e ficha.',
    desconectar: (dir: string) => `Desligar ${dir}`,
    otraRedTitulo: 'Wallet noutra rede',
    otraRedTexto: (red: string) =>
      `O Panal vive na ${red}. Enquanto a tua wallet estiver noutra rede não se pode assinar nada.`,
  },

  llavero: {
    titulo: 'O teu porta-chaves',
    vacio: 'Vazio, para já',
    cuantas: (n: number) => `${n} ${n === 1 ? 'wallet' : 'wallets'} neste telemóvel`,
    bloquear: 'Bloquear o porta-chaves',
    refrescar: 'Voltar a ver os saldos',
    crear: 'Criar uma',
    creando: 'A criar…',
    crearPie: 'É gerada aqui e mais ninguém a vê',
    traer: 'Trazer uma',
    traerPie: 'Com as palavras dela ou a chave privada',
    sinCopia: 'Sem cópia — se perderes o telemóvel, perde-se',
    noSePudoLeer: 'Não foi possível ler o saldo. É a rede, não a wallet: o que estiver lá dentro continua lá.',
    noSePudoGuardar: 'Não foi possível guardar a wallet. Pode não haver espaço no telemóvel.',
    noSePudoCrear: 'Não foi possível criar o porta-chaves neste telemóvel.',
    pinTitulo: 'Escolhe um PIN',
    pinOtraVez: 'Outra vez, para confirmar',
    pinExplicacion:
      'Seis dígitos. Cifram as wallets que criares aqui, e não há forma de o recuperar: se te esqueceres, perdem-se.',
    pinRepite: 'Repete os mesmos seis dígitos.',
    pinNoCoinciden: 'Não coincidem. Começa de novo.',
    pinMalo: 'Esse PIN não é',
    bloqueadoTitulo: 'O teu porta-chaves',
    bloqueadoExplicacion: 'As wallets que guardas neste telemóvel. Nada sai daqui.',
    hastaDonde: 'Até onde chega este PIN',
    hastaDondeTexto:
      'As chaves estão cifradas com ele dentro da gaveta privada da app: mais nenhuma app as lê, e já não vão na cópia de segurança da Google. O que o PIN NÃO trava é alguém com o teu telemóvel desbloqueado e tempo. Para isso é preciso o chip seguro do telemóvel, e o WebView não lá chega sem escrever código nativo. Guarda aqui o que usas, não o que guardas.',
    palabrasTitulo: (n: number) => `As tuas ${n} palavras`,
    claveTitulo: 'A chave privada dela',
    palabrasTexto: (nombre: string) =>
      `Aponta-as em papel e guarda-as fora do telemóvel. São a única forma de recuperar ${nombre} se o perderes — mais ninguém tem cópia, nem o Panal.`,
    claveTexto: (nombre: string) =>
      `Com isto controla-se ${nombre} a partir de qualquer sítio. Guarda-a onde guardas o que importa, não numa fotografia.`,
    peligro:
      'Não a guardes numa fotografia, nem em notas, nem numa conversa. Quem a tiver pode esvaziar esta wallet a partir de qualquer sítio, sem o telemóvel e sem o PIN.',
    yaApuntadas: 'Já as apontei',
    mandar: 'Enviar',
    recibir: 'Receber',
    vaciaPie: 'Ainda não há nada para enviar. Toca em «Receber» para veres para onde o mandar.',
    verPalabras: 'Ver as 12 palavras',
    verClave: 'Ver a chave privada',
    importada: 'Trazida de fora. Continua a existir onde estava: apagá-la daqui não a apaga de lá.',
    creadaAqui: 'Criada neste telemóvel. A cópia de segurança dela são as suas 12 palavras e não há outra.',
    borrarDelTelefono: 'Apagar do telemóvel',
    seguro: 'De certeza?',
    sinApuntar: 'Não apontaste as suas 12 palavras',
    seguroTexto:
      'Sai deste telemóvel. Com as palavras — ou a chave — recuperas-la em qualquer wallet; sem elas, não.',
    sinApuntarTexto: 'Se a apagares agora, o que estiver lá dentro não o recupera ninguém. Nem tu, nem o Panal.',
  },

  enviar: {
    titulo: (nombre: string) => `Enviar de ${nombre}`,
    tienes: (cantidad: string, moneda: string) => `Tens ${cantidad} ${moneda} nesta wallet.`,
    aQuien: 'Para quem',
    cuanto: 'Quanto',
    pegar: 'Colar',
    todo: 'Tudo',
    todoPie: '«Tudo» deixa uma pitada de MON para a taxa da rede. Sem ela a transação não sai.',
    continuar: 'Continuar',
    repasa: 'Revê',
    repasaTexto:
      'Assina-se com a chave deste telemóvel, por isso não vai abrir mais nenhuma app a mostrar-to. É isto que se envia.',
    aEstaDireccion: 'Para este endereço',
    cantidad: 'Quantia',
    desde: 'De',
    red: 'Rede',
    comision: 'Taxa da rede',
    comisionPie: 'Paga-a esta wallet',
    enMon: 'Em MON',
    sinVuelta:
      'Depois de enviado não há quem o devolva, nem o Panal nem ninguém. Se esse endereço estiver errado, o dinheiro fica onde cair.',
    firmar: 'Assinar e enviar',
    mandando: 'A enviar…',
    mandado: 'Enviado',
    a: (dir: string) => `para ${dir}`,
    noCierres:
      'Não feches a app. Se demorar, a transação já foi enviada: vê-se no explorador com a ligação acima.',
    revertida: 'A rede rejeitou-a ao executá-la. Não se moveu nada.',
  },

  recibir: {
    titulo: (nombre: string) => `Carregar ${nombre}`,
    texto:
      'Envia MON ou $PANAL para este endereço a partir de onde já os tenhas: a tua outra wallet, uma exchange, outra pessoa.',
    compartir: 'Partilhar',
    redAviso: (red: string, id: number) =>
      `Tem de chegar pela ${red} (${id}). O mesmo endereço existe noutras redes, e o que chegar por outra não aparece aqui nem se pode recuperar a partir da app.`,
    gasAviso:
      'Deixa algum MON mesmo que só vás mexer em $PANAL: a taxa da rede paga-se em MON, e uma wallet com $PANAL e zero MON não pode enviar nada.',
  },

  importar: {
    titulo: 'Trazer uma wallet',
    texto:
      'Cola as 12 ou 24 palavras dela, ou a chave privada. Fica guardada cifrada com o mesmo PIN que o resto do porta-chaves.',
    etiqueta: 'Palavras ou chave',
    hueco: 'abandon ability able…  ·  ou  0x…',
    pareceClave: 'Parece uma chave privada.',
    parecenPalabras: 'Parecem palavras de recuperação.',
    comoLaLlamas: 'Como lhe chamas',
    huecoNombre: 'Importada',
    aviso:
      'Escreve isto só se o telemóvel for teu e ninguém estiver a ver. Quem tiver estas palavras pode esvaziar a wallet a partir de qualquer sítio, sem o telemóvel e sem o PIN.',
    boton: 'Trazê-la para o porta-chaves',
    comprobando: 'A verificar…',
    noSePudo: 'Não foi possível guardar neste telemóvel.',
    noSePudoAbrir: 'Não foi possível abrir essa wallet.',
  },

  chats: {
    titulo: 'Conversas',
    buscarAgente: 'Procurar um agente',
    tu: 'Tu: ',
    encargoNumero: (id: string) => `Encomenda #${id}`,
    entregado: 'Entregue · falta aprovares',
    enMarcha: 'Encomenda a decorrer',
  },

  mercado: {
    titulo: 'Mercado',
    buscar: 'Procurar um agente',
    limpiar: 'Limpar',
    sinAgentes: 'Ainda não há nenhum agente registado na cadeia.',
    sinResultados: 'Nenhum se chama assim nem faz isso.',
    porEncargo: (precio: string, moneda: string) => `${precio} ${moneda} · por encomenda`,
    sinPrecio: 'sem preço de encomenda',
    tareas: (n: number) => `· ${n} ${n === 1 ? 'tarefa' : 'tarefas'}`,
    sinValoraciones: '· sem avaliações',
  },

  archivo: {
    titulo: 'Os teus processos',
    subtitulo: 'O que a cadeia não guarda de cada encomenda',
    conectaTitulo: 'Liga a tua wallet',
    conectaTexto: 'Os processos são de um endereço: são as encomendas e as conversas dele.',
    holgado: 'O arquivo tem espaço',
    apretado: (quedan: number) => `Faltam ${quedan} antes de começar a perder`,
    deTantos: (n: number, tope: number) => `${n} de ${tope}`,
    salud: (briefsTope: number, hilosTope: number, hilos: number) =>
      `A app guarda ${briefsTope} briefings e, ao chegar lá, vai deitando fora os mais antigos sem avisar. As conversas têm o seu próprio limite: ${hilosTope} conversas (${hilos} guardadas). E tudo isto vive neste telemóvel: apagar os dados da app perde-o, e mudar de telemóvel não o leva.`,
    sacarCopia: 'Exportar uma cópia de tudo',
    preparando: 'A preparar…',
    sacarCopiaPie: 'Um ficheiro que abre sem a app e não caduca',
    copiaLista: (donde: string) => `Cópia pronta em ${donde}.`,
    copiaFallo: (porque: string) => `Não foi possível exportar a cópia: ${porque}`,
    todos: (n: number) => `Todos · ${n}`,
    completos: (n: number) => `Completos · ${n}`,
    conHuecos: (n: number) => `Com falhas · ${n}`,
    leyendo: 'A ler a cadeia…',
    sinNada:
      'Ainda não encomendaste nada. Quando o fizeres, fica aqui o processo: o que pediste, o que te entregaram e a conversa inteira.',
    sinBrief: 'Sem o texto do que pediste',
    soloCadena: 'Só o que está na cadeia · o briefing perdeu-se',
    faltaEntrega: 'Falta a entrega',
    completoConHilo: 'Completo · briefing, entrega e conversa',
    completoSinHilo: 'Completo · briefing e entrega',
    sinEntregar: 'Briefing guardado · ainda por entregar',
  },

  agentes: {
    titulo: 'Os teus agentes',
    entradilla:
      'Há duas formas de entrar, e não são a mesma coisa. Escolhe por onde o teu agente vai assinar, não por comodidade.',
    seguirTitulo: 'Segui-lo',
    seguirTexto:
      'Colas o endereço dele e vês tudo: quanto ganhou, o que lhe falta cobrar, que encomendas tem. Não assina nada porque não há nada para assinar.',
    seguirPie: 'A chave do teu agente não sai do teu servidor.',
    administrarTitulo: 'Administrá-lo',
    administrarTexto:
      'Tudo o anterior, e ainda cobrar, mudar o preço, pausá-lo e editar a ficha dele. Cada coisa é uma assinatura dele.',
    administrarPie: 'É a mesma chave que assina as entregas dele',
    laDireccion: 'O endereço do agente',
    verlo: 'Ver',
    registroNoDistingue: 'O registo não distingue o agente do dono dele:',
    actuanSobreQuienFirma:
      'atuam sobre quem assina. Para mandares a partir do telemóvel tens de ligar a wallet do próprio agente — a que neste momento está no teu servidor.',
    administrarA: (dir: string) => `Administrar ${dir}`,
    conectarLaDelAgente: 'Ligar a wallet do agente',
    losQueSigues: 'Os que segues',
    verlosJuntos: 'Vê-los juntos',
    pausado: 'em pausa',
    altaTitulo: 'Registar um novo',
    altaPie: 'Com uma wallet vazia: a que registares é a que vai ser o agente',
  },

  agente: {
    volver: 'Voltar',
    tareasCompletadas: 'tarefas concluídas',
    valoraciones: (n: number) => `${n} avaliações`,
    sinValoraciones: 'sem avaliações',
    cobrados: (moneda: string) => `${moneda} recebidos`,
    hablar: 'Falar',
    hablarPie: 'resposta na hora · sem disputa',
    noDisponible: 'indisponível',
    encargar: 'Encomendar um trabalho',
    encargarPie: 'prazo · entrega ancorada · disputa',
    sinPrecio: 'sem preço',
    buscando: 'A procurá-lo na cadeia…',
    botonHablar: 'Falar',
    botonEncargar: 'Encomendar',
    verificado: 'Verificado',
    verificadoTexto:
      'O domínio dele publica um agent.json que declara este endereço. O nome escreve-o qualquer um; o domínio não.',
    noVerificado: 'Não verificado',
    noVerificadoTexto: 'Olhou-se para o domínio dele e não confirma este endereço. Pode ser uma falsificação.',
    sinComprobar: 'Por verificar',
    sinComprobarTexto:
      'Ainda ninguém verificou se algum domínio declara este endereço. Não é o mesmo que verificado: é que não se sabe.',
    nombreSinOrigen: (dias: number) => `Não se sabe como ficou com o nome · há ${dias} d`,
    origenes: { reclamado: 'reclamado', comprado: 'comprado', recibido: 'recebido' },
    nombreOrigen: (origen: string, dias: number) => `Nome ${origen} há ${dias} d`,
    nombreReciente:
      'Os números abaixo são deste endereço, não do nome. A reputação não viaja numa venda: fica com quem o vendeu.',
  },

  firmar: {
    titulo: 'Confirmar a mensagem',
    entradilla:
      'Assinas uma autorização e o agente cobra ao responder. Não gastas gas: a transação é ele que a envia.',
    coste: 'Custo da mensagem',
    gas: 'Gas',
    gasLoPaga: 'Paga-o o agente',
    subioPrecio: (cantidad: string, moneda: string) =>
      `O agente pede mais do que anunciava na ficha dele (${cantidad} ${moneda}). O que assinas é o valor acima.`,
    sinConstancia:
      'Uma conversa não deixa registo na cadeia. Se queres entrega verificável e direito a disputa, encomenda-a como trabalho.',
    esperando: 'A aguardar…',
    firmarYEnviar: 'Assinar e enviar',
  },

  encargar: {
    titulo: 'Encomendar trabalho',
    quePides: 'O que lhe pedes',
    briefHueco: 'Descreve o trabalho. É isto que o agente vai ver.',
    plazo: 'Prazo',
    horas: (n: number) => `${n} h`,
    dias: (n: number) => `${n} d`,
    plazoPie: 'Se não entregar a tempo, recuperas o pagamento inteiro.',
    precioAgente: 'Preço do agente',
    protocolo: 'Protocolo · 2,5 %',
    bloqueasAhora: 'Bloqueias agora',
    retenido:
      'O dinheiro fica retido até aprovares. A entrega é ancorada na cadeia e podes abrir uma disputa.',
    aprobandoToken: 'A aprovar o token…',
    bloqueando: 'A bloquear…',
    bloquear: (cantidad: string, moneda: string) => `Bloquear ${cantidad} ${moneda}`,
  },

  revisar: {
    titulo: 'Rever a entrega',
    seApruebaSolo: 'Aprova-se sozinho em',
    loQuePediste: 'O que pediste',
    briefPerdido: 'O texto não está neste telemóvel. Na cadeia só viaja o hash dele.',
    tuValoracion: 'A tua avaliação',
    leyendas: ['Sem avaliação', 'Muito mau', 'Mau', 'Assim-assim', 'Bom', 'Muito bom'],
    estrellas: (v: number) => `${v} em 5`,
    quedaEnElRegistro: 'Fica no registo do agente. Não se pode mudar depois.',
    alAgente: 'Para o agente',
    protocolo: 'Protocolo · 2,5 %',
    firmando: 'A assinar…',
    aprobarYPagar: (cantidad: string, moneda: string) => `Aprovar e pagar ${cantidad} ${moneda}`,
    eligeValoracion: 'Escolhe uma avaliação',
    algoNoCuadra: 'Algo não bate certo · abrir disputa',
    disputaTitulo: 'Abrir uma disputa',
    disputaTexto: (cantidad: string, moneda: string) =>
      `O depósito de ${cantidad} ${moneda} fica congelado. Nem tu nem o agente recebem até estar resolvido.`,
    loQueVeraQuienDecide: 'O que verá quem decide',
    pruebaBrief: 'O que pediste, palavra por palavra',
    pruebaEntrega: 'O ficheiro entregue e o hash dele',
    pruebaHilo: 'A conversa inteira',
    decide: 'Decide',
    decidePie: 'um 2-de-3, não uma só chave',
    catorceDias:
      'Se o árbitro não resolver em 14 dias, recuperas o pagamento inteiro. Pode reclamá-lo qualquer pessoa e não é preciso a autorização dele.',
    abriendo: 'A abrir…',
    abrirDisputa: 'Abrir disputa',
  },

  hilo: {
    volver: 'Voltar',
    porMensaje: (cantidad: string, moneda: string) => `${cantidad} ${moneda} por mensagem`,
    soloEncargos: 'só aceita encomendas',
    encargar: 'Encomendar',
    sinHablar:
      'Ainda não falaram. O que escreveres aqui paga-se por mensagem e ele responde na hora.',
    escribeHueco: 'Escreve a tua mensagem…',
    sinCobroHueco: 'Este agente não cobra por mensagem',
    enviar: 'Enviar',
    piePrecio: (cantidad: string, moneda: string) =>
      `${cantidad} ${moneda} por mensagem · uma assinatura, sem gas`,
    sinCobroPie: 'Sem preço por mensagem publicado',
    cabeceraEncargo: 'Encomenda · pagamento bloqueado',
    encargoNumero: (id: string) => `Encomenda #${id}`,
    precio: 'Preço',
    numero: 'N.º',
    abierto: 'Pagamento bloqueado · o agente está a trabalhar',
    entregado: 'Entregue · revê',
    completado: 'Concluído',
    disputado: 'Em disputa · o pagamento está congelado',
    cancelado: 'Cancelado · o pagamento voltou',
    cancelaste: 'Cancelaste a assinatura. Não se cobrou nada.',
    sinRed: 'Não foi possível falar com o agente. Se não chegou a responder, não se cobrou nada.',
  },

  alta: {
    volver: 'Voltar',
    titulo: 'Registar um agente',
    quienSera: 'Quem vai ser o agente',
    delLlavero: 'Do teu porta-chaves',
    laConectada: 'A wallet ligada',
    yaRegistrada: (nombre: string) =>
      `Esta wallet JÁ está registada como «${nombre}». Um endereço só pode ser um agente; para outro é preciso outra wallet.`,
    conectarLaQueSera: 'Ligar a wallet que vai ser o agente',
    seConvierteEn: 'passa a ser o agente',
    avisoClaveAntes: 'A wallet que assinar isto',
    avisoClaveDespues:
      ': o registo não distingue uma coisa da outra. E a chave dela vai ter de estar no servidor que o põe a funcionar, por isso usa uma nova — não a que guarda o teu dinheiro.',
    tienesEnLlavero: (n: number) =>
      `Tens ${n} ${n === 1 ? 'wallet' : 'wallets'} no porta-chaves deste telemóvel.`,
    suFicha: 'A ficha dele',
    nombre: 'Nome',
    nombreHueco: 'Audit',
    queHace: 'O que faz',
    queHaceHueco: 'Audita contratos e entrega o relatório',
    dondeEscucha: 'Onde escuta',
    dondeEscuchaHueco: 'https://o-teu-agente.lat',
    sinDireccionTitulo: 'Sem endereço, ninguém lhe vai poder falar',
    sinDireccionAntes: 'A app procura',
    sinDireccionDespues:
      'na ficha para saber para onde mandar as mensagens. Sem isso só aceita encomendas com depósito, e o botão de falar aparece desligado a toda a gente. Já acontece a um dos agentes registados.',
    loQueCobra: 'O que cobra por encomenda',
    loQueSeEscribe: 'O que vai ser escrito na cadeia',
    firmaCancelada: 'A assinatura foi cancelada.',
    noSePudoFirmar: 'Não foi possível assinar o registo.',
    firmando: 'A assinar o registo…',
    firmarAlta: 'Assinar o registo',
    pieGas:
      'Assina-o a wallet de cima e paga o gas dela, por isso precisa de algum MON. O preço e a ficha podem mudar depois; o endereço não.',
  },

  guardia: {
    volver: 'Voltar',
    titulo: 'Guarda',
    subtitulo: 'O que tem por fechar',
    sinCerrar: (n: number) => `${n} por fechar`,
    todo: (n: number) => `Tudo · ${n}`,
    correPrisa: (n: number) => `Urgente · ${n}`,
    leyendo: 'A ler a cadeia…',
    nadaTitulo: 'Não há nada por fechar',
    nadaTexto: 'Nem encomendas abertas, nem entregas à espera, nem dinheiro dentro do depósito.',
    deLaCadena:
      'Isto tudo sai da cadeia, não do teu servidor. É de propósito: serve precisamente quando o que falhou foi o teu servidor e o vigilante dele julga que está tudo bem.',
    motivoSinEntregar: 'Aberta e por entregar',
    motivoSinCobrar: 'Ganho e por cobrar',
    motivoSinAprobar: 'Entregue, à espera do cliente',
    motivoDisputa: 'Em disputa',
    plazoVencio: 'o prazo expirou',
    quedan: 'faltam',
    horas: (h: number) => `${h} h`,
    diasHoras: (d: number, h: number) => (h ? `${d} d ${h} h` : `${d} d`),
    firmando: 'A assinar…',
    cobrar: (cantidad: string, moneda: string) => `Cobrar ${cantidad} ${moneda}`,
    noSePuedeEntregar:
      'Daqui não se pode entregar: isso assina-o o teu agente com a chave dele, e o resultado está no teu servidor. O que esta janela dá é dares por isso a tempo.',
    disputaPie: (dias: number) =>
      `Se o árbitro não resolver em ${dias} dias, o pagamento volta inteiro para o cliente e pode reclamá-lo qualquer pessoa.`,
    deposito: (cantidad: string, moneda: string) => `o depósito de ${cantidad} ${moneda}`,
    explSinEntregarVencido: (deposito: string) =>
      `O prazo passou e não há nada ancorado. O cliente pode recuperar ${deposito} quando quiser, e aí não recebes.`,
    explSinEntregar: (deposito: string) =>
      `O teu agente ainda não ancorou nada. Se ninguém entregar antes do prazo, o cliente recupera ${deposito} e tu não recebes.`,
    explSinCobrar: (cantidad: string, moneda: string) =>
      `Há ${cantidad} ${moneda} liquidados e ainda dentro do depósito. Não caducam, mas também não saem sozinhos.`,
    explSinAprobar: (deposito: string) =>
      `Já está ancorada. Se o cliente não a aprovar nem a disputar, liberta-se sozinha e recebes ${deposito}.`,
    explDisputa: (deposito: string) =>
      `Foi o cliente que a abriu. ${deposito[0]!.toUpperCase()}${deposito.slice(1)} está congelado: nem tu nem ele recebem até o árbitro decidir.`,
  },

  cartera: {
    volver: 'Voltar',
    titulo: 'Carteira',
    subtitulo: (n: number) => `${n} ${n === 1 ? 'agente' : 'agentes'} · só ver`,
    ningunoTitulo: 'Não segues nenhum',
    ningunoTexto:
      'Cola o endereço de um agente e vê-lo-ás por inteiro: o que ganha, o que lhe falta cobrar e o que tem por fechar.',
    seguirAUno: 'Seguir um',
    sinCobrarTotal: 'Por cobrar em toda a carteira',
    nadaDentro: 'Nada dentro do depósito.',
    firmasAntes: 'Recolhê-lo são',
    firmasDespues:
      ': uma por agente e moeda, cada uma a partir da wallet desse agente. Daqui não dá —',
    firmas: (n: number) => `${n} assinaturas`,
    firmasCola: 'paga a quem assina.',
    enRiesgo: (n: number) =>
      n === 1
        ? 'Um agente tem encomendas com o prazo expirado e por entregar.'
        : `${n} agentes têm encomendas com o prazo expirado e por entregar.`,
    noSePudoLeer:
      'Não foi possível ler a cadeia. Os saldos e os estados aqui em baixo podem estar incompletos.',
    todos: (n: number) => `Todos · ${n}`,
    activos: (n: number) => `Ativos · ${n}`,
    pausados: (n: number) => `Em pausa · ${n}`,
    leyendo: 'A ler a cadeia…',
    seguirAOtro: 'Seguir outro',
    activo: 'Ativo',
    pausado: 'Em pausa',
    sinRegistrar: 'Por registar',
    sinCobrar: 'por cobrar',
    dejarTexto:
      'Sai da tua lista. O agente continua na mesma, e podes voltar a segui-lo colando o endereço dele.',
    dejarDeSeguir: 'Deixar de seguir',
    avisos: {
      'sin-registrar': 'Não está registada como agente.',
      vencidos: (n: number) =>
        n === 1
          ? 'Tem uma encomenda com o prazo expirado e por entregar.'
          : `Tem ${n} encomendas com o prazo expirado e por entregar.`,
      'pausado-con-dinero': 'Em pausa e com dinheiro lá dentro.',
      'pausado-con-dinero-sin-endpoint':
        'Em pausa e com dinheiro lá dentro. A ficha dele também não declara endpoint.',
      pausado: 'Em pausa: não aparece no mercado e não lhe pode entrar trabalho.',
      'sin-endpoint': 'Sem endpoint na ficha: só aceita encomendas, não mensagens.',
      abiertos: (n: number) =>
        n === 1 ? 'Tem uma encomenda aberta.' : `Tem ${n} encomendas abertas.`,
    },
  },

  expediente: {
    volver: 'Voltar',
    leyendo: 'A ler a cadeia…',
    noAparece: 'Essa encomenda não aparece entre as tuas. Pode ser de outra wallet.',
    titulo: (id: string) => `Encomenda #${id}`,
    guardarBoton: 'Guardar o processo',
    abierto: 'Aberta',
    entregado: 'Entregue',
    completado: 'Concluída',
    disputado: 'Em disputa',
    cancelado: 'Cancelada',
    enLaCadena: 'Na cadeia · para sempre',
    enTuTelefono: 'No teu telemóvel · só aqui',
    cliente: 'Cliente',
    agente: 'Agente',
    creado: 'Criada',
    plazo: 'Prazo',
    filaEntregado: 'Entregue',
    hashPedido: 'Hash do que pediste',
    hashEntrega: 'Hash da entrega',
    loQuePediste: 'O que pediste',
    cuadra: 'bate certo com a cadeia',
    noCuadra: 'NÃO bate certo',
    briefPerdido:
      'Não está neste telemóvel. Na cadeia só viaja o hash, por isso o texto do que pediste perdeu-se — de outro telemóvel, ou porque o arquivo chegou ao limite e o deitou fora.',
    loQueEntrego: 'O que entregou',
    adjuntoPie: (tamano: string) => `${tamano} · o ficheiro descarrega-se do agente, aqui está o hash`,
    entregaNoLaTienes:
      'Não a tens. Pode voltar a pedir-se ao agente enquanto ele estiver de pé; se não, o hash de cima já não prova nada por si só.',
    pidiendola: 'A pedi-la…',
    traerEntrega: 'Trazer a entrega e guardá-la',
    firmarasPie: 'Vais assinar uma mensagem para o agente saber que és o cliente dele. Não custa gas.',
    sinEntregar: 'Ainda não entregou nada. Quando entregar, o texto fica aqui.',
    laConversacion: 'A conversa',
    mensajes: (n: number, rango: string) => `${n} mensagens, ${rango}`,
    elDia: (d: string) => `a ${d}`,
    delAl: (a: string, b: string) => `de ${a} a ${b}`,
    preparando: 'A preparar…',
    guardarPie:
      'Um ficheiro com tudo: o da cadeia, o teu briefing, a entrega e a conversa. Abre sem a app.',
    sinEndpoint: 'Este agente não publica endpoint no registo, por isso não há a quem pedi-la.',
    firmaRechazada: 'O agente não reconhece essa assinatura como sendo do cliente desta encomenda.',
    entregaVacia: 'O agente devolveu uma entrega vazia.',
    noCuadraHash: 'O que o agente devolveu não bate certo com o hash da cadeia. Não se guarda.',
    noSePudoHablar: 'Não foi possível falar com o agente.',
  },

  informe: {
    volver: 'Voltar',
    titulo: 'Relatório',
    subtitulo: (nombre: string) => `${nombre} · o que entrou e o que ficou`,
    todo: 'Tudo',
    leyendo: 'A ler o índice…',
    indiceCaido:
      'O índice não responde. Sem ele não se podem fazer as contas: a cadeia guarda quanto foi bloqueado, mas o que de facto se cobrou está nos eventos de liquidação.',
    periodoVacio: 'Nesse período não se liquidou nenhuma encomenda.',
    nadaLiquidado:
      'Ainda não se liquidou nenhuma encomenda deste agente. O que estiver aberto ou entregue ainda não entrou em caixa.',
    faltanMensajesTitulo: 'As mensagens não estão aqui',
    faltanMensajesTexto:
      'Isto é só o que passou pelo depósito. O que cobras por mensagem avulsa paga-se com uma transferência do token e não fica registado como encomenda, por isso não aparece. Para agentes que vivem disso, este relatório mostra uma fatia pequena — e convém saberes isso antes de o dares a alguém.',
    preparando: 'A preparar…',
    descargar: 'Descarregar o relatório',
    descargarPie:
      'Uma folha de cálculo com uma linha por encomenda e o hash de cada transação, para a tua contabilidade poder verificar sem confiar na app.',
    en: (moneda: string) => `Em ${moneda}`,
    aparte: 'leva-se à parte, não se soma',
    facturado: 'Faturado',
    encargosLiquidados: (n: number) =>
      `${n} ${n === 1 ? 'encomenda liquidada' : 'encomendas liquidadas'}`,
    devueltoEnDisputa: 'Devolvido em disputa',
    unEncargo: (id: string) => `uma encomenda, ${id}`,
    variosEncargos: (n: number, ids: string) => `${n} encomendas: ${ids}`,
    comision: 'Comissão do Panal',
    comisionPie: '2,5 % do que cada um cobra',
    tuyo: 'Teu',
    todoEn: (moneda: string) => `tudo em ${moneda}`,
    encargoPorEncargo: 'Encomenda a encomenda',
    disputada: 'Disputada · devolvido em parte',
    reciboTitulo: (id: string) => `Encomenda n.º ${id}`,
    precioEncargo: 'Preço da encomenda',
    devueltoAlCliente: 'Devolvido ao cliente',
    cobrado: 'Recebido',
    laTransaccion: 'A transação que o prova',
    guardarRecibo: 'Guardar o recibo',
    reciboPie:
      'Um A5 para imprimir. Comprova o recebimento; não é uma fatura — o próprio papel explica porquê.',
    reciboListo: (donde: string) => `Recibo pronto em ${donde}.`,
    reciboFallo: (porque: string) => `Não foi possível: ${porque}`,
    informeListo: (donde: string) => `Relatório pronto em ${donde}.`,
  },

  panel: {
    volver: 'Voltar',
    leyendoRegistro: 'A ler o registo…',
    sinRegistrar: 'Por registar',
    sinRegistrarTexto:
      'Esse endereço não está registado como agente no Panal. Pode ser uma wallet normal, ou o registo pode nunca ter chegado a ser assinado.',
    desde: (mes: string) => `desde ${mes}`,
    administras: 'administras',
    sigues: 'segues',
    ganadoSinCobrar: 'Ganho e por cobrar',
    cobrar: 'Cobrar',
    soloElAgenteAntes: 'Só o próprio agente o pode tirar:',
    soloElAgenteDespues: 'paga a quem assina.',
    todoCobrado: 'Tudo cobrado. Está na wallet dele.',
    pausadoTitulo: 'Está em pausa',
    pausadoTexto:
      'Não aparece no mercado e não lhe pode entrar nenhuma encomenda nova. As que já estivessem abertas seguem o seu curso.',
    aceptarTrabajo: 'Aceitar trabalho',
    precioPorEncargo: 'Preço por encomenda',
    fichaYEndpoint: 'Ficha e endpoint',
    sinEndpoint: 'sem endpoint',
    sinBotAntes: 'A ficha dele não declara',
    sinBotDespues: ', por isso ninguém lhe pode falar por mensagem. Só aceita encomendas',
    sinBotYPausado: ' — e neste momento nem isso',
    guardia: 'Guarda',
    mirando: 'A ver…',
    urgentes: (n: number) => `${n} por fechar e urgentes`,
    nadaPendiente: 'Nada pendente',
    informe: 'Relatório',
    informePie: 'O que entrou e o que ficou, com recibo por encomenda',
    ultimosEncargos: 'Últimas encomendas',
    leyendoCadena: 'A ler a cadeia…',
    sinEncargos: 'Ainda não lhe encomendaram nada.',
    encargoNumero: (id: string) => `Encomenda #${id}`,
    tAbierto: 'Aberta · por entregar',
    tEntregado: 'Entregue · à espera do cliente',
    tCompletado: 'Cobrada',
    tDisputado: 'Em disputa',
    tCancelado: 'Cancelada',
    cobrarTitulo: 'Cobrar o que ganhou',
    cobrarNota:
      'Cada moeda sai em separado: o contrato cobra uma de cada vez. São duas assinaturas.',
    unaFirma: 'uma assinatura',
    sacar: 'Tirar',
    firmando: 'A assinar…',
    vaASuDireccion:
      'O que se cobra vai para este mesmo endereço, que é o do agente. Para ir para outro seria preciso mudar o contrato.',
    precioTexto:
      'O que cobra por um trabalho com depósito. As mensagens avulsas cobram-se à parte, no servidor dele.',
    precioNota:
      'Só afeta as encomendas que entrem a partir de agora. O que já está bloqueado liquida-se ao preço que foi combinado.',
    firmarCambio: 'Assinar a alteração',
    pausarTitulo: 'Pôr o agente em pausa',
    reactivarTitulo: 'Voltar a aceitar trabalho',
    pausarTexto:
      'Deixa de aparecer no mercado e não lhe pode entrar nenhuma encomenda nova. As que já estiverem abertas seguem o seu curso, e continuas a ter de as entregar.',
    reactivarTexto:
      'Volta a aparecer no mercado e pode entrar-lhe trabalho. Certifica-te de que o servidor dele está de pé antes de assinares isto.',
    pausar: 'Pausar',
    reactivar: 'Reativar',
    nombre: 'Nome',
    queHace: 'O que faz',
    dondeEscucha: 'Onde escuta',
    dondeEscuchaHueco: 'https://o-teu-agente.lat',
    sinBotFichaAntes: 'Sem endereço ninguém lhe vai poder falar. A app procura',
    sinBotFichaDespues:
      'na ficha para saber para onde mandar as mensagens; sem isso só aceita encomendas com depósito.',
    loQueSeEscribe: 'O que vai ser escrito',
    firmar: 'Assinar',
  },

  avisos: {
    sinEntregarTitulo: (id: string) => `O teu agente continua sem entregar a #${id}`,
    sinEntregarCuerpo: (horas: number, cantidad: string, moneda: string) =>
      `Faltam ${horas} h de prazo. Se expirar, o cliente recupera ${cantidad} ${moneda} e tu não recebes.`,
    sinEntregarVencido: (cantidad: string, moneda: string) =>
      `O prazo expirou: o cliente pode recuperar ${cantidad} ${moneda}.`,
    disputaTitulo: (id: string) => `Disputaram a #${id}`,
    disputaCuerpo: (cantidad: string, moneda: string) =>
      `O depósito de ${cantidad} ${moneda} fica congelado até o árbitro decidir.`,
    entregaTitulo: (id: string) => `Entregaram a encomenda #${id}`,
    entregaCuerpo: 'Toca para rever a entrega.',
    cuentaAtrasTitulo: (id: string) => `Faltam 6 h para a #${id} se aprovar sozinha`,
    cuentaAtrasCuerpo: (cantidad: string, moneda: string) =>
      `Se não fizeres nada pagam-se ${cantidad} ${moneda} e conta como 5 estrelas.`,
    plazoTitulo: (id: string) => `A #${id} expirou sem entrega`,
    plazoCuerpo: (cantidad: string, moneda: string) =>
      `Podes recuperar o depósito de ${cantidad} ${moneda} que bloqueaste.`,
  },

  pegas: {
    'sin-destino': 'Falta o endereço para onde o mandar.',
    'destino-malo': 'Esse endereço não serve. Um da Monad tem 42 caracteres e começa por 0x.',
    'destino-soy-yo': 'Essa é esta mesma wallet. Põe o endereço de destino.',
    'sin-cantidad': 'Escreve quanto.',
    'cantidad-mala': 'Isso não é uma quantia.',
    'cantidad-cero': 'A quantia é zero.',
    'no-hay-tanto': (moneda: string) => `Não há assim tanto ${moneda} nesta wallet.`,
    'deja-gas': 'Deixa algum MON para a taxa da rede. Usa «Tudo» e ele calcula-o por ti.',
    'sin-mon-para-gas':
      'Esta wallet não tem MON, e a rede cobra a taxa em MON. Manda-lhe um pouco primeiro.',
    'poco-mon': 'Resta muito pouco MON. Se a taxa subir, a transação cai.',
    'ni-palabras-ni-clave': 'Isso não são 12 palavras nem uma chave privada. Cola uma das duas coisas.',
    'palabras-no-cuadran':
      'Essas palavras não batem certo. Vê outra vez: alguma não é da lista, ou estão noutra ordem.',
    ilegible: 'Não foi possível ler isso como uma wallet.',
    repetida: 'Essa wallet já está no porta-chaves.',
    noLlega: 'Não chega para a quantia mais a taxa da rede. Manda um pouco menos.',
    sinSaldo: 'A wallet não tem esse saldo.',
    otraEnMarcha: 'Há outra transação desta wallet ainda a decorrer. Espera que termine.',
    sinRed: 'Não foi possível falar com a rede. Verifica a ligação e tenta outra vez.',
    cancelado: 'Cancelado.',
    rechazada: 'A rede rejeitou a transação. Não se moveu nada.',
  },

  recibo: {
    titulo: 'Recibo de cobrança',
    tituloPagina: (id: string) => `Recibo · encomenda ${id}`,
    sub: (id: string, fecha: string) => `Encomenda n.º ${id} · ${fecha}`,
    cobra: 'Recebe',
    huecoNombre: '[O TEU NOME OU RAZÃO SOCIAL]',
    huecoNif: '[NIF / VAT]',
    huecoDireccion: '[MORADA]',
    agente: (nombre: string) => `agente ${nombre}`,
    pago: 'Pagou',
    esUnaDireccion: 'É um endereço da Monad, não uma identidade fiscal. O Panal não sabe quem está por trás.',
    por: 'Por',
    huecoTrabajo: '[DESCRIÇÃO DO TRABALHO]',
    briefPerdido:
      'O texto do que foi pedido não está neste telemóvel: a cadeia só guarda o hash, e quem o escreveu foi o cliente.',
    precioEncargo: 'Preço da encomenda',
    devuelto: 'Devolvido ao cliente (disputa)',
    comision: 'Comissão do Panal',
    cobrado: 'Recebido',
    laTransaccion: 'A transação que o prova',
    huellaEntrega: 'Impressão do que foi entregue',
    noEsFacturaTitulo: 'Isto comprova um recebimento. Não é uma fatura.',
    noEsFacturaTexto: (moneda: string) =>
      `Uma fatura precisa de um cliente identificado e de um tratamento fiscal que dependem de onde declaras, e aqui o cliente é um endereço. Este papel diz quanto entrou, quando, de onde e com que transação se pode verificar na cadeia — que é o que a tua contabilidade precisa para emitir a fatura que corresponder. Os valores estão em ${moneda}, sem converter: o preço é posto por um mercado e muda, por isso pôr euros aqui seria inventar um número.`,
    csv: {
      encargo: 'encomenda',
      fecha: 'data',
      cliente: 'cliente',
      moneda: 'moeda',
      facturado: 'faturado',
      devuelto: 'devolvido',
      comision: 'comissao',
      cobrado: 'recebido',
      nota: 'nota',
      transaccion: 'transacao',
      hashEntrega: 'hash_entrega',
      estrellas: (n: number) => `${n} estrelas`,
      total: (moneda: string) => `TOTAL ${moneda}`,
      pieAgente: (nombre: string, dir: string) =>
        `Agente ${nombre} (${dir}). Valores sem converter: o preço é posto por um mercado.`,
      pieAviso:
        'Isto comprova recebimentos; não é uma fatura. O que se cobra por mensagem avulsa NÃO aparece aqui.',
    },
  },

  copia: {
    encargo: 'Encomenda',
    cliente: 'Cliente',
    agente: 'Agente',
    importe: 'Valor',
    estado: 'Estado',
    creado: 'Criada',
    plazo: 'Prazo',
    entregado: 'Entregue',
    hashPedido: 'Hash do que se pediu',
    hashEntrega: 'Hash da entrega',
    estados: ['Aberta', 'Entregue', 'Concluída', 'Em disputa', 'Cancelada'],
    titulo: (id: string) => `Encomenda #${id}`,
    sacadaEl: (fecha: string) => `Cópia tirada a ${fecha} a partir da app do Panal.`,
    enLaCadena: 'Na cadeia · para sempre',
    loQuePediste: 'O que pediste',
    cuadra: ' · bate certo com a cadeia',
    noCuadra: ' · NÃO bate certo com a cadeia',
    briefPerdido:
      'Não estava no telemóvel quando esta cópia foi tirada. Na cadeia só viaja o hash, por isso o texto do que se pediu perdeu-se.',
    loQueEntrego: 'O que entregou',
    entregaPerdida:
      'Não estava no telemóvel. Pode voltar a pedir-se ao agente enquanto ele estiver de pé; se não, o hash de cima já não prova nada por si só.',
    archivos: 'Ficheiros que a entrega anuncia',
    archivosAviso:
      'Estes ficheiros NÃO estão dentro desta cópia: descarregam-se do servidor do agente. O que fica aqui é o hash deles, que serve para verificar que uns bytes que tenhas são os que foram entregues.',
    laConversacion: 'A conversa',
    tu: 'Tu',
    elAgente: 'O agente',
    pie: 'Panal · o depósito guarda nove campos por encomenda e nem um a mais. O que houver nesta página que não esteja na tabela de cima só existia num telemóvel. Este ficheiro não pede nada a nenhum servidor: abre na mesma sem internet.',
    tusExpedientes: 'Os teus processos',
    cuantos: (n: number, quien: string, fecha: string) =>
      `${n} ${n === 1 ? 'encomenda' : 'encomendas'} de ${quien}, copiadas a ${fecha}.`,
    indice: 'Índice',
    guardarExpediente: 'Guardar o processo',
    descargas: 'Transferências',
    elTelefono: 'o telemóvel',
  },

  tiempo: {
    ahora: 'agora',
    ayer: 'ontem',
    yaSePuedeLiberar: 'já se pode libertar',
    dias: (d: number, h: number) => `${d} d ${h} h`,
    horas: (h: number) => `${h} h`,
    minutos: (m: number) => `${m} min`,
  },

  arranque: {
    titulo: 'Conversas',
    fueraTitulo: 'Agentes que cobram sozinhos',
    fueraTexto: 'A tua wallet é a tua conta: não há registo nem palavra-passe. Liga-a e já podes começar.',
    aCero: 'A tua wallet está a zero',
    sinHablar: 'Ainda não falaste com ninguém',
    aCeroTexto: 'É preciso $PANAL para falar com um agente, ou MON para lhe encomendar um trabalho.',
    sinHablarTexto: 'Escolhe um agente no mercado e começa por lhe perguntar alguma coisa.',
    hablarTitulo: 'Falar com um agente',
    hablarPie: 'paga-se por mensagem, em $PANAL',
    hablarEstado: 'sem gas',
    encargarTitulo: 'Encomendar um trabalho',
    encargarPie: 'o dinheiro fica em depósito até ele entregar',
    encargarEstado: 'em MON',
    dondeSeCompra:
      '$PANAL troca-se na nad.fun e o MON trá-lo para o teu endereço de onde já o tenhas. O Panal não vende nenhum dos dois.',
    verMercado: 'Ver o mercado',
    verMercadoPie: 'Ver os agentes e os seus preços não custa nada.',
  },
};
