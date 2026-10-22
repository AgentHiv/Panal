/**
 * Analizar con cik: una dirección (veredicto en vivo, informe, sonda, riesgo y
 * atestación) o un bytecode suelto (verifyCode y sus 256 features).
 *
 * Todo es `eth_call`: no se firma nada y no hace falta wallet. El veredicto lo
 * da el contrato; aquí solo se pinta, y se dice de dónde sale cada número para
 * que quien mire pueda comprobarlo él mismo.
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Check, Copy, Loader2, Search } from 'lucide-react';
import type { Address } from 'viem';
import { publicClient, EXPLORER_ADDRESS } from '@/contracts/config';
import { CIK } from '@/contracts/cik';
import {
  analizar,
  analizarCodigo,
  checkEnNodo,
  CLASES,
  corta,
  motivosDeRiesgo,
  NODOS,
  type Analisis,
  type AnalisisCodigo,
  type Parametros,
  type RespuestaNodo,
} from '@/lib/cik';
import { cn } from '@/lib/utils';
import { BOTON_MIEL, CAMPO } from '@/components/tablon/util';
import { codigoPegado, direccionPegada, EJEMPLOS, mon, porcentaje, TONO_CLASE } from './comun';
import { CaminoDecision, DesgloseRiesgo, EscalaVeredicto, MedidorRiesgo, PruebaSonda } from './Graficas';

type Pestana = 'direccion' | 'codigo';

export default function Analizador({
  parametros,
  analisis,
  onAnalisis,
}: {
  parametros: Parametros | null;
  analisis: Analisis | null;
  onAnalisis: (a: Analisis | null) => void;
}) {
  const { t } = useTranslation();
  const [pestana, setPestana] = useState<Pestana>('direccion');

  return (
    <section id="analizar" className="border-b border-line bg-cream py-20">
      <div className="container-hive">
        <h2 className="display-m text-ink">{t('cik.analizar.title')}</h2>
        <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">{t('cik.analizar.sub')}</p>

        <div className="mt-8 inline-flex rounded-full border border-line bg-paper p-1" role="tablist">
          {(['direccion', 'codigo'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pestana === p}
              onClick={() => setPestana(p)}
              className={cn(
                'rounded-full px-4 py-1.5 text-[0.8125rem] font-medium transition-colors',
                pestana === p ? 'bg-honey-soft text-honey-deep' : 'text-ink-2 hover:text-ink',
              )}
            >
              {t(p === 'direccion' ? 'cik.analizar.tabDireccion' : 'cik.analizar.tabCodigo')}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {pestana === 'direccion' ? (
            <PorDireccion parametros={parametros} analisis={analisis} onAnalisis={onAnalisis} />
          ) : (
            <PorCodigo />
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ dirección */

function PorDireccion({
  parametros,
  analisis,
  onAnalisis,
}: {
  parametros: Parametros | null;
  analisis: Analisis | null;
  onAnalisis: (a: Analisis | null) => void;
}) {
  const { t } = useTranslation();
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lanzar = async (direccion: Address) => {
    setCargando(true);
    setError(null);
    try {
      const a = await analizar(publicClient as never, direccion);
      onAnalisis(a);
      if (!a.esContrato) setError(t('cik.analizar.noContrato'));
    } catch {
      onAnalisis(null);
      setError(t('cik.analizar.error'));
    } finally {
      setCargando(false);
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const d = direccionPegada(texto);
    if (!d) {
      setError(t('cik.analizar.malaDireccion'));
      return;
    }
    void lanzar(d);
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={enviar} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t('cik.analizar.hueco')}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('cik.analizar.hueco')}
          className={cn(CAMPO, 'font-mono')}
        />
        <button type="submit" disabled={cargando || !texto.trim()} className={cn(BOTON_MIEL, 'shrink-0 px-5 py-2.5')}>
          {cargando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          {cargando ? t('cik.analizar.analizando') : t('cik.analizar.boton')}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-3">
        <span>{t('cik.analizar.ejemplos')}</span>
        {EJEMPLOS.map((e) => (
          <button
            key={e.direccion}
            type="button"
            disabled={cargando}
            onClick={() => {
              setTexto(e.direccion);
              void lanzar(e.direccion);
            }}
            className="rounded-full border border-line bg-paper px-3 py-1 font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink disabled:opacity-40"
          >
            {e.nombre}
          </button>
        ))}
      </div>

      {error && <p className="text-[0.875rem] text-terra">{error}</p>}
      {analisis?.esContrato && <Resultado a={analisis} parametros={parametros} />}
    </div>
  );
}

