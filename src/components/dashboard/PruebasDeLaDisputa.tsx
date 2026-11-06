/**
 * Panal — las pruebas de una disputa, en el panel.
 *
 * El expediente que la cadena no guarda: el motivo de quien abrió la disputa,
 * lo que aporta cada parte y su respuesta. Lo guarda el buzón de Panal
 * (`lib/pruebas.ts`). Las dos partes aportan y leen; los jueces de la multisig
 * solo leen, y deciden con su veredicto como hasta ahora.
 *
 * Cada pieza la firma su autor sobre su contenido y su fecha: aquí se vuelve a
 * comprobar esa firma, sin fiarse del buzón. Si las dos partes tienen clave,
 * va cifrada para ellas y para los jueces que tengan la suya; a un juez que la
 * active después, una parte le puede dar acceso desde aquí.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, FileDown, Gavel, Loader2, Lock, LockOpen, Paperclip, ShieldAlert, X } from 'lucide-react';
import type { Address } from 'viem';
import { useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { MAX_ARCHIVOS_POR_PIEZA, MAX_PIEZA_CHARS, type Acceso, type Destinatario } from '@panal/sdk';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWallet } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { cn } from '@/lib/utils';
import { guardarComoArchivo, tamano } from '@/lib/archivosTablon';
import { abrirBytes, abrirTexto, clavePublicaDe, darAccesoALosArbitros, leerArbitros } from '@/lib/cifrado';
import {
  abrirPieza,
  aportarPieza,
  bajarArchivoDePruebas,
  buzonDePruebas,
  credencialDePruebas,
  destinatariosDePruebas,
  leerPruebas,
  objetosParaDarAcceso,
  sigueValiendo,
  type ArchivoDePiezaLegible,
  type CredencialDePruebas,
  type PiezaLegible,
} from '@/lib/pruebas';

const MAX_BYTES = 25 * 1024 * 1024;

export interface TareaEnDisputa {
  id: bigint;
  client: Address;
  worker: Address;
}

export default function PruebasDeLaDisputa({
  task,
  comoJuez = false,
  onClose,
}: {
  task: TareaEnDisputa | null;
  /** Un juez de la multisig: solo lee. */
  comoJuez?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={task !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.5rem)] flex-col border-line bg-paper sm:max-w-xl">
        <DialogTitle className="flex items-center gap-2 font-display text-ink">
          <Gavel size={17} className="shrink-0 text-terra" aria-hidden />
          {t('pruebas.titulo', { id: task ? `#${task.id.toString()}` : '' })}
        </DialogTitle>
        <DialogDescription className="text-[0.8125rem] text-ink-2">
          {comoJuez ? t('pruebas.descJuez') : t('pruebas.desc')}
        </DialogDescription>
        {task && <Panel key={task.id.toString()} task={task} comoJuez={comoJuez} />}
      </DialogContent>
    </Dialog>
  );
}

