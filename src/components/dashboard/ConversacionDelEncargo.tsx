/**
 * Panal — la conversación de un encargo, en el panel.
 *
 * Entre el cliente y quien hace el trabajo, con el dinero ya bloqueado en el
 * escrow: aquí no se puede escribir a un desconocido antes de pagar, que es por
 * donde entran las estafas. Vive en el buzón (`lib/conversacion.ts`): se firma
 * una vez para abrirla y la firma vale unos minutos para leer, escribir y
 * mandar archivos. Los archivos que llegan pasan por la revisión antes de
 * guardarse (`guardarComoArchivo`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown, Loader2, Lock, LockOpen, MessageSquare, Paperclip, Send, X } from 'lucide-react';
import type { Address } from 'viem';
import { useSignMessage } from 'wagmi';
import type { Destinatario } from '@panal/sdk';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import { guardarComoArchivo, tamano } from '@/lib/archivosTablon';
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

/** Lo que se puede adjuntar a un mensaje: lo mismo que admite el buzón. */
const MAX_ARCHIVOS = 5;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 4000;
/** Cada cuánto se miran mensajes nuevos con la conversación abierta. */
const CADA_MS = 15_000;

export interface EncargoConConversacion {
  id: bigint;
  client: Address;
  worker: Address;
}

export default function ConversacionDelEncargo({
  task,
  base,
  onClose,
}: {
  task: EncargoConConversacion | null;
  /** El buzón de quien hace el trabajo. */
  base: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={task !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.5rem)] flex-col border-line bg-paper sm:max-w-lg">
        <DialogTitle className="flex items-center gap-2 font-display text-ink">
          <MessageSquare size={17} className="shrink-0 text-honey-deep" aria-hidden />
          {t('conversacion.titulo', { id: task ? `#${task.id.toString()}` : '' })}
        </DialogTitle>
        <DialogDescription className="text-[0.8125rem] text-ink-2">{t('conversacion.desc')}</DialogDescription>
        {task && base && <Panel key={task.id.toString()} task={task} base={base} />}
      </DialogContent>
    </Dialog>
  );
}

