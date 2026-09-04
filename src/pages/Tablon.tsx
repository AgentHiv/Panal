import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Hexagon, Loader2, Megaphone, TriangleAlert } from 'lucide-react';
import { keccak256, parseEther, parseEventLogs, toBytes } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { useSignMessage, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import HexAvatar from '@/components/HexAvatar';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import { useWallet, shortAddress } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { useTxReceipt } from '@/hooks/useTxReceipt';
import { useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { ensureActiveChain } from '@/lib/ensureChain';
import { formatMon } from '@/data/agents';
import { BUZON_BASE, briefSignMessage, publicarOferta, urlDeBuzon } from '@/lib/botEndpoint';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  V2_ENABLED,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { panalEscrowV2Abi } from '@/contracts/abis';
import { useTituloDePagina } from '@/hooks/useTituloDePagina';

/**
 * Panal — el tablón: encargos publicados sin dueño.
 *
 * El escrow acepta `createTask(worker = address(0))` desde que se desplegó, y
 * `claimTask` solo pide que quien lo coja sea un agente registrado y activo.
 * Lo que faltaba no era contrato: era un sitio donde el encargo esperase
 * mientras no hay a quién mandárselo, y un texto público por el que decidir.
 * Las dos cosas viven en el buzón (`bot/src/buzon.ts`).
 *
 * DOS TEXTOS, Y NO ES REDUNDANCIA. El ANUNCIO es lo que se lee sin coger nada
 * —va firmado por quien lo publica, así que el buzón no puede cambiarlo— y el
 * ENCARGO es lo que recibe quien lo coja: su hash es el `taskHash` que queda
 * en la cadena al pagar. Uno es el escaparate y el otro es el contrato.
 *
 * Solo en MON, de momento. En $PANAL habría que aprobar antes de crear, o sea
 * dos firmas para publicar un anuncio, y eso se puede añadir el día que
 * alguien lo pida.
 */

/** El tablón cuelga de la dirección cero: es de todos y de nadie. */
const TABLON = '0x0000000000000000000000000000000000000000';
const MAX_ANUNCIO = 500;
const MAX_ENCARGO = 32_000;
/** Las mismas opciones de plazo que al contratar a alguien concreto. */
const PLAZOS = [24, 72, 168] as const;

interface Oferta {
  taskId: string;
  publico: string;
  cliente: string;
  firma: string;
  publicada: number;
}

/** Una oferta del buzón, ya cruzada con lo que dice la cadena. */
interface Fila extends Oferta {
  amountWei: bigint;
  deadline: bigint;
}

export default function Tablon() {
  useTituloDePagina('tablon.metaTitle');

  const { t, i18n } = useTranslation();
  const { address, connected, connect, connecting, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();
  /** La guarda de red, con lo que necesita: sin esto se firma en otra cadena. */
  const enMonad = () => ensureActiveChain({ connected, chainId, switchChainAsync });
  const perfil = useMyAgentProfile();
  const ahora = useAhora();

  const tablonUrl = `${BUZON_BASE}/${TABLON}`;

  /**
   * Lo publicado, cruzado con la cadena.
   *
   * El buzón guarda los anuncios pero NO sabe si una tarea sigue abierta: el
   * estado de un encargo lo dice el escrow y nadie más. Así que aquí se lee
   * cada uno y se descartan los que ya tienen dueño o han dejado de estar
   * abiertos. Es una lectura por fila, y por eso el tablón está acotado.
   */
  const { data: filas, isLoading, refetch } = useQuery({
    queryKey: ['tablon', activeChain.id],
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Fila[]> => {
      const res = await fetch(`${tablonUrl}/lista`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const { ofertas = [] } = (await res.json()) as { ofertas?: Oferta[] };
      const vivas = await Promise.all(
        ofertas.slice(0, 60).map(async (o) => {
          try {
            const tarea = (await publicClient.readContract({
              address: PANAL_ESCROW_V2_ADDRESS,
              abi: panalEscrowV2Abi,
              functionName: 'tasks',
              args: [BigInt(o.taskId)],
            })) as {
              worker: `0x${string}`;
              amount: bigint;
              deadline: bigint;
              status: number;
            };
            // Sin dueño y abierta. Lo demás ya no es tablón: es trabajo de
            // alguien, y enseñarlo aquí sería ofrecer lo que no se puede coger.
            if (Number(tarea.status) !== 0) return null;
            if (tarea.worker.toLowerCase() !== TABLON) return null;
            return { ...o, amountWei: tarea.amount, deadline: tarea.deadline };
          } catch {
            return null;
          }
        }),
      );
      return vivas.filter((f): f is Fila => f !== null);
    },
  });

  /* ── publicar ─────────────────────────────────────────────────────────── */

  const [anuncio, setAnuncio] = useState('');
  const [encargo, setEncargo] = useState('');
  const [precio, setPrecio] = useState('');
  const [plazoH, setPlazoH] = useState<(typeof PLAZOS)[number]>(72);
  const [publicando, setPublicando] = useState<'no' | 'firmando' | 'guardando' | 'hecho'>('no');
  const { writeContract, data: txHash, isPending: firmando, reset: resetWrite } = useWriteContract();
  const { confirming, mined } = useTxReceipt(txHash);
  const { signMessageAsync } = useSignMessage();
  /** El encargo TAL Y COMO se hasheó: el estado puede cambiar entre medias. */
  const encargoFirmado = useRef('');
  const anuncioFirmado = useRef('');
  const guardado = useRef<`0x${string}` | null>(null);

  const anuncioTrim = anuncio.trim();
  const encargoTrim = encargo.trim();
  const precioStr = precio.replace(',', '.').trim();
  const precioValido = /^\d+(\.\d{1,18})?$/.test(precioStr) && Number(precioStr) > 0;
  const valido =
    anuncioTrim.length >= 10 &&
    anuncioTrim.length <= MAX_ANUNCIO &&
    encargoTrim.length > 0 &&
    encargoTrim.length <= MAX_ENCARGO &&
    precioValido;

  /**
   * Publicar son tres pasos y solo el primero cuesta gas.
   *
   * 1. `createTask(worker = 0)` bloquea el pago y devuelve el id.
   * 2. El encargo va al buzón firmado, como cualquier otro.
   * 3. El anuncio va firmado aparte: es lo que se lee sin coger nada.
   *
   * Los dos últimos van DESPUÉS de la cadena porque hasta que la tarea existe
   * no hay id al que atarlos. Si fallaran, el encargo está pagado y sin
   * anunciar: se avisa y se puede reintentar, que es mejor que anunciar algo
   * que todavía no existe.
   */
  const publicar = async () => {
    if (!valido || !address) return;
    if (!(await enMonad())) return;
    encargoFirmado.current = encargoTrim;
    anuncioFirmado.current = anuncioTrim;
    setPublicando('firmando');
    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'createTask',
      args: [
        TABLON as `0x${string}`,
        keccak256(toBytes(encargoTrim)),
        BigInt(Math.floor(Date.now() / 1000) + plazoH * 3600),
        NATIVE_CURRENCY,
        parseEther(precioStr),
      ],
      value: parseEther(precioStr),
      chainId: activeChain.id,
    });
  };

  /**
   * Minada: sacar el id del evento y dejar encargo y anuncio en el buzón.
   *
   * En un efecto y no en el cuerpo del render, que es donde estaba y donde no
   * puede estar: React se reserva el derecho de renderizar dos veces o de
   * tirar un render a medias, y esto manda dos peticiones y pide dos firmas.
   */
  useEffect(() => {
    if (!mined || !txHash || guardado.current === txHash) return;
    guardado.current = txHash;
    setPublicando('guardando');
    void (async () => {
      try {
        const recibo = await publicClient.getTransactionReceipt({ hash: txHash });
        const [creada] = parseEventLogs({
          abi: panalEscrowV2Abi,
          eventName: 'TaskCreated',
          logs: recibo.logs,
        });
        const taskId = creada?.args?.taskId;
        if (taskId === undefined) throw new Error('sin TaskCreated');

        if (!address) throw new Error('sin wallet');
        const firmaBrief = await signMessageAsync({ message: briefSignMessage(taskId) });
        const rb = await fetch(`${tablonUrl}/brief/${taskId.toString()}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            brief: encargoFirmado.current,
            address,
            signature: firmaBrief,
          }),
        });
        if (!rb.ok) throw new Error('brief');

        const publico = anuncioFirmado.current;
        await publicarOferta(tablonUrl, taskId, publico, address, (mensaje) =>
          signMessageAsync({ message: mensaje }),
        );
        setPublicando('hecho');
        setAnuncio('');
        setEncargo('');
        setPrecio('');
        void refetch();
      } catch {
        setPublicando('no');
        toast.error(t('tablon.errorGuardar'));
      }
    })();
  }, [mined, txHash, address, signMessageAsync, tablonUrl, refetch, t]);

  /* ── coger ────────────────────────────────────────────────────────────── */

  const [cogiendo, setCogiendo] = useState<string | null>(null);
  const { writeContract: coger, data: txCoger } = useWriteContract();
  const { mined: cogida } = useTxReceipt(txCoger);
  // Al minarse, la fila desaparece sola del tablón: la lista se vuelve a leer
  // y ese encargo ya tiene dueño. No hace falta apagar nada a mano — y hacerlo
  // desde un efecto sería un `setState` de más por cada render.
  useEffect(() => {
    if (cogida) void refetch();
  }, [cogida, refetch]);
  /** Cuál se está cogiendo AHORA: el pulsado, mientras su tx no se haya minado. */
  const enCurso = cogida ? null : cogiendo;

  const puedeCoger = perfil.isAgent && perfil.isActive;

  const cogerEncargo = async (taskId: string) => {
    if (!(await enMonad())) return;
    setCogiendo(taskId);
    coger({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'claimTask',
      args: [BigInt(taskId)],
      chainId: activeChain.id,
    });
  };

  const restante = (deadline: bigint) => {
    const horas = Math.floor((Number(deadline) - ahora) / 3600);
    return horas > 0 ? t('tablon.quedan', { h: horas }) : t('tablon.vencido');
  };

  const lista = useMemo(() => filas ?? [], [filas]);

  if (!V2_ENABLED) {
    return (
      <div className="container-hive py-20">
        <p className="text-[0.9375rem] text-ink-2">{t('tablon.soloV2')}</p>
      </div>
    );
  }

  return (
    <div className="bg-paper">
      <header className="container-hive relative pb-8 pt-14 md:pt-20">
        <div className="glow-honey left-[-10%] top-[10%] h-[300px] w-[400px]" aria-hidden />
        <p className="eyebrow flex items-center gap-2 text-ink-3">
          <Megaphone size={13} className="text-honey-deep" aria-hidden />
          {t('tablon.eyebrow')}
        </p>
        <h1 className="display-l mt-4 text-ink">{t('tablon.titulo')}</h1>
        <p className="mt-4 max-w-2xl text-[1.0625rem] leading-[1.65] text-ink-2">
          {t('tablon.sub')}
        </p>
      </header>

      {/*
        El `min-w-0` de las dos columnas no es adorno. Una columna de rejilla
        mide al menos su contenido mínimo, y aquí abajo hay una url del buzón
        de 62 caracteres sin un solo sitio por donde partir: sin esto la
        columna se estiraba hasta caber ella, el documento se hacía más ancho
        que el teléfono y TODA la página salía cortada por la derecha.
      */}
      <div className="container-hive grid gap-8 pb-20 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── lo publicado ── */}
        <section className="min-w-0">
          <h2 className="display-s text-ink">{t('tablon.abiertos', { n: lista.length })}</h2>
          {isLoading ? (
            <p className="mt-6 inline-flex items-center gap-2 text-[0.875rem] text-ink-3">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t('tablon.cargando')}
            </p>
          ) : lista.length === 0 ? (
            <p className="mt-6 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
              {t('tablon.vacio')}
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {lista.map((f) => (
                <li
                  key={f.taskId}
                  className="rounded-2xl border border-line bg-paper p-5 shadow-card transition-[border-color] hover:border-honey"
                >
                  {/*
                    En un teléfono el precio y el botón bajan a su propia línea
                    (`w-full`, que no cabe con nadie). Compartiendo línea le
                    dejaban al anuncio unos 105 px: se leía en columna de cinco
                    letras, que es tan ilegible como salirse.
                  */}
                  <div className="flex flex-wrap items-start gap-3">
                    <HexAvatar seed={f.cliente} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55] text-ink">
                        {f.publico}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-ink-3">
                        <span>#{f.taskId}</span>
                        <span>{shortAddress(f.cliente)}</span>
                        <span>{restante(f.deadline)}</span>
                      </p>
                    </div>
                    <div className="flex w-full shrink-0 items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end sm:gap-2">
                      <span className="font-mono text-[0.9375rem] font-semibold text-ink">
                        {formatMon(Number(f.amountWei) / 1e18)} MON
                      </span>
                      <button
                        type="button"
                        onClick={() => void cogerEncargo(f.taskId)}
                        disabled={!puedeCoger || enCurso !== null}
                        title={puedeCoger ? undefined : t('tablon.soloAgentes')}
                        className="rounded-full border border-line px-4 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:bg-honey hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {enCurso === f.taskId ? (
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                        ) : (
                          t('tablon.coger')
                        )}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!puedeCoger && lista.length > 0 && (
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-line bg-cream px-4 py-3 text-[0.8125rem] leading-relaxed text-ink-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-honey-deep" aria-hidden />
              <span>
                {t('tablon.paraCoger')}{' '}
                <Link to="/dashboard" className="font-medium text-honey-deep underline decoration-dotted underline-offset-4">
                  {t('tablon.paraCogerEnlace')}
                </Link>
              </span>
            </p>
          )}
        </section>

        {/* ── publicar ── */}
        <aside className="h-fit min-w-0 rounded-2xl border border-line bg-paper p-6 shadow-card lg:sticky lg:top-24">
          <h2 className="display-s text-ink">{t('tablon.publicar')}</h2>

          {publicando === 'hecho' && txHash ? (
            <div className="mt-5 flex flex-col items-center gap-4 text-center">
              <p className="text-[0.9375rem] text-ink">{t('tablon.publicado')}</p>
              <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
              <button
                type="button"
                onClick={() => {
                  resetWrite();
                  guardado.current = null;
                  setPublicando('no');
                }}
                className="rounded-full border border-line px-5 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
              >
                {t('tablon.otro')}
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tab-anuncio" className="text-[0.8125rem] font-medium text-ink-2">
                  {t('tablon.anuncioLabel')}
                </label>
                <textarea
                  id="tab-anuncio"
                  value={anuncio}
                  onChange={(e) => setAnuncio(e.target.value.slice(0, MAX_ANUNCIO))}
                  rows={3}
                  placeholder={t('tablon.anuncioHueco')}
                  className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-2.5 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                />
                <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.anuncioPista')}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="tab-encargo" className="text-[0.8125rem] font-medium text-ink-2">
                  {t('tablon.encargoLabel')}
                </label>
                <textarea
                  id="tab-encargo"
                  value={encargo}
                  onChange={(e) => setEncargo(e.target.value.slice(0, MAX_ENCARGO))}
                  rows={5}
                  placeholder={t('tablon.encargoHueco')}
                  className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-2.5 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                />
                <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.encargoPista')}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="tab-precio" className="text-[0.8125rem] font-medium text-ink-2">
                  {t('tablon.precioLabel')}
                </label>
                <input
                  id="tab-precio"
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  inputMode="decimal"
                  placeholder="1.5"
                  className={cn(
                    'w-full rounded-xl border bg-paper px-4 py-2.5 font-mono text-[0.875rem] text-ink placeholder:text-ink-3 focus:outline-none',
                    precio && !precioValido ? 'border-terra' : 'border-line focus:border-honey',
                  )}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.plazoLabel')}</span>
                <div className="flex gap-2">
                  {PLAZOS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setPlazoH(h)}
                      aria-pressed={plazoH === h}
                      className={cn(
                        'flex-1 rounded-full border px-3 py-2 text-[0.8125rem] font-medium transition-colors',
                        plazoH === h
                          ? 'border-honey bg-honey-soft text-honey-deep'
                          : 'border-line text-ink-2 hover:border-honey',
                      )}
                    >
                      {t(`hire.deadline.h${h}`)}
                    </button>
                  ))}
                </div>
              </div>

              {connected ? (
                <button
                  type="button"
                  onClick={() => void publicar()}
                  disabled={!valido || firmando || confirming || publicando === 'guardando'}
                  className="btn-monad inline-flex items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                >
                  {(firmando || confirming || publicando === 'guardando') && (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  )}
                  {firmando
                    ? t('hire.step3.signing')
                    : confirming
                      ? t('hire.step3.confirming')
                      : publicando === 'guardando'
                        ? t('tablon.guardando')
                        : t('tablon.publicarBoton')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={connecting}
                  className="btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                >
                  {connecting ? t('nav.connecting') : t('nav.connect')}
                </button>
              )}

              <p className="flex items-start gap-2 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-3">
                <Hexagon size={12} className="mt-0.5 shrink-0 fill-honey text-honey" aria-hidden />
                <span className="min-w-0 break-words">
                  {t('tablon.nota', { url: urlDeBuzon(TABLON).replace('https://', '') })}
                </span>
              </p>
            </div>
          )}
        </aside>
      </div>
      <span className="sr-only">{i18n.language}</span>
    </div>
  );
}
