/**
 * Dar acceso a lo cifrado de un encargo: a quien se eligió en el tablón, o a
 * quien decide una disputa. Y, del otro lado, el expediente que lee quien
 * decide. Compartido por la web y la app.
 *
 * Para dar acceso hay que poder abrirlo, y para abrirlo hay que tenerlo: aquí
 * se reúne todo lo cifrado de un encargo que una parte puede bajarse con sus
 * propias firmas —el encargo, la entrega y sus archivos—, se saca su clave de
 * contenido y se envuelve para quien toque (`concederAcceso`, en el SDK). El
 * buzón guarda esos accesos y los sirve; no puede usarlos.
 */

import {
  concederAcceso,
  esArchivoCifrado,
  esTextoCifrado,
  parseAttachmentsManifest,
  parseFilesManifest,
  tablonDisputaSignMessage,
  type Acceso,
  type EncargoConReglas,
  type HashedFile,
  sinBarraFinal,
} from '@panal/sdk';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import {
  buildResultUrl,
  cabecerasFirma,
  credencialDeEncargo,
  descargarArchivoDelBuzon,
  disputaSignMessage,
  expiraEn,
  leerEncargoDelBuzon,
  resultSignMessage,
} from '@/lib/botEndpoint';
import {
  abrirBytes,
  abrirTexto,
  clavePublicaDe,
  darAccesoALosArbitros,
  darAccesos,
  miClave,
  nombreEnBuzon,
  type Firmar,
} from '@/lib/cifrado';
import {
  BUZON_DEL_TABLON,
  bajarArchivoDelTablon,
  credencialTablon,
  leerEncargoConFirma,
  leerEntregaConFirma,
} from '@/lib/tablonReglas';

/** Lo cifrado que se ha podido reunir, y los accesos que ya tenía quien lo reúne. */
interface Reunido {
  objetos: (string | Uint8Array)[];
  accesos: Acceso[];
}

/**
 * Todo lo de un encargo del tablón que su CLIENTE puede bajarse: el encargo y
 * sus adjuntos, y —si ya hay entrega— la entrega y sus archivos. Los archivos
 * solo si el texto que los anuncia iba cifrado: en claro no hacen falta.
 */
async function reunirDelTablon(job: EncargoConReglas, yo: Address, firmar: Firmar, resultHash: Hex | null): Promise<Reunido> {
  const objetos: (string | Uint8Array)[] = [];
  const accesos: Acceso[] = [];
  const credE = await credencialTablon('encargo', job.id, yo, firmar);
  const leido = await leerEncargoConFirma(job, credE);
  accesos.push(...leido.accesos);
  if (leido.brief !== null && esTextoCifrado(leido.brief)) {
    objetos.push(leido.brief);
    const { legible } = await abrirTexto(leido.brief, yo, firmar, accesos);
    for (const a of legible ? parseAttachmentsManifest(legible) : []) {
      objetos.push(await bajarArchivoDelTablon(job.id, a, 'adjunto', credE, true));
    }
  }
  if (resultHash) {
    const credR = await credencialTablon('resultado', job.id, yo, firmar);
    const entrega = await leerEntregaConFirma(job.id, resultHash, credR);
    accesos.push(...entrega.accesos);
    if (entrega.texto !== null && esTextoCifrado(entrega.texto)) {
      objetos.push(entrega.texto);
      const { legible } = await abrirTexto(entrega.texto, yo, firmar, accesos);
      for (const f of legible ? parseFilesManifest(legible) : []) {
        objetos.push(await bajarArchivoDelTablon(job.id, f, 'entrega', credR, true));
      }
    }
  }
  return { objetos, accesos };
}

/**
 * El cliente de un encargo confidencial le da acceso a quien eligió: al
 * encargo y a sus adjuntos. Falla si el elegido no ha publicado su clave: sin
 * ella no hay a quién envolverle nada.
 */
export async function darAccesoAlElegido(job: EncargoConReglas, agente: Address, yo: Address, firmar: Firmar): Promise<number> {
  const clave = await clavePublicaDe(agente);
  if (!clave) throw new Error('sin clave');
  const { objetos, accesos } = await reunirDelTablon(job, yo, firmar, null);
  if (objetos.length === 0) return 0;
  const mia = await miClave(yo, firmar);
  const nuevos = objetos.map((o) => concederAcceso(o, yo, mia.secreta, { cuenta: agente, clave }, accesos));
  await darAccesos(BUZON_DEL_TABLON, job.id, true, nuevos, yo, firmar);
  return nuevos.length;
}

