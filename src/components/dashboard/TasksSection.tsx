/**
 * Panal — Tareas REALES del dashboard (PanalEscrow).
 * Tabs Activas (Open/Delivered) / Completadas (Completed/Cancelled) /
 * En disputa (Disputed) con counts reales y acciones on-chain por rol:
 * - Worker: claimTask (Open sin worker) y deliverResult (Open asignada,
 *   resultado → keccak256(toBytes(texto))).
 * - Cliente: approveAndRelease (Delivered, rating 1–5), openDispute,
 *   cancelTask (Open) y autoRelease (Delivered y plazo AUTO_RELEASE pasado).
 * Todas pasan por el patrón de escritura obligatorio (useContractAction) y
 * tras minarse la tx se hace refetch de las tareas.
 */

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, Hexagon, Loader2, Paperclip, RefreshCw, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatEther, keccak256, toBytes } from 'viem';
import type { Address } from 'viem';
import { useReadContract, useSignMessage } from 'wagmi';
import HexAvatar from '@/components/HexAvatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { getTaskBrief } from '@/lib/taskBriefs';
import { useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import {
  credencialDeEncargo,
  credencialDeEntrega,
  dejarEntregaEnBuzon,
  descargarArchivoDelBuzon,
  esBuzon,
  extractBotUrl,
  leerEncargoDelBuzon,
  subirArchivoDeEntrega,
  urlDeBuzon,
  type Credencial,
} from '@/lib/botEndpoint';
import { appendFilesManifest, type DeliveredFile } from '@/lib/deliveredFiles';
import { describirArchivo, tamanoLegible, MAX_ADJUNTOS, type Adjunto } from '@/lib/adjuntos';
import { parseAttachmentsManifest } from '@panal/sdk';
import { hayEntrega } from '@/lib/expedientes';
import { ACTIVE_ESCROW_ABI, ACTIVE_ESCROW_ADDRESS, TASK_STATUS, useMyTasks } from '@/hooks/useMyTasks';
import type { RealTask } from '@/hooks/useMyTasks';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import ResultDialog from '@/components/dashboard/ResultDialog';
import { useContractAction } from '@/hooks/useContractAction';
import type { ContractActionRequest } from '@/hooks/useContractAction';
import { shortAddress } from '@/hooks/useWallet';
import { EXPLORER_TX, activeChain, currencySymbol } from '@/contracts/config';
import type { Perspective } from './data';
import { formatMonEs } from './data';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const STATUS_META: Record<number, { label: string; className: string; pulse?: boolean }> = {
  [TASK_STATUS.Open]: { label: 'tasks.status.open', className: 'bg-honey-soft text-honey-deep' },
  [TASK_STATUS.Delivered]: { label: 'tasks.status.entregada', className: 'bg-olive/10 text-olive', pulse: true },
  [TASK_STATUS.Completed]: { label: 'tasks.status.completed', className: 'bg-olive/10 text-olive' },
  [TASK_STATUS.Disputed]: { label: 'tasks.status.disputa', className: 'bg-terra/10 text-terra' },
  [TASK_STATUS.Cancelled]: { label: 'tasks.status.cancelled', className: 'bg-sand text-ink-3' },
};

function StatusBadge({ status }: { status: number }) {
  const { t } = useTranslation();
  const meta = STATUS_META[status] ?? STATUS_META[TASK_STATUS.Open];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.75rem] font-medium',
        meta.className,
        meta.pulse && 'animate-pulse',
      )}
    >
      {status === TASK_STATUS.Disputed && <AlertTriangle size={12} />}
      {t(meta.label)}
    </span>
  );
}

/* ---------- Diálogos de acción ---------- */

type DialogKind = 'deliver' | 'approve' | 'dispute' | 'cancel' | 'autoRelease' | 'claim' | 'result';

interface ActionDialogState {
  kind: DialogKind;
  task: RealTask;
}

