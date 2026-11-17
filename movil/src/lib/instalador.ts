/**
 * Panal — instalar la versión nueva desde la propia app.
 *
 * El menú avisa cuando hay una versión más nueva (`actualizacion.ts`). Antes,
 * tocar el aviso abría el APK en el navegador: se bajaba a Descargas y había
 * que ir a buscarlo y abrirlo a mano. Ahora se hace dentro de la app:
 *
 *   1. «Descargar»: la app lo baja, con el progreso a la vista, y lo comprueba.
 *   2. En cuanto está bajado y comprobado, abre el instalador de Android solo.
 *   3. Si la persona no instala en ese momento, no pasa nada: la línea del menú
 *      se queda en «Versión X lista · Actualizar» hasta que la instale, también
 *      si cierra la app (`mirar`). Al instalarla, la app arranca con la versión
 *      nueva, ya no hay nada que anunciar y la línea desaparece.
 *
 * Que se abra solo es decisión del fundador (2026-11-17): antes había que tocar
 * «Actualizar» después de la descarga, y eso era un paso de más. Solo se abre
 * si la app está a la vista: si la persona se fue a otra app mientras bajaba,
 * Android no deja abrir pantallas desde segundo plano, y la línea se queda en
 * «Actualizar» para cuando vuelva.
 *
 * El trabajo de verdad —bajar, comprobar que es ESTA app y que lo firmó la
 * misma clave, abrir el instalador— lo hace
 * `android/app/src/directa/.../Actualizador.java`.
 *
 * Instalar lo sigue confirmando la persona en la pantalla del sistema: la
 * primera vez, Android pide permiso para instalar desde Panal, y cada vez,
 * confirmar la actualización.
 *
 * DÓNDE NO EXISTE. En la app de Google Play (Play no deja que una app se
 * actualice por fuera de Play), en el navegador y en las pruebas. Ahí
 * `instalador.disponible` es `false` y el menú enseña el enlace de siempre.
 *
 * EL ESTADO VIVE AQUÍ, NO EN EL MENÚ. La descarga sigue aunque se cierre el
 * menú; si se vuelve a abrir, tiene que enseñar el progreso que lleva, no un
 * botón de «descargar» que lanzaría otra descarga encima. Y si la app se
 * cerró con la versión ya bajada, `mirar` lo pregunta al abrir el menú para
 * ofrecer «Actualizar» directamente, sin volver a abrir el instalador solo.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { EN_PLAY } from '~/lib/canal';

export type EstadoInstalador =
  | { fase: 'quieto' }
  | { fase: 'bajando'; pct: number | null }
  | { fase: 'lista' }
  | { fase: 'error'; motivo: MotivoDelFallo };

/**
 * Por qué no se instaló, en las dos clases que importan a quien lo lee.
 *
 * `noEsNuestra`: el archivo no es esta app o no lo firmó nuestra clave. No se
 * ofrece bajarlo con el navegador: vendría del mismo sitio.
 * `fallo`: todo lo demás —sin red, un corte, el servidor caído—, que se
 * arregla volviendo a intentarlo.
 */
export type MotivoDelFallo = 'noEsNuestra' | 'fallo';

