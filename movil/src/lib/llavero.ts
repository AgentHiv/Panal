/**
 * Panal — el llavero del teléfono.
 *
 * Crea wallets aquí mismo y las guarda cifradas con un PIN. Ni la semilla ni
 * las doce palabras salen del móvil: no hay servidor al que mandarlas, y esta
 * capa no hace una sola petición de red.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CÓMO SE HACE LA CLAVE
 *
 * `generateMnemonic` de viem, que ya está instalado. Por dentro pide entropía a
 * `crypto.getRandomValues` —en Android, el generador del sistema— y la
 * convierte en doce palabras por BIP-39. No hay criptografía escrita a mano
 * aquí, y no hace falta ninguna librería nueva.
 *
 * Las palabras van en INGLÉS aunque la app esté en español. Son la única forma
 * de recuperar la wallet, y hay que poder escribirlas en cualquier wallet del
 * mundo: la lista inglesa la aceptan todas, la española no. Un juego de
 * palabras que solo entiende esta app no es una copia de seguridad.
 *
 * DÓNDE VIVE
 *
 * En `localStorage`, que en Android es un archivo dentro del cajón privado de
 * la aplicación (`/data/data/lat.panal.app/`): otra app no lo lee sin root, y
 * desde que el manifiesto lleva `allowBackup="false"` tampoco viaja en la copia
 * automática de Google.
 *
 * HASTA DÓNDE LLEGA EL PIN, dicho sin adornos
 *
 * Seis dígitos son un millón de combinaciones. La derivación va a 310.000
 * vueltas de PBKDF2 —unos 100 ms aquí, medio segundo en un teléfono—, así que
 * probarlas todas cuesta días de trabajo con el archivo ya en la mano. Eso
 * frena a quien te roba el móvil apagado; no frena a quien te lo coge
 * desbloqueado y tiene tiempo. Para eso hace falta el chip seguro del
 * teléfono, y el WebView no llega ahí sin un plugin nativo. La pantalla lo
 * dice, y este comentario existe para que nadie lo suba de categoría por el
 * camino.
 *
 * LO QUE ENTRA DE FUERA
 *
 * Además de crearlas, el llavero admite wallets que ya existen: doce (o
 * veinticuatro) palabras, o una clave privada suelta. Se guardan igual de
 * cifradas y se distinguen por `tipo`, porque una clave privada no tiene doce
 * palabras que enseñar y la pantalla no puede prometerlas.
 *
 * Una wallet que entra de fuera nace con `copiada: true`: su copia de
 * seguridad existe ya en algún sitio —de allí ha salido— y avisar de que «no
 * está apuntada» sería un aviso falso, que es peor que ninguno.
 *
 * FIRMAR ES OTRO ARCHIVO
 *
 * `cuentaDe` devuelve la cuenta de viem lista para firmar, y hasta ahí llega
 * esto: quien la usa para mandar dinero es `lib/enviar.ts`. La promesa de que
 * este archivo no hace una sola petición de red sigue en pie.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import type { HDAccount, PrivateKeyAccount } from 'viem';
import { claseDeSecreto, limpiarClave, limpiarFrase, validarPalabras } from '~/lib/envio';
import { textos } from '~/i18n/idiomas';

const CLAVE = 'panal:llavero:v1';

/** 310.000 es lo que recomienda OWASP para PBKDF2-SHA256. */
const VUELTAS = 310_000;

/** Lo que se cifra para poder decir «ese PIN no es» sin tener ninguna wallet. */
const TESTIGO = 'panal:llavero';

/** Qué se guardó: doce palabras, o una clave privada a secas. */
export type Tipo = 'palabras' | 'clave';

export interface WalletGuardada {
  id: string;
  nombre: string;
  direccion: string;
  /** Epoch en milisegundos. */
  creada: number;
  /** Si el dueño ha dicho que ya apuntó las doce palabras. */
  copiada: boolean;
  tipo: Tipo;
  /** Si vino de fuera en vez de nacer aquí. */
  importada: boolean;
}

/**
 * Una fila del disco. `tipo` e `importada` van opcionales porque las wallets
 * escritas antes de que existieran no los tienen, y un llavero de verdad no se
 * puede migrar a la fuerza: si el campo falta, es una wallet de doce palabras
 * creada aquí, que es lo único que había entonces.
 */
type Fila = Omit<WalletGuardada, 'tipo' | 'importada'> & {
  tipo?: Tipo;
  importada?: boolean;
  semilla: Cifrado;
};

/** Lo guardado en el disco. Las direcciones van en claro; las semillas no. */
interface Guardado {
  version: 1;
  sal: string;
  testigo: Cifrado;
  wallets: Fila[];
}

interface Cifrado {
  iv: string;
  datos: string;
}

/** El PIN ya comprobado, en memoria. Se pierde al cerrar la app, a propósito. */
export type Llave = CryptoKey;