function Panel({ task, base }: { task: EncargoConConversacion; base: string }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);

  const [cred, setCred] = useState<CredencialDeConversacion | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [mensajes, setMensajes] = useState<MensajeLegible[]>([]);
  const [abierta, setAbierta] = useState(true);
  /** Para quién se cifra: undefined mientras no se sabe, null si va en claro. */
  const [para, setPara] = useState<Destinatario[] | null | undefined>(undefined);
  const [borrador, setBorrador] = useState('');
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const elegir = useRef<HTMLInputElement>(null);

  const yo = (address ?? '').toLowerCase();
  const miRol = yo === task.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDeConversacion) => {
      if (!address) return;
      const r = await leerConversacion(base, task.id, c);
      setMensajes(await Promise.all(r.mensajes.map((m) => abrirMensaje(m, address as Address, firmar))));
      setAbierta(r.abierta);
    },
    [address, base, task.id, firmar],
  );

  const empezar = async () => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDeConversacion(task.id, address, firmar);
      setCred(c);
      setEstado('cargando');
      const [destinatarios] = await Promise.all([cifradoDeLaConversacion(task.client, task.worker), cargar(c)]);
      setPara(destinatarios);
      setEstado('listo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEstado(/reject|denied|user/i.test(msg) ? 'inicio' : 'error');
    }
  };

  // Mensajes nuevos cada poco, mientras la firma valga.
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

  const anadir = (lista: FileList | null) => {
    if (!lista) return;
    const nuevos = [...adjuntos, ...Array.from(lista)];
    if (nuevos.length > MAX_ARCHIVOS) {
      setAviso(t('conversacion.maxArchivos', { max: MAX_ARCHIVOS }));
      return;
    }
    const grande = nuevos.find((f) => f.size > MAX_BYTES);
    if (grande) {
      setAviso(t('conversacion.archivoGrande', { nombre: grande.name }));
      return;
    }
    setAviso(null);
    setAdjuntos(nuevos);
  };

  const enviar = async () => {
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
      await enviarMensaje({ base, taskId: task.id, texto: texto || '📎', archivos, para: para ?? null, cred });
      setBorrador('');
      setAdjuntos([]);
      await cargar(cred);
    } catch (err) {
      const detalle = err instanceof Error ? err.message.split('\n')[0] : '';
      setAviso(/^malware/i.test(detalle ?? '') ? t('conversacion.malware', { detalle }) : t('conversacion.errorEnviar', { detalle }));
    } finally {
      setEnviando(false);
    }
  };

  const bajar = async (a: ArchivoDelChat) => {
    if (!cred || !address) return;
    setBajando(a.hash);
    try {
      const bytes = await bajarArchivoDelChat({ base, taskId: task.id, archivo: a, cred, yo: address as Address, firmar });
      // Pasa por la revisión: si es sospechoso, se pregunta antes de guardarlo.
      await guardarComoArchivo(a.name, bytes, a.mime);
    } catch {
      setAviso(t('conversacion.archivoError', { nombre: a.name }));
    } finally {
      setBajando(null);
    }
  };

  const hora = (ts: number) =>
    new Date(ts).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (estado === 'inicio' || estado === 'firmando' || estado === 'error') {
    return (
      <div className="mt-2 flex flex-col items-start gap-3">
        <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t('conversacion.abrirNota')}</p>
        <button
          type="button"
          onClick={() => void empezar()}
          disabled={estado === 'firmando'}
          className="btn-monad inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
        >
          {estado === 'firmando' && <Loader2 size={15} className="animate-spin" />}
          {t('conversacion.abrir')}
        </button>
        {estado === 'error' && <p className="text-[0.8125rem] text-terra">{t('conversacion.errorCargar')}</p>}
      </div>
    );
  }

  if (estado === 'cargando') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
        <Loader2 size={18} className="animate-spin" /> {t('conversacion.cargando')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {para !== undefined && (
        <p
          className={cn(
            'flex items-center gap-1.5 text-[0.75rem]',
            para ? 'text-olive' : 'text-terra',
          )}
        >
          {para ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
          {para ? t('conversacion.cifrada') : t('conversacion.sinCifrar')}
        </p>
      )}

      <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-xl border border-line bg-cream p-3">
        {mensajes.length === 0 ? (
          <p className="py-8 text-center text-[0.8125rem] text-ink-3">{t('conversacion.vacia')}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {mensajes.map((m, i) => {
              const mio = m.de === miRol;
              return (
                <li key={`${m.ts}-${i}`} className={cn('flex flex-col', mio ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.875rem] leading-relaxed',
                      mio ? 'bg-honey-soft text-ink' : 'border border-line bg-paper text-ink',
                    )}
                  >
                    {m.texto === null ? (
                      <span className="italic text-ink-3">{t('conversacion.noLegible')}</span>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                    )}
                    {m.archivos.map((a) => (
                      <button
                        key={a.hash}
                        type="button"
                        onClick={() => void bajar(a)}
                        disabled={bajando === a.hash}
                        className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-left text-[0.75rem] text-ink-2 hover:border-honey"
                      >
                        {bajando === a.hash ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <FileDown size={13} className="shrink-0" />}
                        <span className="min-w-0 truncate">{a.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-ink-3">{tamano(a.size)}</span>
                      </button>
                    ))}
                  </div>
                  <span className="mt-0.5 px-1 text-[0.6875rem] text-ink-3">
                    {mio ? t('conversacion.tu') : m.de === 'cliente' ? t('conversacion.cliente') : t('conversacion.trabajador')} · {hora(m.ts)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={fin} />
      </div>

      {aviso && <p className="text-[0.8125rem] text-terra">{aviso}</p>}

      {estado === 'caducada' ? (
        <button
          type="button"
          onClick={() => void empezar()}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-honey"
        >
          {t('conversacion.firmarOtraVez')}
        </button>
      ) : abierta ? (
        <div className="flex flex-col gap-2">
          {adjuntos.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {adjuntos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.75rem] text-ink-2">
                  <span className="max-w-[10rem] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                    aria-label={t('conversacion.quitar', { nombre: f.name })}
                    className="text-ink-3 hover:text-terra"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={borrador}
              onChange={(e) => setBorrador(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={2}
              placeholder={t('conversacion.escribe')}
              className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
            />
            <input ref={elegir} type="file" multiple hidden onChange={(e) => anadir(e.target.files)} />
            <button
              type="button"
              onClick={() => elegir.current?.click()}
              aria-label={t('conversacion.adjuntar')}
              className="rounded-full border border-line p-2.5 text-ink-2 hover:border-honey hover:text-honey-deep"
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || (!borrador.trim() && adjuntos.length === 0)}
              aria-label={t('conversacion.enviar')}
              className="btn-monad rounded-full p-2.5 disabled:opacity-50"
            >
              {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-ink-3">{t('conversacion.cerrada')}</p>
      )}
    </div>
  );
}
