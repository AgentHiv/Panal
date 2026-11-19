/**
 * Panal — abrir el llavero con la huella.
 *
 * La huella NO cifra el llavero. El llavero sigue igual que siempre: cifrado
 * con el PIN y, encima, con la clave del chip (`secureKey.ts`). Lo que hace la
 * huella es guardar el PIN, cifrado con OTRA clave del chip que solo se deja
 * usar después de poner el dedo (`android/.../Huella.java`). Poner el dedo
 * devuelve el PIN, y con el PIN se abre el llavero por el camino de siempre.
 *
 * Así lo peor que puede pasar es perder el atajo, nunca las wallets:
 *
 *   · Si alguien añade una huella al teléfono, Android invalida esa clave y la
 *     app vuelve a pedir el PIN (`invalidada`). Es lo que tiene que pasar:
 *     un dedo nuevo no debe abrir tu wallet.
 *   · Si el PIN guardado deja de abrir el llavero —se borró y se hizo otro—,
 *     quien llama lo nota al abrir y llama a `desactivar()`.
 *   · Si se cancela el diálogo, no pasa nada: queda el teclado del PIN.
 *
 * Se ofrece una vez, después de abrir con el PIN (`ofrecer`). Si se dice
 * «ahora no», no se vuelve a ofrecer sola; se activa desde el llavero.
 *
 * Fuera de Android —el navegador, las pruebas sin plugin— no hay huella:
 * `disponible()` dice que no y nada de esto aparece.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Lo que devuelve el chip al cifrar: se guarda tal cual. */
export interface Sobre {
  iv: string;
  datos: string;
}

/** El texto del diálogo del sistema, en el idioma de la app. */
export interface TextosDialogo {
  titulo: string;
  subtitulo: string;
  cancelar: string;
}

/** Lo que expone `Huella.java`. */
export interface PluginHuella {
  estado(): Promise<{ disponible: boolean; sinHuellas?: boolean }>;
  activar(o: { datos: string } & TextosDialogo): Promise<Sobre>;
  abrir(o: Sobre & TextosDialogo): Promise<{ datos: string }>;
  olvidar(): Promise<void>;
}

/**
 * Por qué no salió, en las clases que cambian lo que ve la persona.
 *
 * `cancelado`: tocó «usar el PIN» o cerró el diálogo. No se dice nada.
 * `invalidada`: las huellas del teléfono cambiaron; la huella se desactiva.
 * `bloqueada`: demasiados dedos que no eran; Android la bloquea un rato.
 * `fallo`: cualquier otra cosa. Se usa el PIN y la huella sigue activada.
 */
export type Fallo = 'cancelado' | 'invalidada' | 'bloqueada' | 'fallo';

/** El PIN cifrado. Lo borra también `borrarLlavero()`. */
export const CLAVE_HUELLA = 'panal:huella:v1';
/** «Ahora no»: no volver a ofrecerla sola. */
export const CLAVE_NO_OFRECER = 'panal:huella:no-ofrecer';

const PIN = /^\d{6}$/;

export function falloDe(e: unknown): Fallo {
  const codigo = (e as { code?: unknown } | null)?.code;
  if (codigo === 'CANCELADO' || codigo === 'OCUPADO') return 'cancelado';
  if (codigo === 'INVALIDADA' || codigo === 'SIN_CLAVE') return 'invalidada';
  if (codigo === 'BLOQUEADA') return 'bloqueada';
  return 'fallo';
}

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento no hay huella: se usa el PIN */
  }
}

function sobreGuardado(): Sobre | null {
  const crudo = leer(CLAVE_HUELLA);
  if (!crudo) return null;
  try {
    const s = JSON.parse(crudo) as Partial<Sobre>;
    return typeof s.iv === 'string' && typeof s.datos === 'string' ? { iv: s.iv, datos: s.datos } : null;
  } catch {
    return null;
  }
}