/* ── base64, que es como cabe un binario en localStorage ─────────────────── */

function aBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(texto: string): Uint8Array {
  const s = atob(texto);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/* ── el disco ────────────────────────────────────────────────────────────── */

function leer(): Guardado | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const g = JSON.parse(crudo) as Guardado;
    // Un llavero de otra versión o a medias es mejor tratarlo como que no
    // está: sobrescribirlo perdería claves de verdad.
    if (g.version !== 1 || !g.sal || !Array.isArray(g.wallets)) return null;
    return g;
  } catch {
    return null;
  }
}

function escribir(g: Guardado): void {
  // Sin try/catch: si esto falla, la wallet que se acaba de crear NO está
  // guardada, y quien llama tiene que enterarse en vez de creer que sí.
  localStorage.setItem(CLAVE, JSON.stringify(g));
}

/* ── cifrar y descifrar ──────────────────────────────────────────────────── */

async function derivar(pin: string, sal: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal as BufferSource, iterations: VUELTAS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function cifrar(llave: Llave, texto: string): Promise<Cifrado> {
  // IV nuevo por cada cifrado. Repetir uno con la misma clave rompe AES-GCM
  // del todo, así que nunca se reutiliza ni se deriva de nada.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    llave,
    new TextEncoder().encode(texto),
  );
  return { iv: aBase64(iv), datos: aBase64(new Uint8Array(datos)) };
}

async function descifrar(llave: Llave, c: Cifrado): Promise<string> {
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deBase64(c.iv) as BufferSource },
    llave,
    deBase64(c.datos) as BufferSource,
  );
  return new TextDecoder().decode(claro);
}

/* ── lo que usa la pantalla ──────────────────────────────────────────────── */

/** Si ya hay un PIN puesto. Antes de eso la pantalla pide crearlo. */
export function hayLlavero(): boolean {
  return leer() !== null;
}

/**
 * Las wallets que hay, sin descifrar nada: nombre y dirección van en claro.
 *
 * Se copian los campos uno a uno en vez de quitar `semilla` con un rest: así,
 * el día que se guarde algo más junto a la semilla, no sale de aquí por
 * descuido.
 */
export function listar(): WalletGuardada[] {
  const g = leer();
  if (!g) return [];
  return g.wallets.map((w) => ({
    id: w.id,
    nombre: w.nombre,
    direccion: w.direccion,
    creada: w.creada,
    copiada: w.copiada,
    tipo: w.tipo ?? 'palabras',
    importada: w.importada ?? false,
  }));
}

/** Estrena el llavero con un PIN. Falla si ya había uno, para no pisarlo. */
export async function crearLlavero(pin: string): Promise<Llave> {
  if (leer()) throw new Error('Ya hay un llavero en este teléfono');
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const llave = await derivar(pin, sal);
  escribir({
    version: 1,
    sal: aBase64(sal),
    testigo: await cifrar(llave, TESTIGO),
    wallets: [],
  });
  return llave;
}

/**
 * Abre el llavero. `null` es «ese PIN no es», no un error.
 *
 * Se comprueba descifrando el testigo: AES-GCM trae su propia autenticación,
 * así que con la clave equivocada el descifrado falla en vez de devolver
 * basura. Y funciona igual con el llavero vacío, que es justo el caso en que
 * no habría ninguna semilla contra la que probar.
 */
export async function abrir(pin: string): Promise<Llave | null> {
  const g = leer();
  if (!g) return null;
  const llave = await derivar(pin, deBase64(g.sal));
  try {
    const claro = await descifrar(llave, g.testigo);
    return claro === TESTIGO ? llave : null;
  } catch {
    return null;
  }
}

export interface WalletNueva {
  wallet: WalletGuardada;
  /** Las doce palabras, UNA sola vez: después hay que volver a pedir el PIN. */
  palabras: string[];
}

/** Genera una wallet, la guarda cifrada y devuelve sus palabras para apuntar. */
export async function crearWallet(llave: Llave, nombre: string): Promise<WalletNueva> {
  const g = leer();
  if (!g) throw new Error('No hay llavero');

  const frase = generateMnemonic(english);
  const cuenta = mnemonicToAccount(frase);

  const wallet: WalletGuardada = {
    id: crypto.randomUUID(),
    nombre: nombre.trim() || textos().comun.sinNombre,
    direccion: cuenta.address,
    creada: Date.now(),
    copiada: false,
    tipo: 'palabras',
    importada: false,
  };

  g.wallets.push({ ...wallet, semilla: await cifrar(llave, frase) });
  escribir(g);

  return { wallet, palabras: frase.split(' ') };
}

export interface Secreto {
  tipo: Tipo;
  /** La frase entera, o la clave privada con su `0x`. */
  texto: string;
}

