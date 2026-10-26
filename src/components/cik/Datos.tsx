/**
 * Los datos exactos de un token, debajo del veredicto: de dónde salen los
 * números. Supply y dueño, el código, dónde está el supply, cada mercado con lo
 * que guarda y las 256 features que leyó la red. Todo leído en el momento de la
 * cadena (ver `datosDelToken`), salvo dos cosas que la cadena no sabe y se
 * piden fuera con su nombre: Sourcify y la curva de nad.fun.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Check, Loader2, Minus } from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import { EXPLORER_ADDRESS, publicClient } from '@/contracts/config';
import { SOURCIFY } from '@/contracts/cik';
import { corta, datosDelToken, PERMISOS, type Analisis, type DatosToken, type Mercado } from '@/lib/cik';
import { cn } from '@/lib/utils';
import { MapaFeatures } from './Graficas';

/**
 * Categorías del reparto del supply: cuatro con color propio (paleta
 * categórica validada sobre #121019, orden fijo) y «el resto» en gris, que no
 * es nadie en concreto.
 */
const REPARTO = [
  { clave: 'mercados', color: '#3987e5' },
  { clave: 'dueno', color: '#d95926' },
  { clave: 'quemado', color: '#199e70' },
  { clave: 'contrato', color: '#c98500' },
  { clave: 'resto', color: '#6b6684' },
] as const;

