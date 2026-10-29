/**
 * Panal — los archivos que pueden ejecutar código al abrirlos.
 *
 * Panal comprueba que un archivo es el que se entregó (su hash está en la
 * cadena), pero no que sea inofensivo: eso no lo puede saber nadie mirando los
 * bytes. Lo que sí se sabe es qué TIPOS de archivo hacen algo más que enseñarse
 * al abrirlos —un programa, un script, una página web, un documento con
 * macros—, y para esos la pantalla avisa antes de bajarlos.
 *
 * Es un aviso y no un bloqueo: un agente que programa entrega scripts a
 * propósito, y quien los pidió los quiere. Lo que se evita es abrirlos sin
 * pensar porque venían «verificados».
 *
 * Compartido con la app por el alias `@`.
 */

/**
 * Por extensión, en minúsculas. Agrupadas para poder revisarlas:
 * programas e instaladores, scripts, páginas y gráficos con código, documentos
 * con macros, accesos directos y extensiones de navegador.
 */
const EXTENSIONES = new Set([
  // Programas e instaladores
  'exe', 'msi', 'msix', 'appx', 'com', 'scr', 'pif', 'cpl', 'dll', 'so', 'dylib', 'app', 'dmg', 'pkg',
  'deb', 'rpm', 'apk', 'aab', 'xapk', 'ipa', 'appimage', 'run', 'bin', 'jar', 'iso', 'img', 'vhd',
  // Scripts
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta', 'sh', 'bash',
  'zsh', 'command', 'py', 'pyw', 'rb', 'pl', 'php', 'lua', 'applescript', 'scpt',
  // Páginas y gráficos que pueden llevar código
  'html', 'htm', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'svg', 'svgz',
  // Documentos con macros
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'sldm',
  // Accesos directos, registro y extensiones de navegador
  'lnk', 'url', 'reg', 'inf', 'scf', 'desktop', 'crx', 'xpi',
]);

/** Los mismos, por tipo MIME: el nombre lo elige quien entrega, el tipo también, y se mira todo. */
const TIPOS = [
  /^application\/(x-)?(msdownload|msdos-program|ms-installer|executable|x-executable|x-sharedlib|x-mach-binary)$/i,
  /^application\/(x-)?(sh|bat|csh|perl|python|ruby|php|javascript|ecmascript)$/i,
  /^(text|application)\/(javascript|ecmascript|x-javascript|x-shellscript|x-python|html|xhtml\+xml)$/i,
  /^image\/svg\+xml$/i,
  /^application\/vnd\.android\.package-archive$/i,
  /^application\/java-archive$/i,
  /^application\/vnd\.ms-[a-z]+\.(addin\.)?macroenabled/i,
];

/**
 * Si abrir este archivo puede ejecutar código. Mira la ÚLTIMA extensión, que es
 * la que decide el sistema: `factura.pdf.exe` es un programa aunque diga pdf.
 */
export function puedeEjecutarCodigo(nombre: string, mime?: string): boolean {
  const punto = nombre.lastIndexOf('.');
  const extension = punto >= 0 ? nombre.slice(punto + 1).trim().toLowerCase() : '';
  if (extension && EXTENSIONES.has(extension)) return true;
  return !!mime && TIPOS.some((t) => t.test(mime.trim()));
}
