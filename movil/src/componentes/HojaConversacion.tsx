/**
 * La conversación de un encargo, en la app. La misma que la del panel de la web
 * (`src/components/dashboard/ConversacionDelEncargo.tsx`) y sobre la misma
 * librería (`src/lib/conversacion.ts`): entre el cliente y quien trabaja, con
 * el dinero ya bloqueado, una firma que vale 14 minutos, cifrada si las dos
 * partes tienen clave, y los archivos que llegan pasan por la revisión antes
 * de guardarse (`guardarArchivo`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { useSignMessage } from 'wagmi';
import type { Destinatario } from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import {
  abrirMensaje,
  bajarArchivoDelChat,
  cifradoDeLaConversacion,
  credencialDeConversacion,
  enviarMensaje,
  leerConversacion,
  sigueValiendo,
  type ArchivoDelChat,
  type CredencialDeConversacion,
  type MensajeLegible,
} from '@/lib/conversacion';
import { formatBytes } from '@/lib/deliveredFiles';
import { guardarArchivo } from '~/lib/copia';
import { useTextos } from '~/i18n/idiomas';
import Hoja from './Hoja';
import Icono from './Icono';

const MAX_ARCHIVOS = 5;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 4000;
const CADA_MS = 15_000;

export default function HojaConversacion({
  encargo,
  base,
  onCerrar,
}: {
  encargo: { id: bigint; client: Address; worker: Address };
  /** El buzón de quien hace el trabajo. */
  base: string;
  onCerrar: () => void;
}): React.ReactElement {
  const T = useTextos();
  const C = T.conversacion;
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);

  const [cred, setCred] = useState<CredencialDeConversacion | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [mensajes, setMensajes] = useState<MensajeLegible[]>([]);
  const [abierta, setAbierta] = useState(true);
  const [para, setPara] = useState<Destinatario[] | null | undefined>(undefined);
  const [borrador, setBorrador] = useState('');
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const elegir = useRef<HTMLInputElement>(null);

  const miRol = (address ?? '').toLowerCase() === encargo.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDeConversacion) => {
      if (!address) return;
      const r = await leerConversacion(base, encargo.id, c);
      setMensajes(await Promise.all(r.mensajes.map((m) => abrirMensaje(m, address as Address, firmar))));
      setAbierta(r.abierta);
    },
    [address, base, encargo.id, firmar],
  );

  const empezar = async (): Promise<void> => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDeConversacion(encargo.id, address, firmar);
      setCred(c);
      setEstado('cargando');
      const [destinatarios] = await Promise.all([cifradoDeLaConversacion(encargo.client, encargo.worker), cargar(c)]);
      setPara(destinatarios);
      setEstado('listo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEstado(/reject|denied|user/i.test(msg) ? 'inicio' : 'error');
    }
  };

  useEffect(() => {
    if (estado !== 'listo' || !cred) return;
    const id = setInterval(() => {
      if (!sigueValiendo(cred)) {
        setEstado('caducada');
        return;
      }
      void cargar(cred).catch(() => undefined);
    }, CADA_MS);
    return () => clearInterval(id);
  }, [estado, cred, cargar]);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [mensajes.length]);

  const anadir = (lista: FileList | null): void => {
    if (!lista) return;
    const nuevos = [...adjuntos, ...Array.from(lista)];
    if (nuevos.length > MAX_ARCHIVOS) {
      setAviso(C.maxArchivos(MAX_ARCHIVOS));
      return;
    }
    const grande = nuevos.find((f) => f.size > MAX_BYTES);
    if (grande) {
      setAviso(C.archivoGrande(grande.name));
      return;
    }
    setAviso(null);
    setAdjuntos(nuevos);
  };

  const enviar = async (): Promise<void> => {
    if (!cred || !address || enviando) return;
    const texto = borrador.trim();
    if (!texto && adjuntos.length === 0) return;
    if (!sigueValiendo(cred)) {
      setEstado('caducada');
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      const archivos = await Promise.all(
        adjuntos.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), ...(f.type ? { mime: f.type } : {}) })),
      );
      await enviarMensaje({ base, taskId: encargo.id, texto: texto || '📎', archivos, para: para ?? null, cred });
      setBorrador('');
      setAdjuntos([]);
      await cargar(cred);
    } catch (err) {
      const detalle = err instanceof Error ? (err.message.split('\n')[0] ?? '') : '';
      setAviso(/^malware/i.test(detalle) ? C.malware(detalle) : C.errorEnviar(detalle));
    } finally {
      setEnviando(false);
    }
  };

  const bajar = async (a: ArchivoDelChat): Promise<void> => {
    if (!cred || !address) return;
    setBajando(a.hash);
    try {
      const bytes = await bajarArchivoDelChat({ base, taskId: encargo.id, archivo: a, cred, yo: address as Address, firmar });
      // Pasa por la revisión: si es sospechoso, la hoja de aviso pregunta antes.
      const r = await guardarArchivo(a.name, new Blob([bytes as BlobPart], { type: a.mime || 'application/octet-stream' }));
      if (!r.ok && !r.cancelado) setAviso(r.porque);
    } catch {
      setAviso(C.archivoError(a.name));
    } finally {
      setBajando(null);
    }
  };

  return (
    <Hoja abierta titulo={C.titulo(String(encargo.id))} onCerrar={onCerrar}>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-3">{C.desc}</p>

      {estado === 'inicio' || estado === 'firmando' || estado === 'error' ? (
        <div className="mt-4 flex flex-col gap-3 pb-5">
          <p className="text-[12.5px] leading-[1.55] text-ink-2">{C.abrirNota}</p>
          <button
            type="button"
            onClick={() => void empezar()}
            disabled={estado === 'firmando'}
            className="pulsable tocable rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white disabled:opacity-60"
          >
            {estado === 'firmando' ? C.firmando : C.abrir}
          </button>
          {estado === 'error' && <p className="text-[12.5px] text-terra">{C.errorCargar}</p>}
        </div>
      ) : estado === 'cargando' ? (
        <p className="py-8 text-center text-[13px] text-ink-3">{C.cargando}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 pb-5">
          {para !== undefined && (
            <p className={`text-[11.5px] leading-[1.45] ${para ? 'text-oliva' : 'text-terra'}`}>
              {para ? C.cifrada : C.sinCifrar}
            </p>
          )}
          <div className="max-h-[46vh] min-h-[9rem] overflow-y-auto rounded-[14px] border border-line bg-paper p-3">
            {mensajes.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-3">{C.vacia}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {mensajes.map((m, i) => {
                  const mio = m.de === miRol;
                  return (
                    <li key={`${m.ts}-${i}`} className={`flex flex-col ${mio ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[88%] rounded-[16px] px-3.5 py-2 text-[13.5px] leading-[1.5] ${
                          mio ? 'bg-monad/25 text-ink' : 'border border-line bg-cream text-ink'
                        }`}
                      >
                        {m.texto === null ? (
                          <span className="italic text-ink-3">{C.noLegible}</span>
                        ) : (
                          <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                        )}
                        {m.archivos.map((a) => (
                          <button
                            key={a.hash}
                            type="button"
                            onClick={() => void bajar(a)}
                            disabled={bajando === a.hash}
                            className="pulsable mt-1.5 flex w-full items-center gap-2 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-left text-[12px] text-ink-2"
                          >
                            <Icono nombre="bajar" tamano={13} color="#948DAE" className="shrink-0" />
                            <span className="min-w-0 truncate">{a.name}</span>
                            <span className="ml-auto shrink-0 font-mono text-ink-3">{formatBytes(a.size)}</span>
                          </button>
                        ))}
                      </div>
                      <span className="mt-0.5 px-1 text-[10.5px] text-ink-3">
                        {mio ? C.tu : m.de === 'cliente' ? C.cliente : C.trabajador} ·{' '}
                        {new Date(m.ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div ref={fin} />
          </div>

          {aviso && <p className="text-[12.5px] text-terra">{aviso}</p>}

          {estado === 'caducada' ? (
            <button
              type="button"
              onClick={() => void empezar()}
              className="pulsable tocable rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              {C.firmarOtraVez}
            </button>
          ) : abierta ? (
            <>
              {adjuntos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {adjuntos.map((f, i) => (
                    <button
                      key={`${f.name}-${i}`}
                      type="button"
                      onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                      aria-label={C.quitar(f.name)}
                      className="pulsable flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-2"
                    >
                      <span className="max-w-[9rem] truncate">{f.name}</span>
                      <Icono nombre="cerrar" tamano={11} color="#948DAE" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={borrador}
                  onChange={(e) => setBorrador(e.target.value.slice(0, MAX_CHARS))}
                  rows={2}
                  placeholder={C.escribe}
                  className="min-w-0 grow resize-none rounded-[14px] border border-line bg-paper px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-3"
                />
                <input ref={elegir} type="file" multiple hidden onChange={(e) => anadir(e.target.files)} />
                <button
                  type="button"
                  onClick={() => elegir.current?.click()}
                  aria-label={C.adjuntar}
                  className="pulsable tocable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line"
                >
                  <Icono nombre="mas" tamano={17} color="#948DAE" />
                </button>
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={enviando || (!borrador.trim() && adjuntos.length === 0)}
                  className="pulsable tocable h-11 shrink-0 rounded-full bg-monad px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
                >
                  {enviando ? C.enviando : C.enviar}
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">{C.cerrada}</p>
          )}
        </div>
      )}
    </Hoja>
  );
}
