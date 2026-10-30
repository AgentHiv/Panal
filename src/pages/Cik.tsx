/**
 * Panal — /cik: probar cik, el modelo de IA que vive en Monad.
 *
 * Todo lo que cik sabe hacer, en una página y sin instalar nada: analizar un
 * contrato o un bytecode, probar una política de CiGuardV2 y atestiguar, retar
 * o retirar con la wallet. Los veredictos los dan los contratos; la página no
 * calcula ninguno, y cada número dice de dónde sale.
 *
 * Los parámetros de la portada (registro, pesos, stake, ventana, MODEL_HASH) se leen
 * de `Ci` al abrir, no van escritos: si cambiaran, la página lo diría sola.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Cpu } from 'lucide-react';
import { publicClient } from '@/contracts/config';
import { CIK, SOURCIFY } from '@/contracts/cik';
import { analizar, corta, leerParametros, type Analisis, type Parametros } from '@/lib/cik';
import { useTituloDePagina } from '@/hooks/useTituloDePagina';
import Analizador, { type PedidoAnalisis } from '@/components/cik/Analizador';
import Delegaciones from '@/components/cik/Delegaciones';
import Politica from '@/components/cik/Politica';
import Atestar from '@/components/cik/Atestar';
import { mon } from '@/components/cik/comun';

export default function Cik() {
  useTituloDePagina('cik.metaTitle');
  const [parametros, setParametros] = useState<Parametros | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  // Un token pegado en delegaciones se manda a analizar arriba, como token.
  const [pedido, setPedido] = useState<PedidoAnalisis | null>(null);
  const atendido = useCallback(() => setPedido(null), []);

  useEffect(() => {
    let vivo = true;
    leerParametros(publicClient as never)
      .then((p) => vivo && setParametros(p))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  // Tras atestiguar, retar o retirar: el veredicto en la cadena ha cambiado.
  const refrescar = useCallback(() => {
    if (!analisis) return;
    analizar(publicClient as never, analisis.direccion)
      .then(setAnalisis)
      .catch(() => undefined);
  }, [analisis]);

  return (
    <>
      <Portada parametros={parametros} />
      <Analizador
        parametros={parametros}
        analisis={analisis}
        onAnalisis={setAnalisis}
        pedido={pedido}
        onPedidoAtendido={atendido}
      />
      <Delegaciones onAnalizarToken={(direccion) => setPedido({ direccion, n: Date.now() })} />
      <Politica analisis={analisis} />
      <Atestar analisis={analisis} parametros={parametros} onCambio={refrescar} />
      <Detras parametros={parametros} />
    </>
  );
}

function Portada({ parametros }: { parametros: Parametros | null }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => v.toLocaleString(i18n.language);
  const cifras = [
    { valor: parametros ? n(parametros.clones) : '…', etiqueta: t('cik.hero.stats.clones') },
    { valor: parametros ? n(parametros.pesos) : '…', etiqueta: t('cik.hero.stats.pesos') },
    { valor: parametros ? `${mon(parametros.minStake)} MON` : '…', etiqueta: t('cik.hero.stats.stake') },
    { valor: parametros ? `${Math.round(parametros.challengeWindow / 60)} min` : '…', etiqueta: t('cik.hero.stats.ventana') },
  ];

  return (
    <section className="relative overflow-hidden border-b border-line bg-paper pb-16 pt-32 md:pt-40">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.05]" aria-hidden />
      <div className="container-hive relative">
        <p className="eyebrow flex items-center gap-2 text-ink-3">
          <Cpu size={13} className="text-monad" aria-hidden />
          {t('cik.hero.eyebrow')}
        </p>
        <h1 className="display-xl mt-5 text-ink">
          {t('cik.hero.title1')} <em className="serif-accent text-honey-deep">{t('cik.hero.title2')}</em>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-[1.6] text-ink-2">{t('cik.hero.sub')}</p>

        <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {cifras.map((c) => (
            <div key={c.etiqueta} className="bg-paper p-5">
              <dd className="font-mono text-[1.5rem] font-medium leading-none text-ink">{c.valor}</dd>
              <dt className="mt-2 text-[0.8125rem] text-ink-3">{c.etiqueta}</dt>
            </div>
          ))}
        </dl>
        {parametros && (
          <p className="mt-4 break-all font-mono text-[0.6875rem] text-ink-3">
            {t('cik.hero.modelo')}: {parametros.modelHash}
          </p>
        )}
      </div>
    </section>
  );
}

function Detras({ parametros }: { parametros: Parametros | null }) {
  const { t, i18n } = useTranslation();
  const contratos = [
    { nombre: 'Ci', direccion: CIK.ci },
    { nombre: 'CiView', direccion: CIK.view },
    { nombre: 'CiRisk', direccion: CIK.risk },
    { nombre: 'CiModels', direccion: CIK.models },
    { nombre: 'CiProbe', direccion: CIK.probe },
    { nombre: 'CiDelegate', direccion: CIK.delegate },
  ];
  return (
    <section id="detras" className="bg-paper py-20">
      <div className="container-hive">
        <h2 className="display-m text-ink">{t('cik.detras.title')}</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-[1.0625rem] font-semibold text-ink">{t('cik.detras.p1t')}</h3>
            <p className="mt-2 leading-[1.65] text-ink-2">
              {t('cik.detras.p1', {
                red: parametros ? parametros.capas.map((c) => c.toLocaleString(i18n.language)).join(' → ') : '…',
                pesos: parametros ? parametros.pesos.toLocaleString(i18n.language) : '…',
              })}
            </p>
          </div>
          <div>
            <h3 className="text-[1.0625rem] font-semibold text-ink">{t('cik.detras.p2t')}</h3>
            <p className="mt-2 leading-[1.65] text-ink-2">
              {t('cik.detras.p2', { clones: parametros ? parametros.clones.toLocaleString(i18n.language) : '…' })}
            </p>
          </div>
        </div>

        <h3 className="mt-10 text-[1.0625rem] font-semibold text-ink">{t('cik.detras.p3t')}</h3>
        <ul className="mt-3 flex max-w-3xl list-disc flex-col gap-2 pl-5 leading-[1.65] text-ink-2">
          {(['l1', 'l2', 'l3', 'l4'] as const).map((l) => (
            <li key={l}>{t(`cik.detras.${l}`)}</li>
          ))}
        </ul>

        <h3 className="mt-10 text-[1.0625rem] font-semibold text-ink">{t('cik.detras.contratos')}</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {contratos.map((c) => (
            <li key={c.nombre}>
              <a
                href={SOURCIFY(c.direccion)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-colors hover:border-honey"
              >
                <span>
                  <span className="block font-medium text-ink">{c.nombre}</span>
                  <span className="font-mono text-[0.75rem] text-ink-3">{corta(c.direccion)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[0.75rem] text-honey-deep">
                  {t('cik.detras.verificado')}
                  <ArrowUpRight size={12} aria-hidden />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
