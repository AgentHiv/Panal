/**
 * Panal SDK — encargos cifrados de punta a punta.
 *
 * QUÉ RESUELVE
 *
 * Quien trabaja sin servidor recibe sus encargos en el buzón de Panal, y el
 * buzón los guardaba en claro: Panal podía leerlos. Aquí el encargo se cifra en
 * el dispositivo de quien lo escribe para sus destinatarios —quien lo hace y el
 * propio cliente, que tiene que poder releerlo— y el buzón guarda un sobre que
 * no sabe abrir. La cadena ancla el hash del SOBRE, así que el buzón sigue sin
 * poder cambiar una coma: solo acepta el sobre que da ese hash.
 *
 * LA CLAVE SALE DE UNA FIRMA
 *
 * Las wallets del navegador ya no descifran (MetaMask retiró `eth_decrypt`), y
 * pedir otra contraseña sería otra cosa que perder. La clave de cifrado se
 * calcula de la firma de un mensaje fijo: la misma cuenta firma siempre lo
 * mismo (RFC 6979), así que la misma clave sale en el navegador, en la app y en
 * el servidor de un agente, sin guardarla en ningún sitio. La firma NO se
 * publica nunca: quien la tenga tiene la clave.
 *
 * Lo que sí se publica es la clave PÚBLICA, firmada con otro mensaje que la
 * nombra. Así el buzón, que la sirve, no puede cambiarla por la suya: quien la
 * recibe comprueba que esa firma es de la cuenta a la que va a cifrar.
 *
 * LO QUE NO PROTEGE
 *
 * A quien hace el trabajo: lo lee, porque para eso se le cifra. Y una wallet
 * que no firme siempre igual (algunas cuentas de contrato) daría otra clave
 * cada vez; `claveDesdeFirma` no lo puede saber, y quien la llame tiene que
 * comparar con la clave que publicó.
 *
 * CRIPTOGRAFÍA
 *
 * X25519 para acordar una clave, HKDF-SHA256 para derivarla y
 * XChaCha20-Poly1305 para cifrar, todo de @noble (auditado, sin dependencias
 * nativas, igual en el navegador, la app y Node). Cada sobre lleva una clave de
 * contenido aleatoria, envuelta una vez por destinatario con una clave efímera.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';
import { bytesToString, getAddress, toBytes, verifyMessage, type Address, type Hex, type PublicClient } from 'viem';

/** La versión del formato. Va dentro de todo lo que se cifra o se deriva. */
export const CIFRADO_V1 = 'panal-cifrado-1';

/* ── base64url, sin depender de Buffer ni de btoa ─────────────────────── */

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INVERSO = new Map([...ABC].map((c, i) => [c, i]));

export function aBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ABC[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ABC[n & 63]!;
  }
  return out;
}

export function deBase64(texto: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(texto) || texto.length % 4 === 1) throw new Error('base64url mal formado');
  const out = new Uint8Array(Math.floor((texto.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < texto.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => INVERSO.get(texto[i + k] ?? 'A') ?? 0);
    const n = (v[0]! << 18) | (v[1]! << 12) | (v[2]! << 6) | v[3]!;
    out[j++] = (n >> 16) & 255;
    if (i + 2 < texto.length) out[j++] = (n >> 8) & 255;
    if (i + 3 < texto.length) out[j++] = n & 255;
  }
  return out;
}

/* ── la clave de cada cuenta ──────────────────────────────────────────── */

/**
 * El mensaje que se firma para calcular la clave. NO SE CAMBIA NUNCA: otra
 * coma daría otra clave, y los encargos cifrados con la de antes quedarían sin
 * poder abrirse. Una versión nueva es un mensaje nuevo con otro número.
 */
export function mensajeParaDerivarClave(cuenta: Address): string {
  return [
    'Panal · clave de cifrado · v1',
    '',
    'Firmar esto no mueve dinero ni autoriza nada. Con esta firma tu dispositivo calcula la clave que abre tus encargos cifrados. No compartas esta firma con nadie.',
    '',
    `Cuenta: ${getAddress(cuenta)}`,
  ].join('\n');
}

/** El mensaje con el que una cuenta dice «esta es mi clave pública». Este sí se publica. */
export function mensajeParaPublicarClave(cuenta: Address, clavePublica: string): string {
  return ['Panal · mi clave pública de cifrado · v1', '', `Cuenta: ${getAddress(cuenta)}`, `Clave: ${clavePublica}`].join(
    '\n',
  );
}

