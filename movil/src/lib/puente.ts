/**
 * Panal — la app como wallet de panal.lat.
 *
 * QUÉ ES
 *
 * Quien abre panal.lat en el Chrome de su teléfono puede elegir «Abrir en la
 * app de Panal» al conectar. La web abre `panal://wc?uri=…`, esta app empareja
 * con la sesión de WalletConnect y desde ahí hace de wallet: cada firma que
 * pida la web llega aquí, se enseña en una hoja, se firma con el llavero del
 * teléfono y la app se va al fondo para que quede delante el navegador.
 *
 * Es el lado «wallet» de WalletConnect (`@walletconnect/sign-client`), el
 * mismo protocolo que habla MetaMask. El lado «web» ya lo usa esta app para
 * conectar wallets de fuera; son dos clientes distintos, con su propio prefijo
 * de almacenamiento, y no se pisan.
 *
 * QUÉ FIRMA, Y QUÉ NO
 *
 * Lo mismo que firma la app para sí misma, ni una cosa más: cada petición pasa
 * por `lib/signingPolicy.ts` antes de tocar la clave. Lo que mueve dinero hacia
 * otro —encargar, pagar un mensaje, publicar o elegir en el tablón— necesita
 * que una hoja lo haya confirmado; aquí esa hoja es la de esta pantalla, que
 * enseña lo que la web pide, y al aceptar se arma con los valores de la propia
 * petición. Todo lo demás (contratos que no son de Panal, mensajes cualquiera,
 * otras redes) se rechaza sin preguntar: no se puede aprobar lo que no se
 * firmaría.
 *
 * Y solo con panal.lat. Una propuesta de otra web se rechaza aunque la persona
 * quisiera: esto es «conectar la web de Panal con la app de Panal», no una
 * wallet para cualquier sitio. El origen lo atestigua el servicio de
 * verificación de WalletConnect; si ese servicio no contesta, el origen es el
 * que la web dice de sí misma, y la hoja lo avisa.
 *
 * Solo en el APK directo: la app de Google Play no puede pagar consultas.
 */

import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { decodeFunctionData, getAddress, hexToString, isAddress, isAddressEqual, isHex } from 'viem';
import type { Abi, Address, Hex, TypedDataDefinition } from 'viem';
import { X402_NATIVE, panalTablonAbi } from '@panal/sdk';
import { panalEscrowV2Abi, panalRegistryV2Abi, panalTokenAbi } from '@/contracts/abis';
import {
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TABLON_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  activeChain,
} from '@/contracts/config';
import { EN_PLAY } from '~/lib/canal';
import {
  FirmaBloqueada,
  permitirEncargo,
  permitirPago,
  permitirTablon,
  revisarMensaje,
  revisarTransaccion,
} from '~/lib/signingPolicy';

/* ── lo que no depende de nada (y se prueba) ─────────────────────────────── */

/** La única web con la que se conecta. */
export const ORIGEN_PANAL = 'https://panal.lat';

/** La red, en el formato de WalletConnect. */
export const CADENA = `eip155:${activeChain.id}`;

/** Lo que la app sabe contestar. Lo demás, la web lo resuelve sola o no lo pide. */
export const METODOS = [
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
] as const;

export const EVENTOS = ['accountsChanged', 'chainChanged'] as const;

/**
 * La URI de la sesión que trae un enlace `panal://wc?uri=…`, o `null`.
 *
 * `panal://` a secas también llega —es lo que abre la web para traer la app al
 * frente cuando hay una firma—, y ése no trae nada que emparejar.
 */
export function uriDeEnlace(url: string): string | null {
  const m = /^panal:\/\/wc\/?\?(.*)$/i.exec(url.trim());
  if (!m) return null;
  const crudo = new URLSearchParams(m[1]).get('uri');
  if (!crudo) return null;
  // Con su clave: un enlace sin escapar llega cortado en el primer `&`, sin
  // `symKey`, y emparejar fallaría después con un error que no dice por qué.
  return /^wc:[0-9a-f]{64}@2\?.*\bsymKey=[0-9a-f]{64}\b/i.test(crudo) ? crudo : null;
}