/** Vista de progreso/éxito de tx dentro de los diálogos. */
function TxProgress({
  action,
  onClose,
}: {
  action: ReturnType<typeof useContractAction>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (action.mined && action.txHash) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="font-display text-ink">{t('dashReal.txConfirmed')}</p>
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
        >
          {t('common.close')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
      <p className="text-[0.875rem] font-medium text-ink">
        {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
      </p>
      {action.txHash && (
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

function EmptyTab({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paper px-6 py-16 text-center">
      <Hexagon size={40} className="text-line" strokeWidth={1.25} />
      <p className="font-display text-[1.05rem] font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-[0.875rem] text-ink-2">{desc}</p>
    </div>
  );
}

export default function TasksSection({ perspective }: { perspective: Perspective }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { tasks, loading, error, refetch } = useMyTasks();
  const { agents } = usePanalAgents();
  const action = useContractAction({ onMined: refetch });

  const { data: autoReleaseSec } = useReadContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'AUTO_RELEASE',
    chainId: activeChain.id,
    query: { staleTime: 300_000, retry: 1 },
  });

  const [dialog, setDialog] = useState<ActionDialogState | null>(null);
  const [deliverText, setDeliverText] = useState('');
  const [rating, setRating] = useState(5);

  /**
   * Mi buzón, si es ahí donde recibo.
   *
   * Solo el buzón: un agente con servidor propio ya tiene el encargo —se lo
   * mandan a él— y no expone estas rutas, así que pedírselas sería un 404 y
   * mandarle la entrega, un texto que su servidor no conoce y no va a servir.
   */
  const perfil = useMyAgentProfile();
  const miBuzon = useMemo(() => {
    const url = extractBotUrl(perfil.agent?.metadataURI);
    return esBuzon(url) ? url : null;
  }, [perfil.agent?.metadataURI]);
  const { signMessageAsync } = useSignMessage();
  /** El encargo bajado del buzón para ESTA tarea, y en qué punto va. */
  const [encargo, setEncargo] = useState<
    { estado: 'pidiendo' | 'listo' | 'nada' | 'error'; texto?: string } | null
  >(null);
  /** Cómo va el envío de la entrega al buzón, que pasa ANTES de la firma. */
  const [envio, setEnvio] = useState<{ estado: 'yendo' | 'error'; detalle?: string } | null>(null);
  /** Lo que se adjunta a la entrega, ya leído y hasheado. */
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const inputArchivos = useRef<HTMLInputElement>(null);
  /**
   * La credencial de lectura del encargo: una firma abre el texto y sus
   * archivos.
   *
   * En estado y no en una ref porque de ella depende lo que se pinta: sin
   * firma no hay archivos que ofrecer, y sus botones salen apagados.
   */
  const [credEncargo, setCredEncargo] = useState<Credencial | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.workerAddress.toLowerCase(), a.name);
    return (addr: string) => map.get(addr.toLowerCase()) ?? shortAddress(addr);
  }, [agents]);

  const meLc = address?.toLowerCase();
  const mine = useMemo(
    () => tasks.filter((tk) => (perspective === 'proveedor' ? tk.role === 'worker' : tk.role === 'client')),
    [tasks, perspective],
  );
  const active = mine.filter((tk) => tk.status === TASK_STATUS.Open || tk.status === TASK_STATUS.Delivered);
  const completed = mine.filter((tk) => tk.status === TASK_STATUS.Completed || tk.status === TASK_STATUS.Cancelled);
  const disputed = mine.filter((tk) => tk.status === TASK_STATUS.Disputed);

  // Se refresca solo: calculado en el render se congelaba, y un plazo que
  // vencia mientras alguien miraba la pantalla seguia diciendo que quedaba rato.
  const nowSec = useAhora();

  /* ---------- Acciones por rol ---------- */

  const requestFor = (kind: DialogKind, task: RealTask, extra?: { text?: string; rating?: number }): ContractActionRequest => {
    const base = { address: ACTIVE_ESCROW_ADDRESS as Address, abi: ACTIVE_ESCROW_ABI };
    switch (kind) {
      case 'claim':
        return { ...base, functionName: 'claimTask', args: [task.id] };
      case 'deliver':
        return { ...base, functionName: 'deliverResult', args: [task.id, keccak256(toBytes(extra?.text ?? ''))] };
      case 'approve':
        return { ...base, functionName: 'approveAndRelease', args: [task.id, extra?.rating ?? 5] };
      case 'dispute':
        return { ...base, functionName: 'openDispute', args: [task.id] };
      case 'cancel':
        return { ...base, functionName: 'cancelTask', args: [task.id] };
      case 'autoRelease':
        return { ...base, functionName: 'autoRelease', args: [task.id] };
      case 'result':
        // "Ver resultado" no es una escritura on-chain: se resuelve con firma
        // EIP-191 + fetch al bot del agente (ResultDialog), nunca llega aquí.
        throw new Error('result no es una acción de contrato');
    }
  };

  const openDialog = (kind: DialogKind, task: RealTask) => {
    action.reset();
    setDeliverText('');
    setRating(5);
    setEncargo(null);
    setEnvio(null);
    setAdjuntos([]);
    setCredEncargo(null);
    setDialog({ kind, task });
  };

  const closeDialog = () => {
    setDialog(null);
    setEncargo(null);
    setEnvio(null);
    setAdjuntos([]);
    setCredEncargo(null);
    action.reset();
  };

  /**
   * Baja del buzón lo que le han pedido a este agente.
   *
   * Con un botón y no al abrir el diálogo: hay que firmar, y una ventana de la
   * wallet que salta sola por mirar una tarea es lo que enseña a la gente a
   * firmar sin leer. Es la misma decisión que en «ver resultado».
   */
  const pedirEncargo = async (task: RealTask) => {
    if (!miBuzon || !address) return;
    setEncargo({ estado: 'pidiendo' });
    try {
      const cred = await credencialDeEncargo(task.id, (mensaje) =>
        signMessageAsync({ message: mensaje }),
      );
      // Se guarda: la misma firma abre el texto y los archivos que traiga, y
      // una ventana de wallet por archivo sería una ventana de más cada vez.
      setCredEncargo(cred);
      /**
       * Primero mi buzón; si ahí no está, el del tablón.
       *
       * Un encargo que cogí del tablón se quedó donde esperaba —bajo la
       * dirección cero—, no en el mío: cuando su cliente lo publicó yo no era
       * nadie todavía. La firma es la misma para los dos, así que buscar en el
       * segundo no cuesta otra ventana de wallet.
       */
      const texto =
        (await leerEncargoDelBuzon(miBuzon, task.id, address, cred)) ??
        (await leerEncargoDelBuzon(urlDeBuzon(ZERO_ADDRESS), task.id, address, cred).catch(
          () => null,
        ));
      setEncargo(texto === null ? { estado: 'nada' } : { estado: 'listo', texto });
    } catch {
      setEncargo({ estado: 'error' });
    }
  };

  /** Baja un archivo que el cliente adjuntó, comprobando sus bytes. */
  const bajarAdjunto = async (task: RealTask, archivo: { name: string; size: number; hash: string; mime?: string }) => {
    if (!miBuzon || !address || !credEncargo) return;
    setBajando(archivo.name);
    try {
      const blob = await descargarArchivoDelBuzon(miBuzon, task.id, archivo, address, credEncargo);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = archivo.name;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error(t('tasks.buzon.archivoError', { name: archivo.name }));
    } finally {
      setBajando(null);
    }
  };

  /** Añade archivos a la entrega: se leen y se hashean antes de nada. */
  const anadirArchivos = async (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    const nuevos: Adjunto[] = [];
    for (const file of Array.from(lista)) {
      try {
        nuevos.push(await describirArchivo(file));
      } catch {
        toast.error(t('tasks.buzon.archivoNoVale', { name: file.name }));
      }
    }
    setAdjuntos((previos) => {
      const porHash = new Map(previos.map((a) => [a.hash, a]));
      for (const a of nuevos) if (!porHash.has(a.hash)) porHash.set(a.hash, a);
      const todos = [...porHash.values()];
      if (todos.length > MAX_ADJUNTOS) {
        toast.error(t('hire.attach.tooMany', { max: MAX_ADJUNTOS }));
        return todos.slice(0, MAX_ADJUNTOS);
      }
      return todos;
    });
  };

  /**
   * Entregar: primero al buzón, después a la cadena.
   *
   * Ese orden no es preferencia. Al revés, un fallo de red deja al cliente con
   * una entrega anclada que no puede descargar: el texto existiría solo en
   * este navegador. Así, si el envío falla no se firma nada y se puede
   * reintentar; y un texto en el buzón sin anclar no se le sirve a nadie.
   */
  const submitDialog = () => {
    if (!dialog) return;
    if (dialog.kind !== 'deliver' || !miBuzon || !address) {
      void action.run(requestFor(dialog.kind, dialog.task, { text: deliverText, rating }));
      return;
    }
    setEnvio({ estado: 'yendo' });
    void (async () => {
      let texto = deliverText;
      try {
        // UNA firma para toda la entrega: los archivos y el texto. Lleva la
        // caducidad dentro, así que reusarla no la alarga.
        const cred = await credencialDeEntrega(dialog.task.id, (mensaje) =>
          signMessageAsync({ message: mensaje }),
        );
        const entregados: DeliveredFile[] = [];
        for (const a of adjuntos) {
          const path = await subirArchivoDeEntrega(
            miBuzon,
            dialog.task.id,
            { name: a.name, bytes: a.bytes, mime: a.mime },
            address,
            cred,
          );
          entregados.push({
            name: a.name,
            size: a.size,
            hash: a.hash,
            ...(a.mime ? { mime: a.mime } : {}),
            path,
          });
        }
        // El manifiesto va DENTRO del texto que se ancla: por eso el hash de
        // cada archivo queda respaldado por la cadena y el cliente puede
        // comprobar los bytes que se baje.
        texto = appendFilesManifest(deliverText, entregados);
        await dejarEntregaEnBuzon(miBuzon, dialog.task.id, texto, address, cred);
      } catch (err) {
        setEnvio({
          estado: 'error',
          detalle: err instanceof Error ? err.message.split('\n')[0] : undefined,
        });
        return;
      }
      setEnvio(null);
      // Se ancla el texto CON el manifiesto, que es lo que se ha guardado.
      void action.run(requestFor('deliver', dialog.task, { text: texto }));
    })();
  };

  /** Botones de acción disponibles para una tarea (según rol y estado real). */
  const actionsFor = (task: RealTask) => {
    const out: { kind: DialogKind; label: string; className: string }[] = [];
    const workerZero = task.worker.toLowerCase() === ZERO_ADDRESS;
    if (task.role === 'worker') {
      if (task.status === TASK_STATUS.Open && workerZero) {
        out.push({ kind: 'claim', label: t('tasks.claim'), className: 'bg-honey text-[#1B1814] hover:bg-honey-deep' });
      }
      if (task.status === TASK_STATUS.Open && meLc && task.worker.toLowerCase() === meLc) {
        out.push({ kind: 'deliver', label: t('tasks.deliver'), className: 'bg-honey text-[#1B1814] hover:bg-honey-deep' });
      }
    } else {
      // «Ver resultado» EN CUANTO HAY ENTREGA, y ya para siempre.
      //
      // Antes solo salía mientras la tarea estuviera en Delivered, así que
      // aprobar —o sea, pagar— era justo lo que te dejaba sin forma de volver a
      // lo que acababas de comprar. El contenido no se iba a ninguna parte: el
      // bot del agente no mira el estado, solo la firma del cliente. Era la web
      // la que dejaba de ofrecerlo.
      if (hayEntrega(task.resultHash)) {
        out.push({ kind: 'result', label: t('tasks.viewResult'), className: 'border border-honey text-honey-deep hover:bg-honey-soft' });
      }
      if (task.status === TASK_STATUS.Delivered) {
        out.push({ kind: 'approve', label: t('tasks.approve'), className: 'bg-olive text-paper hover:opacity-85' });
        out.push({ kind: 'dispute', label: t('tasks.openDispute'), className: 'border border-terra/30 text-terra hover:bg-terra/10' });
        const canAuto =
          task.deliveredAt !== undefined &&
          autoReleaseSec !== undefined &&
          Number(task.deliveredAt) + Number(autoReleaseSec) <= nowSec;
        if (canAuto) {
          out.push({ kind: 'autoRelease', label: t('tasks.autoReleaseBtn'), className: 'border border-honey text-honey-deep hover:bg-honey-soft' });
        }
      }
      // El contrato solo permite cancelar si NO hay worker asignado o si ya
      // venció el deadline ("cannot cancel yet" en cualquier otro caso).
      if (task.status === TASK_STATUS.Open && (workerZero || nowSec > Number(task.deadline))) {
        out.push({ kind: 'cancel', label: t('tasks.cancelTask'), className: 'border border-line text-ink-2 hover:border-terra hover:text-terra' });
      }
    }
    return out;
  };

  const fmtDate = (ts: bigint) =>
    ts === 0n
      ? '—'
      : new Date(Number(ts) * 1000).toLocaleString(i18n.language, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const renderRows = (rows: RealTask[], withActions: boolean) =>
    rows.map((task, i) => {
      const counterparty = task.role === 'worker' ? task.client : task.worker;
      const counterpartyZero = counterparty.toLowerCase() === ZERO_ADDRESS;
      const acts = withActions ? actionsFor(task) : [];
      return (
        <motion.tr
          key={task.id.toString()}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
          className="border-b border-line last:border-0 hover:bg-cream/70"
        >
          <td className="whitespace-nowrap py-3.5 pl-3 pr-3 font-mono text-[0.8125rem] text-ink-2 sm:pl-5">
            #{task.id.toString()}
          </td>
          <td className="px-3 py-3.5">
            <span className="flex items-center gap-2">
              <HexAvatar seed={counterparty} size={32} />
              <span className="flex min-w-0 flex-col">
                <span className="max-w-[150px] truncate text-[0.875rem] font-medium text-ink">
                  {counterpartyZero ? t('tasks.unassigned') : nameOf(counterparty)}
                </span>
                {(() => {
                  const brief = getTaskBrief(task.taskHash);
                  return brief ? (
                    <span className="max-w-[130px] truncate text-[0.75rem] text-ink-3 sm:max-w-[190px]" title={brief}>
                      {brief}
                    </span>
                  ) : (
                    <span className="text-[0.75rem] italic text-ink-3/70">{t('tasks.briefMissing')}</span>
                  );
                })()}
              </span>
            </span>
          </td>
          <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[0.8125rem] text-ink">
            {formatMonEs(Number(formatEther(task.amountWei)))} {currencySymbol(task.currency)}
          </td>
          <td className="px-3 py-3.5"><StatusBadge status={task.status} /></td>
          <td className="hidden whitespace-nowrap px-3 py-3.5 font-mono text-[0.75rem] text-ink-3 sm:table-cell">
            {fmtDate(task.deadline)}
          </td>
          {withActions && (
            <td className="whitespace-nowrap py-3.5 pl-3 pr-5">
              <div className="flex items-center justify-end gap-1.5">
                {acts.length === 0 && <span className="font-mono text-[0.75rem] text-ink-3">—</span>}
                {acts.map((a) => (
                  <button
                    key={a.kind}
                    type="button"
                    onClick={() => openDialog(a.kind, task)}
                    className={cn('rounded-full px-3 py-1.5 text-[0.75rem] font-semibold transition-colors', a.className)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </td>
          )}
        </motion.tr>
      );
    });

  const tableHead = (withActions: boolean) => (
    <thead>
      <tr className="border-b border-line text-left">
        <th className="py-3 pl-3 pr-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3 sm:pl-5">ID</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colCounterparty')}</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colAmount')}</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colStatus')}</th>
        <th className="hidden px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3 sm:table-cell">{t('tasks.colDeadline')}</th>
        {withActions && (
          <th className="py-3 pl-3 pr-5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('ranking.colActions')}</th>
        )}
      </tr>
    </thead>
  );

  const renderTable = (rows: RealTask[], withActions: boolean) => (
    <div className="relative">
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
      <table className="w-full min-w-[560px] border-collapse sm:min-w-[640px]">
        {tableHead(withActions)}
        <tbody>{renderRows(rows, withActions)}</tbody>
      </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-paper to-transparent sm:hidden" aria-hidden />
    </div>
  );

  /* ---------- Estados de carga / error ---------- */
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-terra/40 bg-terra/5 px-6 py-14 text-center">
        <AlertTriangle size={28} className="text-terra" />
        <p className="text-[0.875rem] text-ink-2">{t('tasks.loadError')}</p>
        <button
          type="button"
          onClick={refetch}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          <RefreshCw size={13} /> {t('tasks.retry')}
        </button>
      </div>
    );
  }

  const dialogTitle = dialog
    ? t(`tasks.dialog.${dialog.kind}.title`, { id: `#${dialog.task.id.toString()}` })
    : '';
  const dialogDesc = dialog ? t(`tasks.dialog.${dialog.kind}.desc`) : '';
  const dialogConfirm = dialog ? t(`tasks.dialog.${dialog.kind}.confirm`) : '';

  return (
    <div>
      <Tabs defaultValue="activas">
        <TabsList className="h-auto max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-cream p-1">
          <TabsTrigger
            value="activas"
            className="shrink-0 rounded-full px-3 py-2 text-[0.75rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm sm:px-4 sm:text-[0.8125rem]"
          >
            {t('tasks.tabActive')}
            <span className="ml-1.5 rounded-full bg-honey-soft px-1.5 py-0.5 font-mono text-[0.6875rem] text-honey-deep">{active.length}</span>
          </TabsTrigger>
          <TabsTrigger
            value="completadas"
            className="shrink-0 rounded-full px-3 py-2 text-[0.75rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm sm:px-4 sm:text-[0.8125rem]"
          >
            {t('tasks.tabCompleted')}
            <span className="ml-1.5 rounded-full bg-sand px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">{completed.length}</span>
          </TabsTrigger>
          <TabsTrigger
            value="disputa"
            className="shrink-0 rounded-full px-3 py-2 text-[0.75rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm sm:px-4 sm:text-[0.8125rem]"
          >
            {t('tasks.tabDisputed')}
            {disputed.length > 0 && (
              <span className="ml-1.5 rounded-full bg-terra/15 px-1.5 py-0.5 font-mono text-[0.6875rem] text-terra">{disputed.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activas" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : active.length > 0 ? (
            renderTable(active, true)
          ) : (
            <EmptyTab title={t('tasks.noActive')} desc={t('tasks.noActiveDesc')} />
          )}
        </TabsContent>

        <TabsContent value="completadas" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : completed.length > 0 ? (
            renderTable(completed, true)
          ) : (
            <EmptyTab title={t('tasks.noCompleted')} desc={t('tasks.noCompletedDesc')} />
          )}
        </TabsContent>

        <TabsContent value="disputa" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : disputed.length > 0 ? (
            renderTable(disputed, true)
          ) : (
            <EmptyTab title={t('tasks.noDisputes')} desc={t('tasks.noDisputesDesc')} />
          )}
        </TabsContent>
      </Tabs>

      {/* Diálogo de acción (deliver / approve / confirmaciones) */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !action.busy && closeDialog()}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] overflow-y-auto border-line bg-paper sm:max-w-lg">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">{dialogTitle}</DialogTitle>
                <DialogDescription className="text-ink-2">{dialogDesc}</DialogDescription>
              </DialogHeader>

              {dialog.kind === 'result' ? (
                // `key`: el visor lee su copia guardada en el inicializador
                // del estado, así que tiene que remontarse al cambiar de tarea.
                <ResultDialog key={dialog.task.id.toString()} task={dialog.task} />
              ) : action.busy || action.txHash ? (
                <TxProgress action={action} onClose={closeDialog} />
              ) : (
                <div className="flex flex-col gap-4">
                  {(() => {
                    // La copia de este navegador si la hay —quien encargó fue
                    // quien la guardó—, y si no, la que se puede bajar del
                    // buzón firmando. Un trabajador nunca tiene la primera:
                    // el encargo se guardó en el navegador de su cliente.
                    const brief = getTaskBrief(dialog.task.taskHash) ?? encargo?.texto ?? null;
                    const puedeBajarlo =
                      !brief && !!miBuzon && dialog.task.role === 'worker' && encargo?.estado !== 'nada';
                    return (
                      <div className="rounded-xl border border-monad/30 bg-monad/5 p-4">
                        <p className="eyebrow mb-1.5 text-monad-mist">{t('tasks.briefLabel')}</p>
                        {brief ? (
                          <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">{brief}</p>
                        ) : (
                          <>
                            <p className="text-[0.8125rem] italic text-ink-3">
                              {encargo?.estado === 'nada'
                                ? t('tasks.buzon.encargoNoLlego')
                                : t('tasks.briefMissingLong')}
                            </p>
                            {puedeBajarlo && (
                              <button
                                type="button"
                                onClick={() => void pedirEncargo(dialog.task)}
                                disabled={encargo?.estado === 'pidiendo'}
                                className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50"
                              >
                                {encargo?.estado === 'pidiendo' && (
                                  <Loader2 size={13} className="animate-spin" aria-hidden />
                                )}
                                {t(
                                  encargo?.estado === 'pidiendo'
                                    ? 'tasks.buzon.bajando'
                                    : 'tasks.buzon.verEncargo',
                                )}
                              </button>
                            )}
                            {encargo?.estado === 'error' && (
                              <p className="mt-2 text-[0.75rem] text-terra">{t('tasks.buzon.encargoError')}</p>
                            )}
                          </>
                        )}
                        {/*
                          Lo que el cliente adjuntó. Sus hashes viajan DENTRO
                          del encargo, y el encargo cuadra con el `taskHash`
                          que se firmó al pagar: por eso al bajarlos se
                          comprueban los bytes, y por eso un archivo que no
                          cuadre no se guarda «avisando».
                        */}
                        {brief &&
                          miBuzon &&
                          dialog.task.role === 'worker' &&
                          parseAttachmentsManifest(brief).map((a) => (
                            <button
                              key={a.hash}
                              type="button"
                              onClick={() => void bajarAdjunto(dialog.task, a)}
                              disabled={bajando === a.name || !credEncargo}
                              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-left text-[0.8125rem] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50"
                            >
                              {bajando === a.name ? (
                                <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
                              ) : (
                                <Paperclip size={13} className="shrink-0" aria-hidden />
                              )}
                              <span className="min-w-0 flex-1 truncate">{a.name}</span>
                              <span className="shrink-0 font-mono text-[11px] text-ink-3">
                                {tamanoLegible(a.size)}
                              </span>
                            </button>
                          ))}
                      </div>
                    );
                  })()}
                  <div className="rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] text-ink-2">
                    {t('tasks.escrowAmount')}: {formatMonEs(Number(formatEther(dialog.task.amountWei)))} {currencySymbol(dialog.task.currency)}
                  </div>

                  {dialog.kind === 'deliver' && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={deliverText}
                        onChange={(e) => setDeliverText(e.target.value)}
                        rows={4}
                        placeholder={t('tasks.dialog.deliver.placeholder')}
                        className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                      />
                      {miBuzon && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              ref={inputArchivos}
                              type="file"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                void anadirArchivos(e.target.files);
                                e.target.value = '';
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => inputArchivos.current?.click()}
                              disabled={envio?.estado === 'yendo'}
                              className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50"
                            >
                              <Paperclip size={13} aria-hidden />
                              {t('tasks.buzon.adjuntar')}
                            </button>
                            {adjuntos.map((a) => (
                              <span
                                key={a.hash}
                                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-cream px-3 py-1.5 text-[0.8125rem] text-ink-2"
                              >
                                <span className="max-w-[12rem] truncate">{a.name}</span>
                                <span className="font-mono text-[11px] text-ink-3">
                                  {tamanoLegible(a.size)}
                                </span>
                                <button
                                  type="button"
                                  aria-label={t('tasks.buzon.quitar', { name: a.name })}
                                  onClick={() =>
                                    setAdjuntos((previos) => previos.filter((x) => x.hash !== a.hash))
                                  }
                                  className="text-ink-3 transition-colors hover:text-terra"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <p className="text-[0.75rem] leading-relaxed text-ink-3">
                            {t('tasks.buzon.entregaNota')}
                          </p>
                        </>
                      )}
                      {envio?.estado === 'yendo' && (
                        <p className="inline-flex items-center gap-2 text-[0.75rem] text-ink-2">
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                          {t('tasks.buzon.entregaYendo')}
                        </p>
                      )}
                      {envio?.estado === 'error' && (
                        <p className="text-[0.75rem] leading-relaxed text-terra">
                          {t('tasks.buzon.entregaError')}
                          {envio.detalle ? ` (${envio.detalle})` : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {dialog.kind === 'approve' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.8125rem] font-medium text-ink-2">{t('tasks.dialog.approve.ratingLabel')}</span>
                      <div className="flex gap-1" role="radiogroup" aria-label={t('tasks.dialog.approve.ratingLabel')}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={rating === n}
                            onClick={() => setRating(n)}
                            className="rounded-full p-1 transition-transform hover:scale-110"
                          >
                            <Star
                              size={26}
                              className={n <= rating ? 'fill-honey text-honey' : 'fill-sand text-sand'}
                              strokeWidth={0}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="flex-1 rounded-full border border-line px-4 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={submitDialog}
                      disabled={
                        (dialog.kind === 'deliver' && deliverText.trim().length === 0) ||
                        envio?.estado === 'yendo'
                      }
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-40',
                        dialog.kind === 'dispute' || dialog.kind === 'cancel'
                          ? 'border border-terra/50 bg-terra/10 text-terra transition-colors hover:bg-terra/20'
                          : 'btn-monad',
                      )}
                    >
                      {dialogConfirm}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
