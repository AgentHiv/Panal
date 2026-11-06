/**
 * Panal — la revisión de un archivo antes de abrirlo.
 *
 * Que un archivo esté verificado contra la cadena dice que es EL QUE SE ENVIÓ,
 * no que sea inofensivo. Entre personas eso importa: cualquiera puede mandar en
 * un encargo o en el chat un archivo hecho para atacar a quien lo abre. Esto lo
 * mira por dentro, en el dispositivo de quien lo recibe —también los cifrados,
 * una vez abiertos—, y dice qué ve.
 *
 * QUÉ BUSCA. Lo que se ejecuta al abrirlo: programas y scripts (también
 * disfrazados de otra cosa), documentos con macros, PDF con JavaScript o que
 * lanzan programas, páginas con código, accesos directos. Y, dentro de un ZIP,
 * el patrón de las «pruebas técnicas» falsas de las ofertas de trabajo: un
 * proyecto que ejecuta órdenes al instalarlo (`package.json` con `postinstall`),
 * al abrir la carpeta en el editor (`.vscode/tasks.json` con `folderOpen`), con
 * ganchos de git, o con código ofuscado que se evalúa a sí mismo.
 *
 * LO QUE NO ES. No es un antivirus: no conoce firmas de malware —eso lo hace
 * el del servidor, sobre lo que no va cifrado— y no puede saber si un programa
 * es bueno o malo. Dice «sospechoso», nunca «seguro». Un agente que programa
 * entrega scripts a propósito: por eso esto avisa y pide confirmar, no bloquea.
 *
 * Funciona igual en el navegador, en la app y en Node: solo usa
 * `DecompressionStream`, que tienen los tres.
 */

/** Lo que encontró, por qué, y un detalle para enseñarlo (un nombre, un tipo). */
export type CodigoDeRevision =
  | 'programa'
  | 'script'
  | 'disfrazado'
  | 'nombreEnganoso'
  | 'macros'
  | 'pdfActivo'
  | 'paginaConCodigo'
  | 'accesoDirecto'
  | 'instalaAlAbrir'
  | 'codigoOfuscado'
  | 'comprimidoConProgramas'
  | 'comprimidoCerrado'
  | 'comprimidoOpaco'
  | 'comprimidoBomba'
  | 'ilegible';

export interface MotivoDeRevision {
  codigo: CodigoDeRevision;
  /** Para la pantalla: «package.json: postinstall», «RAR», «2,1 GB»… */
  detalle?: string;
}

export interface RevisionDeArchivo {
  /** `limpio` no es «seguro»: es que no se vio nada de lo que se busca. */
  veredicto: 'limpio' | 'sospechoso';
  motivos: MotivoDeRevision[];
}

// ---------------------------------------------------------------------------
// Las listas
// ---------------------------------------------------------------------------

/** Programas e instaladores: abrirlos es ejecutarlos. */
const PROGRAMAS = new Set([
  'exe', 'msi', 'msix', 'msp', 'appx', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'so', 'dylib', 'app', 'dmg',
  'pkg', 'deb', 'rpm', 'apk', 'aab', 'xapk', 'ipa', 'appimage', 'run', 'jar', 'class', 'iso', 'img', 'vhd',
  'vhdx', 'gadget', 'xll',
]);
/** Scripts: el sistema los ejecuta con un doble clic o con un intérprete a mano. */
const SCRIPTS = new Set([
  'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta', 'sh',
  'bash', 'zsh', 'fish', 'command', 'py', 'pyw', 'pyc', 'rb', 'pl', 'php', 'lua', 'applescript', 'scpt', 'ahk',
]);
/** Dentro de un ZIP, lo que se lanza con un doble clic en Windows o macOS. Un .js o un .py en un proyecto es normal; esto no. */
const LANZABLES = new Set([
  'exe', 'msi', 'scr', 'com', 'pif', 'cpl', 'dll', 'lnk', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'jse', 'wsf',
  'hta', 'jar', 'apk', 'app', 'dmg', 'pkg', 'command', 'appimage', 'reg', 'scf', 'url', 'iso', 'img',
]);
const MACROS = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'sldm']);
const PAGINAS = new Set(['html', 'htm', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'svg', 'svgz']);
const ACCESOS = new Set(['lnk', 'url', 'reg', 'inf', 'scf', 'desktop', 'library-ms', 'settingcontent-ms', 'crx', 'xpi']);
/** Lo que se espera que sea inofensivo: si dentro hay un programa, está disfrazado. */
const INOCENTES = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'csv', 'json',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'mp3', 'mp4', 'mov', 'wav', 'ogg', 'webm', 'zip',
]);
/** Scripts de npm que corren solos en `npm install`. */
const SCRIPTS_DE_INSTALACION = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare'];