/** Lo que dice el servicio de verificación de WalletConnect sobre quién propone. */
export interface Verificacion {
  origin?: string;
  validation?: 'VALID' | 'INVALID' | 'UNKNOWN';
  isScam?: boolean;
}

export type Origen =
  | { ok: true; origen: string; comprobado: boolean }
  | { ok: false; origen: string; motivo: 'otraWeb' | 'falsa' | 'estafa' };

/**
 * ¿Se conecta? Solo con panal.lat, y no si la verificación dice que miente.
 *
 * `VALID`: el servicio vio la página y es la que dice ser. `INVALID`: la página
 * dice ser una y es otra, que es exactamente una web haciéndose pasar por
 * Panal. `UNKNOWN`: el servicio no contestó; vale, pero la hoja lo avisa.
 */
export function origenAceptado(v: Verificacion | undefined, urlDeLaWeb: string | undefined): Origen {
  const origen = (v?.origin || urlDeLaWeb || '').trim();
  if (v?.isScam) return { ok: false, origen, motivo: 'estafa' };
  if (v?.validation === 'INVALID') return { ok: false, origen, motivo: 'falsa' };
  let delOrigen = '';
  try {
    delOrigen = new URL(origen).origin;
  } catch {
    /* sin URL no hay origen que aceptar */
  }
  if (delOrigen !== ORIGEN_PANAL) return { ok: false, origen, motivo: 'otraWeb' };
  return { ok: true, origen: ORIGEN_PANAL, comprobado: v?.validation === 'VALID' };
}

interface EspacioPedido {
  chains?: string[];
  methods?: string[];
  events?: string[];
}

/**
 * Lo que se aprueba de la sesión: Monad, esta cuenta, y lo que sabemos hacer.
 *
 * Lanza si la web EXIGE algo que aquí no hay —otra red, otra familia de
 * cadenas, un método que no se contesta—: aprobar una sesión que la web no
 * puede usar es peor que decirle que no.
 */
export function espaciosAprobados(
  propuesta: { requiredNamespaces?: Record<string, EspacioPedido>; optionalNamespaces?: Record<string, EspacioPedido> },
  direccion: Address,
): Record<string, { chains: string[]; accounts: string[]; methods: string[]; events: string[] }> {
  for (const [clave, e] of Object.entries(propuesta.requiredNamespaces ?? {})) {
    const cadenas = clave.includes(':') ? [clave] : (e.chains ?? []);
    if (!clave.startsWith('eip155') || cadenas.some((c) => c !== CADENA)) {
      throw new Error(`la web exige ${cadenas.join(', ') || clave}, y esta wallet solo usa ${CADENA}`);
    }
    const sinMetodo = (e.methods ?? []).filter((m) => !(METODOS as readonly string[]).includes(m));
    if (sinMetodo.length) throw new Error(`la web exige ${sinMetodo.join(', ')}`);
  }
  return {
    eip155: {
      chains: [CADENA],
      accounts: [`${CADENA}:${getAddress(direccion)}`],
      methods: [...METODOS],
      events: [...EVENTOS],
    },
  };
}

/**
 * Lo que pide la web, ya leído: lo que se enseña en la hoja y lo que se arma
 * en la política al aceptar.
 */
export type Peticion =
  | { tipo: 'red' }
  | { tipo: 'mensaje'; texto: string }
  | { tipo: 'permit'; token: Address; importe: bigint; a: Address; caduca: number }
  | { tipo: 'pagoMon'; importe: bigint; a: Address }
  | { tipo: 'encargo'; agente: Address; importe: bigint; moneda: Address }
  | { tipo: 'aprobar'; importe: bigint; para: 'escrow' | 'tablon' }
  | { tipo: 'escrow'; funcion: string }
  | { tipo: 'tablon'; funcion: string; importe?: bigint; moneda?: Address; agente?: Address; jobId?: bigint }
  | { tipo: 'registro'; funcion: string }
  | { tipo: 'bloqueada'; motivo: string };

