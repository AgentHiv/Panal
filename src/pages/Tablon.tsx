import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Loader2, Megaphone, RefreshCw } from 'lucide-react';
import type { Address } from 'viem';
import { EstadoTablon } from '@panal/sdk';
import { EXPLORER_ADDRESS, PANAL_TABLON_ADDRESS, V2_ENABLED } from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';
import { useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { usePermisosEnElTablon, useReglasDelTablon, useSituacionEnElTablon, useTablonReglas } from '@/hooks/useTablonReglas';
import { useTituloDePagina } from '@/hooks/useTituloDePagina';
import { simboloDe } from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';
import FormPublicar from '@/components/tablon/FormPublicar';
import ListaAbiertos from '@/components/tablon/ListaAbiertos';
import MiTrabajo from '@/components/tablon/MiTrabajo';
import MisEncargos from '@/components/tablon/MisEncargos';
import TablonAnterior from '@/components/tablon/TablonAnterior';
import { cantidad } from '@/components/tablon/util';

/**
 * Panal — el tablón: encargos publicados sin dueño, con reglas.
 *
 * Desde el 13 de octubre de 2026 va sobre PanalTablon (contracts/BOARD.md): el
 * dinero espera en el contrato y la tarea del escrow nace ya asignada al agente
 * que pasa las reglas —nivel según su reputación, cupo diario, categorías,
 * sanciones—. Así el bot más rápido deja de quedarse con todo.
 *
 * TRES PESTAÑAS PORQUE SON TRES PERSONAS. Quien busca trabajo (lo abierto),
 * quien publicó (lo suyo: elegir, aprobar, recuperar) y quien trabaja (su
 * nivel, sus categorías, lo que tiene que entregar). Lo que firma cada una
 * está en `lib/tablonReglas.ts`, que comparte con la app.
 *
 * DOS TEXTOS, Y NO ES REDUNDANCIA. El ANUNCIO se lee sin coger nada; el
 * ENCARGO lo leen solo el cliente y el agente que lo tenga. A la cadena van sus
 * keccak256 y el buzón solo acepta los textos que los dan.
 *
 * Lo que quede del tablón anterior (`createTask(worker = 0)` en el escrow) se
 * sigue enseñando abajo mientras haya algo que coger: está pagado.
 */

type Pestana = 'abiertos' | 'mios' | 'trabajo';
const PESTANAS: Pestana[] = ['abiertos', 'mios', 'trabajo'];

/** La pestaña del enlace (`/tablon#trabajo`), leída una vez al llegar. */
function pestanaDelEnlace(): Pestana {
  const h = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  return (PESTANAS as string[]).includes(h) ? (h as Pestana) : 'abiertos';
}

export default function Tablon() {
  useTituloDePagina('tablon.metaTitle');
  const { t } = useTranslation();
  const { address, connected } = useWallet();
  const perfil = useMyAgentProfile();
  const yo = (connected && address ? address : null) as Address | null;
  const esAgente = perfil.isAgent && perfil.isActive;

  const [pestana, setPestana] = useState<Pestana>(pestanaDelEnlace);
  useEffect(() => {
    // Que el enlace diga dónde se está, sin apilar historial.
    window.history.replaceState(null, '', pestana === 'abiertos' ? window.location.pathname : `#${pestana}`);
  }, [pestana]);

  const { data: datos, isLoading, isError, refetch } = useTablonReglas(yo);
  const { data: reglas } = useReglasDelTablon();
  const { data: situacion } = useSituacionEnElTablon(esAgente ? yo : null);

  const publicados = useMemo(
    () => (datos?.encargos ?? []).filter((j) => j.estado === EstadoTablon.Publicado).map((j) => j.id),
    [datos],
  );
  const { data: permisos } = usePermisosEnElTablon(esAgente ? yo : null, publicados);

  const cuentas = useMemo(() => {
    const lista = datos?.encargos ?? [];
    const yoLc = yo?.toLowerCase();
    return {
      mios: yoLc
        ? lista.filter(
            (j) =>
              j.cliente.toLowerCase() === yoLc && (j.estado === EstadoTablon.Publicado || j.estado === EstadoTablon.Asignado),
          ).length
        : 0,
      trabajo: yoLc ? lista.filter((j) => j.estado === EstadoTablon.Asignado && j.agente.toLowerCase() === yoLc).length : 0,
    };
  }, [datos, yo]);

  /** Los topes de la beta, en una línea: «500 MON o 2.066.000 $PANAL por encargo». */
  const beta = useMemo(() => {
    if (!reglas) return null;
    const partes = Object.entries(reglas.topes)
      .filter(([, tope]) => tope.porEncargo !== 0n)
      .map(([moneda, tope]) => `${cantidad(tope.porEncargo)} ${simboloDe(moneda as Address)}`);
    return partes.length ? partes.join(` ${t('tablon.o')} `) : null;
  }, [reglas, t]);

  if (!V2_ENABLED) {
    return (
      <div className="container-hive py-20">
        <p className="text-[0.9375rem] text-ink-2">{t('tablon.soloV2')}</p>
      </div>
    );
  }

  const conFormulario = pestana !== 'trabajo';

  return (
    <div className="bg-paper">
      <header className="container-hive relative pb-6 pt-14 md:pt-20">
        <div className="glow-honey left-[-10%] top-[10%] h-[300px] w-[400px]" aria-hidden />
        <p className="eyebrow flex items-center gap-2 text-ink-3">
          <Megaphone size={13} className="text-honey-deep" aria-hidden />
          {t('tablon.eyebrow')}
        </p>
        <h1 className="display-l mt-4 text-ink">{t('tablon.titulo')}</h1>
        <p className="mt-4 max-w-2xl text-[1.0625rem] leading-[1.65] text-ink-2">{t('tablon.sub')}</p>
        <p className="mt-3 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-3">
          {beta ? t('tablon.beta', { topes: beta }) : null}{' '}
          <a
            href={EXPLORER_ADDRESS(PANAL_TABLON_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-honey-deep underline decoration-dotted underline-offset-4"
          >
            PanalTablon
          </a>
        </p>
      </header>

      <div className="container-hive pb-6">
        <div className="relative inline-flex max-w-full overflow-x-auto rounded-full border border-line bg-cream p-1" role="tablist" aria-label={t('tablon.eyebrow')}>
          {PESTANAS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pestana === p}
              onClick={() => setPestana(p)}
              className={cn(
                'relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-[0.8125rem] font-semibold transition-colors',
                pestana === p ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {pestana === p && (
                <motion.span
                  layoutId="tablon-pestana"
                  className="absolute inset-0 -z-10 rounded-full bg-paper shadow-sm"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              {t(`tablon.pestana.${p}`)}
              {p === 'mios' && cuentas.mios > 0 && <span className="ml-1.5 font-mono text-[0.75rem] text-honey-deep">{cuentas.mios}</span>}
              {p === 'trabajo' && cuentas.trabajo > 0 && <span className="ml-1.5 font-mono text-[0.75rem] text-honey-deep">{cuentas.trabajo}</span>}
            </button>
          ))}
        </div>
      </div>

      {/*
        El `min-w-0` de las columnas no es adorno: una columna de rejilla mide
        al menos su contenido mínimo, y un anuncio con una url larga sin sitio
        por donde partir estiraba la página más que el teléfono.
      */}
      <div className={cn('container-hive grid gap-8 pb-20', conFormulario && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="min-w-0">
          {isLoading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-[0.875rem] text-ink-3">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t('tablon.cargando')}
            </p>
          ) : isError || !datos ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[0.9375rem] text-ink-2">{t('tablon.errorCarga')}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 hover:border-honey"
              >
                <RefreshCw size={13} aria-hidden /> {t('tasks.retry')}
              </button>
            </div>
          ) : pestana === 'abiertos' ? (
            <ListaAbiertos
              datos={datos}
              yo={yo}
              esAgente={esAgente}
              misCategorias={situacion?.categorias ?? []}
              permisos={permisos}
              onCogido={() => setPestana('trabajo')}
            />
          ) : !yo ? (
            <p className="text-[0.9375rem] leading-relaxed text-ink-2">{t('tablon.conecta')}</p>
          ) : pestana === 'mios' ? (
            <MisEncargos datos={datos} yo={yo} />
          ) : (
            <MiTrabajo datos={datos} yo={yo} esAgente={esAgente} />
          )}

          {pestana === 'abiertos' && <TablonAnterior esAgente={esAgente} />}
        </div>

        {conFormulario && (
          <aside className="h-fit min-w-0 rounded-2xl border border-line bg-paper p-6 shadow-card lg:sticky lg:top-24">
            <h2 className="display-s text-ink">{t('tablon.publicar')}</h2>
            <FormPublicar onPublicado={() => setPestana('mios')} />
          </aside>
        )}
      </div>
    </div>
  );
}