export interface ClaveDeCifrado {
  /** 32 bytes. No sale del dispositivo. */
  secreta: Uint8Array;
  /** 32 bytes, en base64url: lo que se publica. */
  publica: string;
}

/**
 * La clave de una cuenta, a partir de su firma de `mensajeParaDerivarClave`.
 * La cuenta va dentro de la derivación: la firma de otra cuenta no sirve.
 */
export function claveDesdeFirma(cuenta: Address, firma: Hex): ClaveDeCifrado {
  const secreta = hkdf(sha256, toBytes(firma), toBytes(CIFRADO_V1), toBytes(`x25519 ${cuenta.toLowerCase()}`), 32);
  return { secreta, publica: aBase64(x25519.getPublicKey(secreta)) };
}

/** Lo que el buzón guarda y sirve por cuenta: la clave pública y la firma que la ata a ella. */
export interface ClavePublicada {
  cuenta: Address;
  clave: string;
  firma: Hex;
}

/**
 * ¿Esta clave es de verdad de esa cuenta? Con `publicClient` también valen las
 * cuentas de contrato (EIP-1271); sin él, solo las normales.
 */
export async function comprobarClavePublicada(c: ClavePublicada, publicClient?: PublicClient): Promise<boolean> {
  try {
    if (deBase64(c.clave).length !== 32) return false;
    const args = { address: getAddress(c.cuenta), message: mensajeParaPublicarClave(c.cuenta, c.clave), signature: c.firma };
    return publicClient ? await publicClient.verifyMessage(args) : await verifyMessage(args);
  } catch {
    return false;
  }
}

/* ── el sobre ─────────────────────────────────────────────────────────── */

/** Para quién se cifra: una cuenta y su clave pública ya comprobada. */
export interface Destinatario {
  cuenta: Address;
  clave: string;
}

interface Cabecera {
  v: typeof CIFRADO_V1;
  /** La clave pública efímera de este sobre. */
  e: string;
  /** El nonce del contenido. */
  n: string;
  /** La clave de contenido, envuelta para cada destinatario. */
  para: { a: string; n: string; k: string }[];
}

/** Un texto cifrado: la cabecera y el contenido, en JSON. Es lo que se ancla y se guarda. */
interface SobreDeTexto extends Cabecera {
  c: string;
}

const AAD = toBytes(CIFRADO_V1);

function claveDeEnvoltura(compartido: Uint8Array, efimera: Uint8Array, destino: Uint8Array): Uint8Array {
  // Una clave «compartida» de ceros es un punto de orden bajo: alguien ha
  // puesto una clave pública trucada para que el resultado sea predecible.
  if (compartido.every((b) => b === 0)) throw new Error('Clave pública no válida.');
  const sal = new Uint8Array(64);
  sal.set(efimera, 0);
  sal.set(destino, 32);
  return hkdf(sha256, compartido, sal, toBytes(`${CIFRADO_V1} clave`), 32);
}

function cerrar(bytes: Uint8Array, para: Destinatario[]): { cabecera: Cabecera; cifrado: Uint8Array } {
  if (para.length === 0) throw new Error('Un sobre sin destinatarios no lo podría abrir nadie.');
  const contenido = randomBytes(32);
  const efimeraSecreta = randomBytes(32);
  const efimera = x25519.getPublicKey(efimeraSecreta);
  const n = randomBytes(24);
  const cifrado = xchacha20poly1305(contenido, n, AAD).encrypt(bytes);
  const vistos = new Set<string>();
  const envueltas = para.flatMap((d) => {
    const a = d.cuenta.toLowerCase();
    if (vistos.has(a)) return [];
    vistos.add(a);
    const destino = deBase64(d.clave);
    if (destino.length !== 32) throw new Error(`La clave de ${d.cuenta} no tiene 32 bytes.`);
    const kek = claveDeEnvoltura(x25519.getSharedSecret(efimeraSecreta, destino), efimera, destino);
    const nk = randomBytes(24);
    return [{ a, n: aBase64(nk), k: aBase64(xchacha20poly1305(kek, nk, AAD).encrypt(contenido)) }];
  });
  return { cabecera: { v: CIFRADO_V1, e: aBase64(efimera), n: aBase64(n), para: envueltas }, cifrado };
}