interface TxCruda {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
}

const enBigInt = (v: string | undefined): bigint => {
  try {
    return v ? BigInt(v) : 0n;
  } catch {
    return -1n;
  }
};

function llamada(abi: Abi, datos: Hex): { functionName: string; args?: readonly unknown[] } | null {
  try {
    return decodeFunctionData({ abi, data: datos }) as { functionName: string; args?: readonly unknown[] };
  } catch {
    return null;
  }
}

/**
 * Lee la petición. No arma nada ni toca la clave.
 *
 * Lo que no necesita hoja (aprobar al escrow, cobrar, disputar, editar la
 * ficha…) se pasa ya por la política, que sin nada armado decide igual que al
 * firmar. Lo que sí la necesita se lee aquí y lo comprueba la política después
 * de aceptar, con lo armado.
 */
export function describir(metodo: string, params: unknown, cuenta: Address, ahora = Date.now()): Peticion {
  const bloqueada = (motivo: string): Peticion => ({ tipo: 'bloqueada', motivo });
  try {
    switch (metodo) {
      case 'wallet_switchEthereumChain': {
        const [p] = (params ?? []) as [{ chainId?: string }];
        return Number(BigInt(p?.chainId ?? '0x0')) === activeChain.id
          ? { tipo: 'red' }
          : bloqueada(`cambiar a la red ${String(p?.chainId)}`);
      }

      case 'personal_sign': {
        const [datos, de] = (params ?? []) as [string, string];
        if (!de || !isAddress(de) || !isAddressEqual(de, cuenta)) return bloqueada(`firmar como ${String(de)}`);
        revisarMensaje(datos, cuenta);
        const texto = isHex(datos) ? hexToString(datos) : datos;
        return { tipo: 'mensaje', texto };
      }

      case 'eth_signTypedData':
      case 'eth_signTypedData_v4': {
        const [de, crudo] = (params ?? []) as [string, string | TypedDataDefinition];
        if (!de || !isAddress(de) || !isAddressEqual(de, cuenta)) return bloqueada(`firmar como ${String(de)}`);
        const t = (typeof crudo === 'string' ? JSON.parse(crudo) : crudo) as TypedDataDefinition;
        if (t.primaryType !== 'Permit') return bloqueada(`datos tipados de tipo ${String(t.primaryType)}`);
        const token = t.domain?.verifyingContract as Address | undefined;
        const m = t.message as Record<string, string | number>;
        if (!token || !isAddress(token) || !isAddress(String(m.spender))) return bloqueada('un permit sin moneda o sin destino');
        if (!isAddressEqual(String(m.owner) as Address, cuenta)) return bloqueada(`un permit a nombre de ${String(m.owner)}`);
        return {
          tipo: 'permit',
          token,
          importe: BigInt(m.value),
          a: getAddress(String(m.spender)),
          caduca: Number(m.deadline) * 1000 - ahora,
        };
      }

      case 'eth_sendTransaction': {
        const [t] = (params ?? []) as [TxCruda];
        if (!t?.from || !isAddress(t.from) || !isAddressEqual(t.from, cuenta)) {
          return bloqueada(`mandar desde ${String(t?.from)}`);
        }
        if (!t.to || !isAddress(t.to)) return bloqueada('crear un contrato');
        const a = getAddress(t.to);
        const valor = enBigInt(t.value);
        const datos = (t.data && t.data !== '0x' ? t.data : '0x') as Hex;
        if (valor < 0n) return bloqueada(`un importe ilegible (${String(t.value)})`);

        // Una transferencia de MON a secas: solo el pago de un mensaje en MON.
        if (datos === '0x') {
          if (valor === 0n) return bloqueada('una transacción vacía');
          return { tipo: 'pagoMon', importe: valor, a };
        }

        if (isAddressEqual(a, PANAL_ESCROW_V2_ADDRESS)) {
          const l = llamada(panalEscrowV2Abi as Abi, datos);
          if (!l) return bloqueada(`una llamada que el escrow no tiene (${datos.slice(0, 10)})`);
          if (l.functionName === 'createTask') {
            const [agente, , , moneda, importe] = l.args as readonly [Address, Hex, bigint, Address, bigint];
            return { tipo: 'encargo', agente: getAddress(agente), importe, moneda: getAddress(moneda) };
          }
          revisarTransaccion({ to: a, data: datos, value: valor }, ahora);
          return { tipo: 'escrow', funcion: l.functionName };
        }

        if (isAddressEqual(a, PANAL_TABLON_ADDRESS)) {
          const l = llamada(panalTablonAbi as unknown as Abi, datos);
          if (!l) return bloqueada(`una llamada que el tablón no tiene (${datos.slice(0, 10)})`);
          if (l.functionName === 'post') {
            const [p] = l.args as readonly [{ amount: bigint; currency: Address }];
            return { tipo: 'tablon', funcion: 'post', importe: p.amount, moneda: getAddress(p.currency) };
          }
          if (l.functionName === 'choose') {
            const [jobId, agente] = l.args as readonly [bigint, Address];
            // Lo que pone al elegir es lo que manda en MON, o lo aprobado antes en $PANAL.
            return { tipo: 'tablon', funcion: 'choose', jobId, agente: getAddress(agente), importe: valor };
          }
          revisarTransaccion({ to: a, data: datos, value: valor }, ahora);
          return { tipo: 'tablon', funcion: l.functionName };
        }

        if (isAddressEqual(a, PANAL_TOKEN_ADDRESS)) {
          const l = llamada(panalTokenAbi as Abi, datos);
          if (!l || l.functionName !== 'approve') return bloqueada(`$PANAL.${l?.functionName ?? '?'}: solo se firma approve`);
          const [para, importe] = l.args as readonly [Address, bigint];
          if (valor !== 0n) return bloqueada('MON a $PANAL');
          if (isAddressEqual(para, PANAL_ESCROW_V2_ADDRESS)) return { tipo: 'aprobar', importe, para: 'escrow' };
          if (isAddressEqual(para, PANAL_TABLON_ADDRESS)) return { tipo: 'aprobar', importe, para: 'tablon' };
          return bloqueada(`$PANAL.approve a ${para}: solo se aprueba al escrow o al tablón`);
        }

        if (isAddressEqual(a, PANAL_REGISTRY_V2_ADDRESS)) {
          revisarTransaccion({ to: a, data: datos, value: valor }, ahora);
          const l = llamada(panalRegistryV2Abi as Abi, datos);
          return { tipo: 'registro', funcion: l?.functionName ?? '?' };
        }

        return bloqueada(`una transacción a ${a}, que no es un contrato de Panal`);
      }

      default:
        return bloqueada(`el método ${metodo}`);
    }
  } catch (e) {
    return bloqueada(e instanceof FirmaBloqueada ? e.detalle : e instanceof Error ? e.message : String(e));
  }
}

