/**
 * Panal — los textos de la app, en español.
 *
 * Este archivo es el original: la app se escribió en español y las demás
 * traducciones salen de aquí. Por eso `Textos` se deriva de él —`typeof es`—
 * y no de un tipo escrito aparte que habría que acordarse de actualizar.
 *
 * Lo que lleva paréntesis es una función porque la frase cambia con el dato:
 * un plural, un nombre, una cantidad. Meter el dato con `+` desde la pantalla
 * obligaría a que todos los idiomas pusieran las piezas en el mismo orden, y
 * no lo hacen.
 *
 * Los nombres propios no se traducen en ningún idioma: Panal, MON, $PANAL,
 * Monad, WalletConnect, x402, nad.fun. Tampoco «wallet», que es como la llama
 * todo el mundo en los cuatro.
 */

export const es = {
  comun: {
    cancelar: 'Cancelar',
    listo: 'Listo',
    cerrar: 'Cerrar',
    atras: 'Atrás',
    borrar: 'Borrar',
    ahoraNo: 'Ahora no',
    guardar: 'Guardar',
    copiar: 'Copiar',
    copiada: 'Copiada',
    copiarDireccion: 'Copiar dirección',
    conectarWallet: 'Conectar wallet',
    conectando: 'Conectando…',
    desconectar: 'Desconectar',
    tuDireccion: 'Tu dirección',
    suDireccion: 'Su dirección',
    verEnElExplorador: 'Verla en el explorador',
    menu: 'Menú',
    sinNombre: 'Sin nombre',
    walletDelTelefono: 'La wallet de este teléfono',
    llaveroCerrado: 'El llavero está cerrado. Ábrelo con tu PIN.',
    abriendo: 'Abriendo…',
  },

  pestanas: {
    chats: 'Chats',
    mercado: 'Mercado',
    archivo: 'Archivo',
    saldo: 'Saldo',
  },

  menu: {
    sinWallet: 'Sin wallet conectada',
    firmaAqui: 'Firma en este teléfono',
    firmaFuera: 'Firma en tu wallet',
    cambiarWallet: 'Cambiar',
    llavero: 'Tu llavero',
    agentes: 'Tus agentes',
    cartera: 'Tu cartera',
    avisos: 'Avisos del teléfono',
    idioma: 'Idioma',
    red: (nombre: string, id: number) => `Panal · ${nombre} (${id})`,
    version: (v: string) => `Versión ${v}`,
    sinVersion: 'Compilación de desarrollo',
    hayVersion: (v: string) => `Versión ${v} disponible`,
  },

  barraRed: {
    otraRed: 'Tu wallet está en otra red',
    cambiar: (red: string) => `Cambiar a ${red}`,
  },

  avisoFirma: {
    titulo: 'Fírmalo en tu wallet',
    conEnlace: 'La petición ya está allí. Si tu wallet no se ha abierto sola, ábrela tú y apruébala.',
    sinEnlace: 'La petición ya está allí. Cambia a tu wallet y apruébala; al volver, esto sigue.',
    abrir: 'Abrir mi wallet',
  },

  hojaWallet: {
    titulo: 'Conectar tu wallet',
    entradilla: 'Tu wallet es tu cuenta. Panal no guarda ninguna clave ni te pide correo.',
    deEsteTelefono: 'La de este teléfono',
    crearAqui: 'Crear una wallet aquí',
    crearAquiPie: 'Se genera en el teléfono y firma sin salir de la app. Un minuto.',
    dentroPie:
      'Firma aquí dentro, sin abrir nada más. Lo que apruebas es lo que te enseña Panal: no hay una segunda pantalla que te lo repita.',
    oLaQueYaUsas: 'o la que ya usas',
    fueraPie:
      'Se abre tu wallet, apruebas allí y vuelves. Cada firma te saca de Panal, pero lo que firmas te lo enseña ella.',
    abrirMiWallet: 'Abrir mi wallet',
    abrirMiWalletPie: 'Se abre la wallet que tengas instalada, apruebas allí y vuelves aquí.',
    copiarEnlace: 'Copiar el enlace',
    enlaceCopiado: 'Enlace copiado',
    copiarPie: 'Para pegarlo a mano en tu wallet, en «escanear» o «conectar».',
    preparando: 'Preparando la conexión…',
    noSePudo: 'No se pudo conectar',
    sinWalletConnect:
      'Esta versión se compiló sin WalletConnect, así que no hay forma de abrir una wallet desde aquí. Hace falta compilar el APK con',
    usarOtra: 'Usar otra',
    tituloCambiar: 'Cambiar de wallet',
    entradillaCambiar:
      'Con la que elijas se firma todo: los mensajes, los encargos y el dinero que se bloquea. Cada wallet tiene su saldo y sus conversaciones.',
    enUso: 'En uso',
    cambiarPie:
      'Hay que poner el PIN para pasarse a otra. La que estabas usando no se pierde ni se cierra: sigue en el llavero, con lo que tenga dentro.',
    pinCambiar: 'Tu PIN del llavero. A partir de ahí se firma con ésta.',
    pinTitulo: 'Tu PIN del llavero. Con él, firmar deja de sacarte de la app.',
    fueraEnAgentes:
      'Para administrar un agente hay que firmar con la wallet del propio agente. Esa se conecta desde «Tus agentes», en el menú.',
  },

  saldo: {
    titulo: 'Saldo',
    conectaTitulo: 'Conecta tu wallet',
    conectaTexto: 'Es tu cuenta y tu saldo a la vez. No hay registro, ni correo, ni contraseña que recordar.',
    panalParaQue: 'Paga cada mensaje que le mandas a un agente.',
    panalPie: 'Hablar no gasta gas: en x402 firmas tú y la transacción la manda quien cobra.',
    monParaQue: 'Paga los encargos con escrow, y el gas de bloquearlos.',
    monPie: 'Sin MON puedes hablar, pero no encargar un trabajo.',
    dondeSeCompra:
      '$PANAL se cambia en nad.fun, y MON lo traes aquí desde donde ya tengas. Panal no vende ninguna de las dos.',
    llavero: 'Tu llavero',
    llaveroPie:
      'Wallets de este teléfono: verles el saldo, mandar, recibir y traer las que ya tengas. La clave se cifra con un PIN y no sale de aquí.',
    agentes: 'Tus agentes',
    agentesPie: 'Sigue uno o administra el tuyo: cobrar, precio, pausa y ficha.',
    desconectar: (dir: string) => `Desconectar ${dir}`,
    cambiarWallet: 'Cambiar de wallet',
    otraRedTitulo: 'Wallet en otra red',
    otraRedTexto: (red: string) =>
      `Panal vive en ${red}. Mientras tu wallet esté en otra red no se puede firmar nada.`,
  },

  llavero: {
    titulo: 'Tu llavero',
    vacio: 'Vacío, de momento',
    cuantas: (n: number) => `${n} ${n === 1 ? 'wallet' : 'wallets'} en este teléfono`,
    bloquear: 'Bloquear el llavero',
    refrescar: 'Volver a mirar los saldos',
    crear: 'Crear una',
    creando: 'Creando…',
    crearPie: 'Se genera aquí y no la ve nadie más',
    traer: 'Traer una',
    traerPie: 'Con sus palabras o su clave privada',
    sinCopia: 'Sin copia — si pierdes el móvil, se pierde',
    noSePudoLeer: 'No se ha podido leer el saldo. Es la red, no la wallet: lo que haya dentro sigue ahí.',
    noSePudoGuardar: 'No se pudo guardar la wallet. Puede que no quede sitio en el teléfono.',
    noSePudoCrear: 'No se pudo crear el llavero en este teléfono.',
    pinTitulo: 'Pon un PIN',
    pinOtraVez: 'Otra vez, para confirmar',
    pinExplicacion:
      'Seis dígitos. Cifran las wallets que crees aquí, y no hay forma de recuperarlo: si se te olvida, se pierden.',
    pinRepite: 'Repite los mismos seis dígitos.',
    pinNoCoinciden: 'No coinciden. Vuelve a empezar.',
    pinMalo: 'Ese PIN no es',
    bloqueadoTitulo: 'Tu llavero',
    bloqueadoExplicacion: 'Las wallets que guardas en este teléfono. Nada sale de aquí.',
    hastaDonde: 'Hasta dónde llega este PIN',
    hastaDondeTexto:
      'Las claves están cifradas con él dentro del cajón privado de la app: ninguna otra app las lee, y ya no salen en la copia de Google. Lo que el PIN NO para es a alguien con tu teléfono desbloqueado y tiempo. Para eso hace falta el chip seguro del móvil, y a eso el WebView no llega sin escribir un trozo nativo. Guarda aquí lo que usas, no lo que guardas.',
    palabrasTitulo: (n: number) => `Tus ${n} palabras`,
    claveTitulo: 'Su clave privada',
    palabrasTexto: (nombre: string) =>
      `Apúntalas en papel y guárdalas fuera del teléfono. Son la única forma de recuperar ${nombre} si pierdes el móvil — nadie más tiene copia, ni Panal.`,
    claveTexto: (nombre: string) =>
      `Con esto se controla ${nombre} desde cualquier sitio. Guárdala donde guardas lo importante, no en una foto.`,
    peligro:
      'No la guardes en una foto, ni en notas, ni en un chat. Quien la tenga puede vaciar esta wallet desde cualquier sitio, sin el teléfono y sin el PIN.',
    yaApuntadas: 'Ya las tengo apuntadas',
    mandar: 'Mandar',
    recibir: 'Recibir',
    vaciaPie: 'No hay nada que mandar todavía. Toca «Recibir» para ver a dónde mandárselo.',
    verPalabras: 'Ver las 12 palabras',
    verClave: 'Ver la clave privada',
    usarEsta: 'Usar esta wallet',
    usarEstaPie:
      'Pasa a ser con la que hablas y encargas. Te pide el PIN, y la de antes se queda como está.',
    esLaQueUsas: 'Es con la que estás pagando',
    cambiarNombre: 'Cambiar el nombre',
    importada: 'Traída de fuera. Sigue existiendo donde estaba: borrarla de aquí no la borra de allí.',
    creadaAqui: 'Creada en este teléfono. Su copia de seguridad son sus 12 palabras y no hay otra.',
    borrarDelTelefono: 'Borrar del teléfono',
    seguro: '¿Seguro?',
    sinApuntar: 'No has apuntado sus 12 palabras',
    seguroTexto:
      'Se va de este teléfono. Con sus palabras —o su clave— la recuperas en cualquier wallet; sin ellas, no.',
    sinApuntarTexto: 'Si la borras ahora, lo que haya dentro no lo recupera nadie. Ni tú, ni Panal.',
  },

  enviar: {
    titulo: (nombre: string) => `Mandar desde ${nombre}`,
    tienes: (cantidad: string, moneda: string) => `Tienes ${cantidad} ${moneda} en esta wallet.`,
    aQuien: 'A quién',
    cuanto: 'Cuánto',
    pegar: 'Pegar',
    todo: 'Todo',
    todoPie: '«Todo» deja una pizca de MON para la comisión de red. Sin ella la transacción no sale.',
    continuar: 'Continuar',
    repasa: 'Repásalo',
    repasaTexto:
      'Se firma con la clave de este teléfono, así que no se va a abrir ninguna otra app a enseñártelo. Esto es lo que se manda.',
    aEstaDireccion: 'A esta dirección',
    cantidad: 'Cantidad',
    desde: 'Desde',
    red: 'Red',
    comision: 'Comisión de red',
    comisionPie: 'La paga esta wallet',
    enMon: 'En MON',
    sinVuelta:
      'Una vez mandado no hay quien lo devuelva, ni Panal ni nadie. Si esa dirección no es, el dinero se queda donde caiga.',
    firmar: 'Firmar y mandar',
    mandando: 'Mandando…',
    mandado: 'Mandado',
    a: (dir: string) => `a ${dir}`,
    noCierres:
      'No cierres la app. Si tarda, la transacción ya está mandada: se ve en el explorador con el enlace de arriba.',
    revertida: 'La red la ha rechazado al ejecutarla. No se ha movido nada.',
  },

  recibir: {
    titulo: (nombre: string) => `Meterle a ${nombre}`,
    texto:
      'Manda MON o $PANAL a esta dirección desde donde ya los tengas: tu otra wallet, un exchange, otra persona.',
    compartir: 'Compartir',
    redAviso: (red: string, id: number) =>
      `Tiene que salir por ${red} (${id}). La misma dirección existe en otras redes, y lo que llegue por otra no aparece aquí ni se puede recuperar desde la app.`,
    gasAviso:
      'Deja algo de MON aunque solo vayas a mover $PANAL: la comisión de red se paga en MON, y una wallet con $PANAL y cero MON no puede mandar nada.',
  },

  importar: {
    titulo: 'Traer una wallet',
    texto:
      'Pega sus 12 o 24 palabras, o su clave privada. Se guarda cifrada con el mismo PIN que el resto del llavero.',
    etiqueta: 'Palabras o clave',
    hueco: 'abandon ability able…  ·  o  0x…',
    pareceClave: 'Parece una clave privada.',
    parecenPalabras: 'Parecen palabras de recuperación.',
    comoLaLlamas: 'Cómo la llamas',
    huecoNombre: 'Importada',
    aviso:
      'Escribe esto solo si el teléfono es tuyo y nadie mira. Quien tenga estas palabras puede vaciar la wallet desde cualquier sitio, sin el móvil y sin el PIN.',
    boton: 'Traerla al llavero',
    comprobando: 'Comprobando…',
    noSePudo: 'No se ha podido guardar en este teléfono.',
    noSePudoAbrir: 'No se pudo abrir esa wallet.',
  },

  chats: {
    titulo: 'Chats',
    buscarAgente: 'Buscar un agente',
    tu: 'Tú: ',
    encargoNumero: (id: string) => `Encargo #${id}`,
    entregado: 'Entregado · te queda aprobar',
    enMarcha: 'Encargo en marcha',
  },

  mercado: {
    titulo: 'Mercado',
    buscar: 'Buscar un agente',
    limpiar: 'Limpiar',
    sinAgentes: 'Todavía no hay ningún agente registrado en la cadena.',
    sinResultados: 'Ninguno se llama así ni hace eso.',
    porEncargo: 'encargo',
    sinPrecio: 'sin precio de encargo',
    tareas: (n: number) => `· ${n} ${n === 1 ? 'tarea' : 'tareas'}`,
  },

  archivo: {
    titulo: 'Tus expedientes',
    subtitulo: 'Lo que la cadena no guarda de cada encargo',
    conectaTitulo: 'Conecta tu wallet',
    conectaTexto: 'Los expedientes son de una dirección: son sus encargos y sus conversaciones.',
    holgado: 'El archivo va holgado',
    apretado: (quedan: number) => `Quedan ${quedan} antes de empezar a perder`,
    deTantos: (n: number, tope: number) => `${n} de ${tope}`,
    salud: (briefsTope: number, hilosTope: number, hilos: number) =>
      `La app guarda ${briefsTope} briefs y, al llegar ahí, va tirando los más viejos sin avisar. Los hilos tienen su propio tope: ${hilosTope} conversaciones (${hilos} guardadas). Y todo esto vive en este teléfono: borrar los datos de la app lo pierde, y cambiar de móvil no se lo lleva.`,
    sacarCopia: 'Sacar una copia de todo',
    preparando: 'Preparando…',
    sacarCopiaPie: 'Un archivo que se abre sin la app y no caduca',
    copiaLista: (donde: string) => `Copia lista en ${donde}.`,
    copiaFallo: (porque: string) => `No se pudo sacar la copia: ${porque}`,
    todos: (n: number) => `Todos · ${n}`,
    completos: (n: number) => `Completos · ${n}`,
    conHuecos: (n: number) => `Con huecos · ${n}`,
    leyendo: 'Leyendo la cadena…',
    sinNada:
      'Todavía no has encargado nada. Cuando lo hagas, aquí queda el expediente: lo que pediste, lo que te entregaron y la conversación entera.',
    sinBrief: 'Sin el texto de lo que pediste',
    soloCadena: 'Solo lo de la cadena · el brief se perdió',
    faltaEntrega: 'Falta la entrega',
    completoConHilo: 'Completo · brief, entrega y hilo',
    completoSinHilo: 'Completo · brief y entrega',
    sinEntregar: 'Brief guardado · aún sin entregar',
  },

  agentes: {
    titulo: 'Tus agentes',
    entradilla:
      'Hay dos formas de entrar, y no son la misma cosa. Elige por dónde va a firmar tu agente, no por comodidad.',
    seguirTitulo: 'Seguirlo',
    seguirTexto:
      'Pegas su dirección y lo ves entero: cuánto ha ganado, qué le queda por cobrar, qué encargos tiene. No firma nada porque no hay nada que firmar.',
    seguirPie: 'La clave de tu agente no sale de tu servidor.',
    administrarTitulo: 'Administrarlo',
    administrarTexto:
      'Todo lo anterior, y además cobrar, cambiar el precio, pausarlo y editar su ficha. Cada cosa es una firma suya.',
    administrarPie: 'Es la misma clave que firma sus entregas',
    laDireccion: 'La dirección del agente',
    verlo: 'Verlo',
    registroNoDistingue: 'El registro no distingue entre el agente y su dueño:',
    actuanSobreQuienFirma:
      'actúan sobre quien firma. Para mandar desde el móvil tienes que conectar la wallet del propio agente — la que ahora mismo está en tu servidor.',
    administrarA: (dir: string) => `Administrar ${dir}`,
    conectarLaDelAgente: 'Conectar la wallet del agente',
    losQueSigues: 'Los que sigues',
    verlosJuntos: 'Verlos juntos',
    pausado: 'pausado',
    altaTitulo: 'Dar de alta uno nuevo',
    altaPie: 'Con una wallet vacía: la que registres es la que será el agente',
  },

  agente: {
    volver: 'Volver',
    tareasCompletadas: 'tareas completadas',
    valoraciones: (n: number) => `${n} valoraciones`,
    sinValoraciones: 'sin valoraciones',
    cobrados: (moneda: string) => `${moneda} cobrados`,
    hablar: 'Hablar',
    hablarPie: 'respuesta al momento · sin disputa',
    noDisponible: 'no disponible',
    encargar: 'Encargar un trabajo',
    encargarPie: 'plazo · entrega anclada · disputa',
    sinPrecio: 'sin precio',
    buscando: 'Buscándolo en la cadena…',
    botonHablar: 'Hablar',
    botonEncargar: 'Encargar',
    verificado: 'Verificado',
    verificadoTexto:
      'Su dominio publica un agent.json que declara esta dirección. El nombre lo escribe cualquiera; el dominio no.',
    noVerificado: 'No verificado',
    noVerificadoTexto: 'Se miró su dominio y no confirma esta dirección. Puede ser una suplantación.',
    sinComprobar: 'Sin comprobar',
    sinComprobarTexto:
      'Nadie ha mirado todavía si algún dominio declara esta dirección. No es lo mismo que verificado: es que no se sabe.',
    nombreSinOrigen: (dias: number) => `No se sabe cómo llegó a tener el nombre · hace ${dias} d`,
    // `origen` llega del indexador en español; cada idioma lo traduce aquí en
    // vez de interpolarlo crudo, que dejaría «Name comprado 5 d ago».
    origenes: { reclamado: 'reclamado', comprado: 'comprado', recibido: 'recibido' },
    nombreOrigen: (origen: string, dias: number) => `Nombre ${origen} hace ${dias} d`,
    nombreReciente:
      'Los números de abajo son de esta dirección, no del nombre. La reputación no viaja en una venta: se queda con quien lo vendió.',
  },

  firmar: {
    titulo: 'Confirmar el mensaje',
    entradilla: 'Firmas un permiso y el agente cobra al responder. No gastas gas: la transacción la manda él.',
    coste: 'Coste del mensaje',
    gas: 'Gas',
    gasLoPaga: 'Lo paga el agente',
    subioPrecio: (cantidad: string, moneda: string) =>
      `El agente pide más de lo que anunciaba en su ficha (${cantidad} ${moneda}). Lo que firmas es lo de arriba.`,
    sinConstancia:
      'Una conversación no deja constancia en la cadena. Si quieres entrega verificable y derecho a disputa, encárgalo como trabajo.',
    esperando: 'Esperando…',
    firmarYEnviar: 'Firmar y enviar',
  },

  encargar: {
    titulo: 'Encargar trabajo',
    quePides: 'Qué le pides',
    nivel: 'Nivel',
    nivelTope: (n: number) => `Hasta ${n.toLocaleString()} caracteres`,
    briefHueco: 'Describe el trabajo. Esto es lo que verá el agente.',
    plazo: 'Plazo',
    // Las unidades también se traducen: «6 h» en chino se lee «6 小时».
    horas: (n: number) => `${n} h`,
    dias: (n: number) => `${n} d`,
    plazoPie: 'Si no entrega a tiempo, recuperas el pago entero.',
    precioAgente: 'Precio del agente',
    protocolo: 'Protocolo · 2,5 %',
    bloqueasAhora: 'Bloqueas ahora',
    retenido:
      'El dinero queda retenido hasta que apruebes. La entrega se ancla en la cadena y puedes abrir una disputa.',
    aprobandoToken: 'Aprobando el token…',
    bloqueando: 'Bloqueando…',
    bloquear: (cantidad: string, moneda: string) => `Bloquear ${cantidad} ${moneda}`,
    archivos: 'Archivos',
    anadirArchivo: 'Añadir',
    quitarArchivo: (nombre: string) => `Quitar ${nombre}`,
    archivosPie: (max: number, tope: string) =>
      `Hasta ${max} archivos de ${tope}. Se anuncian dentro del encargo antes de pagar, así que el escrow también los cubre.`,
    archivoGrande: (nombre: string, tope: string) => `«${nombre}» pasa de ${tope}.`,
    archivoSinNombre: (nombre: string) => `«${nombre}» no tiene un nombre que se pueda usar.`,
    archivoNoSeLee: (nombre: string) => `No se pudo leer «${nombre}». Si está en la nube, descárgalo antes al teléfono.`,
    archivosDemasiados: (max: number) => `Como mucho ${max} archivos.`,
    sinArchivos: 'Este agente no acepta archivos. Cuéntaselo todo en el texto.',
    enviandoAlAgente: 'Pago bloqueado. Llevándole el encargo al agente…',
    subiendoArchivos: (n: number) => `Subiendo ${n} ${n === 1 ? 'archivo' : 'archivos'}…`,
    entregado: 'El agente ya tiene el encargo.',
    noLlego: 'El encargo no le ha llegado al agente.',
    pagoASalvo:
      'El pago sigue bloqueado y la tarea existe en la cadena. El texto está guardado en este teléfono, así que reintentar no cuesta nada.',
    reintentar: 'Reintentar',
    sinIdDeTarea: 'La transacción no dice qué número tiene la tarea.',
    sinEndpoint: 'Este agente no publica dónde escucha, así que no hay a dónde mandarlo.',
    agenteRespondio: (codigo: number) => `El agente respondió ${codigo}.`,
    archivosFallaron: (n: number) => `${n} ${n === 1 ? 'archivo no subió' : 'archivos no subieron'}.`,
    firmaCancelada: 'Has cancelado la firma.',
    noSePudoHablar: 'No se pudo hablar con el agente.',
  },

  revisar: {
    titulo: 'Revisar la entrega',
    seApruebaSolo: 'Se aprueba solo en',
    loQuePediste: 'Lo que pediste',
    briefPerdido: 'El texto no está en este teléfono. En la cadena solo viaja su hash.',
    tuValoracion: 'Tu valoración',
    leyendas: ['Sin valorar', 'Muy mal', 'Mal', 'Regular', 'Bien', 'Muy bien'],
    estrellas: (v: number) => `${v} de 5`,
    quedaEnElRegistro: 'Queda en el registro del agente. No se puede cambiar después.',
    alAgente: 'Al agente',
    protocolo: 'Protocolo · 2,5 %',
    firmando: 'Firmando…',
    aprobarYPagar: (cantidad: string, moneda: string) => `Aprobar y pagar ${cantidad} ${moneda}`,
    eligeValoracion: 'Elige una valoración',
    algoNoCuadra: 'Algo no cuadra · abrir disputa',
    disputaTitulo: 'Abrir una disputa',
    disputaTexto: (cantidad: string, moneda: string) =>
      `El depósito de ${cantidad} ${moneda} se congela. Ni tú ni el agente cobráis hasta que se resuelva.`,
    loQueVeraQuienDecide: 'Lo que verá quien decide',
    pruebaBrief: 'Lo que pediste, palabra por palabra',
    pruebaEntrega: 'El archivo entregado y su hash',
    pruebaHilo: 'La conversación entera',
    decide: 'Decide',
    decidePie: 'un 2-de-3, no una sola clave',
    catorceDias:
      'Si el árbitro no resuelve en 14 días, recuperas el pago entero. Lo puede reclamar cualquiera y no hace falta su permiso.',
    abriendo: 'Abriendo…',
    abrirDisputa: 'Abrir disputa',
  },

  hilo: {
    hoy: 'Hoy',
    ayer: 'Ayer',
    volver: 'Volver',
    porMensaje: 'por mensaje',
    soloEncargos: 'solo acepta encargos',
    encargar: 'Encargar',
    sinHablar:
      'Todavía no habéis hablado. Lo que escribas aquí se paga por mensaje y te responde al momento.',
    escribeHueco: 'Escribe tu mensaje…',
    sinCobroHueco: 'Este agente no cobra por mensaje',
    enviar: 'Enviar',
    enviado: 'Enviado',
    trabajando: 'Trabajando en tu respuesta…',
    piePrecio: (cantidad: string, moneda: string) =>
      `${cantidad} ${moneda} por mensaje · una firma, sin gas`,
    sinCobroPie: 'Sin cobro por mensaje publicado',
    cabeceraEncargo: 'Encargo · pago bloqueado',
    encargoNumero: (id: string) => `Encargo #${id}`,
    precio: 'Precio',
    numero: 'Nº',
    abierto: 'Pago bloqueado · el agente trabaja',
    entregado: 'Entregado · revísalo',
    completado: 'Completado',
    disputado: 'En disputa · el pago está congelado',
    cancelado: 'Cancelado · el pago volvió',
    cancelaste: 'Has cancelado la firma. No se ha cobrado nada.',
    sinRed: 'No se pudo hablar con el agente. Si no llegó a responder, no se ha cobrado nada.',
  },

  marca: {
    titulo: 'Su marca',
    opcional: 'Logo, web, GitHub y redes. Nada de esto hace falta.',
    puestos: (n: number) => `${n} de 5 puestos`,
    pie: 'Sale en el mercado y en la app. Se guarda en su ficha de la cadena, así que cambiarlo cuesta una firma.',
    campos: {
      logo: 'Logo',
      web: 'Web',
      github: 'GitHub',
      x: 'X',
      telegram: 'Telegram',
    },
    huecos: {
      logo: 'https://tu-dominio.com/logo.png',
      web: 'https://tu-dominio.com',
      github: 'usuario o usuario/repo',
      x: 'usuario',
      telegram: 'usuario',
    },
    errores: {
      logo: 'Tiene que ser una URL https a una imagen.',
      web: 'Tiene que ser una URL https.',
      github: 'Pon el usuario, usuario/repo o el enlace de GitHub.',
      x: 'Pon el usuario o el enlace de X.',
      telegram: 'Pon el usuario o el enlace de Telegram.',
    },
    elegirLogo: 'Elegir imagen',
    cambiarLogo: 'Cambiar imagen',
    quitarLogo: 'Quitar la imagen',
    logoDentro: (kb: string) => `Imagen en su ficha · ${kb} KB`,
    logoDentroPie: 'Viaja dentro de su ficha de la cadena, así que no depende de ningún dominio. Añade unos céntimos de gas la primera vez.',
    oPegaUrl: 'O pegue la URL de su logo, si ya lo tiene alojado en algún sitio.',
    erroresLogo: {
      tipo: 'Eso no es una imagen. Valen PNG, JPG, WebP, GIF y SVG.',
      grande: 'La imagen pesa demasiado. Pruebe con una de menos de 8 MB.',
      ilegible: 'No se pudo leer esa imagen. ¿Está completa?',
      noCabe: 'No cabe en su ficha ni reduciéndola. Use un logo más sencillo, o aloje la imagen y pegue su URL.',
    },
    vistaConLogo: 'Así se verá en el mercado. Si sigue saliendo la inicial, la imagen no carga.',
    vistaSinLogo: 'Sin logo sale la celda de siempre.',
  },

  alta: {
    volver: 'Volver',
    titulo: 'Dar de alta un agente',
    quienSera: 'Quién va a ser el agente',
    delLlavero: 'De tu llavero',
    laConectada: 'La wallet conectada',
    yaRegistrada: (nombre: string) =>
      `Esta wallet YA está registrada como «${nombre}». Una dirección solo puede ser un agente; para otro hace falta otra wallet.`,
    conectarLaQueSera: 'Conectar la wallet que será el agente',
    seConvierteEn: 'se convierte en el agente',
    avisoClaveAntes: 'La wallet que firme esto',
    avisoClaveDespues:
      ': el registro no distingue una cosa de otra. Y su clave tendrá que estar en el servidor que lo haga funcionar, así que usa una nueva — no la que guarda tu dinero.',
    tienesEnLlavero: (n: number) =>
      `Tienes ${n} ${n === 1 ? 'wallet' : 'wallets'} en el llavero de este teléfono.`,
    quienTrabaja: '¿Quién va a hacer el trabajo?',
    soyPersona: 'Una persona',
    soyPersonaDesc: 'Recibes los encargos en tu panel y los entregas tú. No hace falta servidor.',
    esBot: 'Un programa',
    esBotDesc: 'Tu bot recibe y entrega solo, en la URL que publiques.',
    buzonNota: 'Recibirás los encargos en el buzón de Panal, a tu nombre. Panal puede leer lo que te encarguen y lo que entregues; no puede cambiarlo.',
    suFicha: 'Su ficha',
    nombre: 'Nombre',
    nombreHueco: 'Audit',
    queHace: 'Qué hace',
    queHaceHueco: 'Audita contratos y entrega el informe',
    dondeEscucha: 'Dónde escucha',
    dondeEscuchaHueco: 'https://tu-agente.lat',
    sinDireccionTitulo: 'Sin dirección, nadie podrá hablarle',
    sinDireccionAntes: 'La app busca',
    sinDireccionDespues:
      'en la ficha para saber dónde mandar los mensajes. Sin eso solo aceptará encargos con depósito, y el botón de hablar le saldrá apagado a todo el mundo. Ya le pasa a uno de los agentes registrados.',
    loQueCobra: 'Lo que cobra por encargo',
    loQueSeEscribe: 'Lo que se va a escribir en la cadena',
    firmaCancelada: 'La firma se canceló.',
    noSePudoFirmar: 'No se pudo firmar el alta.',
    firmando: 'Firmando el alta…',
    firmarAlta: 'Firmar el alta',
    pieGas:
      'Lo firma la wallet de arriba y paga su gas, así que necesita algo de MON. El precio y la ficha se pueden cambiar después; la dirección no.',
  },

  guardia: {
    volver: 'Volver',
    titulo: 'Guardia',
    subtitulo: 'Lo que tiene sin cerrar',
    sinCerrar: (n: number) => `${n} sin cerrar`,
    todo: (n: number) => `Todo · ${n}`,
    correPrisa: (n: number) => `Corre prisa · ${n}`,
    leyendo: 'Leyendo la cadena…',
    nadaTitulo: 'No hay nada sin cerrar',
    nadaTexto: 'Ni encargos abiertos, ni entregas esperando, ni dinero dentro del depósito.',
    deLaCadena:
      'Todo esto sale de la cadena, no de tu servidor. Es a propósito: sirve precisamente cuando lo que ha fallado es tu servidor y su propio vigilante cree que va todo bien.',
    motivoSinEntregar: 'Abierta y sin entregar',
    motivoSinCobrar: 'Ganado y sin cobrar',
    motivoSinAprobar: 'Entregada, esperando al cliente',
    motivoDisputa: 'En disputa',
    plazoVencio: 'el plazo venció',
    quedan: 'quedan',
    // «21 h», «2 d 6 h». Cada idioma pone sus unidades.
    horas: (h: number) => `${h} h`,
    diasHoras: (d: number, h: number) => (h ? `${d} d ${h} h` : `${d} d`),
    firmando: 'Firmando…',
    cobrar: (cantidad: string, moneda: string) => `Cobrar ${cantidad} ${moneda}`,
    noSePuedeEntregar:
      'Desde aquí no se puede entregar: eso lo firma tu agente con su clave, y el resultado está en tu servidor. Lo que da esta pantalla es enterarte a tiempo.',
    disputaPie: (dias: number) =>
      `Si el árbitro no resuelve en ${dias} días, el pago vuelve entero al cliente y lo puede reclamar cualquiera.`,
    deposito: (cantidad: string, moneda: string) => `el depósito de ${cantidad} ${moneda}`,
    explSinEntregarVencido: (deposito: string) =>
      `El plazo pasó y no hay nada anclado. El cliente puede recuperar ${deposito} cuando quiera, y entonces no cobras.`,
    explSinEntregar: (deposito: string) =>
      `Tu agente todavía no ha anclado nada. Si nadie entrega antes del plazo, el cliente recupera ${deposito} y tú no cobras.`,
    explSinCobrar: (cantidad: string, moneda: string) =>
      `Hay ${cantidad} ${moneda} liquidados y todavía dentro del depósito. No caducan, pero tampoco salen solos.`,
    explSinAprobar: (deposito: string) =>
      `Ya está anclada. Si el cliente no la aprueba ni la disputa, se libera sola y cobras ${deposito}.`,
    explDisputa: (deposito: string) =>
      `El cliente la abrió. ${deposito[0]!.toUpperCase()}${deposito.slice(1)} está congelado: ni tú ni él cobráis hasta que el árbitro decida.`,
  },

  cartera: {
    volver: 'Volver',
    titulo: 'Cartera',
    subtitulo: (n: number) => `${n} ${n === 1 ? 'agente' : 'agentes'} · solo mirar`,
    ningunoTitulo: 'No sigues a ninguno',
    ningunoTexto:
      'Pega la dirección de un agente y lo verás entero: lo que gana, lo que le queda por cobrar y lo que tiene sin cerrar.',
    seguirAUno: 'Seguir a uno',
    sinCobrarTotal: 'Sin cobrar en toda la cartera',
    nadaDentro: 'Nada dentro del depósito.',
    firmasAntes: 'Recogerlo son',
    firmas: (n: number) => `${n} firmas`,
    firmasDespues:
      ': una por agente y moneda, cada una desde la wallet de ese agente. Desde aquí no se puede —',
    firmasCola: 'paga a quien firma.',
    enRiesgo: (n: number) =>
      n === 1
        ? 'Un agente tiene encargos con el plazo vencido y sin entregar.'
        : `${n} agentes tienen encargos con el plazo vencido y sin entregar.`,
    noSePudoLeer:
      'No se pudo leer la cadena. Los saldos y los estados de aquí abajo pueden estar incompletos.',
    todos: (n: number) => `Todos · ${n}`,
    activos: (n: number) => `Activos · ${n}`,
    pausados: (n: number) => `Pausados · ${n}`,
    leyendo: 'Leyendo la cadena…',
    seguirAOtro: 'Seguir a otro',
    activo: 'Activo',
    pausado: 'Pausado',
    sinRegistrar: 'Sin registrar',
    sinCobrar: 'sin cobrar',
    dejarTexto:
      'Se quita de tu lista. El agente sigue igual, y puedes volver a seguirlo pegando su dirección.',
    dejarDeSeguir: 'Dejar de seguir',
    avisos: {
      'sin-registrar': 'No está registrada como agente.',
      vencidos: (n: number) =>
        n === 1
          ? 'Tiene un encargo con el plazo vencido y sin entregar.'
          : `Tiene ${n} encargos con el plazo vencido y sin entregar.`,
      'pausado-con-dinero': 'Pausado y con dinero dentro.',
      'pausado-con-dinero-sin-endpoint':
        'Pausado y con dinero dentro. Su ficha tampoco declara endpoint.',
      pausado: 'Pausado: no sale en el mercado y no puede entrarle trabajo.',
      'sin-endpoint': 'Sin endpoint en su ficha: solo acepta encargos, no mensajes.',
      abiertos: (n: number) =>
        n === 1 ? 'Tiene un encargo abierto.' : `Tiene ${n} encargos abiertos.`,
    },
  },

  expediente: {
    volver: 'Volver',
    leyendo: 'Leyendo la cadena…',
    noAparece: 'Ese encargo no aparece entre los tuyos. Puede ser de otra wallet.',
    titulo: (id: string) => `Encargo #${id}`,
    guardarBoton: 'Guardar el expediente',
    abierto: 'Abierto',
    entregado: 'Entregado',
    completado: 'Completado',
    disputado: 'En disputa',
    cancelado: 'Cancelado',
    enLaCadena: 'En la cadena · para siempre',
    enTuTelefono: 'En tu teléfono · solo aquí',
    cliente: 'Cliente',
    agente: 'Agente',
    creado: 'Creado',
    plazo: 'Plazo',
    filaEntregado: 'Entregado',
    hashPedido: 'Hash de lo pedido',
    hashEntrega: 'Hash de la entrega',
    loQuePediste: 'Lo que pediste',
    cuadra: 'cuadra con la cadena',
    noCuadra: 'NO cuadra',
    briefPerdido:
      'No está en este teléfono. En la cadena solo viaja su hash, así que el texto de lo que pediste se perdió — de otro móvil, o porque el archivo llegó a su tope y lo tiró.',
    loQueEntrego: 'Lo que entregó',
    adjuntoPie: (tamano: string) => `${tamano} · el archivo se baja del agente, aquí está su hash`,
    adjuntoBajar: 'Tocar para bajarlo',
    adjuntoBajando: 'Bajándolo…',
    adjuntoGuardado: 'Guardado',
    adjuntoNoCuadra: 'Los bytes NO cuadran con el hash. No se guarda.',
    adjuntoFallo: 'No se pudo bajar del agente.',
    entregaNoLaTienes:
      'No la tienes. Se puede volver a pedir al agente mientras siga en pie; si no, el hash de arriba ya no prueba nada por sí solo.',
    pidiendola: 'Pidiéndosela…',
    traerEntrega: 'Traer la entrega y guardarla',
    firmarasPie: 'Firmarás un mensaje para que el agente sepa que eres su cliente. No cuesta gas.',
    sinEntregar: 'Todavía no ha entregado nada. Cuando lo haga, aquí queda el texto.',
    laConversacion: 'La conversación',
    mensajes: (n: number, rango: string) => `${n} mensajes, ${rango}`,
    elDia: (d: string) => `el ${d}`,
    delAl: (a: string, b: string) => `del ${a} al ${b}`,
    preparando: 'Preparando…',
    guardarPie:
      'Un archivo con todo: lo de la cadena, tu brief, la entrega y el hilo. Se abre sin la app.',
    sinEndpoint: 'Este agente no publica endpoint en el registro, así que no hay a quién pedírsela.',
    firmaRechazada: 'El agente no reconoce esa firma como del cliente de este encargo.',
    entregaVacia: 'El agente devolvió una entrega vacía.',
    noCuadraHash: 'Lo que ha devuelto el agente no cuadra con el hash de la cadena. No se guarda.',
    noSePudoHablar: 'No se pudo hablar con el agente.',
  },

  informe: {
    grafico: 'Lo cobrado, mes a mes',
    graficoPie: (moneda: string) => `Últimos meses, en ${moneda}. Los vacíos son meses sin cobrar.`,
    subio: (pct: string) => `+${pct} % sobre el mes anterior`,
    bajo: (pct: string) => `−${pct} % sobre el mes anterior`,
    igual: 'Igual que el mes anterior',
    unSoloMes: 'Un solo mes con movimiento: todavía no hay con qué comparar',
    volver: 'Volver',
    titulo: 'Informe',
    subtitulo: (nombre: string) => `${nombre} · lo que entró y lo que se quedó`,
    todo: 'Todo',
    leyendo: 'Leyendo el índice…',
    indiceCaido:
      'El índice no responde. Sin él no se pueden hacer las cuentas: la cadena guarda cuánto se bloqueó, pero lo que de verdad se cobró está en los eventos de liquidación.',
    periodoVacio: 'En ese periodo no se liquidó ningún encargo.',
    nadaLiquidado:
      'Todavía no se ha liquidado ningún encargo de este agente. Lo que esté abierto o entregado aún no ha entrado en caja.',
    faltanMensajesTitulo: 'Aquí no están los mensajes',
    faltanMensajesTexto:
      'Esto es solo lo que pasó por el depósito. Lo que cobras por mensaje suelto se paga con una transferencia del token y no queda registrado como encargo, así que no aparece. Para agentes que viven de eso, este informe enseña una parte pequeña — y conviene que lo sepas antes de dárselo a nadie.',
    preparando: 'Preparando…',
    descargar: 'Descargar el informe',
    descargarPie:
      'Una hoja de cálculo con una fila por encargo y el hash de cada transacción, para que tu gestoría pueda comprobarlo sin fiarse de la app.',
    en: (moneda: string) => `En ${moneda}`,
    aparte: 'se lleva aparte, no se suma',
    facturado: 'Facturado',
    encargosLiquidados: (n: number) => `${n} ${n === 1 ? 'encargo liquidado' : 'encargos liquidados'}`,
    devueltoEnDisputa: 'Devuelto en disputa',
    unEncargo: (id: string) => `un encargo, ${id}`,
    variosEncargos: (n: number, ids: string) => `${n} encargos: ${ids}`,
    comision: 'Comisión de Panal',
    comisionPie: '2,5 % de lo que cobra cada uno',
    tuyo: 'Tuyo',
    todoEn: (moneda: string) => `todo en ${moneda}`,
    encargoPorEncargo: 'Encargo por encargo',
    disputada: 'Disputada · devuelto en parte',
    reciboTitulo: (id: string) => `Encargo n.º ${id}`,
    precioEncargo: 'Precio del encargo',
    devueltoAlCliente: 'Devuelto al cliente',
    cobrado: 'Cobrado',
    laTransaccion: 'La transacción que lo prueba',
    guardarRecibo: 'Guardar el recibo',
    reciboPie:
      'Un A5 para imprimir. Acredita el cobro; no es una factura — el propio papel explica por qué.',
    reciboListo: (donde: string) => `Recibo listo en ${donde}.`,
    reciboFallo: (porque: string) => `No se pudo: ${porque}`,
    informeListo: (donde: string) => `Informe listo en ${donde}.`,
  },

  panel: {
    volver: 'Volver',
    leyendoRegistro: 'Leyendo el registro…',
    sinRegistrar: 'Sin registrar',
    sinRegistrarTexto:
      'Esa dirección no está registrada como agente en Panal. Puede que sea una wallet normal, o que el alta no llegara a firmarse.',
    desde: (mes: string) => `desde ${mes}`,
    administras: 'administras',
    sigues: 'sigues',
    ganadoSinCobrar: 'Ganado y sin cobrar',
    cobrar: 'Cobrar',
    soloElAgenteAntes: 'Solo puede sacarlo el propio agente:',
    soloElAgenteDespues: 'paga a quien firma.',
    todoCobrado: 'Todo cobrado. Está en su wallet.',
    pausadoTitulo: 'Está pausado',
    pausadoTexto:
      'No aparece en el mercado y no puede entrarle ningún encargo nuevo. Los que ya estuvieran abiertos siguen su curso.',
    aceptarTrabajo: 'Aceptar trabajo',
    precioPorEncargo: 'Precio por encargo',
    fichaYEndpoint: 'Ficha y endpoint',
    sinEndpoint: 'sin endpoint',
    sinBotAntes: 'Su ficha no declara',
    sinBotDespues: ', así que nadie puede hablarle por mensaje. Solo acepta encargos',
    sinBotYPausado: ' — y ahora mismo tampoco',
    guardia: 'Guardia',
    mirando: 'Mirando…',
    urgentes: (n: number) => `${n} sin cerrar que corren prisa`,
    nadaPendiente: 'Nada pendiente',
    informe: 'Informe',
    informePie: 'Lo que entró y lo que se quedó, con recibo por encargo',
    ultimosEncargos: 'Últimos encargos',
    leyendoCadena: 'Leyendo la cadena…',
    sinEncargos: 'Todavía no le han encargado nada.',
    encargoNumero: (id: string) => `Encargo #${id}`,
    tAbierto: 'Abierto · sin entregar',
    tEntregado: 'Entregado · esperando al cliente',
    tCompletado: 'Cobrado',
    tDisputado: 'En disputa',
    tCancelado: 'Cancelado',
    cobrarTitulo: 'Cobrar lo ganado',
    cobrarNota: 'Cada moneda se saca por separado: el contrato cobra de una en una. Son dos firmas.',
    unaFirma: 'una firma',
    sacar: 'Sacar',
    firmando: 'Firmando…',
    vaASuDireccion:
      'Lo cobrado va a esta misma dirección, que es la del agente. Para que vaya a otra hace falta cambiar el contrato.',
    precioTexto:
      'Lo que cobra por un trabajo con depósito. Los mensajes sueltos se cobran aparte, en su servidor.',
    precioNota:
      'Solo afecta a los encargos que entren a partir de ahora. Lo que ya está bloqueado se liquida al precio que se pactó.',
    firmarCambio: 'Firmar el cambio',
    pausarTitulo: 'Pausar el agente',
    reactivarTitulo: 'Volver a aceptar trabajo',
    pausarTexto:
      'Dejará de salir en el mercado y no podrá entrarle ningún encargo nuevo. Los que ya estén abiertos siguen su curso, y sigues teniendo que entregarlos.',
    reactivarTexto:
      'Volverá a salir en el mercado y podrá entrarle trabajo. Asegúrate de que su servidor está en pie antes de firmar esto.',
    pausar: 'Pausar',
    reactivar: 'Reactivar',
    nombre: 'Nombre',
    queHace: 'Qué hace',
    dondeEscucha: 'Dónde escucha',
    dondeEscuchaHueco: 'https://tu-agente.lat',
    sinBotFichaAntes: 'Sin dirección nadie podrá hablarle. La app busca',
    sinBotFichaDespues:
      'en la ficha para saber dónde mandar los mensajes; sin eso solo aceptará encargos con depósito.',
    loQueSeEscribe: 'Lo que se va a escribir',
    firmar: 'Firmar',
  },

  avisos: {
    encargoNuevoTitulo: (id: string) => `Te han encargado el #${id}`,
    encargoNuevoCuerpo: (cantidad: string, moneda: string, horas: number) =>
      horas > 0
        ? `${cantidad} ${moneda} bloqueados. Tienes ${horas} h para entregarlo.`
        : `${cantidad} ${moneda} bloqueados, y el plazo ya ha vencido.`,
    sinEntregarTitulo: (id: string) => `Tu agente lleva sin entregar el #${id}`,
    sinEntregarCuerpo: (horas: number, cantidad: string, moneda: string) =>
      `Quedan ${horas} h de plazo. Si vence, el cliente recupera ${cantidad} ${moneda} y no cobras.`,
    sinEntregarVencido: (cantidad: string, moneda: string) =>
      `El plazo venció: el cliente puede recuperar ${cantidad} ${moneda}.`,
    disputaTitulo: (id: string) => `Han disputado el #${id}`,
    disputaCuerpo: (cantidad: string, moneda: string) =>
      `El depósito de ${cantidad} ${moneda} queda congelado hasta que decida el árbitro.`,
    entregaTitulo: (id: string) => `Entregaron el encargo #${id}`,
    entregaCuerpo: 'Toca para revisar la entrega.',
    cuentaAtrasTitulo: (id: string) => `Quedan 6 h para que #${id} se apruebe solo`,
    cuentaAtrasCuerpo: (cantidad: string, moneda: string) =>
      `Si no haces nada se pagan ${cantidad} ${moneda} y cuenta como 5 estrellas.`,
    plazoTitulo: (id: string) => `#${id} venció sin entrega`,
    plazoCuerpo: (cantidad: string, moneda: string) =>
      `Puedes recuperar el depósito de ${cantidad} ${moneda} que bloqueaste.`,
  },

  pegas: {
    'sin-destino': 'Falta la dirección a la que mandarlo.',
    'destino-malo': 'Esa dirección no vale. Una de Monad son 42 caracteres y empieza por 0x.',
    'destino-soy-yo': 'Esa es esta misma wallet. Pon la dirección de destino.',
    'sin-cantidad': 'Escribe cuánto.',
    'cantidad-mala': 'Eso no es una cantidad.',
    'cantidad-cero': 'La cantidad es cero.',
    'no-hay-tanto': (moneda: string) => `No hay tanto ${moneda} en esta wallet.`,
    'deja-gas': 'Deja algo de MON para la comisión de red. Usa «Todo» y te lo calcula.',
    'sin-mon-para-gas':
      'Esta wallet no tiene MON, y la red cobra la comisión en MON. Mándale un poco antes.',
    'poco-mon': 'Queda muy poco MON. Si la comisión sube, la transacción se cae.',
    'ni-palabras-ni-clave': 'Eso no son 12 palabras ni una clave privada. Pega una de las dos cosas.',
    'palabras-no-cuadran':
      'Esas palabras no cuadran. Míralas de nuevo: alguna no es de la lista, o están en otro orden.',
    ilegible: 'No se ha podido leer eso como una wallet.',
    repetida: 'Esa wallet ya está en el llavero.',
    // Los de la red, al mandar.
    noLlega: 'No llega para la cantidad más la comisión de red. Manda un poco menos.',
    sinSaldo: 'La wallet no tiene ese saldo.',
    otraEnMarcha: 'Hay otra transacción de esta wallet todavía en marcha. Espera a que termine.',
    sinRed: 'No se ha podido hablar con la red. Comprueba la conexión y vuelve a intentarlo.',
    cancelado: 'Cancelado.',
    rechazada: 'La red ha rechazado la transacción. No se ha movido nada.',
  },

  recibo: {
    titulo: 'Recibo de cobro',
    tituloPagina: (id: string) => `Recibo · encargo ${id}`,
    sub: (id: string, fecha: string) => `Encargo n.º ${id} · ${fecha}`,
    cobra: 'Cobra',
    huecoNombre: '[TU NOMBRE O RAZÓN SOCIAL]',
    huecoNif: '[NIF / VAT]',
    huecoDireccion: '[DIRECCIÓN]',
    agente: (nombre: string) => `agente ${nombre}`,
    pago: 'Pagó',
    esUnaDireccion: 'Es una dirección de Monad, no una identidad fiscal. Panal no sabe quién hay detrás.',
    por: 'Por',
    huecoTrabajo: '[DESCRIPCIÓN DEL TRABAJO]',
    briefPerdido:
      'El texto de lo que se pidió no está en este teléfono: la cadena solo guarda su hash, y quien lo escribió fue el cliente.',
    precioEncargo: 'Precio del encargo',
    devuelto: 'Devuelto al cliente (disputa)',
    comision: 'Comisión de Panal',
    cobrado: 'Cobrado',
    laTransaccion: 'La transacción que lo prueba',
    huellaEntrega: 'Huella de lo entregado',
    noEsFacturaTitulo: 'Esto acredita un cobro. No es una factura.',
    noEsFacturaTexto: (moneda: string) =>
      `Una factura necesita un cliente identificado y un tratamiento fiscal que dependen de dónde tributes, y aquí el cliente es una dirección. Este papel dice cuánto entró, cuándo, de dónde y con qué transacción se puede comprobar en la cadena — que es lo que tu gestoría necesita para emitir la factura que corresponda. Las cifras están en ${moneda}, sin convertir: su precio lo pone un mercado y cambia, así que ponerle euros aquí sería inventarse una cifra.`,
    csv: {
      encargo: 'encargo',
      fecha: 'fecha',
      cliente: 'cliente',
      moneda: 'moneda',
      facturado: 'facturado',
      devuelto: 'devuelto',
      comision: 'comision',
      cobrado: 'cobrado',
      nota: 'nota',
      transaccion: 'transaccion',
      hashEntrega: 'hash_entrega',
      estrellas: (n: number) => `${n} estrellas`,
      total: (moneda: string) => `TOTAL ${moneda}`,
      pieAgente: (nombre: string, dir: string) =>
        `Agente ${nombre} (${dir}). Cifras sin convertir a euros: su precio lo pone un mercado.`,
      pieAviso: 'Esto acredita cobros; no es una factura. Lo que se cobra por mensaje suelto NO aparece aquí.',
    },
  },

  copia: {
    encargo: 'Encargo',
    cliente: 'Cliente',
    agente: 'Agente',
    importe: 'Importe',
    estado: 'Estado',
    creado: 'Creado',
    plazo: 'Plazo',
    entregado: 'Entregado',
    hashPedido: 'Hash de lo pedido',
    hashEntrega: 'Hash de la entrega',
    estados: ['Abierto', 'Entregado', 'Completado', 'Disputado', 'Cancelado'],
    titulo: (id: string) => `Encargo #${id}`,
    sacadaEl: (fecha: string) => `Copia sacada el ${fecha} desde la app de Panal.`,
    enLaCadena: 'En la cadena · para siempre',
    loQuePediste: 'Lo que pediste',
    cuadra: ' · cuadra con la cadena',
    noCuadra: ' · NO cuadra con la cadena',
    briefPerdido:
      'No estaba en el teléfono cuando se sacó esta copia. En la cadena solo viaja su hash, así que el texto de lo que se pidió se perdió.',
    loQueEntrego: 'Lo que entregó',
    entregaPerdida:
      'No estaba en el teléfono. Se puede volver a pedir al agente mientras siga en pie; si no, el hash de arriba ya no prueba nada por sí solo.',
    archivos: 'Archivos que anuncia la entrega',
    archivosAviso:
      'Estos archivos NO están dentro de esta copia: se bajan del servidor del agente. Lo que sí queda aquí es su hash, que sirve para comprobar que unos bytes que tengas son los que se entregaron.',
    laConversacion: 'La conversación',
    tu: 'Tú',
    elAgente: 'El agente',
    pie: 'Panal · el escrow guarda nueve campos por encargo y ni uno más. Lo que hay en esta página que no esté en la tabla de arriba solo existía en un teléfono. Este archivo no pide nada a ningún servidor: se abre igual sin internet.',
    tusExpedientes: 'Tus expedientes',
    cuantos: (n: number, quien: string, fecha: string) =>
      `${n} ${n === 1 ? 'encargo' : 'encargos'} de ${quien}, copiados el ${fecha}.`,
    indice: 'Índice',
    guardarExpediente: 'Guardar el expediente',
    guardarArchivo: 'Guardar el archivo',
    descargas: 'Descargas',
    elTelefono: 'el teléfono',
  },

  tiempo: {
    ahora: 'ahora',
    ayer: 'ayer',
    yaSePuedeLiberar: 'ya se puede liberar',
    dias: (d: number, h: number) => `${d} d ${h} h`,
    horas: (h: number) => `${h} h`,
    minutos: (m: number) => `${m} min`,
  },

  bienvenida: {
    titulo: 'Bienvenido a Panal',
    texto:
      'Un mercado de agentes que trabajan por encargo y cobran en la cadena. No hay registro, ni correo, ni contraseña: tu wallet es tu cuenta.',
    hablar: 'Habla con un agente y paga cada mensaje en $PANAL.',
    encargar: 'Encárgale un trabajo: el dinero queda en escrow hasta que entregue.',
    tuya: 'Las claves se cifran con un PIN y no salen de este teléfono.',
    paraEmpezar: 'Para empezar',
    crear: 'Crear una wallet',
    crearPie: 'Se genera aquí mismo, en un minuto. Te enseñará 12 palabras: son la única copia.',
    traer: 'Traer la mía',
    traerPie: 'Con sus 12 palabras o su clave privada. Se guarda cifrada, igual que las de aquí.',
    pie: 'Panal no guarda ninguna clave y no puede recuperar la tuya. Nadie más que tú tiene copia.',
  },

  olvidado: {
    enlace: '¿Olvidaste el PIN?',
    volver: 'Volver al PIN',
    titulo: 'Sin el PIN no hay forma de abrirlo',
    texto:
      'No es que no queramos: no se puede. Las claves están cifradas con tu PIN y sin él no se descifran aquí ni en ninguna parte. Panal no tiene copia, y no hay nadie a quien pedírsela.',
    conPalabras:
      'Si apuntaste las 12 palabras de tu wallet no has perdido nada: borra el llavero y tráela otra vez con ellas. Vuelve igual, con su saldo y su historial.',
    borrar: 'Empezar de cero',
    seguroTexto:
      'Se borran de este teléfono todas las wallets del llavero. Las que tengan sus 12 palabras apuntadas se recuperan con ellas; las que no, no las recupera nadie — ni tú, ni Panal.',
    borrarSeguro: 'Borrar el llavero',
  },

  arranque: {
    titulo: 'Chats',
    fueraTitulo: 'Agentes que cobran solos',
    fueraTexto: 'Tu wallet es tu cuenta: no hay registro ni contraseña. Conéctala y ya puedes empezar.',
    aCero: 'Tu wallet está a cero',
    sinHablar: 'Todavía no has hablado con nadie',
    aCeroTexto: 'Hace falta $PANAL para hablar con un agente, o MON para encargarle un trabajo.',
    sinHablarTexto: 'Elige un agente en el mercado y empieza por preguntarle algo.',
    hablarTitulo: 'Hablar con un agente',
    hablarPie: 'se paga por mensaje, en $PANAL',
    hablarEstado: 'sin gas',
    encargarTitulo: 'Encargar un trabajo',
    encargarPie: 'el dinero queda en depósito hasta que entregue',
    encargarEstado: 'en MON',
    dondeSeCompra:
      '$PANAL se cambia en nad.fun y MON lo traes a tu dirección desde donde ya tengas. Panal no vende ninguna de las dos.',
    verMercado: 'Ver el mercado',
    verMercadoPie: 'Mirar los agentes y sus precios no cuesta nada.',
  },
};

export type Textos = typeof es;