function abrir(cabecera: Cabecera, cifrado: Uint8Array, yo: Address, secreta: Uint8Array): Uint8Array {
  const mia = cabecera.para.find((p) => p.a === yo.toLowerCase());
  if (!mia) throw new Error('Este encargo no está cifrado para esta cuenta.');
  const efimera = deBase64(cabecera.e);
  const kek = claveDeEnvoltura(x25519.getSharedSecret(secreta, efimera), efimera, x25519.getPublicKey(secreta));
  let contenido: Uint8Array;
  try {
    contenido = xchacha20poly1305(kek, deBase64(mia.n), AAD).decrypt(deBase64(mia.k));
  } catch {
    throw new Error('No se puede abrir: la clave de esta cuenta no es la que se usó para cifrarlo.');
  }
  try {
    return xchacha20poly1305(contenido, deBase64(cabecera.n), AAD).decrypt(cifrado);
  } catch {
    throw new Error('El encargo cifrado está dañado o lo han cambiado.');
  }
}

/** ¿Este texto es un sobre cifrado? Mira la forma, sin intentar abrirlo. */
export function esTextoCifrado(texto: string): boolean {
  if (!texto.startsWith(`{"v":"${CIFRADO_V1}"`)) return false;
  try {
    const s = JSON.parse(texto) as Partial<SobreDeTexto>;
    return typeof s.c === 'string' && Array.isArray(s.para);
  } catch {
    return false;
  }
}

/**
 * Cifra un texto para varias cuentas. Lo que devuelve es el texto que se ancla
 * (su keccak256 es el `taskHash` o el `resultHash`) y el que se le da al buzón.
 */
export function cifrarTexto(texto: string, para: Destinatario[]): string {
  const { cabecera, cifrado } = cerrar(toBytes(texto), para);
  // El orden de las claves es fijo: `v` primero es lo que mira `esTextoCifrado`.
  const sobre: SobreDeTexto = { v: cabecera.v, e: cabecera.e, n: cabecera.n, para: cabecera.para, c: aBase64(cifrado) };
  return JSON.stringify(sobre);
}

/** Abre un texto cifrado con la clave de `yo`. Falla con un motivo claro si no puede. */
export function descifrarTexto(sobre: string, yo: Address, secreta: Uint8Array): string {
  if (!esTextoCifrado(sobre)) throw new Error('Esto no es un encargo cifrado.');
  const s = JSON.parse(sobre) as SobreDeTexto;
  return bytesToString(abrir(s, deBase64(s.c), yo, secreta));
}

/** Para quién va cifrado un texto: sus cuentas, en minúsculas. */
export function destinatariosDe(sobre: string): string[] {
  if (!esTextoCifrado(sobre)) return [];
  return (JSON.parse(sobre) as SobreDeTexto).para.map((p) => p.a);
}

/* ── archivos ─────────────────────────────────────────────────────────── */

/**
 * Un archivo cifrado es binario y no JSON: un PDF de 25 MB en base64 pesaría
 * un tercio más. Lleva una marca, el largo de la cabecera, la cabecera y los
 * bytes cifrados. El hash anunciado del archivo es el de ESTOS bytes, así que
 * el buzón lo sigue comprobando sin poder leerlo.
 */
const MARCA_ARCHIVO = toBytes(`${CIFRADO_V1}\n`);

export function esArchivoCifrado(bytes: Uint8Array): boolean {
  return bytes.length > MARCA_ARCHIVO.length + 4 && MARCA_ARCHIVO.every((b, i) => bytes[i] === b);
}

export function cifrarArchivo(bytes: Uint8Array, para: Destinatario[]): Uint8Array {
  const { cabecera, cifrado } = cerrar(bytes, para);
  const cab = toBytes(JSON.stringify(cabecera));
  const out = new Uint8Array(MARCA_ARCHIVO.length + 4 + cab.length + cifrado.length);
  out.set(MARCA_ARCHIVO, 0);
  new DataView(out.buffer).setUint32(MARCA_ARCHIVO.length, cab.length);
  out.set(cab, MARCA_ARCHIVO.length + 4);
  out.set(cifrado, MARCA_ARCHIVO.length + 4 + cab.length);
  return out;
}

export function descifrarArchivo(bytes: Uint8Array, yo: Address, secreta: Uint8Array): Uint8Array {
  if (!esArchivoCifrado(bytes)) throw new Error('Este archivo no está cifrado.');
  const largo = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MARCA_ARCHIVO.length);
  const inicio = MARCA_ARCHIVO.length + 4;
  if (inicio + largo > bytes.length) throw new Error('El archivo cifrado está cortado.');
  const cabecera = JSON.parse(bytesToString(bytes.subarray(inicio, inicio + largo))) as Cabecera;
  if (cabecera.v !== CIFRADO_V1) throw new Error('Versión de cifrado desconocida.');
  return abrir(cabecera, bytes.subarray(inicio + largo), yo, secreta);
}