/**
 * Al aceptar en la hoja: arma en la política justo lo que se enseñó.
 *
 * Lo armado vale para una firma y caduca a los pocos minutos, como cuando lo
 * arma una hoja de la propia app. Lo que no mueve dinero hacia otro no arma
 * nada: la política ya lo dejó pasar al leerlo.
 */
export function armar(p: Peticion, ahora = Date.now()): void {
  switch (p.tipo) {
    case 'encargo':
      permitirEncargo({ worker: p.agente, amount: p.importe, currency: p.moneda }, ahora);
      return;
    case 'permit':
      permitirPago({ spender: p.a, value: p.importe, token: p.token }, ahora);
      return;
    case 'pagoMon':
      permitirPago({ spender: p.a, value: p.importe, token: X402_NATIVE }, ahora);
      return;
    case 'aprobar':
      // Al tablón: lo que se aprueba es para publicar (o elegir) por ese importe
      // en $PANAL, y es lo que la política mira. Detrás llega la llamada al
      // tablón, con su propia hoja.
      if (p.para === 'tablon') permitirTablon({ funcion: 'post', amount: p.importe, currency: PANAL_TOKEN_ADDRESS }, ahora);
      return;
    case 'tablon':
      if (p.funcion === 'post' && p.importe !== undefined && p.moneda) {
        permitirTablon({ funcion: 'post', amount: p.importe, currency: p.moneda }, ahora);
      } else if (p.funcion === 'choose' && p.jobId !== undefined && p.agente) {
        // En MON se pone lo que lleva la transacción; en $PANAL va aprobado
        // antes y aquí no viaja nada.
        const enMon = (p.importe ?? 0n) > 0n;
        permitirTablon(
          {
            funcion: 'choose',
            amount: p.importe ?? 0n,
            currency: enMon ? X402_NATIVE : PANAL_TOKEN_ADDRESS,
            jobId: p.jobId,
            agente: p.agente,
          },
          ahora,
        );
      }
      return;
    default:
      return;
  }
}

