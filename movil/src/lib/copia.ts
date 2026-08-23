/**
 * Panal — sacar una copia de un expediente.
 *
 * Un archivo HTML suelto, con todo dentro y sin una sola petición de red: se
 * abre a los diez años en cualquier ordenador, sin la app, sin Panal y sin
 * internet. Ese es el punto de tenerlo — si la copia necesitara un servidor,
 * no sería una copia.
 *
 * En Android se escribe en la caché de la app y se pasa al menú de compartir,
 * que es donde el teléfono ya sabe guardar en Drive, en Archivos o mandarlo por
 * donde sea. Un `<a download>` no vale: el WebView de Capacitor no lo baja.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import type { Expediente } from '~/lib/expedientes';
import { formatBytes } from '@/lib/deliveredFiles';
import { monto } from '~/lib/formato';

const ESTADOS = ['Abierto', 'Entregado', 'Completado', 'Disputado', 'Cancelado'];

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fecha(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** El expediente entero como una página que se abre sola. */
export function aHtml(e: Expediente): string {
  const filas = [
    ['Encargo', `#${e.id}`],
    ['Cliente', e.cliente],
    ['Agente', e.agente],
    ['Importe', `${monto(e.cadena.importe)} ${e.cadena.simbolo}`],
    ['Estado', ESTADOS[e.cadena.estado] ?? String(e.cadena.estado)],
    ['Creado', fecha(e.cadena.creado)],
    ['Plazo', fecha(e.cadena.plazo)],
    ['Entregado', fecha(e.cadena.entregado)],
    ['Hash de lo pedido', e.cadena.taskHash],
    ['Hash de la entrega', e.cadena.resultHash],
  ]
    .map(([k, v]) => `<tr><th>${escapar(k)}</th><td class="mono">${escapar(v)}</td></tr>`)
    .join('\n');

  const adjuntos = e.local.adjuntos.length
    ? `<h2>Archivos que anuncia la entrega</h2>
<p class="aviso">Estos archivos NO están dentro de esta copia: se bajan del servidor del agente. Lo que sí queda aquí es su hash, que sirve para comprobar que unos bytes que tengas son los que se entregaron.</p>
<ul>${e.local.adjuntos
        .map(
          (a) =>
            `<li><b>${escapar(a.name)}</b> · ${formatBytes(a.size)}<br><span class="mono peq">${escapar(a.hash)}</span></li>`,
        )
        .join('')}</ul>`
    : '';

  const hilo = e.local.hilo.length
    ? `<h2>La conversación</h2>
<div class="hilo">${e.local.hilo
        .map(
          (m) =>
            `<div class="msg ${m.de === 'yo' ? 'yo' : 'ag'}"><div class="quien">${
              m.de === 'yo' ? 'Tú' : 'El agente'
            } · ${escapar(fecha(m.cuando))}</div><div class="texto">${escapar(m.texto)}</div></div>`,
        )
        .join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panal · encargo #${escapar(e.id)}</title>
<style>
  body { margin: 0 auto; padding: 32px 22px 60px; max-width: 760px; background: #fbfaf7; color: #1b1a17;
         font: 15px/1.6 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 15px; margin: 30px 0 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b6659; }
  .sub { color: #6b6659; margin: 0 0 26px; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #e6e2d8; vertical-align: top; }
  th { font-weight: 500; color: #6b6659; width: 34%; font-size: 14px; }
  .mono { font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 13px; word-break: break-all; }
  .peq { font-size: 12px; color: #6b6659; }
  .caja { border: 1px solid #e6e2d8; border-radius: 10px; padding: 14px 16px; background: #fff;
          white-space: pre-wrap; }
  .falta { border: 1px solid #e3c9b8; background: #fdf3ee; border-radius: 10px; padding: 14px 16px; color: #8a4a28; }
  .aviso { color: #6b6659; font-size: 13.5px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 8px; }
  .hilo { display: flex; flex-direction: column; gap: 10px; }
  .msg { border-radius: 10px; padding: 10px 13px; max-width: 82%; }
  .msg.yo { background: #ece8ff; align-self: flex-end; }
  .msg.ag { background: #fff; border: 1px solid #e6e2d8; align-self: flex-start; }
  .quien { font-size: 11.5px; color: #6b6659; margin-bottom: 3px; }
  footer { margin-top: 40px; border-top: 1px solid #e6e2d8; padding-top: 14px; font-size: 12.5px; color: #6b6659; }
</style>
</head><body>

<h1>Encargo #${escapar(e.id)}</h1>
<p class="sub">Copia sacada el ${escapar(fecha(Date.now()))} desde la app de Panal.</p>

<h2>En la cadena · para siempre</h2>
<table>${filas}</table>

<h2>Lo que pediste</h2>
${
  e.local.brief
    ? `<div class="caja">${escapar(e.local.brief)}</div>
<p class="peq mono">keccak256 → ${escapar(e.cadena.taskHash)}${
        e.local.briefCuadra ? ' · cuadra con la cadena' : ' · NO cuadra con la cadena'
      }</p>`
    : `<div class="falta">No estaba en el teléfono cuando se sacó esta copia. En la cadena solo viaja su hash, así que el texto de lo que se pidió se perdió.</div>`
}

<h2>Lo que entregó</h2>
${
  e.local.entrega
    ? `<div class="caja">${escapar(e.local.entrega)}</div>
<p class="peq mono">keccak256 → ${escapar(e.cadena.resultHash)} · cuadra con la cadena</p>`
    : `<div class="falta">No estaba en el teléfono. Se puede volver a pedir al agente mientras siga en pie; si no, el hash de arriba ya no prueba nada por sí solo.</div>`
}

${adjuntos}
${hilo}

<footer>
  Panal · el escrow guarda nueve campos por encargo y ni uno más. Lo que hay en esta página que no
  esté en la tabla de arriba solo existía en un teléfono. Este archivo no pide nada a ningún
  servidor: se abre igual sin internet.
</footer>
</body></html>
`;
}

