/**
 * Mandar una CARPETA por el tablón: se convierte en un .zip en el navegador
 * (`src/lib/zip.ts`, `carpetaComoZip`) y el agente lo abre con el lector de la
 * plantilla. Se comprueba con ese mismo lector, que es el que lo va a abrir de
 * verdad, y el CRC contra el de zlib.
 */
import { crc32 as crcZlib } from 'node:zlib';
const { crearZip, crc32 } = await import('@/lib/zip');
const { carpetaComoZip, tamano } = await import('@/lib/archivosTablon');
const { leerZip } = await import('../../create-agent/template/src/zip.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};
const t = new TextEncoder();

console.log('\nel zip');
dice('el CRC-32 es el de zlib', crc32(t.encode('hola, ñandú')) === crcZlib(t.encode('hola, ñandú')));
const zip = crearZip([
  { nombre: 'a.txt', bytes: t.encode('uno') },
  { nombre: 'sub/b.csv', bytes: t.encode('x,y\n1,2\n') },
  { nombre: '../../fuera/c.bin', bytes: new Uint8Array(3000).map((_, i) => i % 251) },
]);
const dentro = leerZip(zip);
dice('lo abre el lector de la plantilla', dentro.length === 3);
dice('con sus rutas', dentro.map((e) => e.nombre).join(',') === 'a.txt,sub/b.csv,fuera/c.bin');
dice('y sus bytes', new TextDecoder().decode(dentro[1].bytes) === 'x,y\n1,2\n' && dentro[2].bytes.every((b, i) => b === i % 251));
dice('una ruta con .. no se sale de la carpeta', !dentro.some((e) => e.nombre.includes('..')));

console.log('\nuna carpeta elegida');
const archivo = (ruta, texto) => {
  const f = new File([t.encode(texto)], ruta.split('/').pop(), { type: 'text/plain' });
  Object.defineProperty(f, 'webkitRelativePath', { value: ruta });
  return f;
};
const carpeta = await carpetaComoZip([archivo('informe-final/resumen.txt', 'resumen'), archivo('informe-final/anexos/tabla.csv', 'a,b\n')]);
dice('viaja como un .zip con el nombre de la carpeta', carpeta?.name === 'informe-final.zip' && carpeta.mime === 'application/zip');
dice('sin repetir la carpeta dentro', leerZip(carpeta.bytes).map((e) => e.nombre).join(',') === 'resumen.txt,anexos/tabla.csv');
dice('una carpeta vacía no es nada', (await carpetaComoZip([])) === null);

console.log('\ntamaños');
dice('bytes, kB y MB', tamano(12) === '12 B' && tamano(2048) === '2 kB' && tamano(3 * 1024 * 1024) === '3.0 MB');

console.log(`\n${bien} bien · ${mal} mal`);
if (mal > 0) process.exit(1);
