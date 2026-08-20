import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ExternalLink, Loader2, Paperclip, Timer, TriangleAlert, X } from 'lucide-react';
import { useSignMessage, useSwitchChain, useWriteContract } from 'wagmi';
import { keccak256, parseEventLogs, toBytes } from 'viem';
import { ensureActiveChain } from '@/lib/ensureChain';
import { saveTaskBrief } from '@/lib/taskBriefs';
import {
  briefSignMessage,
  buildBriefUrl,
  buildUploadUrl,
  enviarBriefConReintento,
  extractBotUrl,
  leerCapacidades,
} from '@/lib/botEndpoint';
import {
  MAX_ADJUNTOS,
  MAX_ADJUNTO_BYTES,
  appendAttachmentsManifest,
  describirArchivo,
  tamanoLegible,
  type Adjunto,
} from '@/lib/adjuntos';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import HexAvatar from '@/components/HexAvatar';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';
import { PROTOCOL_FEE, ESCROW_AUTO_RELEASE_H } from '@/data/protocol';
import { useTxReceipt } from '@/hooks/useTxReceipt';
import { useWallet } from '@/hooks/useWallet';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import {
  EXPLORER_TX,
  NATIVE_CURRENCY,
  PANAL_ESCROW_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  V2_ENABLED,
  activeChain,
  currencySymbol,
  publicClient,
} from '@/contracts/config';
import { panalEscrowAbi, panalEscrowV2Abi, panalRegistryAbi, panalRegistryV2Abi, panalTokenAbi } from '@/contracts/abis';

export interface HireDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EXAMPLE_CHIPS = ['hire.chip1', 'hire.chip2', 'hire.chip3', 'hire.chip4'];
const STEP_TITLES = ['hire.step1.title', 'hire.step2.title', 'hire.step3.title'];

/** Opciones de plazo del pedido (horas → i18n hire.deadline.*). */
const DEADLINE_OPTIONS = [6, 24, 72, 168] as const;

/**
 * Modal global "Contratar agente" — 3 pasos con stepper de hexágonos (marketplace.md S8).
 * El estado del wizard vive en HireWizard: Radix desmonta el contenido al cerrar,
 * así cada apertura empieza de cero. TODO es real: solo agentes on-chain y solo
 * con wallet conectada (fail-closed, sin sellado simulado).
 */