export type Resultado = { ok: true; donde: string } | { ok: false; porque: string };

/**
 * Escribe la copia y la ofrece al teléfono.
 *
 * Fuera de Android —el `pnpm dev` de un portátil— baja como un archivo normal,
 * porque ahí sí funciona `<a download>` y así se puede probar sin compilar.
 */
export async function guardarCopia(
  nombre: string,
  contenido: string,
  tipo = 'text/html',
): Promise<Resultado> {
  if (!Capacitor.isNativePlatform()) {
    try {
      const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
      return { ok: true, donde: 'Descargas' };
    } catch (err) {
      return { ok: false, porque: err instanceof Error ? err.message : 'No se pudo' };
    }
  }

  try {
    // A la caché y no a Documents: Documents pide permiso de almacenamiento en
    // Android viejos, y el archivo se va a compartir al momento de todos modos.
    const escrito = await Filesystem.writeFile({
      path: nombre,
      data: contenido,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: nombre,
      // Sin `text`: algunas apps de destino mandan el texto y sueltan el
      // archivo, y lo que hay que compartir es el archivo.
      url: escrito.uri,
      dialogTitle: 'Guardar el expediente',
    });
    return { ok: true, donde: 'el teléfono' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Cerrar el menú de compartir tira un error, y no es un fallo.
    if (/cancel/i.test(msg)) return { ok: true, donde: 'el teléfono' };
    return { ok: false, porque: msg };
  }
}

/** Un nombre de archivo que se ordena solo y no choca. */
export function nombreDe(e: Expediente): string {
  const d = new Date(e.cadena.creado);
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `panal-encargo-${e.id}-${dia}.html`;
}

/** Todos los expedientes en un solo archivo, con un índice arriba. */
export function todoAHtml(expedientes: Expediente[], quien: string): string {
  const indice = expedientes
    .map(
      (e) =>
        `<li><a href="#e${escapar(e.id)}">Encargo #${escapar(e.id)}</a> · ${escapar(
          fecha(e.cadena.creado),
        )} · ${escapar(monto(e.cadena.importe))} ${escapar(e.cadena.simbolo)}</li>`,
    )
    .join('');

  // Se reusa `aHtml` y se le quita el envoltorio: así una copia suelta y la
  // copia de todo no pueden decir cosas distintas del mismo encargo.
  const cuerpos = expedientes
    .map((e) => {
      const dentro = aHtml(e).replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '');
      return `<section id="e${escapar(e.id)}">${dentro}</section>`;
    })
    .join('\n<hr>\n');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panal · tus expedientes</title>
<style>
  body { margin: 0 auto; padding: 32px 22px 60px; max-width: 760px; background: #fbfaf7; color: #1b1a17;
         font: 15px/1.6 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 15px; margin: 30px 0 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b6659; }
  .sub { color: #6b6659; margin: 0 0 26px; font-size: 14px; }
  a { color: #a06a12; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #e6e2d8; vertical-align: top; }
  th { font-weight: 500; color: #6b6659; width: 34%; font-size: 14px; }
  .mono { font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 13px; word-break: break-all; }
  .peq { font-size: 12px; color: #6b6659; }
  .caja { border: 1px solid #e6e2d8; border-radius: 10px; padding: 14px 16px; background: #fff; white-space: pre-wrap; }
  .falta { border: 1px solid #e3c9b8; background: #fdf3ee; border-radius: 10px; padding: 14px 16px; color: #8a4a28; }
  .aviso { color: #6b6659; font-size: 13.5px; }
  ul { padding-left: 20px; } li { margin-bottom: 8px; }
  .hilo { display: flex; flex-direction: column; gap: 10px; }
  .msg { border-radius: 10px; padding: 10px 13px; max-width: 82%; }
  .msg.yo { background: #ece8ff; align-self: flex-end; }
  .msg.ag { background: #fff; border: 1px solid #e6e2d8; align-self: flex-start; }
  .quien { font-size: 11.5px; color: #6b6659; margin-bottom: 3px; }
  hr { border: 0; border-top: 2px solid #e6e2d8; margin: 46px 0; }
  footer { margin-top: 40px; border-top: 1px solid #e6e2d8; padding-top: 14px; font-size: 12.5px; color: #6b6659; }
  section h1 { font-size: 21px; margin-top: 0; }
</style>
</head><body>

<h1>Tus expedientes</h1>
<p class="sub">
  ${expedientes.length} ${expedientes.length === 1 ? 'encargo' : 'encargos'} de
  <span class="mono">${escapar(quien)}</span>, copiados el ${escapar(fecha(Date.now()))}.
</p>

<h2>Índice</h2>
<ul>${indice}</ul>

${cuerpos}
</body></html>
`;
}