/** Lo que se guardó, descifrado. Exige el llavero abierto. */
export async function verSecreto(llave: Llave, id: string): Promise<Secreto> {
  const g = leer();
  const w = g?.wallets.find((x) => x.id === id);
  if (!w) throw new Error('Esa wallet no está');
  return { tipo: w.tipo ?? 'palabras', texto: await descifrar(llave, w.semilla) };
}

/** Las doce palabras. Falla si esa wallet entró como clave privada. */
export async function verPalabras(llave: Llave, id: string): Promise<string[]> {
  const s = await verSecreto(llave, id);
  if (s.tipo !== 'palabras') throw new Error('Esa wallet no tiene palabras');
  return s.texto.split(' ');
}

/**
 * La cuenta de viem, lista para firmar.
 *
 * Es la única puerta por la que sale la clave de este archivo, y sale ya
 * envuelta: quien la recibe puede firmar con ella, pero no leerla. Para leerla
 * está `verSecreto`, que se llama desde una pantalla que enseña un aviso.
 */
export async function cuentaDe(llave: Llave, id: string): Promise<HDAccount | PrivateKeyAccount> {
  const s = await verSecreto(llave, id);
  return s.tipo === 'clave'
    ? privateKeyToAccount(s.texto as `0x${string}`)
    : mnemonicToAccount(s.texto);
}

/* ── traer una wallet de fuera ───────────────────────────────────────────── */

/** Por qué no entró. Clave y no frase: la pantalla la escribe en su idioma. */
export type PegaImportar = 'ni-palabras-ni-clave' | 'palabras-no-cuadran' | 'ilegible' | 'repetida';

export type Importacion =
  | { ok: true; wallet: WalletGuardada }
  | { ok: false; pega: PegaImportar };

/**
 * Mete en el llavero una wallet que ya existía.
 *
 * Devuelve la pega en vez de lanzarla porque aquí todos los fallos son de
 * quien escribe, no del programa: una palabra mal, una clave a medias, una
 * wallet que ya estaba. Eso se enseña en la pantalla tal cual, y un `throw`
 * habría acabado siendo un «no se pudo importar» que no dice cuál de las tres.
 *
 * La suma de control la comprueba viem (`validateMnemonic`), no nosotros: una
 * frase con dos palabras intercambiadas sigue siendo doce palabras válidas y
 * da una dirección distinta y vacía. Sin esa comprobación, importar mal
 * parecería haber funcionado.
 */
export async function importarWallet(
  llave: Llave,
  nombre: string,
  secreto: string,
): Promise<Importacion> {
  const g = leer();
  if (!g) throw new Error('No hay llavero');

  const clase = claseDeSecreto(secreto);
  if (!clase)
    return { ok: false, pega: 'ni-palabras-ni-clave' };

  let texto: string;
  let direccion: string;
  try {
    if (clase === 'clave') {
      texto = limpiarClave(secreto) as string;
      direccion = privateKeyToAccount(texto as `0x${string}`).address;
    } else {
      texto = limpiarFrase(secreto);
      if (!validarPalabras(texto))
        return { ok: false, pega: 'palabras-no-cuadran' };
      direccion = mnemonicToAccount(texto).address;
    }
  } catch {
    return { ok: false, pega: 'ilegible' };
  }

  if (g.wallets.some((w) => w.direccion.toLowerCase() === direccion.toLowerCase()))
    return { ok: false, pega: 'repetida' };

  const wallet: WalletGuardada = {
    id: crypto.randomUUID(),
    nombre: nombre.trim() || 'Importada',
    direccion,
    creada: Date.now(),
    // Su copia de seguridad está fuera desde antes: de ahí ha venido.
    copiada: true,
    tipo: clase,
    importada: true,
  };

  g.wallets.push({ ...wallet, semilla: await cifrar(llave, texto) });
  escribir(g);

  return { ok: true, wallet };
}

/** Marca que las palabras ya están apuntadas fuera del teléfono. */
export function marcarCopiada(id: string): void {
  const g = leer();
  if (!g) return;
  const w = g.wallets.find((x) => x.id === id);
  if (!w) return;
  w.copiada = true;
  escribir(g);
}

export function renombrar(id: string, nombre: string): void {
  const g = leer();
  if (!g) return;
  const w = g.wallets.find((x) => x.id === id);
  if (!w) return;
  w.nombre = nombre.trim() || textos().comun.sinNombre;
  escribir(g);
}

/**
 * Borra una wallet del teléfono.
 *
 * Sin las doce palabras esto es irreversible y no hay a quién reclamar, así
 * que la pantalla lo pregunta dos veces. Aquí no se pregunta nada.
 */
export function borrar(id: string): void {
  const g = leer();
  if (!g) return;
  g.wallets = g.wallets.filter((x) => x.id !== id);
  escribir(g);
}
