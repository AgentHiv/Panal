/**
 * Panal — instalar la versión nueva desde la propia app.
 *
 * El menú avisa cuando hay una versión más nueva (`actualizacion.ts`). Antes,
 * tocar el aviso abría el APK en el navegador: se bajaba a Descargas y había
 * que ir a buscarlo y abrirlo a mano. Ahora la app lo baja ella misma, enseña
 * el progreso y abre el instalador de Android. El trabajo de verdad —bajar,
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
 * botón de «instalar» que lanzaría otra descarga encima.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { EN_PLAY } from '~/lib/canal';

export type EstadoInstalador =
  | { fase: 'quieto' }
  | { fase: 'bajando'; pct: number | null }
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
  instalar(o: { version: string }): Promise<{ estado: string }>;
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

  return {
    disponible: plugin !== null,
    leer: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
    async instalar(version) {
      // Dos toques seguidos no lanzan dos descargas.
      if (!plugin || !VERSION.test(version) || estado.fase === 'bajando') return;
      poner({ fase: 'bajando', pct: null });
      let oido: PluginListenerHandle | null = null;
      try {
        oido = await plugin.addListener('progreso', ({ recibidos, total }) => {
          if (estado.fase === 'bajando') poner({ fase: 'bajando', pct: porcentaje(recibidos, total) });
        });
        await plugin.instalar({ version });
        poner({ fase: 'instalador' });
      } catch (e) {
        poner({ fase: 'error', motivo: motivoDelFallo(e) });
      } finally {
        void oido?.remove();
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