function Panel({ task, comoJuez }: { task: TareaEnDisputa; comoJuez: boolean }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);
  const base = buzonDePruebas(task.worker);

  const [cred, setCred] = useState<CredencialDePruebas | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [piezas, setPiezas] = useState<PiezaLegible[]>([]);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [plazo, setPlazo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  /** Para quién se cifra: undefined mientras no se sabe, null si va en claro. */
  const [para, setPara] = useState<Destinatario[] | null | undefined>(undefined);
  const [juecesSinClave, setJuecesSinClave] = useState<Address[]>([]);
  const [borrador, setBorrador] = useState('');
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [dandoAcceso, setDandoAcceso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const elegir = useRef<HTMLInputElement>(null);
  // La hora, refrescada sola: el plazo que vence con la ventana abierta tiene que verse.
  const ahoraS = useAhora();

  const yo = (address ?? '') as Address;
  const miRol = comoJuez ? null : yo.toLowerCase() === task.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDePruebas) => {
      if (!address) return;
      const e = await leerPruebas(base, task.id, c);
      const abrir = async (sobre: string, acc: Acceso[]) => (await abrirTexto(sobre, address as Address, firmar, acc)).legible;
      setPiezas(await Promise.all(e.piezas.map((p) => abrirPieza(task.id, p, e.archivos, e.accesos, abrir))));
      setAccesos(e.accesos);
      setPlazo(e.plazo);
      setAbierto(e.abierto);
    },
    [address, base, task.id, firmar],
  );

  const empezar = async () => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDePruebas(task.id, address, firmar);
      setCred(c);
      setEstado('cargando');
      const [destino] = await Promise.all([
        leerArbitros().then((jueces) => destinatariosDePruebas(task.client, task.worker, jueces, (a) => clavePublicaDe(a))),
        cargar(c),
      ]);
      setPara(destino.para);
      setJuecesSinClave(destino.juecesSinClave);
      setEstado('listo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEstado(/reject|denied|user/i.test(msg) ? 'inicio' : 'error');
    }
  };

  // La firma de sesión caduca: se avisa en vez de fallar al siguiente clic.
  useEffect(() => {
    if (estado !== 'listo' || !cred) return;
    const id = setInterval(() => {
      if (!sigueValiendo(cred)) setEstado('caducada');
    }, 20_000);
    return () => clearInterval(id);
  }, [estado, cred]);

  const anadir = (lista: FileList | null) => {
    if (!lista) return;
    const nuevos = [...adjuntos, ...Array.from(lista)];
    if (nuevos.length > MAX_ARCHIVOS_POR_PIEZA) {
      setAviso(t('pruebas.maxArchivos', { max: MAX_ARCHIVOS_POR_PIEZA }));
      return;
    }
    const grande = nuevos.find((f) => f.size > MAX_BYTES);
    if (grande) {
      setAviso(t('pruebas.archivoGrande', { nombre: grande.name }));
      return;
    }
    setAviso(null);
    setAdjuntos(nuevos);
  };

  const aportar = async () => {
    if (!cred || !address || enviando) return;
    const texto = borrador.trim();
    if (!texto) return;
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
      await aportarPieza({ base, taskId: task.id, texto, archivos, para: para ?? null, cred, yo, firmar });
      setBorrador('');
      setAdjuntos([]);
      await cargar(cred);
      toast.success(t('pruebas.aportada'));
    } catch (err) {
      const detalle = err instanceof Error ? err.message.split('\n')[0] ?? '' : '';
      if (/reject|denied|user/i.test(detalle)) setAviso(null);
      else if (/^malware/i.test(detalle)) setAviso(t('pruebas.malware', { detalle }));
      else if (/evidence period over/.test(detalle)) setAviso(t('pruebas.plazoCerrado'));
      else setAviso(t('pruebas.errorAportar', { detalle }));
    } finally {
      setEnviando(false);
    }
  };

  const bajar = async (a: ArchivoDePiezaLegible) => {
    if (!cred || !address) return;
    setBajando(a.hash);
    try {
      const bytes = await bajarArchivoDePruebas({
        base,
        taskId: task.id,
        archivo: a,
        cred,
        accesos,
        abrir: (b, acc) => abrirBytes(b, address as Address, firmar, acc),
      });
      // Pasa por la revisión: si es sospechoso, se pregunta antes de guardarlo.
      await guardarComoArchivo(a.name, bytes, a.mime);
    } catch {
      setAviso(t('pruebas.archivoError', { nombre: a.name }));
    } finally {
      setBajando(null);
    }
  };

  /**
   * Jueces con clave que no están entre los destinatarios de alguna pieza que
   * esta parte sí puede abrir: los que la activaron después. A esos se les da
   * acceso; el buzón sustituye uno repetido, así que darlo dos veces no hace daño.
   */
  const juecesConClave = (para ?? []).slice(2).map((d) => d.cuenta.toLowerCase());
  const faltanJueces =
    !comoJuez &&
    juecesConClave.length > 0 &&
    piezas.some((p) => p.cifrada && p.texto !== null && juecesConClave.some((j) => !p.para.includes(j)));

  const darAcceso = async () => {
    if (!cred || !address) return;
    setDandoAcceso(true);
    try {
      const objetos = await objetosParaDarAcceso({ base, taskId: task.id, piezas, cred });
      const r = await darAccesoALosArbitros({ base, id: task.id, esTablon: false, objetos, accesos: [], cuenta: address as Address, firmar });
      toast.success(t('pruebas.accesoDado', { n: r.arbitros }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) toast.error(t('pruebas.accesoNo'));
    } finally {
      setDandoAcceso(false);
    }
  };

  const fecha = (iso: string | number) =>
    new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const diasQuedan = Math.max(0, (plazo - ahoraS) / 86_400);
  const sinAbrir = piezas.filter((p) => p.texto === null).length;
  const mias = piezas.filter((p) => p.de === miRol).length;

  if (estado === 'inicio' || estado === 'firmando' || estado === 'error') {
    return (
      <div className="mt-2 flex flex-col items-start gap-3">
        <p className="text-[0.8125rem] leading-relaxed text-ink-2">{comoJuez ? t('pruebas.abrirNotaJuez') : t('pruebas.abrirNota')}</p>
        <button
          type="button"
          onClick={() => void empezar()}
          disabled={estado === 'firmando'}
          className="btn-monad inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
        >
          {estado === 'firmando' && <Loader2 size={15} className="animate-spin" />}
          {t('pruebas.abrir')}
        </button>
        {estado === 'error' && <p className="text-[0.8125rem] text-terra">{t('pruebas.errorCargar')}</p>}
      </div>
    );
  }

  if (estado === 'cargando') {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
        <Loader2 size={18} className="animate-spin" /> {t('pruebas.cargando')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* El plazo */}
      <p className={cn('text-[0.8125rem]', abierto ? 'text-ink-2' : 'text-terra')}>
        {plazo === 0
          ? t('pruebas.sinPlazo')
          : abierto
            ? t('pruebas.plazoHasta', { fecha: fecha(plazo * 1000), dias: diasQuedan.toFixed(1) })
            : t('pruebas.plazoTerminado', { fecha: fecha(plazo * 1000) })}
      </p>

      {/* El cifrado */}
      {!comoJuez && para !== undefined && (
        <p className={cn('flex items-start gap-1.5 text-[0.75rem] leading-snug', para ? 'text-olive' : 'text-terra')}>
          {para ? <Lock size={12} className="mt-0.5 shrink-0" aria-hidden /> : <LockOpen size={12} className="mt-0.5 shrink-0" aria-hidden />}
          {para
            ? juecesSinClave.length > 0
              ? t('pruebas.cifradoFaltanJueces', { n: juecesSinClave.length })
              : t('pruebas.cifrado')
            : t('pruebas.sinCifrar')}
        </p>
      )}
      {comoJuez && sinAbrir > 0 && (
        <p className="flex items-start gap-1.5 text-[0.75rem] leading-snug text-terra">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
          {t('pruebas.juezSinAbrir', { n: sinAbrir })}
        </p>
      )}

      {/* Las piezas */}
      <div className="min-h-[10rem] flex-1 overflow-y-auto rounded-xl border border-line bg-cream p-3">
        {piezas.length === 0 ? (
          <p className="py-8 text-center text-[0.8125rem] text-ink-3">{t('pruebas.vacio')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {piezas.map((p, i) => (
              <li key={`${p.recibida}-${i}`} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.75rem] font-medium text-ink-2">
                    {p.de === miRol ? t('pruebas.tu') : p.de === 'cliente' ? t('pruebas.cliente') : t('pruebas.trabajador')} ·{' '}
                    <span className="font-normal text-ink-3">{fecha(p.fecha)}</span>
                  </p>
                  <span
                    className={cn('inline-flex items-center gap-1 text-[0.6875rem]', p.firmaOk ? 'text-olive' : 'text-terra')}
                    title={p.autor}
                  >
                    {p.firmaOk ? <BadgeCheck size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
                    {p.firmaOk ? t('pruebas.firmaOk') : t('pruebas.firmaMal')}
                  </span>
                </div>
                {p.texto === null ? (
                  <p className="mt-2 text-[0.8125rem] italic text-ink-3">{t('pruebas.noLegible')}</p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink">{p.texto}</p>
                )}
                {p.archivos.map((a) => (
                  <button
                    key={a.hash}
                    type="button"
                    onClick={() => void bajar(a)}
                    disabled={bajando === a.hash}
                    className="mt-2 flex w-full items-center gap-2 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-left text-[0.75rem] text-ink-2 hover:border-honey"
                  >
                    {bajando === a.hash ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <FileDown size={13} className="shrink-0" />}
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-ink-3">{tamano(a.size)}</span>
                  </button>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>

      {aviso && <p className="text-[0.8125rem] text-terra">{aviso}</p>}

      {faltanJueces && (
        <button
          type="button"
          onClick={() => void darAcceso()}
          disabled={dandoAcceso}
          className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-honey hover:text-honey-deep disabled:opacity-50"
        >
          {dandoAcceso ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
          {t('pruebas.darAcceso')}
        </button>
      )}

      {estado === 'caducada' ? (
        <button
          type="button"
          onClick={() => void empezar()}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-honey"
        >
          {t('pruebas.firmarOtraVez')}
        </button>
      ) : comoJuez ? null : abierto ? (
        <div className="flex flex-col gap-2">
          <p className="text-[0.75rem] leading-snug text-ink-3">{mias === 0 ? t('pruebas.primera') : t('pruebas.otra')}</p>
          {adjuntos.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {adjuntos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.75rem] text-ink-2">
                  <span className="max-w-[10rem] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                    aria-label={t('pruebas.quitar', { nombre: f.name })}
                    className="text-ink-3 hover:text-terra"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value.slice(0, MAX_PIEZA_CHARS))}
            rows={4}
            placeholder={t('pruebas.escribe')}
            className="min-w-0 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input ref={elegir} type="file" multiple hidden onChange={(e) => anadir(e.target.files)} />
            <button
              type="button"
              onClick={() => elegir.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-[0.8125rem] text-ink-2 hover:border-honey hover:text-honey-deep"
            >
              <Paperclip size={14} />
              {t('pruebas.adjuntar')}
            </button>
            <button
              type="button"
              onClick={() => void aportar()}
              disabled={enviando || !borrador.trim()}
              className="btn-monad inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
            >
              {enviando && <Loader2 size={15} className="animate-spin" />}
              {t('pruebas.aportar')}
            </button>
          </div>
          <p className="text-[0.6875rem] leading-snug text-ink-3">{t('pruebas.firmaNota')}</p>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-ink-3">{t('pruebas.cerrado')}</p>
      )}
    </div>
  );
}