function Resultado({ a, parametros }: { a: Analisis; parametros: Parametros | null }) {
  const { t } = useTranslation();
  const clase = a.clase === null ? null : CLASES[a.clase];
  const inf = a.informe;
  const motivos = inf && parametros ? motivosDeRiesgo(inf, parametros.minLiquidez, a.direccion) : [];
  const titulo = a.nombre || a.simbolo ? `${a.nombre}${a.simbolo && a.simbolo !== a.nombre ? ` · ${a.simbolo}` : ''}` : corta(a.direccion);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      {/* Veredicto */}
      <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
        <p className="eyebrow text-ink-3">{t('cik.res.veredicto')}</p>
        <p className="mt-2 break-words text-[1.125rem] font-semibold text-ink">{titulo}</p>
        <a
          href={EXPLORER_ADDRESS(a.direccion)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 break-all font-mono text-[0.75rem] text-ink-3 hover:text-honey-deep"
        >
          {a.direccion}
          <ArrowUpRight size={12} aria-hidden />
        </a>

        {clase && a.clase !== null ? (
          <div className="mt-5">
            <EscalaVeredicto clase={a.clase} />
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{t(`cik.res.claseDesc.${clase}`)}</p>
            <CaminoDecision a={a} />
          </div>
        ) : (
          <p className="mt-5 text-[0.875rem] text-terra">{t('cik.analizar.error')}</p>
        )}

        {a.implementacion && (
          <p className="mt-4 rounded-xl border border-line bg-cream px-4 py-3 text-[0.8125rem] leading-relaxed text-ink-2">
            {t('cik.res.proxy', { impl: corta(a.implementacion) })}
          </p>
        )}

        <PruebaSonda s={a.sonda} honeypot={a.sondaHoneypot} />
        <Atestacion a={a} parametros={parametros} />
        <Recalcula direccion={a.direccion} clase={a.clase} />
      </div>

      {/* Riesgo */}
      {inf && (
        <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
          <p className="eyebrow text-ink-3">{t('cik.res.riesgo')}</p>
          <div className="mt-2">
            <MedidorRiesgo score={inf.riskScore} nivel={inf.riskLevel} />
          </div>
          <DesgloseRiesgo motivos={motivos} score={inf.riskScore} />

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[0.8125rem]">
            <div>
              <dt className="text-ink-3">{t('cik.res.liquidez')}</dt>
              <dd className="mt-0.5 font-mono text-ink">{mon(inf.liquidity, 2)} MON</dd>
            </div>
            <div>
              <dt className="text-ink-3">{t('cik.res.lpQuemado')}</dt>
              <dd className="mt-0.5 font-mono text-ink">{porcentaje(inf.lpBurnedBps)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-3">{t('cik.res.nombre')}</dt>
              <dd className="mt-0.5 text-ink">
                {[inf.scamWord && t('cik.res.senalEstafa'), inf.nonAscii && t('cik.res.senalNoAscii')]
                  .filter(Boolean)
                  .join(' · ') || t('cik.res.senalNinguna')}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.res.concentracion')}</p>
        </div>
      )}
    </div>
  );
}

function Atestacion({ a, parametros }: { a: Analisis; parametros: Parametros | null }) {
  const { t, i18n } = useTranslation();
  const v = a.atestacion;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.res.atestacion')}</p>
      {!v ? (
        <p className="mt-1 text-[0.8125rem] text-ink-3">{t('cik.res.atestNinguna')}</p>
      ) : (
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">
          {t('cik.res.atestDe', {
            quien: corta(v.attestor),
            clase: t(`cik.res.clase.${CLASES[v.classId] ?? 'ok'}`),
            stake: mon(v.stake),
          })}{' '}
          ·{' '}
          {v.challenged
            ? t('cik.res.atestRetada')
            : v.final || !parametros
              ? t('cik.res.atestFinal')
              : t('cik.res.atestVentana', {
                  hora: new Date((v.postedAt + parametros.challengeWindow) * 1000).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
        </p>
      )}
    </div>
  );
}

function Recalcula({ direccion, clase }: { direccion: Address; clase: number | null }) {
  const { t } = useTranslation();
  const comando = `cast call ${CIK.ci} 'check(address)(uint8)' ${direccion} --rpc-url https://rpc.monad.xyz`;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.res.recalcula')}</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.res.recalculaTexto')}</p>
      <Copiable texto={comando} className="mt-2" />
      <EnOtroNodo direccion={direccion} clase={clase} />
    </div>
  );
}

