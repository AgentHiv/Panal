/**
 * El borrador de una contratación, cerrado con una clave que solo va en el enlace.
 *
 * El MCP remoto guarda dos horas lo que preparó un asistente, para que la web
 * lo abra (`remoto.ts`). Lo guarda CERRADO: AES-128-GCM con una clave al azar
 * que se devuelve dentro del enlace, detrás de la `#`, y que el servidor no se
 * queda. Lo que va detrás de la `#` no lo manda ningún navegador a ningún
 * servidor —ni a Cloudflare, ni a Caddy, ni a este—, así que el número del
 * borrador que sí queda en un registro de acceso no sirve para leerlo, y quien
 * leyera la memoria del proceso solo vería cajas cerradas.
 *
 * El número del borrador va como dato asociado (AAD): una caja no se abre con
 * el número de otra, aunque alguien las cambiara de sitio.
 *
 * El mismo formato lo abre la web con WebCrypto (`src/lib/borrador.ts`):
 *   base64url( iv[12] ‖ cifrado ‖ etiqueta[16] )
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Lo que va dentro de la caja. */
export interface ContenidoDelBorrador {
  agente: string;
  encargo: string;
  nivel: string | null;
  nivelWei: string | null;
  horas: number;
}

/** Cierra el contenido. Devuelve la caja, para guardarla, y la clave, para el enlace. */
export function cerrarBorrador(contenido: ContenidoDelBorrador, id: string): { cifrado: string; clave: string } {
  const clave = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-128-gcm', clave, iv);
  c.setAAD(Buffer.from(id, 'utf8'));
  const cuerpo = Buffer.concat([c.update(JSON.stringify(contenido), 'utf8'), c.final()]);
  return {
    cifrado: Buffer.concat([iv, cuerpo, c.getAuthTag()]).toString('base64url'),
    clave: clave.toString('base64url'),
  };
}

/** Lo abre en Node: solo para las pruebas. La web usa su propia versión con WebCrypto. */
export function abrirBorradorEnNode(cifrado: string, clave: string, id: string): ContenidoDelBorrador | null {
  try {
    const datos = Buffer.from(cifrado, 'base64url');
    const k = Buffer.from(clave, 'base64url');
    if (k.length !== 16 || datos.length < 12 + 16) return null;
    const d = createDecipheriv('aes-128-gcm', k, datos.subarray(0, 12));
    d.setAAD(Buffer.from(id, 'utf8'));
    d.setAuthTag(datos.subarray(datos.length - 16));
    const plano = Buffer.concat([d.update(datos.subarray(12, datos.length - 16)), d.final()]);
    return JSON.parse(plano.toString('utf8')) as ContenidoDelBorrador;
  } catch {
    return null;
  }
}