export interface Huella {
  /** Si este teléfono puede ahora mismo: sensor y alguna huella dada de alta. */
  disponible(): Promise<boolean>;
  /** Si hay un PIN guardado con la huella. */
  activada(): boolean;
  suscribir(oyente: () => void): () => void;
  /** Pide el dedo y guarda el PIN. El PIN tiene que ser el bueno: no se comprueba aquí. */
  activar(pin: string, textos: TextosDialogo): Promise<'ok' | Fallo>;
  /** Pide el dedo y devuelve el PIN. */
  pin(textos: TextosDialogo): Promise<{ pin: string } | { fallo: Fallo }>;
  desactivar(): void;
  /** Si toca ofrecerla después de abrir con el PIN. */
  ofrecer(): Promise<boolean>;
  /** «Ahora no». */
  noOfrecer(): void;
}

/** Separado del plugin de verdad para poder probarlo con uno de mentira. */
export function crearHuella(plugin: PluginHuella | null): Huella {
  const oyentes = new Set<() => void>();
  const avisar = (): void => {
    for (const o of oyentes) o();
  };
  // Un diálogo cada vez. El segundo que pida recibe la misma respuesta.
  let enCurso: Promise<{ pin: string } | { fallo: Fallo }> | null = null;

  const desactivar = (): void => {
    escribir(CLAVE_HUELLA, null);
    void plugin?.olvidar().catch(() => undefined);
    avisar();
  };

  const disponible = async (): Promise<boolean> => {
    if (!plugin) return false;
    try {
      return (await plugin.estado()).disponible === true;
    } catch {
      return false;
    }
  };

  return {
    disponible,
    activada: () => plugin !== null && sobreGuardado() !== null,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
    async activar(pin, textos) {
      if (!plugin || !PIN.test(pin)) return 'fallo';
      try {
        const sobre = await plugin.activar({ datos: btoa(pin), ...textos });
        escribir(CLAVE_HUELLA, JSON.stringify({ iv: sobre.iv, datos: sobre.datos }));
        avisar();
        return 'ok';
      } catch (e) {
        return falloDe(e);
      }
    },
    pin(textos) {
      if (enCurso) return enCurso;
      const sobre = sobreGuardado();
      if (!plugin || !sobre) return Promise.resolve({ fallo: 'fallo' as const });
      enCurso = (async () => {
        try {
          const pin = atob((await plugin.abrir({ ...sobre, ...textos })).datos);
          if (PIN.test(pin)) return { pin };
          // Lo que salió no es un PIN: guardado roto. Fuera, y a teclear.
          desactivar();
          return { fallo: 'fallo' as const };
        } catch (e) {
          const fallo = falloDe(e);
          if (fallo === 'invalidada') desactivar();
          return { fallo };
        } finally {
          enCurso = null;
        }
      })();
      return enCurso;
    },
    desactivar,
    async ofrecer() {
      if (!plugin || sobreGuardado() !== null || leer(CLAVE_NO_OFRECER) !== null) return false;
      return disponible();
    },
    noOfrecer() {
      escribir(CLAVE_NO_OFRECER, '1');
    },
  };
}

function pluginNativo(): PluginHuella | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Huella')) return null;
  return registerPlugin<PluginHuella>('Huella');
}

export const huella = crearHuella(pluginNativo());

/**
 * Si se puede usar y si está activada, para pintar el botón y el ajuste.
 *
 * `disponible` se vuelve a preguntar al volver a la app: la persona pudo irse
 * a los ajustes a dar de alta su primera huella, o a quitarlas todas.
 */
export function useHuella(): { disponible: boolean; activada: boolean } {
  const activada = useSyncExternalStore(huella.suscribir, huella.activada, huella.activada);
  const [disponible, setDisponible] = useState(false);
  useEffect(() => {
    let vivo = true;
    const mirar = (): void => {
      if (document.visibilityState === 'hidden') return;
      void huella.disponible().then((d) => {
        if (vivo) setDisponible(d);
      });
    };
    mirar();
    document.addEventListener('visibilitychange', mirar);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', mirar);
    };
  }, []);
  return { disponible, activada };
}
