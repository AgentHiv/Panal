/**
 * Panal — saber si hay una versión más nueva que la instalada.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 *
 * La app viaja ENTERA dentro del APK: no se actualiza sola, y desplegar la web
 * no toca los teléfonos. O sea que quien instaló la 2.5.0 se queda en la 2.5.0
 * para siempre salvo que alguien se lo cuente. La web ya lo enseña en
 * `panal.lat/app`, pero eso solo lo ve quien vuelve al sitio, que es justo lo
 * que no hace quien ya tiene la app instalada.
 *
 * QUÉ NO HACE, Y A PROPÓSITO
 *
 * No instala nada y no interrumpe. Enseña una línea en el menú y, al tocarla,
 * descarga el APK — instalar sigue siendo una decisión que se toma fuera, con
 * Android pidiendo permiso. Una app que maneja un llavero cifrado no es el
 * sitio para inventarse un actualizador que se instala solo.
 *
 * Lo que sí cambió: antes llevaba a la PÁGINA de la release y desde ahí había
 * que encontrar el `.apk` entre los adjuntos, con la lista plegada en un móvil.
 * Ahora el enlace es el archivo. Un gesto en vez de tres.
 *
 * CUÁNTO SE ASOMA A LA RED
 *
 * Se pregunta lo mínimo: SOLO al abrir el menú —no al arrancar, no de fondo— y
 * como mucho una vez al día; el resto del tiempo se contesta con lo guardado.
 * Sin red o con el bucket caído no se dice nada: el fallo de esto nunca puede
 * ser un error en la cara de nadie.
 *
 * Y solo en una versión de verdad. Una compilación de desarrollo no tiene
 * número contra el que comparar, así que ni pregunta.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';

/**
 * De dónde se pregunta: NUESTRO dominio, no la API de GitHub.
 *
 * Es el mismo `ultima.json` que escribe el flujo del APK al publicar y que lee
 * `panal.lat/app`, así que las dos cuentan lo mismo por construcción. Antes se
 * preguntaba a `api.github.com/.../releases/latest`, con tres pegas: le decía a
 * GitHub que esta app está abierta, tiene un límite de peticiones por IP que se
 * comparte con todo el que salga por esa red, y devuelve una release entera
 * para leer un número.
 */
const ULTIMA = 'https://panalandroid.panal.lat/ultima.json';

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

/**
 * A dónde lleva: AL ARCHIVO, no a una página.
 *
 * Antes abría la release de GitHub, y desde ahí había que encontrar el `.apk`
 * entre los adjuntos y pulsarlo — en un móvil, con la lista de assets plegada.
 * Ahora el enlace ES el APK, servido desde nuestro dominio con el
 * `content-type` de Android, así que al tocarlo se descarga y el sistema ofrece
 * instalarlo. Un gesto en vez de tres.
 *
 * A la copia CON NÚMERO y no a `panal.apk`: se descarga exactamente la versión
 * que se acaba de anunciar. Con la clave fija habría una ventana —entre que se
 * anuncia y se pulsa— en la que podría publicarse otra y bajarse una distinta
 * de la que se dijo.
 *
 * Se arma con el número ya validado por `trozos`, nunca con una URL que venga
 * de la red.
 */
export function enlaceDeVersion(version: string): string {
  return `https://panalandroid.panal.lat/panal-apk-v${version}.apk`;
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

/** Lee el manifiesto. Devuelve la versión publicada, o null si algo falla. */
async function preguntar(): Promise<string | null> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA);
  try {
    const res = await fetch(ULTIMA, { signal: corte.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const cuerpo: unknown = await res.json();
    const v = (cuerpo as { version?: unknown } | null)?.version;
    // Se valida la forma antes de creérselo: viene de la red, y con ella se
    // arma una URL. `trozos` exige exactamente `n.n.n`.
    return typeof v === 'string' && trozos(v.trim()) ? v.trim() : null;
  } catch {
    // Sin red, con el bucket caído o con una respuesta que no es JSON: lo mismo
    // en todos los casos, no decir nada.
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