/** Lo que expone el plugin nativo. */
export interface PluginActualizador {
  descargar(o: { version: string }): Promise<{ estado: string }>;
  instalar(o: { version: string }): Promise<{ estado: string }>;
  preparada(o: { version: string }): Promise<{ lista: boolean }>;
  addListener(
    evento: 'progreso',
    oyente: (p: { recibidos: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

/** El mismo `n.n.n` que exige el lado nativo. Lo que no lo cumple ni se pide. */
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** `null` si el servidor no dijo cuánto mide: se enseña «descargando» sin número. */
export function porcentaje(recibidos: number, total: number): number | null {
  if (!(total > 0) || !(recibidos >= 0)) return null;
  return Math.min(100, Math.floor((recibidos / total) * 100));
}

/** Los códigos de `Actualizador.java`, en las dos clases de arriba. */
export function motivoDelFallo(e: unknown): MotivoDelFallo {
  const codigo = (e as { code?: unknown } | null)?.code;
  return codigo === 'FIRMA' || codigo === 'OTRA_APP' ? 'noEsNuestra' : 'fallo';
}

export interface Instalador {
  disponible: boolean;
  leer(): EstadoInstalador;
  suscribir(oyente: () => void): () => void;
  /** Si ya hay una versión bajada y buena, pasa a «lista». Nunca baja nada. */
  mirar(version: string): Promise<void>;
  /** Bajarla, comprobarla y abrir el instalador. Termina en «lista». */
  descargar(version: string): Promise<void>;
  /** «Actualizar»: abrir el instalador con lo ya bajado. Sigue en «lista». */
  instalar(version: string): Promise<void>;
}

/** Si la app está en pantalla. En las pruebas, y fuera de un navegador, sí. */
function aLaVistaDeVerdad(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** Separado del plugin de verdad para poder probarlo con uno de mentira. */
export function crearInstalador(
  plugin: PluginActualizador | null,
  { aLaVista = aLaVistaDeVerdad }: { aLaVista?: () => boolean } = {},
): Instalador {
  let estado: EstadoInstalador = { fase: 'quieto' };
  // Mientras se abre el instalador, un toque en «Actualizar» no pide otro: el
  // lado nativo hace una cosa cada vez y le contestaría «ocupado», que el
  // menú enseñaría como un fallo.
  let abriendo = false;
  const oyentes = new Set<() => void>();
  const poner = (nuevo: EstadoInstalador): void => {
    estado = nuevo;
    for (const o of oyentes) o();
  };

  /**
   * Llama al plugin escuchando el progreso. Si llega progreso, se enseña: al
   * descargar siempre, y al instalar solo si el archivo se perdió de la caché
   * y hubo que volver a bajarlo.
   */
  async function conProgreso(
    nativo: PluginActualizador,
    llamada: () => Promise<unknown>,
    alTerminar: EstadoInstalador,
  ): Promise<void> {
    let oido: PluginListenerHandle | null = null;
    try {
      oido = await nativo.addListener('progreso', ({ recibidos, total }) => {
        poner({ fase: 'bajando', pct: porcentaje(recibidos, total) });
      });
      await llamada();
      poner(alTerminar);
    } catch (e) {
      poner({ fase: 'error', motivo: motivoDelFallo(e) });
    } finally {
      void oido?.remove();
    }
  }

  return {
    disponible: plugin !== null,
    leer: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
    async mirar(version) {
      if (!plugin || !VERSION.test(version) || estado.fase !== 'quieto') return;
      try {
        const { lista } = await plugin.preparada({ version });
        // Solo si nadie tocó nada mientras se miraba.
        if (lista && estado.fase === 'quieto') poner({ fase: 'lista' });
      } catch {
        /* sin respuesta, se queda en «Descargar», que también funciona */
      }
    },
    async descargar(version) {
      // Dos toques seguidos no lanzan dos descargas.
      if (!plugin || !VERSION.test(version) || estado.fase === 'bajando' || abriendo) return;
      poner({ fase: 'bajando', pct: null });
      await conProgreso(plugin, () => plugin.descargar({ version }), { fase: 'lista' });
      // Bajada y comprobada: el instalador se abre solo. Si no se puede, no es
      // un error: la línea ya dice «Actualizar», y tocarla lo vuelve a intentar.
      if (estado.fase !== 'lista' || !aLaVista()) return;
      abriendo = true;
      try {
        await plugin.instalar({ version });
      } catch {
        /* se queda en «Actualizar» */
      } finally {
        abriendo = false;
      }
    },
    async instalar(version) {
      if (!plugin || !VERSION.test(version) || estado.fase === 'bajando' || abriendo) return;
      abriendo = true;
      try {
        // Termina otra vez en «lista»: si la persona cancela el instalador, el
        // botón sigue ahí hasta que la instale.
        await conProgreso(plugin, () => plugin.instalar({ version }), { fase: 'lista' });
      } finally {
        abriendo = false;
      }
    },
  };
}

function pluginNativo(): PluginActualizador | null {
  if (EN_PLAY || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Actualizador')) return null;
  return registerPlugin<PluginActualizador>('Actualizador');
}

export const instalador = crearInstalador(pluginNativo());

export function useInstalador(): EstadoInstalador {
  return useSyncExternalStore(instalador.suscribir, instalador.leer, instalador.leer);
}
