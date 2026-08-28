/**
 * Panal — saber si hay una versión más nueva que la instalada.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 *
 * La app viaja ENTERA dentro del APK: no se actualiza sola, y desplegar la web
 * no toca los teléfonos. O sea que quien instaló la 2.5.0 se queda en la 2.5.0
 * para siempre salvo que alguien se lo cuente. La web ya enlaza a la release
 * más nueva, pero eso solo lo ve quien vuelve a panal.lat, que es justo lo que
 * no hace quien ya tiene la app instalada.
 *
 * QUÉ NO HACE, Y A PROPÓSITO
 *
 * No descarga nada, no instala nada y no interrumpe. Enseña una línea en el
 * menú y lleva a la release; instalar sigue siendo una decisión que se toma
 * fuera de la app, con Android pidiendo permiso. Una app que maneja un llavero
 * cifrado no es el sitio para inventarse un actualizador automático.
 *
 * CUÁNTO SE ASOMA A LA RED
 *
 * Preguntarle a GitHub es decirle a GitHub que esta app está abierta. Así que
 * se pregunta lo mínimo: SOLO al abrir el menú —no al arrancar, no de fondo— y
 * como mucho una vez al día; el resto del tiempo se contesta con lo guardado.
 * Sin red, con GitHub caído o pasado el límite de peticiones no se dice nada:
 * el fallo de esto nunca puede ser un error en la cara de nadie.
 *
 * Y solo en una versión de verdad. Una compilación de desarrollo no tiene
 * número contra el que comparar, así que ni pregunta.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';

/** La release más nueva que no sea borrador ni prelanzamiento. */
const ULTIMA = 'https://api.github.com/repos/AgentHiv/Panal/releases/latest';

const CLAVE = 'panal:ultima-version:v1';
const UN_DIA = 24 * 60 * 60 * 1000;

/** Que una respuesta lenta no deje la promesa colgando para siempre. */
const ESPERA = 8000;

/**
 * La versión instalada.
 *
 * Sale de `VITE_VERSION`, que el flujo del APK rellena con el mismo número que
 * `versionName`. Compilando a mano no existe, y eso es la señal de que esto no
 * tiene nada que comparar.
 */
export function versionInstalada(): string | null {
  const v = import.meta.env.VITE_VERSION?.trim();
  return v && trozos(v) ? v : null;
}

/** `2.5.1` → `[2, 5, 1]`. Cualquier otra forma, null. */
function trozos(v: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(v)) return null;
  return v.split('.').map(Number);
}

/**
 * `apk-v2.5.1` → `2.5.1`.
 *
 * Se exige el prefijo en vez de aceptar cualquier etiqueta: el día que este
 * repositorio publique una release que no sea un APK, lo correcto es callarse,
 * no ofrecer la versión de otra cosa.
 */
function versionDeEtiqueta(etiqueta: unknown): string | null {
  if (typeof etiqueta !== 'string') return null;
  const m = /^apk-v(\d+\.\d+\.\d+)$/.exec(etiqueta.trim());
  return m ? m[1] : null;
}

/**
 * Si `candidata` es posterior a `actual`.
 *
 * Número a número y no como texto, que es donde esto se rompe siempre: como
 * cadenas, `'2.10.0' > '2.9.0'` es FALSO y la actualización no se anunciaría
 * nunca a partir de la décima revisión.
 */
export function esMasNueva(candidata: string, actual: string): boolean {
  const a = trozos(candidata);
  const b = trozos(actual);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** A dónde lleva. Se arma con el número ya validado, nunca con una URL que venga de la red. */
export function enlaceDeVersion(version: string): string {
  return `https://github.com/AgentHiv/Panal/releases/tag/apk-v${version}`;
}

interface Guardado {
  /** Cuándo se preguntó, epoch ms. */
  visto: number;
  /** Lo que contestó. */
  version: string;
}

function leerGuardado(): Guardado | null {
  try {
    const g: unknown = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    if (!g || typeof g !== 'object') return null;
    const { visto, version } = g as Record<string, unknown>;
    if (typeof visto !== 'number' || typeof version !== 'string') return null;
    return trozos(version) ? { visto, version } : null;
  } catch {
    return null;
  }
}

function guardar(version: string): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ visto: Date.now(), version }));
  } catch {
    /* sin disco se pregunta más veces, que es lo peor que puede pasar aquí */
  }
}

/** Le pregunta a GitHub. Devuelve la versión publicada, o null si algo falla. */
async function preguntar(): Promise<string | null> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA);
  try {
    const res = await fetch(ULTIMA, {
      headers: { accept: 'application/vnd.github+json' },
      signal: corte.signal,
    });
    if (!res.ok) return null;
    const cuerpo: unknown = await res.json();
    return versionDeEtiqueta((cuerpo as { tag_name?: unknown } | null)?.tag_name);
  } catch {
    // Sin red, con GitHub caído, pasado el límite de peticiones o con una
    // respuesta que no es JSON: lo mismo en todos los casos, no decir nada.
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * La versión publicada, preguntando como mucho una vez al día.
 *
 * Lo guardado se usa aunque esté caducado si la pregunta falla: es mejor una
 * respuesta de ayer que ninguna, y de todas formas se compara contra la
 * instalada antes de enseñar nada.
 */
export async function ultimaPublicada(): Promise<string | null> {
  const guardado = leerGuardado();
  if (guardado && Date.now() - guardado.visto < UN_DIA) return guardado.version;

  const fresca = await preguntar();
  if (!fresca) return guardado?.version ?? null;
  guardar(fresca);
  return fresca;
}

/**
 * Para el menú: la versión nueva si la hay, y si no, null.
 *
 * Se dispara al montar, o sea al ABRIR el menú, que es un gesto de la persona
 * y no un latido de la app.
 */
export function useActualizacion(): string | null {
  const [nueva, setNueva] = useState<string | null>(null);

  useEffect(() => {
    const actual = versionInstalada();
    if (!actual) return;

    let vivo = true;
    void ultimaPublicada().then((publicada) => {
      if (vivo && publicada && esMasNueva(publicada, actual)) setNueva(publicada);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return nueva;
}
