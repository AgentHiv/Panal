/**
 * Panal — instalar la versión nueva desde la propia app.
 *
 * El menú avisa cuando hay una versión más nueva (`actualizacion.ts`). Antes,
 * tocar el aviso abría el APK en el navegador: se bajaba a Descargas y había
 * que ir a buscarlo y abrirlo a mano. Ahora son dos pasos dentro de la app:
 *
 *   1. «Descargar»: la app lo baja, con el progreso a la vista, y lo comprueba.
 *   2. Solo cuando ya está bajado y comprobado aparece «Actualizar», que abre
 *      el instalador de Android.
 *
 * Dos pasos y no uno a propósito: así el instalador no salta encima de lo que
 * se esté haciendo cuando acaba la descarga. El trabajo de verdad —bajar,
 * comprobar que es ESTA app y que lo firmó la misma clave, abrir el
 * instalador— lo hace `android/app/src/directa/.../Actualizador.java`.
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
 * ofrecer «Actualizar» directamente.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { EN_PLAY } from '~/lib/canal';

export type EstadoInstalador =
  | { fase: 'quieto' }
  | { fase: 'bajando'; pct: number | null }
  | { fase: 'lista' }
  | { fase: 'instalador' }
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
  /** Paso 1: bajarla y comprobarla. Termina en «lista». */
  descargar(version: string): Promise<void>;
  /** Paso 2: abrir el instalador de Android con lo ya bajado. */
  instalar(version: string): Promise<void>;
}

/** Separado del plugin de verdad para poder probarlo con uno de mentira. */
export function crearInstalador(plugin: PluginActualizador | null): Instalador {
  let estado: EstadoInstalador = { fase: 'quieto' };
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
      if (!plugin || !VERSION.test(version) || estado.fase === 'bajando') return;
      poner({ fase: 'bajando', pct: null });
      await conProgreso(plugin, () => plugin.descargar({ version }), { fase: 'lista' });
    },
    async instalar(version) {
      if (!plugin || !VERSION.test(version) || estado.fase === 'bajando') return;
      await conProgreso(plugin, () => plugin.instalar({ version }), { fase: 'instalador' });
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