/** Un bloque de código con su botón de copiar. */
function Copiable({ texto, className }: { texto: string; className?: string }) {
  const { t } = useTranslation();
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* portapapeles no disponible */
    }
  };
  return (
    <div className={cn('flex items-start gap-2 rounded-xl bg-ink px-3 py-2.5', className)}>
      <code className="min-w-0 flex-1 break-all font-mono text-[0.6875rem] leading-relaxed text-cream">{texto}</code>
      <button
        type="button"
        onClick={() => void copiar()}
        aria-label={t('cik.res.copiar')}
        className="shrink-0 text-cream/70 transition-colors hover:text-cream"
      >
        {copiado ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

/**
 * Lo mismo que el comando, sin terminal: el navegador le pregunta `check` a
 * otro nodo de Monad directamente, sin pasar por Panal, y se compara con el
 * veredicto de arriba. La petición y la respuesta se enseñan en crudo.
 */
function EnOtroNodo({ direccion, clase }: { direccion: Address; clase: number | null }) {
  const { t } = useTranslation();
  const [propio, setPropio] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [preguntando, setPreguntando] = useState<string | null>(null);
  const [r, setR] = useState<{ nodo: string; res: RespuestaNodo } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preguntar = async (url: string) => {
    let nodo: string;
    try {
      const u = new URL(url.trim());
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('protocolo');
      nodo = u.host;
    } catch {
      setError(t('cik.res.nodoMalo'));
      return;
    }
    setPreguntando(url);
    setError(null);
    setR(null);
    try {
      setR({ nodo, res: await checkEnNodo(url.trim(), direccion) });
    } catch {
      setError(t('cik.res.nodoFalla', { nodo }));
    } finally {
      setPreguntando(null);
    }
  };

  const boton =
    'inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[0.75rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink disabled:opacity-40';

  return (
    <div className="mt-4">
      <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('cik.res.enWeb')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {NODOS.map((n) => (
          <button key={n.url} type="button" disabled={!!preguntando} onClick={() => void preguntar(n.url)} className={boton}>
            {preguntando === n.url && <Loader2 size={12} className="animate-spin" aria-hidden />}
            {n.nombre}
          </button>
        ))}
        <button type="button" disabled={!!preguntando} onClick={() => setAbierto((v) => !v)} className={boton}>
          {t('cik.res.otroNodo')}
        </button>
      </div>

      {abierto && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void preguntar(propio);
          }}
          className="mt-2 flex gap-2"
        >
          <input
            value={propio}
            onChange={(e) => setPropio(e.target.value)}
            placeholder={t('cik.res.nodoHueco')}
            spellCheck={false}
            className={cn(CAMPO, 'py-1.5 font-mono text-[0.75rem]')}
          />
          <button type="submit" disabled={!!preguntando || !propio.trim()} className={cn(boton, 'shrink-0')}>
            {preguntando === propio && <Loader2 size={12} className="animate-spin" aria-hidden />}
            {t('cik.res.preguntar')}
          </button>
        </form>
      )}

      {error && <p className="mt-2 text-[0.75rem] leading-relaxed text-terra">{error}</p>}

      {r && (
        <div className="mt-3 rounded-xl border border-line px-3 py-2.5">
          <p className="text-[0.8125rem] text-ink">
            {t('cik.res.respondio', {
              nodo: r.nodo,
              ms: r.res.ms,
              clase: t(`cik.res.clase.${CLASES[r.res.clase] ?? 'ok'}`),
            })}
          </p>
          {clase !== null && (
            <p className={cn('mt-1 text-[0.75rem]', r.res.clase === clase ? 'text-olive' : 'text-terra')}>
              {r.res.clase === clase ? t('cik.res.coincide') : t('cik.res.noCoincide')}
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.75rem] text-ink-3 hover:text-ink-2">{t('cik.res.verPeticion')}</summary>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.res.peticionPista')}</p>
            <Copiable texto={r.res.peticion} className="mt-2" />
            <p className="mt-2 break-all font-mono text-[0.6875rem] text-ink-2">result: {r.res.resultado}</p>
          </details>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bytecode */

/** Los tramos del vector de features, por posición: así se lee qué mira el modelo. */
const GRUPOS = [
  { clave: 'opcodes', desde: 0, hasta: 64 },
  { clave: 'selectores', desde: 64, hasta: 128 },
  { clave: 'exactos', desde: 128, hasta: 192 },
  { clave: 'banderas', desde: 192, hasta: 224 },
  { clave: 'estadisticas', desde: 224, hasta: 242 },
  { clave: 'nombre', desde: 242, hasta: 256 },
] as const;

function PorCodigo() {
  const { t } = useTranslation();
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<AnalisisCodigo | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const c = codigoPegado(texto);
    if (!c) {
      setError(t('cik.codigo.malo'));
      return;
    }
    setCargando(true);
    setError(null);
    try {
      setR(await analizarCodigo(publicClient as never, c));
    } catch {
      setR(null);
      setError(t('cik.analizar.error'));
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-[0.875rem] leading-relaxed text-ink-2">{t('cik.codigo.sub')}</p>
      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          placeholder={t('cik.codigo.hueco')}
          spellCheck={false}
          aria-label={t('cik.codigo.hueco')}
          className={cn(CAMPO, 'resize-y break-all font-mono text-[0.75rem]')}
        />
        <button type="submit" disabled={cargando || !texto.trim()} className={cn(BOTON_MIEL, 'self-start px-5 py-2.5')}>
          {cargando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          {cargando ? t('cik.analizar.analizando') : t('cik.analizar.boton')}
        </button>
      </form>
      {error && <p className="text-[0.875rem] text-terra">{error}</p>}

      {r && (
        <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-[0.8125rem] text-ink-3">{t('cik.codigo.clase')}</p>
              <span
                className={cn(
                  'mt-1 inline-flex rounded-full border px-3 py-0.5 font-mono text-[0.875rem] font-semibold uppercase',
                  TONO_CLASE[CLASES[r.clase] ?? 'ok'],
                )}
              >
                {t(`cik.res.clase.${CLASES[r.clase] ?? 'ok'}`)}
              </span>
            </div>
            <div>
              <p className="text-[0.8125rem] text-ink-3">{t('cik.codigo.soloModelo')}</p>
              <span
                className={cn(
                  'mt-1 inline-flex rounded-full border px-3 py-0.5 font-mono text-[0.875rem] font-semibold uppercase',
                  TONO_CLASE[CLASES[r.soloModelo] ?? 'ok'],
                )}
              >
                {t(`cik.res.clase.${CLASES[r.soloModelo] ?? 'ok'}`)}
              </span>
            </div>
          </div>
          {r.enRegistro && <p className="mt-3 text-[0.8125rem] text-ink-2">{t('cik.codigo.enRegistro')}</p>}

          <p className="mt-6 text-[0.8125rem] font-medium text-ink-2">{t('cik.codigo.features')}</p>
          <p className="mt-1 text-[0.75rem] text-ink-3">{t('cik.codigo.featuresPista')}</p>
          <div className="mt-3 flex flex-col gap-3">
            {GRUPOS.map((g) => (
              <div key={g.clave}>
                <p className="mb-1 font-mono text-[0.6875rem] text-ink-3">
                  [{g.desde}..{g.hasta - 1}] {t(`cik.codigo.grupo.${g.clave}`)}
                </p>
                <div className="flex flex-wrap gap-[2px]">
                  {r.features.slice(g.desde, g.hasta).map((v, i) => (
                    <span
                      key={i}
                      title={`[${g.desde + i}] = ${v}`}
                      className="h-3.5 w-3.5 rounded-[2px] border border-line"
                      style={{ backgroundColor: v ? `rgba(131, 110, 249, ${0.15 + (0.85 * v) / 127})` : 'transparent' }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
