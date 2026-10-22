/**
 * Atestiguar, retar y retirar en cik: las tres escrituras de `Ci`.
 *
 * Atestiguar deja un veredicto en la cadena con stake detrás; retar paga el
 * bond y `Ci` recalcula la verdad en la misma transacción; retirar devuelve el
 * stake cuando el veredicto es final. Las tres mueven MON de verdad, así que
 * antes de firmar se enseña qué se arriesga y cuánto gas reservará Monad, que
 * cobra el LÍMITE de gas: por eso el gas va siempre explícito (estimación +
 * 10 %), como en las retiradas del panel.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { parseEther, type Abi, type Address } from 'viem';
import { useContractAction } from '@/hooks/useContractAction';
import { useWallet } from '@/hooks/useWallet';
import { publicClient, EXPLORER_TX } from '@/contracts/config';
import { CIK, ciAbi } from '@/contracts/cik';
import { CLASES, corta, type Analisis, type Parametros } from '@/lib/cik';
import { esFaltaDeReserva, monHaciaArriba } from '@/lib/reservaDeGas';
import { cn } from '@/lib/utils';
import { BOTON_LINEA, BOTON_MIEL, CAMPO } from '@/components/tablon/util';
import { mon } from './comun';

type Accion = 'attest' | 'challenge' | 'withdraw';

interface Plan {
  accion: Accion;
  args: readonly unknown[];
  value: bigint;
  gas: bigint;
  /** gas × precio de ahora: lo que se pagará más o menos. */
  coste: bigint;
  /** gas × precio máximo + value: lo que Monad bloquea al enviar. */
  reserva: bigint;
  falta: bigint;
}

