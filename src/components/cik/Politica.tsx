/**
 * Probar una política de CiGuardV2: el contrato que un DEX, un launchpad o un
 * vault despliega con sus umbrales para rechazar tokens.
 *
 * No se despliega nada. Se ejecuta el bytecode de creación con la política como
 * argumentos en un `eth_call` (ver `probarPolitica`), así que el resultado es
 * el del contrato de verdad, no una imitación de sus reglas.
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { parseEther, type Address } from 'viem';
import { publicClient } from '@/contracts/config';
import { NIVELES, POLITICA_INICIAL, probarPolitica, type Analisis, type Politica as PoliticaGuard, type ResultadoGuard } from '@/lib/cik';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { BOTON_MIEL, CAMPO } from '@/components/tablon/util';
import { direccionPegada } from './comun';

const MAX_HOLDERS = 100;

export default function Politica({ analisis }: { analisis: Analisis | null }) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [p, setP] = useState<PoliticaGuard>(POLITICA_INICIAL);
  const [minLiq, setMinLiq] = useState('0');
  const [top1, setTop1] = useState('100');
  const [top10, setTop10] = useState('100');
  const [holders, setHolders] = useState('');
  const [sonda, setSonda] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<ResultadoGuard | null>(null);

  // El token que se acaba de analizar arriba entra solo: es lo que se quiere
  // probar. Se ajusta al renderizar, cuando cambia, y no en un efecto: así no
  // hay un render de más con el token viejo.
  const [visto, setVisto] = useState<string | null>(null);
  if (analisis?.esContrato && analisis.direccion !== visto) {
    setVisto(analisis.direccion);
    setToken(analisis.direccion);
    setR(null);
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setR(null);
    const dir = direccionPegada(token);
    if (!dir) {
      setError(t('cik.analizar.malaDireccion'));
      return;
    }
    const lineas = holders.split(/[\s,;]+/).filter(Boolean);
    if (lineas.length > MAX_HOLDERS) {
      setError(t('cik.politica.demasiados', { n: MAX_HOLDERS }));
      return;
    }
    const lista = lineas.map(direccionPegada);
    if (lista.some((h) => h === null)) {
      setError(t('cik.politica.malHolders'));
      return;
    }
    let politica: PoliticaGuard;
    try {
      const bps = (v: string) => Math.round(Math.min(100, Math.max(0, Number(v.replace(',', '.')))) * 100);
      politica = {
        ...p,
        minLiquidity: parseEther((minLiq.trim() || '0').replace(',', '.') as `${number}`),
        maxTop1Bps: bps(top1),
        maxTop10Bps: bps(top10),
      };
      if (Number.isNaN(politica.maxTop1Bps) || Number.isNaN(politica.maxTop10Bps)) throw new Error('bps');
    } catch {
      setError(t('cik.politica.malNumero'));
      return;
    }
    setCargando(true);
    try {
      setR(await probarPolitica(publicClient as never, politica, dir, lista as Address[], sonda));
    } catch {
      setError(t('cik.analizar.error'));
    } finally {
      setCargando(false);
    }
  };

  const etiqueta = 'text-[0.8125rem] font-medium text-ink-2';
  const casilla =
    'mt-0.5 border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink';

  return (
    <section id="politica" className="border-b border-line bg-paper py-20">
      <div className="container-hive">
        <h2 className="display-m text-ink">{t('cik.politica.title')}</h2>
        <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">{t('cik.politica.sub')}</p>

        <form onSubmit={(e) => void enviar(e)} className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className={etiqueta}>{t('cik.politica.token')}</span>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('cik.analizar.hueco')}
                spellCheck={false}
                className={cn(CAMPO, 'font-mono')}
              />
              <span className="text-[0.75rem] text-ink-3">{t('cik.politica.tokenPista')}</span>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className={etiqueta}>{t('cik.politica.maxRiesgo')}</span>
              <div className="flex flex-wrap gap-2">
                {NIVELES.map((n, i) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={p.maxRiskLevel === i}
                    onClick={() => setP({ ...p, maxRiskLevel: i })}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
                      p.maxRiskLevel === i ? 'border-honey bg-honey-soft text-honey-deep' : 'border-line text-ink-2 hover:border-honey',
                    )}
                  >
                    {t(`cik.res.nivel.${n}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className={etiqueta}>{t('cik.politica.minLiquidez')}</span>
                <input value={minLiq} onChange={(e) => setMinLiq(e.target.value)} inputMode="decimal" className={cn(CAMPO, 'font-mono')} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={etiqueta}>{t('cik.politica.maxTop1')}</span>
                <input value={top1} onChange={(e) => setTop1(e.target.value)} inputMode="decimal" className={cn(CAMPO, 'font-mono')} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={etiqueta}>{t('cik.politica.maxTop10')}</span>
                <input value={top10} onChange={(e) => setTop10(e.target.value)} inputMode="decimal" className={cn(CAMPO, 'font-mono')} />
              </label>
            </div>

            <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
              <Checkbox checked={p.blockSuspicious} onCheckedChange={(v) => setP({ ...p, blockSuspicious: v === true })} className={casilla} />
              {t('cik.politica.bloquearSospechoso')}
            </label>
            <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
              <Checkbox checked={p.blockSymbolScam} onCheckedChange={(v) => setP({ ...p, blockSymbolScam: v === true })} className={casilla} />
              {t('cik.politica.bloquearEstafa')}
            </label>
            <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
              <Checkbox checked={sonda} onCheckedChange={(v) => setSonda(v === true)} className={casilla} />
              {t('cik.politica.conSonda')}
            </label>
          </div>

          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className={etiqueta}>{t('cik.politica.holders')}</span>
              <textarea
                value={holders}
                onChange={(e) => setHolders(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder="0x…"
                className={cn(CAMPO, 'resize-y font-mono text-[0.75rem]')}
              />
              <span className="text-[0.75rem] leading-relaxed text-ink-3">{t('cik.politica.holdersPista', { n: MAX_HOLDERS })}</span>
            </label>

            <button type="submit" disabled={cargando || !token.trim()} className={cn(BOTON_MIEL, 'self-start px-5 py-2.5')}>
              {cargando && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {t('cik.politica.boton')}
            </button>
            {error && <p className="text-[0.875rem] text-terra">{error}</p>}

            {r && (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-2xl border p-5',
                  r.pasa ? 'border-olive/40 bg-olive/10' : 'border-terra/40 bg-terra/10',
                )}
              >
                {r.pasa ? (
                  <ShieldCheck size={22} className="shrink-0 text-olive" aria-hidden />
                ) : (
                  <ShieldX size={22} className="shrink-0 text-terra" aria-hidden />
                )}
                <div>
                  <p className={cn('font-semibold', r.pasa ? 'text-olive' : 'text-terra')}>
                    {r.pasa ? t('cik.politica.pasa') : t('cik.politica.rechaza', { codigo: r.motivo })}
                  </p>
                  {!r.pasa && <p className="mt-1 text-[0.875rem] text-ink-2">{t(`cik.politica.motivo.m${r.motivo}`)}</p>}
                </div>
              </div>
            )}

            <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('cik.politica.nota')}</p>
          </div>
        </form>
      </div>
    </section>
  );
}
