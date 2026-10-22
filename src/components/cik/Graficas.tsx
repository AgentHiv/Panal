/**
 * Las gráficas del veredicto de cik: qué dijo, cómo lo decidió, qué vio la
 * sonda y de dónde sale el riesgo. Todo con datos que ya devolvió la cadena;
 * aquí no se calcula ningún veredicto, solo se dibuja.
 *
 * Reglas de color (dataviz): el estado —bien, aviso, peligro— va siempre con
 * icono y texto, nunca solo con el color; las magnitudes que no son estado (los
 * puntos de cada sumando del riesgo) van en un solo tono que no es de estado, el
 * morado de Monad. Contrastes medidos sobre el fondo #121019: oliva 6,8, miel
 * 8,0, terracota 4,9, morado 5,0 (3,4 sobre la pista).
 */

import { useTranslation } from 'react-i18next';
import { Check, CircleSlash, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react';
import type { ComponentType } from 'react';
import { CLASES, NIVELES, type Analisis, type Motivo, type Sonda } from '@/lib/cik';
import { cn } from '@/lib/utils';
import { porcentaje } from './comun';

type Estado = 'bien' | 'aviso' | 'peligro';

const ESTADO: Record<Estado, { texto: string; fondo: string; borde: string; Icono: ComponentType<{ size?: number; className?: string }> }> = {
  bien: { texto: 'text-olive', fondo: 'bg-olive', borde: 'border-olive/50', Icono: ShieldCheck },
  aviso: { texto: 'text-honey-deep', fondo: 'bg-honey', borde: 'border-honey/60', Icono: ShieldAlert },
  peligro: { texto: 'text-terra', fondo: 'bg-terra', borde: 'border-terra/60', Icono: ShieldX },
};

/** ok es bien, sospechoso es aviso, drainer y honeypot son peligro. */
function estadoDeClase(clase: number): Estado {
  return clase === 0 ? 'bien' : clase === 3 ? 'aviso' : 'peligro';
}

/** Bajo es bien, medio es aviso, alto y crítico son peligro (el texto los separa). */
function estadoDeNivel(nivel: number): Estado {
  return nivel === 0 ? 'bien' : nivel === 1 ? 'aviso' : 'peligro';
}

/* ------------------------------------------------------------------ veredicto */

/**
 * Los cuatro veredictos posibles, de menos a más grave, con el que salió
 * resaltado: se entiende qué podía haber dicho y dónde cayó.
 */
export function EscalaVeredicto({ clase }: { clase: number }) {
  const { t } = useTranslation();
  // Orden de gravedad, no el de `Ci`: ok, sospechoso, drainer, honeypot.
  const orden = [0, 3, 1, 2];
  return (
    <div role="list" aria-label={t('cik.graf.posibles')} className="flex flex-wrap gap-1.5">
      {orden.map((c) => {
        const activo = c === clase;
        const e = ESTADO[estadoDeClase(c)];
        return (
          <span
            key={c}
            role="listitem"
            aria-current={activo || undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.75rem] uppercase tracking-wide',
              activo ? cn(e.borde, 'bg-paper font-semibold text-ink') : 'border-line text-ink-3 opacity-60',
            )}
          >
            {activo && <e.Icono size={14} className={e.texto} aria-hidden />}
            {t(`cik.res.clase.${CLASES[c]}`)}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ cómo decidió */

/**
 * El orden en que decide `Ci`: la sonda, el registro de clones y la red. El paso
 * que decidió va resaltado; los de después no hizo falta mirarlos.
 */
export function CaminoDecision({ a }: { a: Analisis }) {
  const { t } = useTranslation();
  if (!a.fuente || !a.informe) return null;
  const inf = a.informe;
  const s = a.sonda;
  const orden = ['sonda', 'registro', 'modelo'] as const;
  const decidio = orden.indexOf(a.fuente);

  const resultado = (paso: (typeof orden)[number]): string => {
    if (paso === 'sonda') {
      if (!s?.hasPair) return t('cik.graf.sondaSinMercado');
      return a.sondaHoneypot ? t('cik.graf.sondaHoneypot') : t('cik.graf.sondaPasa');
    }
    if (paso === 'registro') {
      return inf.cloneHit
        ? t('cik.graf.registroSi', { clase: t(`cik.res.clase.${CLASES[inf.cloneClass] ?? 'ok'}`) })
        : t('cik.graf.registroNo');
    }
    return t('cik.graf.modeloDice', { clase: t(`cik.res.clase.${CLASES[inf.modelClass] ?? 'ok'}`) });
  };

  return (
    <div className="mt-5">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.graf.camino')}</p>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {orden.map((paso, i) => {
          const esEste = i === decidio;
          const despues = i > decidio;
          return (
            <li
              key={paso}
              className={cn(
                'relative rounded-xl border px-3 py-2.5',
                esEste ? 'border-honey bg-honey-soft/40' : 'border-line',
                despues && 'opacity-50',
              )}
            >
              <p className="flex items-center gap-1.5 text-[0.75rem] text-ink-3">
                <span className="font-mono">{i + 1}</span>
                {t(`cik.graf.paso.${paso}`)}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-snug text-ink">
                {despues ? t('cik.graf.noHizoFalta') : resultado(paso)}
              </p>
              {esEste && (
                <span className="mt-1.5 inline-flex rounded-full bg-honey px-2 py-0.5 text-[0.6875rem] font-semibold text-[#1B1814]">
                  {t('cik.graf.decidio')}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ sonda */

/**
 * La prueba de compra y venta en barras de 0 a 100 %: lo que llega al comprar,
 * lo que llega al vender y el viaje completo. La regla de la sonda es el viaje
 * completo: si vuelve menos de la mitad (o una de las dos falla), es honeypot.
 */
export function PruebaSonda({ s, honeypot }: { s: Sonda | null; honeypot: boolean | null }) {
  const { t } = useTranslation();
  if (!s) return null;
  const mercado = ['', 'Uniswap V2', 'Uniswap V3', 'Uniswap V4'][s.venue] ?? '';
  if (!s.hasPair) {
    return (
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.res.sonda')}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-ink-3">
          <CircleSlash size={14} aria-hidden />
          {t('cik.res.sondaSin')}
        </p>
      </div>
    );
  }
  const compra = s.bought ? s.buyKeptBps : 0;
  const venta = s.sold ? s.sellKeptBps : 0;
  const viaje = Math.floor((compra * venta) / 10_000);
  const filas = [
    { clave: 'compra', bps: compra, ok: s.bought },
    { clave: 'venta', bps: venta, ok: s.sold },
    { clave: 'viaje', bps: viaje, ok: honeypot === false },
  ] as const;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[0.8125rem] font-medium text-ink-2">
        {t('cik.res.sonda')}
        {mercado && ` · ${t('cik.res.sondaMercado', { mercado })}`}
      </p>
      <div className="mt-3 flex flex-col gap-2.5">
        {filas.map((f) => {
          const e = ESTADO[f.ok ? 'bien' : 'peligro'];
          const valor = porcentaje(f.bps);
          return (
            <div key={f.clave} title={`${t(`cik.graf.sonda.${f.clave}`)}: ${valor}`}>
              <div className="flex items-baseline justify-between gap-3 text-[0.75rem]">
                <span className={cn('text-ink-2', f.clave === 'viaje' && 'font-medium text-ink')}>
                  {t(`cik.graf.sonda.${f.clave}`)}
                </span>
                <span className="flex items-center gap-1 font-mono text-ink">
                  {f.ok ? <Check size={12} className="text-olive" aria-hidden /> : <X size={12} className="text-terra" aria-hidden />}
                  {valor}
                </span>
              </div>
              {/* Pista con la marca del 50 %: la línea que separa pasar de ser honeypot. */}
              <div className="relative mt-1 h-2 rounded-full bg-line">
                <div
                  className={cn('h-2 rounded-full', e.fondo)}
                  style={{ width: `${Math.max(f.bps / 100, f.bps > 0 ? 1.5 : 0)}%` }}
                />
                {f.clave === 'viaje' && (
                  <span className="absolute -top-1 bottom-[-4px] left-1/2 w-px bg-ink-3" aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-3">{t('cik.graf.sondaRegla')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ riesgo */

/**
 * El riesgo de 0 a 100 sobre sus cuatro tramos (bajo, medio, alto, crítico), con
 * la aguja donde cae. El color es el del estado y el texto lo nombra.
 */
export function MedidorRiesgo({ score, nivel }: { score: number; nivel: number }) {
  const { t } = useTranslation();
  const e = ESTADO[estadoDeNivel(nivel)];
  return (
    <div>
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-[2.25rem] font-medium leading-none text-ink">{score}</span>
        <span className="text-ink-3">/ 100</span>
        <span className={cn('ml-1 inline-flex items-center gap-1 text-[0.875rem] font-medium', e.texto)}>
          <e.Icono size={15} aria-hidden />
          {t(`cik.res.nivel.${NIVELES[nivel] ?? 'bajo'}`)}
        </span>
      </p>
      <div
        className="relative mt-3 h-2.5 rounded-full bg-line"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label={t('cik.res.riesgo')}
      >
        <div className={cn('h-2.5 rounded-full', e.fondo)} style={{ width: `${Math.max(score, 1.5)}%` }} />
        {[25, 50, 75].map((x) => (
          <span key={x} className="absolute inset-y-0 w-[2px] bg-paper" style={{ left: `${x}%` }} aria-hidden />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 text-[0.6875rem] text-ink-3">
        {NIVELES.map((n, i) => (
          <span key={n} className={cn(i === nivel && 'font-semibold text-ink-2')}>
            {t(`cik.res.nivel.${n}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * De dónde sale el número: una barra por sumando, en la misma escala de 0 a 100
 * que el medidor, con su valor al final. Un solo tono: son puntos, no estados.
 */
export function DesgloseRiesgo({ motivos, score }: { motivos: Motivo[]; score: number }) {
  const { t } = useTranslation();
  const suma = motivos.reduce((s, m) => s + m.puntos, 0);
  if (motivos.length === 0) return <p className="mt-4 text-[0.8125rem] text-ink-3">{t('cik.res.sinMotivos')}</p>;
  return (
    <div className="mt-5">
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.graf.deDonde')}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {motivos.map((m) => (
          <li key={m.clave} title={`${t(`cik.res.motivo.${m.clave}`)}: +${m.puntos}`}>
            <div className="flex items-baseline justify-between gap-3 text-[0.75rem]">
              <span className="text-ink-2">{t(`cik.res.motivo.${m.clave}`)}</span>
              <span className="shrink-0 font-mono text-ink">+{m.puntos}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-line">
              <div className="h-1.5 rounded-full bg-monad" style={{ width: `${m.puntos}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {suma > score && <p className="mt-2 text-[0.75rem] text-ink-3">{t('cik.graf.tope', { suma })}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ features */

/** Los tramos del vector de features, por posición: así se lee qué mira el modelo. */
const GRUPOS = [
  { clave: 'opcodes', desde: 0, hasta: 64 },
  { clave: 'selectores', desde: 64, hasta: 128 },
  { clave: 'exactos', desde: 128, hasta: 192 },
  { clave: 'banderas', desde: 192, hasta: 224 },
  { clave: 'estadisticas', desde: 224, hasta: 242 },
  { clave: 'nombre', desde: 242, hasta: 256 },
] as const;

/**
 * Las 256 features que lee la red, por tramos: una casilla por byte (0..127),
 * más oscura cuanto más alta. Una sola escala de un tono (morado): es magnitud.
 * El valor exacto de cada casilla sale al pasar por encima.
 */
export function MapaFeatures({ features }: { features: number[] }) {
  const { t } = useTranslation();
  if (features.length !== 256) return null;
  return (
    <div>
      <p className="text-[0.8125rem] font-medium text-ink-2">{t('cik.codigo.features')}</p>
      <p className="mt-1 text-[0.75rem] text-ink-3">{t('cik.codigo.featuresPista')}</p>
      <div className="mt-3 flex flex-col gap-3">
        {GRUPOS.map((g) => {
          const tramo = features.slice(g.desde, g.hasta);
          const activas = tramo.filter((v) => v > 0).length;
          return (
            <div key={g.clave}>
              <p className="mb-1 flex justify-between gap-3 font-mono text-[0.6875rem] text-ink-3">
                <span>
                  [{g.desde}..{g.hasta - 1}] {t(`cik.codigo.grupo.${g.clave}`)}
                </span>
                <span>{t('cik.graf.activas', { n: activas, total: tramo.length })}</span>
              </p>
              <div className="flex flex-wrap gap-[2px]">
                {tramo.map((v, i) => (
                  <span
                    key={i}
                    title={`[${g.desde + i}] = ${v}`}
                    className="h-3.5 w-3.5 rounded-[2px] border border-line"
                    style={{ backgroundColor: v ? `rgba(131, 110, 249, ${0.15 + (0.85 * v) / 127})` : 'transparent' }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