export default function Atestar({
  analisis,
  parametros,
  onCambio,
}: {
  analisis: Analisis | null;
  parametros: Parametros | null;
  /** Tras minarse una escritura: volver a leer el veredicto. */
  onCambio: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { connected, address, connect } = useWallet();
  const [clase, setClase] = useState<number | null>(null);
  const [stake, setStake] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useContractAction({
    onMined: () => {
      setPlan(null);
      onCambio();
    },
  });

  const reglas = parametros && (
    <ul className="mt-6 grid gap-3 text-[0.875rem] leading-relaxed text-ink-2 md:grid-cols-2">
      {(['r1', 'r2', 'r3', 'r4'] as const).map((r) => (
        <li key={r} className="rounded-xl border border-line bg-paper px-4 py-3">
          {t(`cik.atestar.${r}`, {
            stake: mon(parametros.minStake),
            bond: mon(parametros.challengeBond),
            ventana: Math.round(parametros.challengeWindow / 60),
          })}
        </li>
      ))}
    </ul>
  );

  const a = analisis?.esContrato ? analisis : null;
  const v = a?.atestacion ?? null;
  const verdad = a?.clase ?? null;
  const claseElegida = clase ?? verdad ?? 0;
  const yo = address?.toLowerCase();
  const soyAttestor = !!v && !!yo && v.attestor.toLowerCase() === yo;

  const preparar = async (accion: Accion) => {
    if (!a || !address || !parametros) return;
    setError(null);
    setPlan(null);
    let args: readonly unknown[];
    let value = 0n;
    if (accion === 'attest') {
      if (!a.evidencia) return;
      try {
        value = parseEther(((stake.trim() || mon(parametros.minStake)).replace(',', '.')) as `${number}`);
      } catch {
        setError(t('cik.politica.malNumero'));
        return;
      }
      if (value < parametros.minStake) {
        setError(t('cik.atestar.stakeMinimo', { stake: mon(parametros.minStake) }));
        return;
      }
      args = [a.direccion, claseElegida, a.evidencia];
    } else if (accion === 'challenge') {
      value = parametros.challengeBond;
      args = [a.direccion];
    } else {
      if (!a.clave) return;
      args = [a.clave];
    }
    setPreparando(true);
    try {
      const cuenta = address as Address;
      const [saldo, comisiones, precio] = await Promise.all([
        publicClient.getBalance({ address: cuenta }),
        publicClient.estimateFeesPerGas(),
        publicClient.getGasPrice(),
      ]);
      if (saldo < value) {
        setPlan({ accion, args, value, gas: 0n, coste: 0n, reserva: value, falta: value - saldo });
        return;
      }
      const estimado = await publicClient.estimateContractGas({
        address: CIK.ci,
        abi: ciAbi as Abi,
        functionName: accion,
        args: args as unknown[],
        value,
        account: cuenta,
      });
      const gas = (estimado * 11n + 9n) / 10n;
      const reserva = gas * comisiones.maxFeePerGas + value;
      setPlan({ accion, args, value, gas, coste: gas * precio, reserva, falta: reserva > saldo ? reserva - saldo : 0n });
    } catch (err) {
      if (esFaltaDeReserva(err)) {
        setError(t('cik.atestar.sinSaldo'));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        const motivo = /MetaChanged/.test(msg)
          ? t('cik.atestar.cambio')
          : (/(ActiveVerdict|NoVerdict|AlreadyChallenged|NotAttestor|NotFinal|BadBond|BadStake|BadClass|ProbeFailed)/.exec(msg)?.[1] ??
            msg.split('\n')[0]);
        setError(t('cik.atestar.sinEstimar', { motivo }));
      }
    } finally {
      setPreparando(false);
    }
  };

  const firmar = () => {
    if (!plan) return;
    void action.run({
      address: CIK.ci,
      abi: ciAbi,
      functionName: plan.accion,
      args: plan.args,
      value: plan.value || undefined,
      gas: plan.gas,
    });
  };

  const hora = (s: number) =>
    new Date(s * 1000).toLocaleString(i18n.language, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

  return (
    <section id="atestar" className="border-b border-line bg-cream py-20">
      <div className="container-hive">
        <h2 className="display-m text-ink">{t('cik.atestar.title')}</h2>
        <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">{t('cik.atestar.sub')}</p>
        {reglas}

        <div className="mt-8 rounded-2xl border border-line bg-paper p-6 shadow-card">
          {!a || !parametros ? (
            <p className="text-[0.875rem] text-ink-3">{t('cik.atestar.sinAnalisis')}</p>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-[0.9375rem] text-ink">
                {t('cik.atestar.objetivo', { nombre: a.nombre || corta(a.direccion) })}
                <span className="ml-2 font-mono text-[0.75rem] text-ink-3">{corta(a.direccion)}</span>
              </p>

              {!v ? (
                /* Sin veredicto: se puede atestiguar. */
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink-2">{t('cik.atestar.clase')}</span>
                    <div className="flex flex-wrap gap-2">
                      {CLASES.map((c, i) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={claseElegida === i}
                          onClick={() => {
                            setClase(i);
                            setPlan(null);
                          }}
                          className={cn(
                            'rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
                            claseElegida === i ? 'border-honey bg-honey-soft text-honey-deep' : 'border-line text-ink-2 hover:border-honey',
                          )}
                        >
                          {t(`cik.res.clase.${c}`)}
                        </button>
                      ))}
                    </div>
                    {verdad !== null && (
                      <p className={cn('text-[0.8125rem]', claseElegida === verdad ? 'text-ink-3' : 'text-terra')}>
                        {t('cik.atestar.claseVerdad', { clase: t(`cik.res.clase.${CLASES[verdad]}`) })}
                        {claseElegida !== verdad && ` ${t('cik.atestar.claseDistinta')}`}
                      </p>
                    )}
                  </div>
                  <label className="flex max-w-xs flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink-2">{t('cik.atestar.stake')}</span>
                    <input
                      value={stake}
                      onChange={(e) => {
                        setStake(e.target.value);
                        setPlan(null);
                      }}
                      placeholder={mon(parametros.minStake)}
                      inputMode="decimal"
                      className={cn(CAMPO, 'font-mono')}
                    />
                  </label>
                  <Boton
                    conectado={connected}
                    conectar={connect}
                    ocupado={preparando || action.busy}
                    onClick={() => void preparar('attest')}
                    texto={t('cik.atestar.botonAtestiguar')}
                    principal
                  />
                </div>
              ) : (
                /* Con veredicto: retar, o retirar si es tuyo y es final. */
                <div className="flex flex-col gap-4">
                  <p className="text-[0.875rem] leading-relaxed text-ink-2">
                    {t('cik.atestar.yaAtestiguado', {
                      clase: t(`cik.res.clase.${CLASES[v.classId] ?? 'ok'}`),
                      stake: mon(v.stake),
                    })}
                  </p>
                  {v.challenged ? (
                    <p className="text-[0.875rem] text-ink-3">{t('cik.atestar.yaRetado')}</p>
                  ) : (
                    <>
                      {verdad !== null && (
                        <p className={cn('text-[0.875rem] leading-relaxed', verdad !== v.classId ? 'text-olive' : 'text-ink-3')}>
                          {verdad !== v.classId
                            ? t('cik.atestar.retoGanaria', {
                                verdad: t(`cik.res.clase.${CLASES[verdad]}`),
                                premio: mon(v.stake - (v.stake * 2000n) / 10_000n),
                              })
                            : t('cik.atestar.retoPerderia')}
                        </p>
                      )}
                      <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('cik.atestar.retoNota')}</p>
                      <Boton
                        conectado={connected}
                        conectar={connect}
                        ocupado={preparando || action.busy}
                        onClick={() => void preparar('challenge')}
                        texto={t('cik.atestar.botonRetar', { bond: mon(parametros.challengeBond) })}
                      />
                    </>
                  )}
                  {soyAttestor && v.stake > 0n && (
                    <div className="flex flex-col gap-2 border-t border-line pt-4">
                      <p className="text-[0.875rem] text-ink-2">{t('cik.atestar.eresAttestor')}</p>
                      {v.final ? (
                        <Boton
                          conectado={connected}
                          conectar={connect}
                          ocupado={preparando || action.busy}
                          onClick={() => void preparar('withdraw')}
                          texto={t('cik.atestar.botonRetirar', { stake: mon(v.stake) })}
                          principal
                        />
                      ) : (
                        <p className="text-[0.8125rem] text-ink-3">
                          {t('cik.atestar.esperaFinal', { hora: hora(v.postedAt + parametros.challengeWindow) })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-[0.875rem] text-terra">{error}</p>}

              {plan && (
                <div className="flex flex-col gap-3 rounded-xl border border-honey/50 bg-honey-soft/40 p-4">
                  {plan.gas > 0n && (
                    <p className="text-[0.8125rem] leading-relaxed text-ink-2">
                      {t('cik.atestar.gas', { gas: monHaciaArriba(plan.coste), reserva: monHaciaArriba(plan.reserva) })}
                    </p>
                  )}
                  {plan.falta > 0n ? (
                    <p className="text-[0.8125rem] text-terra">{t('cik.atestar.falta', { falta: monHaciaArriba(plan.falta) })}</p>
                  ) : (
                    <button type="button" onClick={firmar} disabled={action.busy} className={cn(BOTON_MIEL, 'self-start px-5 py-2')}>
                      {action.busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
                      {t('cik.atestar.firmar', { value: mon(plan.value) })}
                    </button>
                  )}
                </div>
              )}

              {action.txHash && (
                <a
                  href={EXPLORER_TX(action.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[0.75rem] text-ink-3 hover:text-honey-deep"
                >
                  {action.mined ? t('dashReal.txConfirmed') : t('hire.step3.confirming')} · {corta(action.txHash)}
                  <ArrowUpRight size={12} aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Boton({
  conectado,
  conectar,
  ocupado,
  onClick,
  texto,
  principal = false,
}: {
  conectado: boolean;
  conectar: () => void;
  ocupado: boolean;
  onClick: () => void;
  texto: string;
  principal?: boolean;
}) {
  const { t } = useTranslation();
  if (!conectado) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[0.8125rem] text-ink-3">{t('cik.atestar.conecta')}</p>
        <button type="button" onClick={conectar} className={cn(BOTON_LINEA, 'px-5 py-2')}>
          {t('nav.connect')}
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={ocupado} className={cn(principal ? BOTON_MIEL : BOTON_LINEA, 'self-start px-5 py-2')}>
      {ocupado && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {texto}
    </button>
  );
}
