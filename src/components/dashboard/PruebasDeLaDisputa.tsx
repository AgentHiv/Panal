/**
 * Panal — el expediente de una disputa, en el panel.
 *
 * Lo que la cadena no guarda: el motivo de quien abrió la disputa, lo que
 * cuenta cada parte, lo que preguntan los jueces y, sobre todo, el encargo y
 * la entrega EXACTOS. Lo guarda el buzón de Panal (`lib/pruebas.ts`).
 *
 * V2 (noviembre de 2026):
 *   - Todo lo ven las dos partes y los tres jueces, y va cifrado para ellos:
 *     Panal no lo lee. Para escribir hace falta la clave de cifrado propia
 *     (una firma, sin gas).
 *   - Los jueces escriben: preguntan (a todos o a una parte) y PIDEN el
 *     encargo o la entrega a una parte. Quien recibe una petición la ve arriba,
 *     con el botón para contestarla.
 *   - Solo cuenta lo anclado: el cliente comparte su encargo y la entrega que
 *     recibió desde la copia que guarda este navegador, y solo si su keccak256
 *     es el que está en la cadena. Quien lee lo vuelve a comprobar y lo marca.
 *     Nada de archivos de fuera: los archivos anclados los aporta el agente.
 *
 * Cada pieza la firma su autor sobre su contenido y su fecha: aquí se vuelve a
 * comprobar esa firma, sin fiarse del buzón.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Bot, FileDown, Gavel, Loader2, Lock, Send, ShieldAlert, ShieldCheck, ShieldX, Share2 } from 'lucide-react';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { useReadContract, useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { MAX_PIEZA_CHARS, anclaDeLaPieza, cuerpoDePieza, type Acceso, type Destinatario } from '@panal/sdk';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWallet } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { cn } from '@/lib/utils';
import { guardarComoArchivo, tamano } from '@/lib/archivosTablon';
import { abrirBytes, abrirTexto, clavePublicaDe, darAccesoA, leerArbitros, publicarMiClave } from '@/lib/cifrado';
import { getTaskBrief, getTaskSobre } from '@/lib/taskBriefs';
import { leerEntrega } from '@/lib/expedientes';
import { panalEscrowV2Abi } from '@/contracts/abis';
import { PANAL_ESCROW_V2_ADDRESS, activeChain } from '@/contracts/config';
import {
  abrirPieza,
  aportarPieza,
  bajarArchivoDePruebas,
  buzonDePruebas,
  credencialDePruebas,
  destinatariosDePruebas,
  faltanPorAcceso,
  leerPruebas,
  marcarAnclados,
  objetosParaDarAcceso,
  puedeEscribir,
  sigueValiendo,
  type ArchivoDePiezaLegible,
  type CredencialDePruebas,
  type PiezaLegible,
} from '@/lib/pruebas';

export interface TareaEnDisputa {
  /** La tarea del escrow. */
  id: bigint;
  /** El cliente de verdad: en una del tablón con reglas, el de su encargo, no el contrato. */
  client: Address;
  worker: Address;
  /** Su encargo del tablón con reglas, si viene de allí. */
  jobId?: bigint;
}

type Rol = 'cliente' | 'trabajador' | 'juez';
type Parte = 'cliente' | 'trabajador';

const HASH_CERO = `0x${'0'.repeat(64)}`;

