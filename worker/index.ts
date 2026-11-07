/**
 * El Worker de panal.lat. La web sigue siendo estática: Cloudflare sirve
 * `dist/` sin pasar por aquí, salvo las rutas de `assets.run_worker_first` en
 * `wrangler.jsonc`, que hoy son solo las fichas de los agentes (`/agente/*`).
 *
 * En esas, el HTML de la SPA sale con el título, la descripción y la imagen de
 * ESE agente (ver `vista-previa.ts`), que es lo que leen X, Telegram, Discord o
 * WhatsApp al pegar el enlace. A la persona que abre la ficha le llega la misma
 * página de siempre con otro título.
 *
 * Si algo falla —el indexador no contesta, tarda, o el agente no existe— se
 * sirve la página tal cual: la vista previa genérica es mejor que una ficha que
 * no carga.
 */

import { CABECERAS } from './cabeceras';
import { API, direccionDeId, metaDeAgente, reescribirHtml, type RespuestaDelIndice } from './vista-previa';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Lo que se espera al indexador antes de servir la página sin más. */
const ESPERA_MS = 1_500;
/** Lo que Cloudflare guarda la respuesta del indexador en cada centro de datos. */
const CACHE_S = 60;

function conCabeceras(respuesta: Response): Response {
  const r = new Response(respuesta.body, respuesta);
  for (const [k, v] of Object.entries(CABECERAS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pagina = await env.ASSETS.fetch(request);

    const m = /^\/agente\/([^/]+)\/?$/.exec(new URL(request.url).pathname);
    let id = '';
    try {
      id = m ? decodeURIComponent(m[1]!) : '';
    } catch {
      // Un %xx roto: no es la ficha de nadie.
    }
    const direccion = direccionDeId(id);
    const esHtml = (pagina.headers.get('content-type') ?? '').includes('text/html');
    if (!direccion || pagina.status !== 200 || !esHtml || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return conCabeceras(pagina);
    }

    try {
      const init: RequestInit & { cf?: Record<string, unknown> } = {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_MS),
        cf: { cacheTtl: CACHE_S, cacheEverything: true },
      };
      const r = await fetch(`${API}/index/agent?address=${direccion}`, init);
      if (!r.ok) return conCabeceras(pagina);
      const datos = (await r.json()) as RespuestaDelIndice;
      if (!datos?.agent?.address) return conCabeceras(pagina);

      const { html } = reescribirHtml(await pagina.clone().text(), metaDeAgente(datos, id));
      const cabeceras = new Headers(pagina.headers);
      // El cuerpo ya no es el del archivo: ni su tamaño ni su ETag valen.
      cabeceras.delete('content-length');
      cabeceras.delete('etag');
      for (const [k, v] of Object.entries(CABECERAS)) cabeceras.set(k, v);
      return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: cabeceras });
    } catch {
      return conCabeceras(pagina);
    }
  },
};