/** El cliente de un encargo del tablón da acceso a quien decide su disputa. */
export async function darAccesoALosArbitrosDelTablon(
  job: EncargoConReglas,
  resultHash: Hex | null,
  yo: Address,
  firmar: Firmar,
): ReturnType<typeof darAccesoALosArbitros> {
  const { objetos, accesos } = await reunirDelTablon(job, yo, firmar, resultHash);
  return darAccesoALosArbitros({ base: BUZON_DEL_TABLON, id: job.id, esTablon: true, objetos, accesos, cuenta: yo, firmar });
}

/**
 * Una parte de una tarea DIRECTA con una persona da acceso a quien decide su
 * disputa. El trabajador puede bajarse el encargo, la entrega y todos los
 * archivos; el cliente, la entrega y los archivos, y el encargo solo si lo
 * guardó al contratar (el buzón se lo enseña al trabajador, no a él).
 */
export async function darAccesoALosArbitrosDeUnaTarea(o: {
  botUrl: string;
  taskId: bigint;
  taskHash: Hex;
  resultHash: Hex | null;
  rol: 'client' | 'worker';
  sobreGuardado: string | null;
  yo: Address;
  firmar: Firmar;
}): ReturnType<typeof darAccesoALosArbitros> {
  const objetos: (string | Uint8Array)[] = [];
  const credE = o.rol === 'worker' ? await credencialDeEncargo(o.taskId, o.firmar) : null;
  // El encargo: el trabajador lo baja; el cliente usa el sobre que guardó.
  const brief =
    o.rol === 'worker' && credE
      ? await leerEncargoDelBuzon(o.botUrl, o.taskId, o.yo, credE)
      : o.sobreGuardado && keccak256(toBytes(o.sobreGuardado)).toLowerCase() === o.taskHash.toLowerCase()
        ? o.sobreGuardado
        : null;
  // La entrega, con la firma de «resultado», que ahora vale para las dos partes.
  let entrega: string | null = null;
  let credR: { firma: string; expira: number } | null = null;
  if (o.resultHash) {
    const expira = expiraEn();
    credR = { firma: await o.firmar(resultSignMessage(o.taskId, expira)), expira };
    const res = await fetch(buildResultUrl(o.botUrl, o.taskId), { headers: cabecerasFirma(o.yo, credR.firma, credR.expira) });
    if (res.ok) {
      const { resultText } = (await res.json()) as { resultText?: unknown };
      if (typeof resultText === 'string' && keccak256(toBytes(resultText)).toLowerCase() === o.resultHash.toLowerCase()) {
        entrega = resultText;
      }
    }
  }
  // Los archivos se bajan con la firma que vale para quien los pide: el
  // trabajador, con la del encargo; el cliente, con la de la entrega.
  const credArchivos = credE ?? credR;
  const bajar = async (archivo: { name: string; size: number; hash: string; mime?: string }) =>
    credArchivos
      ? new Uint8Array(
          await (
            await descargarArchivoDelBuzon(o.botUrl, o.taskId, { ...archivo, name: nombreEnBuzon(archivo.hash) }, o.yo, credArchivos)
          ).arrayBuffer(),
        )
      : null;
  for (const [texto, archivos] of [
    [brief, (t: string) => parseAttachmentsManifest(t)],
    [entrega, (t: string) => parseFilesManifest(t)],
  ] as const) {
    if (!texto || !esTextoCifrado(texto)) continue;
    objetos.push(texto);
    const { legible } = await abrirTexto(texto, o.yo, o.firmar);
    for (const a of legible ? archivos(legible) : []) {
      const bytes = await bajar(a).catch(() => null);
      if (bytes && esArchivoCifrado(bytes)) objetos.push(bytes);
    }
  }
  return darAccesoALosArbitros({ base: o.botUrl, id: o.taskId, esTablon: false, objetos, accesos: [], cuenta: o.yo, firmar: o.firmar });
}