export default function PruebasDeLaDisputa({
  task,
  comoJuez = false,
  onClose,
}: {
  task: TareaEnDisputa | null;
  /** Un juez de la multisig: pregunta y pide, y decide abajo con su veredicto. */
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

/** Lo anclado que guarda este navegador, y solo si coincide con la cadena. */
function copiaAnclada(texto: string | null | undefined, ancla: string | undefined): string | null {
  if (!texto || !ancla || ancla === HASH_CERO) return null;
  return keccak256(toBytes(texto)).toLowerCase() === ancla.toLowerCase() ? texto : null;
}

function Panel({ task, comoJuez }: { task: TareaEnDisputa; comoJuez: boolean }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);
  const base = buzonDePruebas(task.worker);

  // Las huellas de la tarea: con ellas se comprueba el encargo y la entrega.
  const { data: enCadena } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'tasks',
    args: [task.id],
    chainId: activeChain.id,
    query: { retry: 1 },
  });
  const huellas = useMemo(() => {
    const r = enCadena as unknown as { taskHash?: Hex; resultHash?: Hex } | undefined;
    return r?.taskHash && r.resultHash ? { taskHash: r.taskHash, resultHash: r.resultHash } : undefined;
  }, [enCadena]);

  const [cred, setCred] = useState<CredencialDePruebas | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [piezas, setPiezas] = useState<PiezaLegible[]>([]);
  /** El texto en claro de un encargo o una entrega que se ancló cifrada, por índice. */
  const [claros, setClaros] = useState<Record<number, string>>({});
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [plazo, setPlazo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [jueces, setJueces] = useState<Address[]>([]);
  /** Para quién se cifra: todos los del expediente con clave. */
  const [para, setPara] = useState<Destinatario[] | undefined>(undefined);
  const [sinClave, setSinClave] = useState<Address[]>([]);
  const [borrador, setBorrador] = useState('');
  const [dirigida, setDirigida] = useState<'todos' | Parte>('todos');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [activando, setActivando] = useState(false);
  const [dandoAcceso, setDandoAcceso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  // La hora, refrescada sola: el plazo que vence con la ventana abierta tiene que verse.
  const ahoraS = useAhora();

  const yo = (address ?? '') as Address;
  const miRol: Rol = comoJuez ? 'juez' : yo.toLowerCase() === task.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDePruebas) => {
      if (!address) return;
      const e = await leerPruebas(base, task.id, c);
      const abrir = async (sobre: string, acc: Acceso[]) => (await abrirTexto(sobre, address as Address, firmar, acc)).legible;
      const abiertas = await Promise.all(e.piezas.map((p) => abrirPieza(task.id, p, e.archivos, e.accesos, abrir)));
      // Un encargo o una entrega que se anclaron cifrados: lo que se compara
      // con la cadena es el sobre; lo que se lee, lo de dentro (con un acceso).
      const dentro: Record<number, string> = {};
      for (const [i, p] of abiertas.entries()) {
        if ((p.tipo === 'encargo' || p.tipo === 'entrega') && p.texto && p.texto.startsWith('{"v":"panal-cifrado-1"')) {
          const legible = await abrir(p.texto, e.accesos).catch(() => null);
          if (legible !== null) dentro[i] = legible;
        }
      }
      setPiezas(abiertas);
      setClaros(dentro);
      setAccesos(e.accesos);
      setPlazo(e.plazo);
      setAbierto(e.abierto);
    },
    [address, base, task.id, firmar],
  );

  // Lo anclado se comprueba aquí, con las huellas de la cadena (que pueden
  // llegar después de abrir el expediente): el encargo y la entrega contra su
  // hash, y los archivos contra lo que dicen ellos.
  const vistas = useMemo(
    () =>
      marcarAnclados(
        piezas.map((p) => ({
          ...p,
          ancla:
            huellas && (p.tipo === 'encargo' || p.tipo === 'entrega') && p.texto !== null
              ? anclaDeLaPieza(cuerpoDePieza({ tipo: p.tipo, texto: p.texto }), huellas)
              : null,
        })),
      ),
    [piezas, huellas],
  );

  const destinatarios = useCallback(
    async (lista: Address[]) => {
      const d = await destinatariosDePruebas(task.client, task.worker, lista, (a) => clavePublicaDe(a));
      setPara(d.para);
      setSinClave(d.sinClave);
      return d.para;
    },
    [task.client, task.worker],
  );

  const empezar = async () => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDePruebas(task.id, address, firmar, task.jobId);
      setCred(c);
      setEstado('cargando');
      const lista = await leerArbitros();
      setJueces(lista);
      await Promise.all([destinatarios(lista), cargar(c)]);
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

  const activarClave = async () => {
    if (!address) return;
    setActivando(true);
    setAviso(null);
    try {
      await publicarMiClave(address as Address, firmar);
      await destinatarios(jueces);
      toast.success(t('pruebas.claveActivada'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) setAviso(t('pruebas.claveError'));
    } finally {
      setActivando(false);
    }
  };

  /** Escribe una pieza. Si alguien publicó su clave entretanto, rehace la lista y reintenta una vez. */
  const escribir = async (
    que: string,
    o: { texto: string; tipo?: 'mensaje' | 'encargo' | 'entrega' | 'peticion'; dirigida?: Parte; pide?: 'encargo' | 'entrega' },
  ): Promise<boolean> => {
    if (!cred || !address || enviando) return false;
    if (!sigueValiendo(cred)) {
      setEstado('caducada');
      return false;
    }
    setEnviando(que);
    setAviso(null);
    const enviar = (destino: Destinatario[] | undefined) =>
      aportarPieza({ base, taskId: task.id, texto: o.texto, archivos: [], para: destino ?? null, cred, yo, firmar, tipo: o.tipo, dirigida: o.dirigida, pide: o.pide });
    try {
      try {
        await enviar(para);
      } catch (err) {
        if (!(err instanceof Error) || err.message !== 'missing recipients') throw err;
        await enviar(await destinatarios(jueces));
      }
      await cargar(cred);
      return true;
    } catch (err) {
      const detalle = err instanceof Error ? (err.message.split('\n')[0] ?? '') : '';
      if (/reject|denied|user/i.test(detalle)) setAviso(null);
      else if (detalle === 'sin-clave') setAviso(t('pruebas.sinClaveMia'));
      else if (/evidence period over/.test(detalle)) setAviso(t('pruebas.plazoCerrado'));
      else setAviso(t('pruebas.errorAportar', { detalle }));
      return false;
    } finally {
      setEnviando(null);
    }
  };

  const enviarMensaje = async () => {
    const texto = borrador.trim();
    if (!texto) return;
    const ok = await escribir('mensaje', { texto, ...(comoJuez && dirigida !== 'todos' ? { dirigida } : {}) });
    if (ok) {
      setBorrador('');
      toast.success(t('pruebas.enviado'));
    }
  };

  const pedir = (pide: 'encargo' | 'entrega', a: Parte) =>
    escribir(`pide-${pide}-${a}`, { texto: '', tipo: 'peticion', dirigida: a, pide }).then((ok) => {
      if (ok) toast.success(t('pruebas.enviado'));
    });

  // Lo anclado que este navegador puede compartir: la copia que guardó al
  // contratar o al recibir, solo si coincide con la cadena.
  const encargoLocal = miRol === 'cliente' ? copiaAnclada(getTaskSobre(huellas?.taskHash) ?? getTaskBrief(huellas?.taskHash), huellas?.taskHash) : null;
  const entregaLocal = miRol === 'cliente' ? copiaAnclada(leerEntrega(task.id.toString())?.texto, huellas?.resultHash) : null;

  const compartir = async (tipo: 'encargo' | 'entrega', texto: string) => {
    const ok = await escribir(tipo, { texto, tipo });
    if (!ok) return;
    // Si lo anclado era un sobre, quien lea necesita además un acceso para abrirlo.
    if (texto.startsWith('{"v":"panal-cifrado-1"') && para && cred) {
      await darAccesoA({ base, id: task.id, objetos: [texto], accesos, para, cuenta: yo, firmar, job: task.jobId }).catch(() => 0);
      await cargar(cred);
    }
    toast.success(t('pruebas.compartido'));
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

  // Quien tiene clave y no puede abrir algo que este lector sí: los que la
  // activaron tarde. Cualquiera del expediente puede darles acceso.
  const faltan = para ? faltanPorAcceso(vistas, para).filter((d) => d.cuenta.toLowerCase() !== yo.toLowerCase()) : [];
  const darAcceso = async () => {
    if (!cred || !address) return;
    setDandoAcceso(true);
    try {
      const objetos = await objetosParaDarAcceso({ base, taskId: task.id, piezas: vistas, cred });
      const n = await darAccesoA({ base, id: task.id, objetos, accesos, para: faltan, cuenta: yo, firmar, job: task.jobId });
      toast.success(t('pruebas.accesoDado', { n }));
      await cargar(cred);
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
  const sinAbrir = vistas.filter((p) => p.texto === null).length;
  const puedo = puedeEscribir(para, yo);

  /** Quién es el autor de una pieza, dicho para quien lee. */
  const quien = (p: PiezaLegible) => {
    if (p.autor.toLowerCase() === yo.toLowerCase()) return t('pruebas.tu');
    if (p.de === 'juez') {
      const n = jueces.findIndex((j) => j.toLowerCase() === p.autor.toLowerCase());
      return t('pruebas.juez', { n: n >= 0 ? n + 1 : '?' });
    }
    return p.de === 'cliente' ? t('pruebas.cliente') : t('pruebas.trabajador');
  };

  // Lo que los jueces le han pedido a quien lee y todavía no ha llegado.
  const pendientes = miRol === 'juez'
    ? []
    : (['encargo', 'entrega'] as const).filter((que) => {
        let pedida = -1;
        vistas.forEach((p, i) => {
          if (p.de === 'juez' && p.tipo === 'peticion' && p.dirigida === miRol && p.pide === que) pedida = i;
        });
        if (pedida < 0) return false;
        return !vistas.some((p, i) => i > pedida && p.de === miRol && p.tipo === que && p.ancla === 'coincide');
      });

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

  const boton =
    'inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50';

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
      <p className="flex items-start gap-1.5 text-[0.75rem] leading-snug text-olive">
        <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
        {t('pruebas.cifrado')}
      </p>
      {sinClave.length > 0 && (
        <p className="text-[0.75rem] leading-snug text-ink-3">
          {t('pruebas.faltanClave', {
            quien: sinClave
              .map((a) =>
                a.toLowerCase() === task.client.toLowerCase()
                  ? t('pruebas.cliente')
                  : a.toLowerCase() === task.worker.toLowerCase()
                    ? t('pruebas.trabajador')
                    : t('pruebas.juez', { n: jueces.findIndex((j) => j.toLowerCase() === a.toLowerCase()) + 1 }),
              )
              .join(', '),
          })}
        </p>
      )}
      {sinAbrir > 0 && (
        <p className="flex items-start gap-1.5 text-[0.75rem] leading-snug text-terra">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
          {t('pruebas.sinAbrir', { n: sinAbrir })}
        </p>
      )}

      {/* Lo que te han pedido */}
      {abierto && pendientes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-honey/60 bg-honey-soft/50 px-3 py-2.5">
          {pendientes.map((que) => {
            const texto = que === 'encargo' ? encargoLocal : entregaLocal;
            return (
              <div key={que} className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.8125rem] text-ink">{que === 'encargo' ? t('pruebas.teHanPedidoEncargo') : t('pruebas.teHanPedidoEntrega')}</p>
                {texto ? (
                  <button type="button" disabled={!puedo || enviando !== null} onClick={() => void compartir(que, texto)} className={boton}>
                    {enviando === que ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    {que === 'encargo' ? t('pruebas.compartirEncargo') : t('pruebas.compartirEntrega')}
                  </button>
                ) : (
                  <p className="text-[0.75rem] text-ink-3">{t('pruebas.sinCopia')}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Las piezas */}
      <div className="min-h-[10rem] flex-1 overflow-y-auto rounded-xl border border-line bg-cream p-3">
        {vistas.length === 0 ? (
          <p className="py-8 text-center text-[0.8125rem] text-ink-3">{t('pruebas.vacio')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {vistas.map((p, i) => (
              <li
                key={`${p.recibida}-${i}`}
                className={cn('rounded-xl border bg-paper p-3', p.de === 'juez' ? 'border-monad/40' : 'border-line')}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.75rem] font-medium text-ink-2">
                    {p.de === 'juez' && <Gavel size={12} className="text-monad" aria-hidden />}
                    {quien(p)}
                    {p.dirigida && (
                      <span className="font-normal text-ink-3">
                        → {p.dirigida === 'cliente' ? t('pruebas.cliente') : t('pruebas.trabajador')}
                      </span>
                    )}
                    <span className="font-normal text-ink-3">· {fecha(p.fecha)}</span>
                  </p>
                  <span
                    className={cn('inline-flex items-center gap-1 text-[0.6875rem]', p.firmaOk ? 'text-olive' : 'text-terra')}
                    title={p.autor}
                  >
                    {p.firmaOk ? <BadgeCheck size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
                    {p.firmaOk ? t('pruebas.firmaOk') : t('pruebas.firmaMal')}
                  </span>
                </div>

                {(p.tipo !== 'mensaje' || p.auto) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.tipo === 'encargo' && <span className="rounded-full bg-cream px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">{t('pruebas.tipoEncargo')}</span>}
                    {p.tipo === 'entrega' && <span className="rounded-full bg-cream px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">{t('pruebas.tipoEntrega')}</span>}
                    {p.ancla === 'coincide' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-olive/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-olive">
                        <ShieldCheck size={11} aria-hidden /> {t('pruebas.anclaOk')}
                      </span>
                    )}
                    {p.ancla === 'no-coincide' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-terra/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-terra">
                        <ShieldX size={11} aria-hidden /> {t('pruebas.anclaMal')}
                      </span>
                    )}
                    {p.auto && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-[0.6875rem] text-ink-3">
                        <Bot size={11} aria-hidden /> {t('pruebas.auto')}
                      </span>
                    )}
                  </div>
                )}

                {p.texto === null ? (
                  <p className="mt-2 text-[0.8125rem] italic text-ink-3">{t('pruebas.noLegible')}</p>
                ) : p.tipo === 'peticion' ? (
                  <p className="mt-2 text-[0.875rem] font-medium text-ink">
                    {p.pide === 'entrega'
                      ? p.dirigida === 'cliente'
                        ? t('pruebas.pideEntregaCliente')
                        : t('pruebas.pideEntregaTrabajador')
                      : p.dirigida === 'cliente'
                        ? t('pruebas.pideEncargoCliente')
                        : t('pruebas.pideEncargoTrabajador')}
                    {p.texto ? <span className="mt-1 block font-normal text-ink-2">{p.texto}</span> : null}
                  </p>
                ) : (
                  <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink">
                    {claros[i] ?? p.texto}
                  </p>
                )}

                {p.archivos.map((a) =>
                  a.anclado ? (
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
                  ) : (
                    <p key={a.hash} className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[0.75rem] text-ink-3">
                      <ShieldX size={13} className="shrink-0 text-terra" aria-hidden />
                      <span className="min-w-0 truncate">{a.name}</span>
                      <span className="ml-auto shrink-0">{t('pruebas.noAnclado')}</span>
                    </p>
                  ),
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {aviso && <p className="text-[0.8125rem] text-terra">{aviso}</p>}

      {faltan.length > 0 && (
        <button
          type="button"
          onClick={() => void darAcceso()}
          disabled={dandoAcceso}
          className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-honey hover:text-honey-deep disabled:opacity-50"
        >
          {dandoAcceso ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
          {t('pruebas.darAcceso', { n: faltan.length })}
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
      ) : !abierto ? (
        <p className="text-[0.8125rem] text-ink-3">{t('pruebas.cerrado')}</p>
      ) : !puedo ? (
        // Sin clave no se escribe: lo que se escribe va cifrado para todos, el autor incluido.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-honey/50 bg-honey-soft/40 px-3 py-2.5">
          <p className="max-w-sm text-[0.8125rem] leading-relaxed text-ink-2">{t('pruebas.sinClaveMia')}</p>
          <button type="button" onClick={() => void activarClave()} disabled={activando} className={boton}>
            {activando ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
            {t('pruebas.activarClave')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {comoJuez ? (
            <div className="flex flex-wrap gap-1.5">
              {(['cliente', 'trabajador'] as const).map((a) =>
                (['encargo', 'entrega'] as const).map((que) => (
                  <button key={`${que}-${a}`} type="button" disabled={enviando !== null} onClick={() => void pedir(que, a)} className={boton}>
                    {enviando === `pide-${que}-${a}` && <Loader2 size={12} className="animate-spin" />}
                    {que === 'encargo'
                      ? a === 'cliente'
                        ? t('pruebas.pedirEncargoCliente')
                        : t('pruebas.pedirEncargoTrabajador')
                      : a === 'cliente'
                        ? t('pruebas.pedirEntregaCliente')
                        : t('pruebas.pedirEntregaTrabajador')}
                  </button>
                )),
              )}
            </div>
          ) : (
            (encargoLocal || entregaLocal) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {encargoLocal && (
                  <button type="button" disabled={enviando !== null} onClick={() => void compartir('encargo', encargoLocal)} className={boton}>
                    {enviando === 'encargo' ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    {t('pruebas.compartirEncargo')}
                  </button>
                )}
                {entregaLocal && (
                  <button type="button" disabled={enviando !== null} onClick={() => void compartir('entrega', entregaLocal)} className={boton}>
                    {enviando === 'entrega' ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    {t('pruebas.compartirEntrega')}
                  </button>
                )}
                <p className="w-full text-[0.6875rem] leading-snug text-ink-3">{t('pruebas.compartirNota')}</p>
              </div>
            )
          )}

          {comoJuez && (
            <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-3">
              {t('pruebas.para')}
              {(['todos', 'cliente', 'trabajador'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirigida(d)}
                  className={cn(
                    'rounded-full border px-2.5 py-1',
                    dirigida === d ? 'border-monad bg-monad/10 text-monad' : 'border-line text-ink-2 hover:border-monad',
                  )}
                >
                  {d === 'todos' ? t('pruebas.paraTodos') : d === 'cliente' ? t('pruebas.cliente') : t('pruebas.trabajador')}
                </button>
              ))}
            </div>
          )}
          {!comoJuez && <p className="text-[0.75rem] leading-snug text-ink-3">{vistas.some((p) => p.de === miRol) ? t('pruebas.otra') : t('pruebas.primera')}</p>}
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value.slice(0, MAX_PIEZA_CHARS))}
            rows={4}
            placeholder={comoJuez ? t('pruebas.escribeJuez') : t('pruebas.escribe')}
            className="min-w-0 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xs text-[0.6875rem] leading-snug text-ink-3">{t('pruebas.firmaNota')}</p>
            <button
              type="button"
              onClick={() => void enviarMensaje()}
              disabled={enviando !== null || !borrador.trim()}
              className="btn-monad inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
            >
              {enviando === 'mensaje' ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
              {t('pruebas.enviar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