export default function HireDialog({ agent, open, onOpenChange }: HireDialogProps) {
  if (!agent) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto border-line bg-paper p-0 sm:rounded-2xl">
        <HireWizard agent={agent} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function HireWizard({ agent, onOpenChange }: { agent: Agent; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [taskText, setTaskText] = useState('');
  /** Plazo de la tarea en horas (deadline on-chain elegido por el cliente). */
  const [deadlineHours, setDeadlineHours] = useState(72);
  const [params, setParams] = useState('');
  /** Lo que el cliente adjunta. Sus hashes viajan DENTRO del encargo. */
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [adjuntosEstado, setAdjuntosEstado] = useState<'pendiente' | 'subiendo' | 'subidos' | 'fallo'>(
    'pendiente',
  );
  const inputArchivos = useRef<HTMLInputElement>(null);
  /**
   * ¿Este agente acepta archivos?
   *
   * Se pregunta a su tarjeta antes de ofrecer el clip. Un agente con la
   * plantilla anterior aceptaría el encargo igual —el manifiesto va dentro del
   * brief, así que el hash cuadra— y trabajaría sin la foto: entrega, ancla y
   * cobra, y el cliente no ve un solo error por ninguna parte.
   */
  const [aceptaAdjuntos, setAceptaAdjuntos] = useState<'comprobando' | 'si' | 'no'>('comprobando');
  const [topeAdjunto, setTopeAdjunto] = useState(MAX_ADJUNTO_BYTES);
  /**
   * El endpoint del agente, leído al abrir.
   *
   * Se guarda para no volver a leerlo justo después de pagar: esa lectura va
   * en el camino crítico del envío del brief, y si el RPC falla ahí el
   * encargo no llega con el pago ya bloqueado.
   */
  const botUrlRef = useRef<string | null>(null);
  /**
   * El encargo TAL Y COMO se hasheó al contratar.
   *
   * `componerBrief()` lo compone a partir del estado, y el estado puede haber
   * cambiado entre la firma y el envío. Hoy no hay forma de volver al paso 1
   * con la tarea ya creada, así que no puede pasar — pero lo que hay en juego
   * si algún día la hubiera es el pago del cliente, no un render feo, y una
   * copia congelada cuesta una línea.
   */
  const briefFirmado = useRef<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  /* ---------- contratación real (PanalEscrow) ---------- */
  const { connected, connecting, wrongNetwork, switchToMonad, chainId, connect, address } = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const onchain = isOnchainAgent(agent);
  /** Moneda del agente (v2): address(0) = MON, PANAL_TOKEN = $PANAL. */
  const agentCurrency = onchain ? agent.currency : NATIVE_CURRENCY;
  const isPanal = V2_ENABLED && agentCurrency.toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase();
  const symbol = currencySymbol(agentCurrency);
  const {
    writeContract,
    data: realTxHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { confirming, mined, reverted, receipt } = useTxReceipt(realTxHash);

  /* Paso approve previo (solo agentes en $PANAL): approve(escrowV2, price) */
  const [approvePhase, setApprovePhase] = useState<'idle' | 'approving' | 'approved'>('idle');
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: approveSigning,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const {
    confirming: approveConfirming,
    mined: approveMined,
    reverted: approveReverted,
  } = useTxReceipt(approveTxHash);

  // Se pregunta una vez, al abrir. El diálogo se desmonta al cerrarse, así que
  // volver a entrar vuelve a preguntar y un agente recién actualizado se nota
  // sin recargar la página.
  useEffect(() => {
    if (!isOnchainAgent(agent)) return;
    let vigente = true;
    void (async () => {
      try {
        const meta = (await publicClient.readContract({
          address: PANAL_REGISTRY_V2_ADDRESS,
          abi: panalRegistryV2Abi,
          functionName: 'getAgent',
          args: [agent.workerAddress],
        })) as { metadataURI?: string };
        const botUrl = extractBotUrl(meta.metadataURI);
        if (vigente) botUrlRef.current = botUrl;
        // Sin endpoint publicado no hay a quién subirle nada.
        const caps = botUrl ? await leerCapacidades(botUrl) : { adjuntos: false };
        if (!vigente) return;
        setAceptaAdjuntos(caps.adjuntos ? 'si' : 'no');
        if (caps.maxAdjuntoBytes) setTopeAdjunto(Math.min(caps.maxAdjuntoBytes, MAX_ADJUNTO_BYTES));
      } catch {
        // Falla cerrado, igual que `leerCapacidades`.
        if (vigente) setAceptaAdjuntos('no');
      }
    })();
    return () => {
      vigente = false;
    };
  }, [agent]);

  /**
   * El encargo, tal y como se va a hashear. Se compone AQUÍ y en ningún otro
   * sitio.
   *
   * Estaba escrito tres veces —al contratar en MON, al encadenar el createTask
   * del $PANAL y al mandárselo al agente— y las tres tenían que dar el mismo
   * texto carácter a carácter. Con adjuntos eso deja de ser una duda teórica:
   * si el manifiesto se compone distinto en cualquiera de ellas, el keccak256
   * cambia, el agente rechaza el encargo por no coincidir con el taskHash, y
   * el cliente se queda con el pago bloqueado hasta que venza el plazo.
   */
  const componerBrief = useCallback((): string => {
    const texto = taskText.trim() + (params.trim() ? '\n' + params.trim() : '');
    return appendAttachmentsManifest(texto, adjuntos);
  }, [taskText, params, adjuntos]);

  /**
   * Añade archivos: los lee, los hashea y los deja listos para anunciarse.
   *
   * El hash se calcula ahora, ANTES de pagar, porque es lo que hace que el
   * escrow cubra la foto. Un archivo elegido después de contratar ya no cabe
   * en el encargo: habría que cancelar y volver a empezar.
   */
  const anadirArchivos = useCallback(
    async (lista: FileList | null): Promise<void> => {
      if (!lista || lista.length === 0) return;
      const nuevos: Adjunto[] = [];
      for (const file of Array.from(lista)) {
        // El tope del AGENTE, que puede ser menor que el nuestro. Rechazarlo
        // aquí evita que se descubra subiendo, con el pago ya bloqueado.
        if (file.size > topeAdjunto) {
          toast.error(t('hire.attach.tooBig', { name: file.name, max: tamanoLegible(topeAdjunto) }));
          continue;
        }
        try {
          nuevos.push(await describirArchivo(file));
        } catch {
          toast.error(t('hire.attach.badName', { name: file.name }));
        }
      }
      setAdjuntos((previos) => {
        // Por hash: el mismo archivo elegido dos veces es un adjunto, no dos.
        const porHash = new Map(previos.map((a) => [a.hash, a]));
        for (const a of nuevos) if (!porHash.has(a.hash)) porHash.set(a.hash, a);
        const todos = [...porHash.values()];
        if (todos.length > MAX_ADJUNTOS) {
          toast.error(t('hire.attach.tooMany', { max: MAX_ADJUNTOS }));
          return todos.slice(0, MAX_ADJUNTOS);
        }
        return todos;
      });
    },
    [t, topeAdjunto],
  );

  const hireOnchain = async () => {
    if (!isOnchainAgent(agent)) return;
    // Guarda de red: verificar la chain REAL de la wallet (eth_chainId), no
    // solo el estado de wagmi, y re-verificar tras el cambio. Si no, la tx
    // falla con el error crudo de viem (chain de la wallet != chain objetivo).
    const chainOk = await ensureActiveChain({ connected, chainId, switchChainAsync });
    if (!chainOk) {
      toast(t('wallet.wrongChainToast'), {
        description: t('wallet.wrongChainToastDesc', { network: `${activeChain.name} · ${activeChain.id}` }),
      });
      return;
    }
    // Revalidar el precio on-chain justo antes de firmar: el agente puede
    // haberlo cambiado desde que se cargó la lista (protección económica).
    try {
      const fresh = (await publicClient.readContract({
        address: V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS,
        abi: V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi,
        functionName: 'getAgent',
        args: [agent.workerAddress],
      })) as { pricePerTask: bigint; currency?: string };
      if (fresh.pricePerTask !== agent.priceWei || (V2_ENABLED && fresh.currency !== undefined && fresh.currency.toLowerCase() !== agentCurrency.toLowerCase())) {
        toast.error(t('wallet.txError'));
        return;
      }
    } catch {
      // si el RPC falla, seguimos con el precio cacheado (misma fuente)
    }
    const brief = componerBrief();
    briefFirmado.current = brief;
    const taskHash = keccak256(toBytes(brief));
    saveTaskBrief(taskHash, brief); // caché local: el trabajador verá QUÉ se pidió
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);
    if (!V2_ENABLED) {
      // v1: createTask(worker, taskHash, deadline) con value = precio.
      writeContract({
        address: PANAL_ESCROW_ADDRESS,
        abi: panalEscrowAbi,
        functionName: 'createTask',
        args: [agent.workerAddress, taskHash, deadline],
        value: agent.priceWei,
        chainId: activeChain.id,
      });
    } else if (!isPanal) {
      // v2 MON: currency = address(0), amount == msg.value.
      writeContract({
        address: PANAL_ESCROW_V2_ADDRESS,
        abi: panalEscrowV2Abi,
        functionName: 'createTask',
        args: [agent.workerAddress, taskHash, deadline, NATIVE_CURRENCY, agent.priceWei],
        value: agent.priceWei,
        chainId: activeChain.id,
      });
    } else {
      // v2 $PANAL: primero approve(escrowV2, price); createTask se dispara
      // al minarse el approve (useEffect de abajo), con msg.value = 0.
      setApprovePhase('approving');
      writeApprove({
        address: PANAL_TOKEN_ADDRESS,
        abi: panalTokenAbi,
        functionName: 'approve',
        args: [PANAL_ESCROW_V2_ADDRESS, agent.priceWei],
        chainId: activeChain.id,
      });
    }
    setStep(2);
  };

  // Encadenar createTask tras el approve minado (flujo $PANAL).
  useEffect(() => {
    if (!isPanal || approvePhase !== 'approving' || !approveMined || !isOnchainAgent(agent)) return;
    // Deliberado, y no se toca: esto es la máquina de estados del flujo de
    // pago en $PANAL. El approve se ha minado y toca encadenar el createTask,
    // y la marca tiene que ponerse ANTES de firmar para que un segundo pase
    // del efecto no cree dos tareas. El aviso es por el render de más que
    // provoca; reordenarlo para ahorrarlo arriesga cobrar dos veces.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApprovePhase('approved');
    const brief = componerBrief();
    briefFirmado.current = brief;
    const taskHash = keccak256(toBytes(brief));
    saveTaskBrief(taskHash, brief); // caché local: el trabajador verá QUÉ se pidió
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);
    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'createTask',
      args: [agent.workerAddress, taskHash, deadline, PANAL_TOKEN_ADDRESS, agent.priceWei],
      value: 0n,
      chainId: activeChain.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveMined, approvePhase, isPanal]);

  /* Push del brief al bot del agente (entrega máquina-a-máquina, headless).
     Tras minarse createTask: si el agente publica "bot:<url>" en su metadata
     on-chain, firmamos "Panal brief #<taskId>" (EIP-191, sin gas) y hacemos
     POST /brief/:taskId. Si el envío no es posible (agente sin endpoint, bot
     offline, firma rechazada) avisamos con un toast: sin brief el bot solo
     puede entregar un resultado GENÉRICO. El brief también queda en
     localStorage y el operador puede cargarlo por Telegram como fallback. */
  const [briefEstado, setBriefEstado] = useState<'pendiente' | 'enviando' | 'enviado' | 'fallo'>('pendiente');

  /**
   * Sube los bytes de cada adjunto, uno a uno.
   *
   * Va DESPUÉS del brief y no puede ir antes: el agente sólo acepta lo que su
   * encargo anuncia, y hasta tener el encargo no sabe cuáles son.
   *
   * Si uno falla se sigue con los demás y se avisa al final. El agente no
   * empieza hasta tenerlos todos, así que los que sí subieron no se pierden:
   * quedan en su disco y un reintento sólo tiene que completar el resto.
   *
   * El nombre va percent-encoded porque una cabecera HTTP no admite caracteres
   * fuera de latin-1, y «recibo ñ.png» es un nombre perfectamente normal.
   */
  const subirAdjuntos = useCallback(
    async (botUrl: string, taskId: bigint, signature: string, quien: string): Promise<void> => {
      setAdjuntosEstado('subiendo');
      let fallos = 0;
      for (const a of adjuntos) {
        try {
          const res = await fetch(buildUploadUrl(botUrl, taskId), {
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              'x-panal-address': quien,
              'x-panal-signature': signature,
              'x-panal-filename': encodeURIComponent(a.name),
            },
            body: new Blob([a.bytes]),
          });
          if (!res.ok) {
            fallos += 1;
            console.warn(`[panal] el agente rechazó el adjunto "${a.name}" con ${res.status}`);
          }
        } catch (err) {
          fallos += 1;
          console.warn(
            `[panal] no se pudo subir "${a.name}": ${err instanceof Error ? err.message.split('\n')[0] : err}`,
          );
        }
      }
      if (fallos === 0) {
        setAdjuntosEstado('subidos');
        toast(t('hire.attach.uploaded', { n: adjuntos.length }));
      } else {
        setAdjuntosEstado('fallo');
        toast.warning(t('hire.attach.failed', { n: fallos }));
      }
    },
    [adjuntos, t],
  );

  const enviarBrief = useCallback(async (): Promise<void> => {
    if (!receipt || !address || !isOnchainAgent(agent)) return;
    setBriefEstado('enviando');
    try {
      // taskId del evento TaskCreated del receipt.
      const [created] = parseEventLogs({
        abi: panalEscrowV2Abi,
        eventName: 'TaskCreated',
        logs: receipt.logs,
      });
      const taskId = created?.args?.taskId;
      if (taskId === undefined) {
        // Sin id no hay a dónde mandar el brief. Antes se salía en silencio y
        // el cliente se quedaba mirando una pantalla de éxito sin saber que su
        // encargo no había llegado a ninguna parte.
        console.warn('[panal] el receipt no trae TaskCreated: no se puede saber el id de la tarea');
        setBriefEstado('fallo');
        toast.warning(t('hire.step3.briefFailed'));
        return;
      }
      // URL del bot del metadataURI on-chain del agente (token "bot:<url>").
      // Normalmente ya se leyó al abrir el diálogo; se relee sólo si aquella
      // lectura no llegó a completarse.
      const botUrl =
        botUrlRef.current ??
        extractBotUrl(
          (
            (await publicClient.readContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'getAgent',
              args: [agent.workerAddress],
            })) as { metadataURI?: string }
          ).metadataURI,
        );
      if (!botUrl) {
        console.warn('[panal] el agente no publica "bot:<url>" en su metadata; no se pudo enviar el brief');
        setBriefEstado('fallo');
        toast.warning(t('hire.step3.briefNoEndpoint'));
        return;
      }
      // El que se firmó, no el que compondría el estado de ahora.
      const brief = briefFirmado.current ?? componerBrief();
      const signature = await signMessageAsync({ message: briefSignMessage(taskId) });
      const res = await enviarBriefConReintento(buildBriefUrl(botUrl, taskId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, address, signature }),
      });
      if (res.ok) {
        setBriefEstado('enviado');
        toast(t('hire.step3.briefSent'));
        // Y ahora los bytes, que el agente ya sabe cuáles espera. Con la MISMA
        // firma: a quien acaba de pagar no se le pide nada más.
        if (adjuntos.length > 0) await subirAdjuntos(botUrl, taskId, signature, address);
      } else {
        console.warn(`[panal] POST brief al bot respondió ${res.status}; el brief sigue en local`);
        setBriefEstado('fallo');
        toast.warning(t('hire.step3.briefFailed'));
      }
    } catch (err) {
      console.warn(`[panal] no se pudo enviar el brief al bot: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      setBriefEstado('fallo');
      toast.warning(t('hire.step3.briefFailed'));
    }
  }, [receipt, address, agent, componerBrief, adjuntos.length, subirAdjuntos, signMessageAsync, t]);

  /* Push del brief al bot del agente (entrega máquina-a-máquina, headless).
     Tras minarse createTask: si el agente publica "bot:<url>" en su metadata
     on-chain, firmamos "Panal brief #<taskId>" (EIP-191, sin gas) y hacemos
     POST /brief/:taskId.

     El orden de las dos guardas importa y es la razón de este comentario: la
     marca de "ya intentado" NO puede ponerse antes de tener `address`. En el
     móvil, al volver del navegador de la wallet tras firmar la transacción, la
     cuenta tarda un instante en rehidratarse; si se marcara antes, ese hueco se
     comería el único intento y el brief no se enviaría nunca, sin un solo
     aviso. Por eso además existe el botón manual del paso 3: en el navegador de
     una wallet, una firma que no nace de un toque del usuario se ignora a
     menudo. */
  const briefPushedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mined || !receipt || !realTxHash) return;
    if (!V2_ENABLED || !address || !isOnchainAgent(agent)) return;
    if (briefPushedFor.current === realTxHash) return;
    briefPushedFor.current = realTxHash;
    void enviarBrief();
  }, [mined, receipt, realTxHash, address, agent, enviarBrief]);

  const price = agent.pricePerTask;
  const fee = price * PROTOCOL_FEE;
  // Lo que bloquea/firma el cliente es exactamente `price`; el fee del 2,5 %
  // se descuenta del pago al agente al liberar el escrow (ver contrato).
  const total = price;

  /* Fail-closed SIEMPRE (no hay flujo simulado en ninguna red):
     - agente no on-chain → aviso + enlace al mercado;
     - agente on-chain sin wallet conectada → pedir conexión.
     El wizard de pasos solo se alcanza con un agente on-chain y wallet. */
  if (!onchain) {
    return (
      <div className="px-7 pb-7 pt-6">
        <DialogTitle className="display-m text-ink">{t('hire.mainnetDemo.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('hire.desc', { name: agent.name })}</DialogDescription>
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-cream px-4 py-3">
            <HexAvatar seed={agent.wallet} size={40} />
            <div className="flex-1">
              <p className="text-[0.875rem] font-semibold text-ink">{agent.name}</p>
              <p className="font-mono text-[12px] text-ink-3">
                {t(symbol === '$PANAL' ? 'common.tokenPerTask' : 'common.monPerTask', {
                  price: formatMon(agent.pricePerTask),
                })}
              </p>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-xl border border-honey bg-honey-soft px-4 py-3 text-[0.8125rem] text-honey-deep">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            {t('hire.mainnetDemo.desc', { name: agent.name })}
          </p>
          <Link
            to="/mercado"
            onClick={() => onOpenChange(false)}
            className="btn-monad px-5 py-3 text-center text-[0.875rem] font-semibold"
          >
            {t('hire.mainnetDemo.cta')}
          </Link>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="px-7 pb-7 pt-6">
        <DialogTitle className="display-m text-ink">{t('hire.mainnetConnect.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('hire.desc', { name: agent.name })}</DialogDescription>
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-[0.875rem] text-ink-2">{t('hire.mainnetConnect.desc', { name: agent.name })}</p>
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
          >
            {connecting ? t('nav.connecting') : t('nav.connect')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-7 pb-7 pt-6">
          {/* Stepper de hexágonos */}
          <div className="mb-6 flex items-center gap-3" aria-label={t('hire.stepAria', { step: step + 1 })}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center transition-colors duration-300',
                    i < step
                      ? 'text-ink'
                      : i === step
                        ? 'text-ink'
                        : 'text-ink-3',
                  )}
                  style={{
                    clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)',
                    backgroundColor: i < step ? '#E29A2E' : i === step ? '#F2EFFA' : '#C8C3DC',
                  }}
                >
                  {i < step ? <Check size={14} strokeWidth={3} /> : <span className="font-mono text-[12px] font-semibold">{i + 1}</span>}
                </span>
                {i < 2 && (
                  <span className="relative h-px w-10 bg-line sm:w-16">
                    <span
                      className="absolute inset-y-0 left-0 bg-honey transition-all duration-500"
                      style={{ width: i < step ? '100%' : '0%' }}
                    />
                  </span>
                )}
              </div>
            ))}
            <span className="ml-2 font-mono text-[12px] text-ink-3">0{step + 1}/03</span>
          </div>

          <DialogTitle className="display-m text-ink">{t(STEP_TITLES[step])}</DialogTitle>
          <DialogDescription className="sr-only">{t('hire.desc', { name: agent.name })}</DialogDescription>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="mt-5"
            >
              {step === 0 && (
                <div className="flex flex-col gap-4">
                  {/* agente resumido */}
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-cream px-4 py-3">
                    <HexAvatar seed={agent.wallet} size={40} />
                    <div className="flex-1">
                      <p className="text-[0.875rem] font-semibold text-ink">{agent.name}</p>
                      <p className="font-mono text-[12px] text-ink-3">
                        {symbol === '$PANAL'
                          ? t('common.tokenPerTask', { price: formatMon(price) })
                          : t('common.monPerTask', { price: formatMon(price) })}
                      </p>
                    </div>
                  </div>
                  <textarea
                    value={taskText}
                    onChange={(e) => setTaskText(e.target.value)}
                    rows={4}
                    placeholder={t('hire.taskPlaceholder')}
                    className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setTaskText(t(chip))}
                        className="rounded-full bg-sand px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors hover:bg-honey-soft hover:text-honey-deep"
                      >
                        {t(chip)}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink-2">{t('hire.deadline.label')}</span>
                    <div className="grid grid-cols-4 gap-2">
                      {DEADLINE_OPTIONS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setDeadlineHours(h)}
                          className={cn(
                            'rounded-full border px-2 py-2 text-[0.75rem] font-medium transition-colors',
                            deadlineHours === h
                              ? 'border-honey bg-honey-soft text-honey-deep'
                              : 'border-line bg-transparent text-ink-2 hover:border-honey/50 hover:text-ink',
                          )}
                        >
                          {t(`hire.deadline.h${h}`)}
                        </button>
                      ))}
                    </div>
                    <span className="text-[0.6875rem] text-ink-3">{t('hire.deadline.hint')}</span>
                  </div>
                  <input
                    value={params}
                    onChange={(e) => setParams(e.target.value)}
                    placeholder={t('hire.paramsPlaceholder')}
                    className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  {/* Adjuntos. El hash de cada uno entra en el encargo ANTES de
                      pagar, así que el escrow los cubre igual que al texto: si
                      alguien cambiara el archivo por el camino, el agente lo
                      vería. Los bytes se suben después de contratar.

                      Sólo se enseña si el agente dice que sabe recibirlos. No
                      se avisa cuando no: hoy la mayoría de los agentes
                      registrados son anteriores a esto, y poner un cartel en
                      cada uno sería ruido en casi todas las fichas. Quien no
                      puede adjuntar sencillamente no ve la opción. */}
                  {aceptaAdjuntos === 'si' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[0.8125rem] font-medium text-ink-2">{t('hire.attach.label')}</span>
                        <button
                          type="button"
                          onClick={() => inputArchivos.current?.click()}
                          disabled={adjuntos.length >= MAX_ADJUNTOS}
                          className="flex items-center gap-1.5 rounded-full bg-sand px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors hover:bg-honey-soft hover:text-honey-deep disabled:opacity-40"
                        >
                          <Paperclip size={13} aria-hidden />
                          {t('hire.attach.add')}
                        </button>
                      </div>
                      <input
                        ref={inputArchivos}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void anadirArchivos(e.target.files);
                          // Se vacía para que volver a elegir el MISMO archivo
                          // dispare el change otra vez; si no, quitarlo y
                          // reañadirlo no funcionaría.
                          e.target.value = '';
                        }}
                      />
                      {adjuntos.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {adjuntos.map((a) => (
                            <li
                              key={a.hash}
                              className="flex items-center gap-2 rounded-lg border border-line bg-cream px-3 py-2"
                            >
                              <Paperclip size={13} className="shrink-0 text-ink-3" aria-hidden />
                              <span className="flex-1 truncate text-[0.8125rem] text-ink">{a.name}</span>
                              <span className="shrink-0 font-mono text-[11px] text-ink-3">{tamanoLegible(a.size)}</span>
                              <button
                                type="button"
                                onClick={() => setAdjuntos((prev) => prev.filter((x) => x.hash !== a.hash))}
                                aria-label={t('hire.attach.remove', { name: a.name })}
                                className="shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-sand hover:text-ink"
                              >
                                <X size={13} aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                    )}
                    <span className="text-[0.6875rem] text-ink-3">{t('hire.attach.hint')}</span>
                  </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    disabled={taskText.trim().length === 0}
                    className="mt-2 btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                  >
                    {t('common.continue')}
                  </button>
                </div>
              )}

              {step === 1 && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-cream px-5 py-4 font-mono text-[0.875rem]">
                    <div className="flex justify-between">
                      <span className="text-ink-2">{t('hire.step2.taskPrice')}</span>
                      <span className="text-ink">{price.toFixed(3)} {symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-2">{t('hire.step2.protocolFee')}</span>
                      <span className="text-ink">{formatMon(fee, 5)} {symbol}</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                      <span className="text-ink">{t('hire.step2.totalLock')}</span>
                      <span className="text-honey-deep">{formatMon(total, 5)} {symbol}</span>
                    </div>
                  </div>
                  <p className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
                    <Timer size={15} className="mt-0.5 shrink-0 text-honey-deep" />
                    {t('hire.step2.autoRelease', { hours: ESCROW_AUTO_RELEASE_H })}
                  </p>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[0.875rem] text-ink-2">
                    <Checkbox
                      checked={accepted}
                      onCheckedChange={(v) => setAccepted(v === true)}
                      className="border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
                    />
                    {t('hire.step2.accept')}
                  </label>
                  {onchain && connected && wrongNetwork ? (
                    <div className="mt-1 flex flex-col gap-3">
                      <p className="flex items-start gap-2 rounded-xl border border-honey bg-honey-soft px-4 py-3 text-[0.8125rem] text-honey-deep">
                        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                        {t('hire.step2.wrongNetwork')}
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setStep(0)}
                          className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                        >
                          {t('common.back')}
                        </button>
                        <button
                          type="button"
                          onClick={switchToMonad}
                          className="btn-monad inline-flex flex-1 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                        >
                          {t('nav.switchNetwork')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                      >
                        {t('common.back')}
                      </button>
                      <button
                        type="button"
                        onClick={hireOnchain}
                        disabled={!accepted || signing || approveSigning}
                        className="flex-1 rounded-full bg-honey px-5 py-3 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper disabled:opacity-40"
                      >
                        {isPanal
                          ? t('hire.step2.signLockToken', { price: formatMon(price) })
                          : t('hire.step2.signLock', { price: formatMon(price) })}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="relative flex flex-col items-center gap-5 py-2 text-center">
                  {approveError && approvePhase === 'approving' ? (
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-terra/10 text-terra">
                        <TriangleAlert size={28} />
                      </span>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.txFailed')}</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {approveError.message.includes('User rejected')
                            ? t('hire.step3.rejected')
                            : approveError.message.split("\n")[0]}
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                            resetApprove();
                            setApprovePhase('idle');
                            setStep(1);
                          }}
                          className="flex-1 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.retry')}
                        </button>
                      </div>
                    </>
                  ) : writeError ? (
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-terra/10 text-terra">
                        <TriangleAlert size={28} />
                      </span>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.txFailed')}</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {writeError.message.includes('User rejected')
                            ? t('hire.step3.rejected')
                            : writeError.message.split("\n")[0]}
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                            resetWrite();
                            setStep(1);
                          }}
                          className="flex-1 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.retry')}
                        </button>
                      </div>
                    </>
                  ) : reverted || approveReverted ? (
                    /* Minada pero revertida: gastó gas y no creó ninguna tarea.
                       Va ANTES de los dos spinners a propósito — `mined` ya no
                       se pondrá nunca a true, así que sin esta rama el diálogo
                       giraba para siempre sobre una contratación que no existe.
                       El recibo no dice por qué revirtió, así que no se inventa
                       un motivo: se dice qué pasó y se ofrece reintentar. */
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-terra/10 text-terra">
                        <TriangleAlert size={28} />
                      </span>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.txReverted')}</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {t('hire.step3.txRevertedDesc')}
                        </p>
                      </div>
                      {(realTxHash ?? approveTxHash) && (
                        <a
                          href={EXPLORER_TX((realTxHash ?? approveTxHash)!)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                        >
                          {t('hire.step3.viewTx')}
                          <ExternalLink size={13} />
                        </a>
                      )}
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                            resetWrite();
                            resetApprove();
                            setApprovePhase('idle');
                            setStep(1);
                          }}
                          className="flex-1 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.retry')}
                        </button>
                      </div>
                    </>
                  ) : approvePhase === 'approving' ? (
                    <>
                      {/* Paso 1/2 del flujo $PANAL: approve(escrow, precio) */}
                      <Loader2 size={40} className="animate-spin text-honey-deep" aria-hidden />
                      <div>
                        <p className="display-m text-ink">{t('hire.approve.title')}</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {!approveTxHash ? t('hire.approve.signing') : t('hire.approve.confirming')}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-ink-3">{t('hire.approve.desc')}</p>
                      </div>
                      {approveTxHash && (
                        <a
                          href={EXPLORER_TX(approveTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                        >
                          {t('hire.step3.viewTx')}
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {approveConfirming && <p className="font-mono text-[11px] text-ink-3">{t('hire.step3.oneConfirm')}</p>}
                    </>
                  ) : !mined ? (
                    <>
                      <Loader2 size={40} className="animate-spin text-honey-deep" aria-hidden />
                      <div>
                        {isPanal && <p className="mb-1 font-mono text-[11px] text-olive">{t('hire.approve.done')}</p>}
                        <p className="display-m text-ink">
                          {!realTxHash ? t('hire.step3.signing') : t('hire.step3.confirming')}
                        </p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {!realTxHash ? t('hire.step3.signingHint') : t('hire.step3.confirmingHint')}
                        </p>
                      </div>
                      {realTxHash && (
                        <a
                          href={EXPLORER_TX(realTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                        >
                          {t('hire.step3.viewTx')}
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {confirming && <p className="font-mono text-[11px] text-ink-3">{t('hire.step3.oneConfirm')}</p>}
                    </>
                  ) : (
                    <>
                      {/* hexágono sellado (éxito real) */}
                      <div className="relative">
                        <svg viewBox="0 0 96 96" className="h-24 w-24">
                          <motion.polygon
                            points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
                            fill="#F2EFFA"
                            stroke="#E29A2E"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                            initial={{ pathLength: 0, fillOpacity: 0 }}
                            animate={{ pathLength: 1, fillOpacity: 1 }}
                            transition={{ pathLength: { duration: 0.9, ease: 'easeInOut' }, fillOpacity: { duration: 0.5, delay: 0.5 } }}
                          />
                          <motion.g
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.75, type: 'spring', stiffness: 300, damping: 16 }}
                            style={{ transformOrigin: '48px 48px' }}
                          >
                            <circle cx="48" cy="48" r="15" fill="#6E7B4E" />
                            <path d="M41 48.5l5 5 9-10" stroke="#F2EFFA" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </motion.g>
                        </svg>
                      </div>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.sealed')}</p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {isPanal
                            ? t('hire.step3.sealedDescRealToken', { name: agent.name, price: formatMon(price) })
                            : t('hire.step3.sealedDescReal', { name: agent.name, price: formatMon(price) })}
                        </p>
                      </div>
                      {realTxHash && <TxHash hash={realTxHash} className="rounded-full border border-line bg-cream px-4 py-2" />}
                      {/* Envío manual del brief. Visible hasta que conste enviado:
                          en el navegador de una wallet el envío automático se
                          pierde a menudo, y sin brief el agente entrega genérico. */}
                      {adjuntos.length > 0 && briefEstado === 'enviado' && adjuntosEstado !== 'pendiente' && (
                        <p className="text-[0.8125rem] text-ink-2">
                          {adjuntosEstado === 'subiendo'
                            ? t('hire.attach.uploading', { n: adjuntos.length })
                            : adjuntosEstado === 'subidos'
                              ? t('hire.attach.uploaded', { n: adjuntos.length })
                              : t('hire.attach.failed', { n: adjuntos.length })}
                        </p>
                      )}
                      {(briefEstado !== 'enviado' || adjuntosEstado === 'fallo') && (
                        <button
                          type="button"
                          disabled={briefEstado === 'enviando' || adjuntosEstado === 'subiendo'}
                          onClick={() => void enviarBrief()}
                          className="btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                        >
                          {briefEstado === 'enviando' || adjuntosEstado === 'subiendo'
                            ? t('hire.step3.sendingBrief')
                            : briefEstado === 'fallo' || adjuntosEstado === 'fallo'
                              ? t('hire.step3.retryBrief')
                              : t('hire.step3.sendBrief')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // Con el manifiesto dentro: la página de reenvío del
                          // agente comprueba keccak256(brief) contra el
                          // taskHash, y un texto sin adjuntos ya no cuadraría.
                          void navigator.clipboard.writeText(componerBrief());
                          toast(t('hire.step3.briefCopied'));
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-monad/40 bg-monad/10 px-4 py-2 text-[0.8125rem] font-medium text-monad-mist transition-colors hover:border-monad"
                      >
                        {t('hire.step3.copyBrief')}
                      </button>
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <Link
                          to="/dashboard"
                          onClick={() => onOpenChange(false)}
                          className="flex-1 btn-monad px-5 py-3 text-center text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.viewDashboard')}
                        </Link>
                        {realTxHash && (
                          <a
                            href={EXPLORER_TX(realTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                          >
                            {t('hire.step3.viewExplorer')}
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
    </div>
  );
}