/** Caracteres que dan la vuelta al texto o se ven vacíos: esconden la extensión real («fac‮fdp.exe» se lee «facexe.pdf»). */
const ENGANOSOS = /[‪-‮⁦-⁩‎‏؜​]/;

const LIMITE_LECTURA = 1024 * 1024; // lo que se descomprime de una entrada para mirarla
const LIMITE_FICHEROS_DE_CODIGO = 200;
const LIMITE_BOMBA = 2 * 1024 * 1024 * 1024; // 2 GiB declarados al descomprimir

// ---------------------------------------------------------------------------
// La revisión
// ---------------------------------------------------------------------------

/**
 * Revisa un archivo por su nombre, su tipo y sus bytes. Nunca lanza: si algo no
 * se puede leer, lo dice como motivo.
 */
export async function revisarArchivo(nombre: string, bytes: Uint8Array, mime?: string): Promise<RevisionDeArchivo> {
  const motivos: MotivoDeRevision[] = [];
  try {
    await revisar(nombre, bytes, mime ?? '', motivos, 0);
  } catch {
    motivos.push({ codigo: 'ilegible' });
  }
  // Un motivo por código y detalle: el mismo hallazgo en dos sitios se dice una vez.
  const vistos = new Set<string>();
  const unicos = motivos.filter((m) => {
    const k = `${m.codigo}|${m.detalle ?? ''}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { veredicto: unicos.length ? 'sospechoso' : 'limpio', motivos: unicos };
}

async function revisar(nombre: string, bytes: Uint8Array, mime: string, motivos: MotivoDeRevision[], nivel: number): Promise<void> {
  const ext = extension(nombre);
  const penultima = extension(nombre.slice(0, Math.max(0, nombre.length - ext.length - 1)));
  const contenido = queEs(bytes);

  if (ENGANOSOS.test(nombre)) motivos.push({ codigo: 'nombreEnganoso' });

  // Lo que dice el contenido, se llame como se llame.
  if (contenido === 'programa') motivos.push({ codigo: 'programa' });
  if (contenido === 'acceso') motivos.push({ codigo: 'accesoDirecto' });
  if ((contenido === 'programa' || contenido === 'script') && INOCENTES.has(ext)) {
    motivos.push({ codigo: 'disfrazado', detalle: `.${ext}` });
  }

  // Lo que dice el nombre.
  if (PROGRAMAS.has(ext) && contenido !== 'programa') motivos.push({ codigo: 'programa' });
  if (SCRIPTS.has(ext) || contenido === 'script') motivos.push({ codigo: 'script' });
  if (ACCESOS.has(ext) && contenido !== 'acceso') motivos.push({ codigo: 'accesoDirecto' });
  if (MACROS.has(ext)) motivos.push({ codigo: 'macros' });
  // `factura.pdf.exe`: el sistema mira la última; quien lo lee, la penúltima.
  if ((PROGRAMAS.has(ext) || SCRIPTS.has(ext) || LANZABLES.has(ext)) && INOCENTES.has(penultima)) {
    motivos.push({ codigo: 'disfrazado', detalle: `.${penultima}.${ext}` });
  }

  if (contenido === 'pdf') revisarPdf(bytes, motivos);
  if (PAGINAS.has(ext) || /html|svg|xhtml/i.test(mime) || contenido === 'pagina') revisarPagina(bytes, motivos);
  if (contenido === 'ole') revisarOle(bytes, motivos);
  if (contenido === 'zip') await revisarZip(nombre, bytes, motivos, nivel);
  if (contenido === 'rar') motivos.push({ codigo: 'comprimidoOpaco', detalle: 'RAR' });
  if (contenido === '7z') motivos.push({ codigo: 'comprimidoOpaco', detalle: '7z' });
  if (contenido === 'gzip' || ext === 'tar' || ext === 'tgz') motivos.push({ codigo: 'comprimidoOpaco', detalle: ext === 'tgz' || ext === 'gz' ? 'tar.gz' : ext || 'gzip' });
}

/** La última extensión, en minúsculas y sin espacios: la que decide el sistema. */
function extension(nombre: string): string {
  const base = nombre.split(/[/\\]/).pop() ?? '';
  const punto = base.lastIndexOf('.');
  return punto > 0 ? base.slice(punto + 1).trim().toLowerCase() : '';
}

type Contenido = 'programa' | 'script' | 'acceso' | 'pdf' | 'ole' | 'zip' | 'rar' | '7z' | 'gzip' | 'pagina' | 'otro';

/** Qué es por sus primeros bytes, que no dependen de cómo se llame. */
function queEs(b: Uint8Array): Contenido {
  const empieza = (...firma: number[]) => firma.every((x, i) => b[i] === x);
  // Windows: «MZ» y, donde dice su cabecera, «PE\0\0». Solo «MZ» sale en textos.
  if (empieza(0x4d, 0x5a) && b.length > 0x40) {
    const pe = b[0x3c]! | (b[0x3d]! << 8) | (b[0x3e]! << 16) | (b[0x3f]! << 24);
    if (pe > 0 && pe + 4 <= b.length && b[pe] === 0x50 && b[pe + 1] === 0x45 && b[pe + 2] === 0 && b[pe + 3] === 0) return 'programa';
  }
  if (empieza(0x7f, 0x45, 0x4c, 0x46)) return 'programa'; // ELF
  if (empieza(0xfe, 0xed, 0xfa, 0xce) || empieza(0xfe, 0xed, 0xfa, 0xcf) || empieza(0xce, 0xfa, 0xed, 0xfe) || empieza(0xcf, 0xfa, 0xed, 0xfe)) return 'programa'; // Mach-O
  if (empieza(0xca, 0xfe, 0xba, 0xbe)) return 'programa'; // Mach-O universal, o una clase de Java
  if (empieza(0x64, 0x65, 0x78, 0x0a)) return 'programa'; // dex de Android
  if (empieza(0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00)) return 'acceso'; // .lnk
  if (empieza(0x23, 0x21)) return 'script'; // «#!»
  if (empieza(0x25, 0x50, 0x44, 0x46)) return 'pdf';
  if (empieza(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole';
  if (empieza(0x50, 0x4b, 0x03, 0x04) || empieza(0x50, 0x4b, 0x05, 0x06)) return 'zip';
  if (empieza(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) return 'rar';
  if (empieza(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z';
  if (empieza(0x1f, 0x8b)) return 'gzip';
  const inicio = latin1(b.subarray(0, 512)).trimStart().toLowerCase();
  if (inicio.startsWith('<!doctype html') || inicio.startsWith('<html') || inicio.startsWith('<svg')) return 'pagina';
  return 'otro';
}

/** Bytes a texto 1:1, sin fallar con nada: para buscar marcas ASCII en binarios. */
function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

/** Un PDF puede ejecutar JavaScript, lanzar un programa o llevar archivos dentro. */
function revisarPdf(bytes: Uint8Array, motivos: MotivoDeRevision[]): void {
  // Los nombres de un PDF se pueden escribir con «#xx» («/J#61vaScript»): se deshacen antes de buscar.
  const texto = latin1(bytes).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
  const hay: string[] = [];
  if (/\/(JavaScript|JS)(?![A-Za-z0-9])/.test(texto)) hay.push('JavaScript');
  if (/\/Launch(?![A-Za-z0-9])/.test(texto)) hay.push('Launch');
  if (/\/EmbeddedFile(?![A-Za-z0-9])/.test(texto)) hay.push('EmbeddedFile');
  if (/\/RichMedia(?![A-Za-z0-9])/.test(texto)) hay.push('RichMedia');
  if (hay.length) motivos.push({ codigo: 'pdfActivo', detalle: hay.join(', ') });
}

/** Una página o un SVG con código que se ejecuta al abrirlo. */
function revisarPagina(bytes: Uint8Array, motivos: MotivoDeRevision[]): void {
  const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 5 * 1024 * 1024));
  if (/<script\b|\son[a-z]+\s*=|javascript:|<iframe\b|<object\b|<embed\b|http-equiv\s*=\s*["']?refresh/i.test(texto)) {
    motivos.push({ codigo: 'paginaConCodigo' });
  }
}

/** Un documento de Office antiguo (o un .msi): sus macros viven en flujos con estos nombres, en UTF-16. */
function revisarOle(bytes: Uint8Array, motivos: MotivoDeRevision[]): void {
  const utf16 = (s: string) => Array.from(s).map((c) => `${c}\0`).join('');
  const texto = latin1(bytes);
  if (texto.includes(utf16('_VBA_PROJECT')) || texto.includes(utf16('Macros')) || texto.includes(utf16('VBA'))) {
    motivos.push({ codigo: 'macros' });
  }
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface Entrada {
  nombre: string;
  metodo: number;
  cifrada: boolean;
  comprimido: number;
  descomprimido: number;
  desplazamiento: number;
}

/** El directorio central de un ZIP: nombres y tamaños sin descomprimir nada. */
function leerDirectorio(b: Uint8Array): Entrada[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // El final del directorio está en los últimos 64 KB + 22.
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const entradas: Entrada[] = [];
  for (let n = 0; n < total && n < 20_000; n++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return entradas.length ? entradas : null;
    const flags = dv.getUint16(p + 8, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComentario = dv.getUint16(p + 32, true);
    entradas.push({
      nombre: new TextDecoder().decode(b.subarray(p + 46, p + 46 + largoNombre)),
      metodo: dv.getUint16(p + 10, true),
      cifrada: (flags & 1) === 1,
      comprimido: dv.getUint32(p + 20, true),
      descomprimido: dv.getUint32(p + 24, true),
      desplazamiento: dv.getUint32(p + 42, true),
    });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Los bytes de una entrada, descomprimidos, o null si no se puede o pasa del límite. */
async function leerEntrada(b: Uint8Array, e: Entrada): Promise<Uint8Array | null> {
  if (e.cifrada || e.descomprimido > LIMITE_LECTURA || e.comprimido > LIMITE_LECTURA) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const p = e.desplazamiento;
  if (p + 30 > b.length || dv.getUint32(p, true) !== 0x04034b50) return null;
  const inicio = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  const datos = b.subarray(inicio, inicio + e.comprimido);
  if (e.metodo === 0) return datos;
  if (e.metodo !== 8 || typeof DecompressionStream === 'undefined') return null;
  // Una copia propia: el Blob no admite una vista sobre un buffer compartido.
  const flujo = new Blob([datos.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const salida = new Uint8Array(await new Response(flujo).arrayBuffer());
  return salida.byteLength > LIMITE_LECTURA ? null : salida;
}

async function revisarZip(nombre: string, b: Uint8Array, motivos: MotivoDeRevision[], nivel: number): Promise<void> {
  const entradas = leerDirectorio(b);
  if (!entradas) {
    motivos.push({ codigo: 'ilegible' });
    return;
  }
  const nombres = entradas.map((e) => e.nombre);
  const ext = extension(nombre);

  // Un programa con forma de ZIP: Android, Java.
  if (nombres.includes('AndroidManifest.xml') && nombres.some((n) => n.endsWith('.dex'))) motivos.push({ codigo: 'programa' });
  if (nombres.includes('META-INF/MANIFEST.MF') && nombres.some((n) => n.endsWith('.class'))) motivos.push({ codigo: 'programa' });
  // Un documento de Office con macros.
  if (nombres.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) motivos.push({ codigo: 'macros' });
  // Si es un documento de Office, lo demás no aplica: no es un proyecto.
  if (nombres.includes('[Content_Types].xml') && ext !== 'zip') return;

  if (entradas.some((e) => e.cifrada)) motivos.push({ codigo: 'comprimidoCerrado' });

  const declarado = entradas.reduce((s, e) => s + e.descomprimido, 0);
  const desmesurada = entradas.some((e) => e.descomprimido > 50 * 1024 * 1024 && e.descomprimido > e.comprimido * 100);
  if (declarado > LIMITE_BOMBA || desmesurada) motivos.push({ codigo: 'comprimidoBomba', detalle: tamano(declarado) });

  const lanzables = nombres.filter((n) => LANZABLES.has(extension(n)) && !n.endsWith('/'));
  if (lanzables.length) {
    motivos.push({ codigo: 'comprimidoConProgramas', detalle: resumen(lanzables) });
  }

  // El patrón de las pruebas técnicas falsas.
  const ganchos = nombres.filter((n) => /(^|\/)\.git\/hooks\/[^/]+$/.test(n) && !n.endsWith('.sample'));
  if (ganchos.length) motivos.push({ codigo: 'instalaAlAbrir', detalle: '.git/hooks' });

  for (const e of entradas) {
    if (/(^|\/)node_modules\//.test(e.nombre)) continue;
    if (/(^|\/)package\.json$/.test(e.nombre)) {
      const datos = await leerEntrada(b, e);
      if (!datos) continue;
      try {
        const pkg = JSON.parse(new TextDecoder().decode(datos)) as { scripts?: Record<string, unknown> };
        const corren = SCRIPTS_DE_INSTALACION.filter((s) => typeof pkg.scripts?.[s] === 'string');
        if (corren.length) motivos.push({ codigo: 'instalaAlAbrir', detalle: `${e.nombre}: ${corren.join(', ')}` });
      } catch {
        // Un package.json roto no se ejecuta.
      }
    }
    if (/(^|\/)\.vscode\/tasks\.json$/.test(e.nombre)) {
      const datos = await leerEntrada(b, e);
      if (datos && /["']?runOn["']?\s*:\s*["']folderOpen["']/.test(new TextDecoder().decode(datos))) {
        motivos.push({ codigo: 'instalaAlAbrir', detalle: `${e.nombre}: folderOpen` });
      }
    }
  }

  // Código que se descifra y se evalúa a sí mismo: así esconden el cargador.
  let revisados = 0;
  for (const e of entradas) {
    if (revisados >= LIMITE_FICHEROS_DE_CODIGO) break;
    if (/(^|\/)node_modules\//.test(e.nombre) || !/\.(m?js|cjs|ts|py)$/i.test(e.nombre)) continue;
    revisados++;
    const datos = await leerEntrada(b, e);
    if (datos && pareceOfuscado(new TextDecoder().decode(datos))) {
      motivos.push({ codigo: 'codigoOfuscado', detalle: e.nombre });
      break;
    }
  }

  // Un ZIP dentro de otro, un nivel: no hace falta más para esconder algo.
  if (nivel < 1) {
    for (const e of entradas.filter((x) => extension(x.nombre) === 'zip').slice(0, 10)) {
      const datos = await leerEntrada(b, e);
      if (datos) await revisar(e.nombre, datos, '', motivos, nivel + 1);
    }
  }
}

/**
 * Un `eval` (o `new Function`, o `exec` en Python) junto a un bloque enorme de
 * base64 o hex, o a una línea de miles de caracteres. El código normal no se
 * escribe así; el que se esconde, casi siempre.
 */
export function pareceOfuscado(codigo: string): boolean {
  const evalua = /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]|\bexec\s*\(\s*(base64|bytes|codecs|zlib)/.test(codigo);
  if (!evalua) return false;
  const bloque = /[A-Za-z0-9+/=]{1500,}|(?:\\x[0-9a-fA-F]{2}){300,}/.test(codigo);
  const lineaEnorme = codigo.split('\n').some((l) => l.length > 5000);
  return bloque || lineaEnorme;
}

function tamano(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

/** «a.exe, b.bat y 3 más». */
function resumen(nombres: string[]): string {
  const cortos = nombres.slice(0, 3).map((n) => n.split('/').pop() ?? n);
  return nombres.length > 3 ? `${cortos.join(', ')} +${nombres.length - 3}` : cortos.join(', ');
}