/* ── el expediente de una disputa, para quien decide ──────────────────── */

/** Un texto del expediente —el encargo o la entrega— y lo que trae. */
export interface TextoDelExpediente {
  /** En claro, o abierto; `null` si va cifrado y nadie te ha dado acceso. */
  legible: string | null;
  cifrado: boolean;
  /** Si cuadra con el hash que ancló la cadena. Si no, no vale como prueba. */
  cuadra: boolean;
  /** Sus archivos, del manifiesto que va dentro (solo si se pudo leer). */
  archivos: HashedFile[];
  /** De quién son sus archivos en el buzón. */
  de: 'cliente' | 'trabajador';
}

export interface ExpedienteDeDisputa {
  base: string;
  id: bigint;
  esTablon: boolean;
  cred: { firma: string; expira: number };
  encargo: TextoDelExpediente | null;
  entrega: TextoDelExpediente | null;
  accesos: Acceso[];
}

/**
 * Lo que guarda el buzón de una disputa, para un firmante de la multisig:
 * el encargo, la entrega y sus archivos, comprobados contra los hashes de la
 * cadena y abiertos con los accesos que le hayan dado. El buzón solo se lo
 * sirve a un firmante y solo mientras la tarea esté en disputa.
 *
 * `base` es el buzón de quien trabaja o el del tablón; `id`, el número de la
 * tarea o el del encargo del tablón.
 */
export async function leerExpediente(o: {
  base: string;
  id: bigint;
  esTablon: boolean;
  taskHash: Hex;
  resultHash: Hex | null;
  yo: Address;
  firmar: Firmar;
}): Promise<ExpedienteDeDisputa | null> {
  const expira = expiraEn();
  const firma = await o.firmar(o.esTablon ? tablonDisputaSignMessage(o.id, expira) : disputaSignMessage(o.id, expira));
  const cred = { firma, expira };
  const res = await fetch(`${sinBarraFinal(o.base)}/dispute/${o.id.toString()}`, {
    headers: cabecerasFirma(o.yo, firma, expira),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { brief?: unknown; entrega?: unknown; accesos?: unknown };
  const accesos = Array.isArray(body.accesos) ? (body.accesos as Acceso[]) : [];
  const leer = async (
    texto: unknown,
    hash: Hex | null,
    de: 'cliente' | 'trabajador',
    archivosDe: (t: string) => HashedFile[],
  ): Promise<TextoDelExpediente | null> => {
    if (typeof texto !== 'string') return null;
    const cuadra = !!hash && keccak256(toBytes(texto)).toLowerCase() === hash.toLowerCase();
    const { legible, cifrado } = await abrirTexto(texto, o.yo, o.firmar, accesos);
    return { legible, cifrado, cuadra, archivos: legible ? archivosDe(legible) : [], de };
  };
  return {
    base: o.base,
    id: o.id,
    esTablon: o.esTablon,
    cred,
    accesos,
    encargo: await leer(body.brief, o.taskHash, 'cliente', parseAttachmentsManifest),
    entrega: await leer(body.entrega, o.resultHash, 'trabajador', parseFilesManifest),
  };
}

/**
 * Un archivo del expediente: comprobado contra el hash del manifiesto —que
 * va dentro del texto anclado— y abierto si iba cifrado. Si el texto que lo
 * anuncia iba cifrado, el buzón lo guarda con su nombre opaco.
 */
export async function bajarDelExpediente(
  exp: ExpedienteDeDisputa,
  archivo: HashedFile,
  texto: TextoDelExpediente,
  yo: Address,
  firmar: Firmar,
): Promise<Uint8Array> {
  const nombre = texto.cifrado ? nombreEnBuzon(archivo.hash) : archivo.name;
  const res = await fetch(
    `${sinBarraFinal(exp.base)}/dispute/${exp.id.toString()}/file/${encodeURIComponent(nombre)}?de=${texto.de}`,
    { headers: cabecerasFirma(yo, exp.cred.firma, exp.cred.expira), signal: AbortSignal.timeout(180_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength !== archivo.size || keccak256(bytes).toLowerCase() !== archivo.hash.toLowerCase()) {
    throw new Error('no cuadra con el hash');
  }
  return abrirBytes(bytes, yo, firmar, exp.accesos);
}
