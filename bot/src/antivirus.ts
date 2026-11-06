/**
 * Panal — el antivirus del buzón (ClamAV).
 *
 * El buzón guarda archivos que una persona le manda a otra: adjuntos de un
 * encargo, archivos de una entrega, los del chat y los del tablón. La web y la
 * app ya los revisan antes de guardarlos (`sdk/src/revision.ts`), pero eso mira
 * la FORMA —un programa, un proyecto que se ejecuta al instalarlo—, no si es
 * malware conocido. Eso lo sabe un antivirus con firmas, y aquí se le pregunta
 * a ClamAV antes de guardar nada.
 *
 * Lo que encuentra se RECHAZA: el archivo no llega a guardarse y quien lo
 * subía recibe un 422 con el nombre de la firma. Es la única revisión que
 * bloquea, porque es la única que no adivina.
 *
 * LO QUE NO PUEDE MIRAR. Lo cifrado de punta a punta: el buzón no tiene la
 * clave, a propósito. Eso lo revisa el dispositivo de quien lo recibe, cuando
 * ya lo ha abierto.
 *
 * SI CLAMAV NO CONTESTA, el archivo se guarda igual y se dice en el registro.
 * Un antivirus caído no puede tumbar los encargos de todo el mundo, y la
 * revisión del dispositivo sigue en pie. Se ve en `/health` del buzón.
 *
 * Habla el protocolo de `clamd` (INSTREAM), por socket Unix o por TCP:
 *   CLAMD=unix:/var/run/clamav/clamd.ctl
 *   CLAMD=tcp:127.0.0.1:3310
 * Sin `CLAMD`, no hay antivirus y el buzón funciona como antes.
 */

import { connect, type Socket } from 'node:net';

export type ResultadoAntivirus =
  | { estado: 'limpio' }
  | { estado: 'infectado'; firma: string }
  | { estado: 'sin-revisar'; porque: string };

export interface Antivirus {
  revisar(bytes: Uint8Array): Promise<ResultadoAntivirus>;
}

/** Lo cifrado para un destinatario (`sdk/src/cifrado.ts`): el antivirus no puede verlo por dentro. */
const MARCA_CIFRADO = new TextEncoder().encode('panal-cifrado-1\n');

export function esArchivoCifrado(bytes: Uint8Array): boolean {
  return bytes.length > MARCA_CIFRADO.length + 4 && MARCA_CIFRADO.every((b, i) => bytes[i] === b);
}

/** Lo que se le manda a clamd por trozo. Por debajo de su `StreamMaxLength`, que se mide entero. */
const TROZO = 64 * 1024;

function conectar(destino: string): Socket {
  if (destino.startsWith('unix:')) return connect({ path: destino.slice('unix:'.length) });
  const m = /^tcp:([^:]+):(\d{1,5})$/.exec(destino);
  if (!m) throw new Error(`CLAMD no se entiende: «${destino}». Usa unix:/ruta o tcp:host:puerto.`);
  return connect({ host: m[1]!, port: Number(m[2]) });
}

/**
 * Pregunta a clamd por unos bytes con INSTREAM: «zINSTREAM\0», trozos con su
 * longitud delante (4 bytes, big-endian) y un trozo de longitud cero al final.
 * Contesta «stream: OK», «stream: <firma> FOUND» o «... ERROR».
 */
export function antivirusDeClamd(destino: string, plazoMs = 30_000): Antivirus {
  return {
    revisar: (bytes) =>
      new Promise<ResultadoAntivirus>((resolve) => {
        let terminado = false;
        let respuesta = '';
        const acabar = (r: ResultadoAntivirus) => {
          if (terminado) return;
          terminado = true;
          clearTimeout(reloj);
          socket.destroy();
          resolve(r);
        };
        let socket: Socket;
        try {
          socket = conectar(destino);
        } catch (err) {
          resolve({ estado: 'sin-revisar', porque: err instanceof Error ? err.message : String(err) });
          return;
        }
        const reloj = setTimeout(() => acabar({ estado: 'sin-revisar', porque: 'clamd no contestó a tiempo' }), plazoMs);
        socket.on('error', (err) => acabar({ estado: 'sin-revisar', porque: err.message }));
        socket.on('data', (d: Buffer) => {
          respuesta += d.toString('utf8');
          if (respuesta.includes('\0')) socket.end();
        });
        socket.on('close', () => acabar(interpretar(respuesta)));
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          for (let i = 0; i < bytes.length; i += TROZO) {
            const trozo = bytes.subarray(i, i + TROZO);
            const largo = Buffer.alloc(4);
            largo.writeUInt32BE(trozo.length, 0);
            socket.write(largo);
            socket.write(trozo);
          }
          socket.write(Buffer.alloc(4));
        });
      }),
  };
}

/** «stream: OK» → limpio; «stream: Eicar-Signature FOUND» → infectado; lo demás → sin revisar. */
export function interpretar(respuesta: string): ResultadoAntivirus {
  // Hasta el primer \0, que es donde clamd acaba su respuesta.
  const linea = (respuesta.split('\0')[0] ?? '').trim();
  if (/^stream: OK$/.test(linea)) return { estado: 'limpio' };
  const encontrado = /^stream: (.+) FOUND$/.exec(linea);
  if (encontrado) return { estado: 'infectado', firma: encontrado[1]!.slice(0, 200) };
  return { estado: 'sin-revisar', porque: linea ? linea.slice(0, 200) : 'clamd cerró sin contestar' };
}

/** Si clamd está ahí: «zPING\0» y espera «PONG». Para decirlo al arrancar. */
export function comprobarClamd(destino: string, plazoMs = 5_000): Promise<boolean> {
  return new Promise((resolve) => {
    let respuesta = '';
    let socket: Socket;
    try {
      socket = conectar(destino);
    } catch {
      resolve(false);
      return;
    }
    const reloj = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, plazoMs);
    socket.on('error', () => {
      clearTimeout(reloj);
      resolve(false);
    });
    socket.on('data', (d: Buffer) => {
      respuesta += d.toString('utf8');
    });
    socket.on('close', () => {
      clearTimeout(reloj);
      resolve(respuesta.startsWith('PONG'));
    });
    socket.on('connect', () => socket.end('zPING\0'));
  });
}