export default function DatosDelToken({ a }: { a: Analisis }) {
  const { t } = useTranslation();
  const [datos, setDatos] = useState<{ de: Address; d: DatosToken } | null>(null);
  const [fallo, setFallo] = useState<Address | null>(null);

  useEffect(() => {
    let vivo = true;
    datosDelToken(publicClient as never, a.direccion)
      .then((d) => vivo && setDatos({ de: a.direccion, d }))
      .catch(() => vivo && setFallo(a.direccion));
    return () => {
      vivo = false;
    };
  }, [a.direccion]);

  // Mientras llegan los de un token nuevo no se enseñan los del anterior.
  const d = datos?.de === a.direccion ? datos.d : null;
  if (fallo === a.direccion && !d) return <p className="mt-4 text-[0.875rem] text-terra">{t('cik.analizar.error')}</p>;

  return (
    <section className="mt-4" aria-busy={!d}>
      <h3 className="eyebrow text-ink-3">{t('cik.datos.title')}</h3>
      {!d ? (
        <p className="mt-3 flex items-center gap-2 text-[0.875rem] text-ink-3">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          {t('cik.datos.cargando')}
        </p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Ficha a={a} d={d} />
          <Reparto d={d} />
          <Mercados d={d} />
          <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
            <MapaFeatures features={d.features} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Cantidades de token legibles: «1.000 M», «615,5 M», «191,49». */
function useCantidad() {
  const { i18n } = useTranslation();
  return (v: bigint, decimales: number) => {
    const n = Number(formatUnits(v, decimales));
    return n.toLocaleString(i18n.language, { notation: n >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 2 });
  };
}

/** Del supply, qué parte es: «61,55 %»; por debajo de una centésima, «<0,01 %». */
function useParte() {
  const { i18n } = useTranslation();
  return (x: bigint, total: bigint | null) => {
    if (!total || total === 0n) return '—';
    const pct = Number((x * 1_000_000n) / total) / 10_000;
    if (x > 0n && pct < 0.01) return `<${(0.01).toLocaleString(i18n.language)} %`;
    return `${pct.toLocaleString(i18n.language, { maximumFractionDigits: 2 })} %`;
  };
}

/* ------------------------------------------------------------------ ficha */

function Ficha({ a, d }: { a: Analisis; d: DatosToken }) {
  const { t, i18n } = useTranslation();
  const cantidad = useCantidad();
  const inf = a.informe;
  const flags = inf?.riskFlags ?? 0;

  const fila = (etiqueta: string, valor: ReactNode) => (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 border-b border-line py-2 last:border-0">
      <dt className="text-ink-3">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-ink">{valor}</dd>
    </div>
  );
  const enlace = (href: string, texto: string, mono = true) => (
    <a href={href} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 hover:text-honey-deep', mono && 'font-mono')}>
      {texto}
      <ArrowUpRight size={11} aria-hidden />
    </a>
  );

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.datos.ficha')}</p>
      <dl className="mt-2 text-[0.8125rem]">
        {fila(
          t('cik.datos.supply'),
          d.supply === null || d.decimales === null ? '—' : `${cantidad(d.supply, d.decimales)} · ${t('cik.datos.decimales', { n: d.decimales })}`,
        )}
        {fila(
          t('cik.datos.dueno'),
          d.dueno.tipo === 'cuenta'
            ? enlace(EXPLORER_ADDRESS(d.dueno.direccion), corta(d.dueno.direccion))
            : t(`cik.datos.dueno_${d.dueno.tipo}`),
        )}
        {fila(
          t('cik.datos.codigo'),
          <>
            {t('cik.datos.bytes', { n: d.bytes.toLocaleString(i18n.language) })}
            {a.implementacion && <> · {t('cik.datos.proxyDe')} {enlace(EXPLORER_ADDRESS(a.implementacion), corta(a.implementacion))}</>}
          </>,
        )}
        {fila(
          t('cik.datos.fuente'),
          d.verificado === null ? '—' : d.verificado ? enlace(SOURCIFY(a.direccion), t('cik.datos.verificadoSi'), false) : t('cik.datos.verificadoNo'),
        )}
        {fila(t('cik.datos.huella'), <span className="font-mono text-[0.75rem]">{corta(d.codehash)}</span>)}
        {inf &&
          fila(
            t('cik.datos.simbolo'),
            <>
              {t('cik.datos.otrosConSimbolo', { n: inf.othersWithSymbol })}
              {inf.scamWord && ` · ${t('cik.res.senalEstafa')}`}
              {inf.nonAscii && ` · ${t('cik.res.senalNoAscii')}`}
            </>,
          )}
      </dl>

      <p className="mt-4 text-[0.8125rem] font-medium text-ink-2">{t('cik.datos.permisos')}</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.8125rem]">
        {PERMISOS.map((p) => {
          const tiene = (flags & p.bit) !== 0;
          return (
            <li key={p.clave} className={cn('flex items-center gap-1.5', tiene ? 'text-ink' : 'text-ink-3')}>
              {tiene ? <Check size={13} className="shrink-0 text-terra" aria-hidden /> : <Minus size={13} className="shrink-0" aria-hidden />}
              <span>{t(`cik.res.motivo.permiso.${p.clave}`)}</span>
              <span className="sr-only">{tiene ? t('cik.datos.encontrado') : t('cik.datos.noEncontrado')}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.datos.permisosPista')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ reparto */

/**
 * Dónde está el supply, en una barra apilada (100 % = el supply) con su
 * leyenda: cada categoría con su muestra, su porcentaje y su cantidad. Las
 * piezas van separadas por 2 px de fondo, no por un borde.
 */
function Reparto({ d }: { d: DatosToken }) {
  const { t } = useTranslation();
  const cantidad = useCantidad();
  const parte = useParte();
  if (!d.reparto || !d.supply) return null;
  const r = d.reparto;
  const total = d.supply;
  const dec = d.decimales ?? 18;

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.datos.reparto')}</p>
      <div className="mt-3 flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={t('cik.datos.reparto')}>
        {REPARTO.map((c) => {
          const v = r[c.clave];
          if (v === 0n) return null;
          const ancho = Number((v * 10_000n) / total) / 100;
          return (
            <span
              key={c.clave}
              title={`${t(`cik.datos.r_${c.clave}`)}: ${parte(v, total)}`}
              style={{ width: `${Math.max(ancho, 0.6)}%`, backgroundColor: c.color }}
            />
          );
        })}
      </div>
      <table className="mt-4 w-full text-[0.8125rem]">
        <tbody>
          {REPARTO.map((c) => (
            <tr key={c.clave} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2 text-ink-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: c.color }} aria-hidden />
                  {t(`cik.datos.r_${c.clave}`)}
                </span>
              </td>
              <td className="py-1.5 text-right font-mono text-ink">{parte(r[c.clave], total)}</td>
              <td className="hidden py-1.5 pl-3 text-right font-mono text-ink-3 sm:table-cell">{cantidad(r[c.clave], dec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.datos.repartoPista')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ mercados */

/**
 * Cada mercado con lo que guarda: la profundidad en WMON (barra de un solo
 * tono, a la escala del mayor), qué parte del supply tiene y, en el par V2,
 * cuánto LP está quemado. V4 no dice su WMON por pool y la curva de nad.fun lo
 * da su API: se dice en la fila.
 */
function Mercados({ d }: { d: DatosToken }) {
  const { t, i18n } = useTranslation();
  const parte = useParte();
  const maxWmon = d.mercados.reduce((m, x) => (x.wmon !== null && x.wmon > m ? x.wmon : m), 0n);
  const wmon = (v: bigint) =>
    Number(formatUnits(v, 18)).toLocaleString(i18n.language, { notation: 'compact', maximumFractionDigits: 2 });
  const nombre = (m: Mercado) =>
    m.tipo === 'v3'
      ? t('cik.datos.m_v3', { comision: ((m.comision ?? 0) / 10_000).toLocaleString(i18n.language) })
      : t(`cik.datos.m_${m.tipo}`);

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-card">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.datos.mercados')}</p>
      {d.mercados.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-ink-3">{t('cik.datos.sinMercados')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {d.mercados.map((m) => (
            <li key={`${m.tipo}-${m.direccion}`} className="text-[0.8125rem]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <a
                  href={EXPLORER_ADDRESS(m.direccion)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-ink-2 hover:text-honey-deep"
                >
                  {nombre(m)}
                  <ArrowUpRight size={11} aria-hidden />
                </a>
                <span className="font-mono text-ink">
                  {m.wmon === null ? '—' : `${wmon(m.wmon)} MON`}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-line" title={m.wmon === null ? undefined : `${wmon(m.wmon)} MON`}>
                {m.wmon !== null && maxWmon > 0n && (
                  <div
                    className="h-1.5 rounded-full bg-monad"
                    style={{ width: `${Math.max(Number((m.wmon * 10_000n) / maxWmon) / 100, m.wmon > 0n ? 1 : 0)}%` }}
                  />
                )}
              </div>
              <p className="mt-1 text-[0.75rem] text-ink-3">
                {t('cik.datos.guarda', { parte: parte(m.tokens, d.supply) })}
                {m.lpQuemadoBps !== undefined &&
                  ` · ${t('cik.datos.lpQuemado', { pct: (m.lpQuemadoBps / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 }) })}`}
                {m.tipo === 'v4' && ` · ${t('cik.datos.v4Pista')}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.datos.mercadosPista')}</p>
    </div>
  );
}