/* ── el cliente de WalletConnect y su estado ─────────────────────────────── */

/** El plugin nativo (`Enlaces.java`, solo en el APK directo). */
interface PluginEnlaces {
  inicial(): Promise<{ url?: string }>;
  volver(): Promise<void>;
  addListener(evento: 'enlace', oyente: (e: { url: string }) => void): Promise<unknown>;
}

function pluginEnlaces(): PluginEnlaces | null {
  if (EN_PLAY || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Enlaces')) return null;
  return registerPlugin<PluginEnlaces>('Enlaces');
}

/** Hay alguna sesión con la web: arrancar el cliente al abrir la app. */
const CLAVE_SESIONES = 'panal:puente:v1';

export interface PropuestaPuente {
  id: number;
  origen: string;
  comprobado: boolean;
  /** Lo que pide la web; se aprueba con la cuenta abierta en ese momento. */
  espacios: { requiredNamespaces?: Record<string, EspacioPedido>; optionalNamespaces?: Record<string, EspacioPedido> };
}

export interface PeticionPuente {
  id: number;
  topic: string;
  metodo: string;
  params: unknown;
  /** La cuenta con la que se conectó la web. */
  cuenta: Address;
}

export interface SesionPuente {
  topic: string;
  cuenta: Address;
  origen: string;
}

export interface EstadoPuente {
  disponible: boolean;
  propuesta: PropuestaPuente | null;
  /** La primera de la cola, la que enseña la hoja. */
  peticion: PeticionPuente | null;
  /** Cuántas más esperan detrás. */
  enCola: number;
  sesiones: SesionPuente[];
  /** Lo último que salió mal, para decirlo una vez. */
  aviso:
    | { tipo: 'otraWeb' | 'falsa' | 'estafa'; origen: string }
    | { tipo: 'caducado' | 'sinRed' | 'rechazada'; detalle?: string }
    | null;
  ocupado: boolean;
}

interface ClienteWC {
  pair(o: { uri: string }): Promise<unknown>;
  approve(o: { id: number; namespaces: unknown }): Promise<{ acknowledged: () => Promise<{ topic: string }> }>;
  reject(o: { id: number; reason: { code: number; message: string } }): Promise<void>;
  respond(o: { topic: string; response: unknown }): Promise<void>;
  disconnect(o: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  on(evento: string, f: (e: never) => void): void;
  getPendingSessionRequests(): {
    id: number;
    topic: string;
    params: { request: { method: string; params: unknown }; chainId: string };
  }[];
  session: { getAll(): { topic: string; namespaces: Record<string, { accounts: string[] }>; peer: { metadata: { url: string } } }[] };
}

let estado: EstadoPuente = {
  disponible: false,
  propuesta: null,
  peticion: null,
  enCola: 0,
  sesiones: [],
  aviso: null,
  ocupado: false,
};
const oyentes = new Set<() => void>();
let cola: PeticionPuente[] = [];
let cliente: Promise<ClienteWC> | null = null;
let arrancado = false;

function cambiar(parcial: Partial<EstadoPuente>): void {
  estado = { ...estado, ...parcial, peticion: cola[0] ?? null, enCola: Math.max(0, cola.length - 1) };
  for (const f of oyentes) f();
}

function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
const leer = (): EstadoPuente => estado;

export function usePuente(): EstadoPuente {
  return useSyncExternalStore(suscribir, leer, leer);
}

const RECHAZO_USUARIO = { code: 5000, message: 'El usuario lo rechazó en la app de Panal.' };
const DESCONECTADO = { code: 6000, message: 'Desconectado desde la app de Panal.' };

function sesionesDe(c: ClienteWC): SesionPuente[] {
  return c.session.getAll().map((s) => {
    const cuenta = (s.namespaces.eip155?.accounts?.[0] ?? '').split(':')[2] ?? '';
    return { topic: s.topic, cuenta: (isAddress(cuenta) ? getAddress(cuenta) : cuenta) as Address, origen: s.peer.metadata.url };
  });
}

function haySesiones(): boolean {
  try {
    return localStorage.getItem(CLAVE_SESIONES) === '1';
  } catch {
    return false;
  }
}

function recordarSesiones(hay: boolean): void {
  try {
    if (hay) localStorage.setItem(CLAVE_SESIONES, '1');
    else localStorage.removeItem(CLAVE_SESIONES);
  } catch {
    /* sin localStorage, la app arranca el cliente al recibir el siguiente enlace */
  }
}

function encolar(p: PeticionPuente): void {
  if (cola.some((q) => q.id === p.id)) return;
  cola = [...cola, p];
  cambiar({});
}

function cuentaDeSesion(c: ClienteWC, topic: string): Address | null {
  return sesionesDe(c).find((s) => s.topic === topic)?.cuenta ?? null;
}

async function crearCliente(): Promise<ClienteWC> {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) throw new Error('sin VITE_WALLETCONNECT_PROJECT_ID');
  const { SignClient } = await import('@walletconnect/sign-client');
  const c = (await SignClient.init({
    projectId,
    // Otro prefijo que el del conector de wagmi: son dos clientes en la misma
    // página, uno de cada lado, y compartir almacenamiento los mezclaría.
    customStoragePrefix: 'panal-puente',
    metadata: {
      name: 'Panal',
      description: 'La wallet de la app de Panal',
      url: ORIGEN_PANAL,
      icons: [`${ORIGEN_PANAL}/icon.svg`],
      // Por aquí vuelve la web a traer la app al frente en cada firma.
      redirect: { native: 'panal://', universal: `${ORIGEN_PANAL}/app` },
    },
  })) as unknown as ClienteWC;

  c.on('session_proposal', ((e: {
    id: number;
    params: PropuestaPuente['espacios'] & { proposer: { metadata: { url: string } } };
    verifyContext?: { verified?: Verificacion };
  }) => {
    const o = origenAceptado(e.verifyContext?.verified, e.params.proposer?.metadata?.url);
    if (!o.ok) {
      void c.reject({ id: e.id, reason: { code: 5000, message: 'La app de Panal solo se conecta con panal.lat.' } });
      cambiar({ aviso: { tipo: o.motivo, origen: o.origen }, ocupado: false });
      return;
    }
    cambiar({
      propuesta: { id: e.id, origen: o.origen, comprobado: o.comprobado, espacios: e.params },
      ocupado: false,
    });
  }) as never);

  c.on('session_request', ((e: {
    id: number;
    topic: string;
    params: { request: { method: string; params: unknown }; chainId: string };
  }) => {
    void recibir(c, e);
  }) as never);

  c.on('session_request_expire', ((e: { id: number }) => {
    cola = cola.filter((p) => p.id !== e.id);
    cambiar({});
  }) as never);

  c.on('session_delete', (() => {
    const sesiones = sesionesDe(c);
    recordarSesiones(sesiones.length > 0);
    cola = cola.filter((p) => sesiones.some((s) => s.topic === p.topic));
    cambiar({ sesiones });
  }) as never);

  const sesiones = sesionesDe(c);
  recordarSesiones(sesiones.length > 0);
  cambiar({ sesiones });

  // Lo que llegó mientras la app estaba cerrada: el relé lo guarda y el
  // cliente lo recupera al arrancar, antes de que hubiera nadie escuchando.
  for (const p of c.getPendingSessionRequests()) void recibir(c, p);
  return c;
}

/**
 * Lo que llega de la web. Cambiar a Monad se contesta sin preguntar; lo que
 * la app no firmaría se rechaza sin preguntar; lo demás va a la hoja.
 */
async function recibir(
  c: ClienteWC,
  e: { id: number; topic: string; params: { request: { method: string; params: unknown }; chainId: string } },
): Promise<void> {
  const { method, params } = e.params.request;
  const cuenta = cuentaDeSesion(c, e.topic);
  const responder = (r: { result: unknown } | { error: { code: number; message: string } }) =>
    c.respond({ topic: e.topic, response: { id: e.id, jsonrpc: '2.0', ...r } });

  if (!cuenta || e.params.chainId !== CADENA) {
    await responder({ error: { code: 4100, message: `Esta wallet solo firma en ${CADENA}.` } });
    return;
  }
  const d = describir(method, params, cuenta);
  if (d.tipo === 'red') {
    await responder({ result: null });
    return;
  }
  if (d.tipo === 'bloqueada') {
    await responder({ error: { code: 4001, message: `La app de Panal no firma esto: ${d.motivo}` } });
    cambiar({ aviso: { tipo: 'rechazada', detalle: d.motivo } });
    return;
  }
  encolar({ id: e.id, topic: e.topic, metodo: method, params, cuenta });
}

function obtenerCliente(): Promise<ClienteWC> {
  if (!cliente) {
    cliente = crearCliente().catch((e: unknown) => {
      cliente = null;
      throw e;
    });
  }
  return cliente;
}

/** Un enlace `panal://`: con sesión dentro, se empareja; a secas, solo despierta al cliente. */
async function alEnlace(url: string): Promise<void> {
  const uri = uriDeEnlace(url);
  if (!uri && !url.startsWith('panal://')) return;
  try {
    const c = await obtenerCliente();
    if (uri) {
      cambiar({ ocupado: true, aviso: null });
      await c.pair({ uri });
    }
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    cambiar({ ocupado: false, aviso: { tipo: /expired|caduc/i.test(texto) ? 'caducado' : 'sinRed', detalle: texto } });
  }
}

/**
 * Arranca una vez, al montar la app: escucha los enlaces nuevos, mira el
 * enlace con el que se abrió y, si ya hay sesiones con la web, levanta el
 * cliente para que las firmas que lleguen se vean sin esperar a otro enlace.
 */
export function arrancarPuente(): void {
  if (arrancado) return;
  arrancado = true;
  const plugin = pluginEnlaces();
  if (!plugin) return;
  cambiar({ disponible: true });
  void plugin.addListener('enlace', ({ url }) => void alEnlace(url));
  void plugin.inicial().then(({ url }) => {
    if (url) void alEnlace(url);
    else if (haySesiones()) void obtenerCliente().catch(() => undefined);
  });
}

function volverALaWeb(): void {
  void pluginEnlaces()?.volver();
}

/** Conectar: la web queda enlazada con la cuenta abierta ahora mismo. */
export async function aprobarPropuesta(direccion: Address): Promise<void> {
  const p = estado.propuesta;
  if (!p) return;
  cambiar({ ocupado: true });
  try {
    const c = await obtenerCliente();
    const { acknowledged } = await c.approve({ id: p.id, namespaces: espaciosAprobados(p.espacios, direccion) });
    await acknowledged();
    const sesiones = sesionesDe(c);
    recordarSesiones(true);
    cambiar({ propuesta: null, sesiones, ocupado: false });
    volverALaWeb();
  } catch (e) {
    const c = await obtenerCliente().catch(() => null);
    await c?.reject({ id: p.id, reason: { code: 5100, message: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
    cambiar({ propuesta: null, ocupado: false, aviso: { tipo: 'rechazada', detalle: e instanceof Error ? e.message : String(e) } });
  }
}

export async function rechazarPropuesta(): Promise<void> {
  const p = estado.propuesta;
  if (!p) return;
  cambiar({ propuesta: null });
  const c = await obtenerCliente().catch(() => null);
  await c?.reject({ id: p.id, reason: RECHAZO_USUARIO }).catch(() => undefined);
  volverALaWeb();
}

/**
 * Firmar la primera de la cola con el proveedor del llavero (`lib/conector.ts`),
 * que es el que pasa la política, fija el gas y firma. Se le pasa la función y
 * no se importa aquí para que esto se pueda probar sin el llavero.
 *
 * `activa` es la cuenta del llavero abierta ahora. Tiene que ser la misma con
 * la que se conectó la web: el proveedor firma con la abierta, y una
 * transacción saldría de otra wallet que la que la web cree estar usando.
 */
export async function firmarPeticion(
  firmar: (a: { method: string; params: unknown }) => Promise<unknown>,
  activa: Address | null,
): Promise<'firmada' | 'fallo'> {
  const p = cola[0];
  if (!p) return 'fallo';
  cambiar({ ocupado: true });
  const c = await obtenerCliente();
  let salida: 'firmada' | 'fallo' = 'firmada';
  try {
    if (!activa || !isAddressEqual(activa, p.cuenta)) {
      throw new Error(`la web está conectada con ${p.cuenta}, y la wallet abierta es otra`);
    }
    const d = describir(p.metodo, p.params, p.cuenta);
    if (d.tipo === 'bloqueada') throw new FirmaBloqueada(d.motivo);
    armar(d);
    const result = await firmar({ method: p.metodo, params: p.params });
    await c.respond({ topic: p.topic, response: { id: p.id, jsonrpc: '2.0', result } });
  } catch (e) {
    salida = 'fallo';
    const motivo =
      e instanceof FirmaBloqueada ? e.detalle : e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e);
    await c
      .respond({ topic: p.topic, response: { id: p.id, jsonrpc: '2.0', error: { code: 4001, message: motivo } } })
      .catch(() => undefined);
    cambiar({ aviso: { tipo: 'rechazada', detalle: motivo } });
  }
  cola = cola.slice(1);
  cambiar({ ocupado: false });
  if (salida === 'firmada' && cola.length === 0) volverALaWeb();
  return salida;
}

export async function rechazarPeticion(): Promise<void> {
  const p = cola[0];
  if (!p) return;
  cola = cola.slice(1);
  cambiar({});
  const c = await obtenerCliente().catch(() => null);
  await c
    ?.respond({ topic: p.topic, response: { id: p.id, jsonrpc: '2.0', error: { code: 4001, message: RECHAZO_USUARIO.message } } })
    .catch(() => undefined);
  if (cola.length === 0) volverALaWeb();
}

/** Cortar con la web desde la app: la web vuelve a enseñar «Conectar». */
export async function desconectarWeb(topic: string): Promise<void> {
  const c = await obtenerCliente().catch(() => null);
  if (!c) return;
  await c.disconnect({ topic, reason: DESCONECTADO }).catch(() => undefined);
  const sesiones = sesionesDe(c);
  recordarSesiones(sesiones.length > 0);
  cola = cola.filter((p) => p.topic !== topic);
  cambiar({ sesiones });
}

export function olvidarAviso(): void {
  cambiar({ aviso: null });
}
