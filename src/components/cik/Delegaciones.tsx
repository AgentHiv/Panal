/**
 * Panal — /cik: delegaciones EIP-7702.
 *
 * Con EIP-7702 una cuenta normal ejecuta, en su propia dirección, el código de
 * otro contrato. Ese contrato puede llevarse todo lo que la cuenta tiene sin
 * pedir un solo permiso: así se vació la hot wallet Binance 14 el 29 de octubre
 * de 2026, según la cadena y las noticias, y así trabajan en Monad los
 * barredores sobre las cuentas cuya clave es pública.
 *
 * Una sola casilla para los dos momentos que importan: con una CUENTA, a quién
 * está delegada (antes de mandarle nada); con un CONTRATO, qué pasaría si
 * delegaras en él (antes de firmar la autorización). Lo dice `CiDelegate` en la
 * cadena, con reglas fijas sobre el código del delegado; la página no calcula
 * nada.
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import type { Address } from 'viem';
import { publicClient, EXPLORER_ADDRESS } from '@/contracts/config';
import { CIK, SOURCIFY } from '@/contracts/cik';
import {
  BANDERAS_DELEGACION,
  DELEGADOS_CONOCIDOS,
  VEREDICTOS_DELEGACION,
  corta,
  delegacionDe,
  type Delegacion,
} from '@/lib/cik';
import { cn } from '@/lib/utils';
import { BOTON_MIEL, CAMPO } from '@/components/tablon/util';
import { direccionPegada } from './comun';

/** Cuentas de anvil/Foundry, cuya clave es pública: casos reales que cualquiera puede comprobar. */
const EJEMPLOS: { clave: string; direccion: Address }[] = [
  { clave: 'ejemploConocida', direccion: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
  { clave: 'ejemploBarredor', direccion: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { clave: 'ejemploContrato', direccion: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B' },
];

const TONO: Record<(typeof VEREDICTOS_DELEGACION)[number], string> = {
  ninguna: 'border-line bg-paper text-ink-2',
  conocido: 'border-olive/40 bg-olive/10 text-olive',
  desconocido: 'border-honey/50 bg-honey-soft text-honey-deep',
  barredor: 'border-terra/40 bg-terra/10 text-terra',
};

const ICONO = { ninguna: ShieldQuestion, conocido: ShieldCheck, desconocido: ShieldAlert, barredor: ShieldX };

export default function Delegaciones() {
  const { t } = useTranslation();
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ direccion: Address; d: Delegacion } | null>(null);

  const lanzar = async (direccion: Address) => {
    setCargando(true);
    setError(null);
    try {
      setResultado({ direccion, d: await delegacionDe(publicClient as never, direccion) });
    } catch {
      setResultado(null);
      setError(t('cik.delegacion.error'));
    } finally {
      setCargando(false);
    }
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const d = direccionPegada(texto);
    if (!d) return setError(t('cik.analizar.malaDireccion'));
    void lanzar(d);
  };

  return (
    <section id="delegaciones" className="border-b border-line bg-paper py-20">
      <div className="container-hive">
        <h2 className="display-m text-ink">{t('cik.delegacion.title')}</h2>
        <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">{t('cik.delegacion.sub')}</p>

        <form onSubmit={enviar} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('cik.delegacion.hueco')}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('cik.delegacion.hueco')}
            className={cn(CAMPO, 'font-mono')}
          />
          <button type="submit" disabled={cargando || !texto.trim()} className={cn(BOTON_MIEL, 'shrink-0 px-5 py-2.5')}>
            {cargando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ShieldQuestion size={15} aria-hidden />}
            {t('cik.delegacion.boton')}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-3">
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
              {t(`cik.delegacion.${e.clave}`)}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-[0.875rem] text-terra">{error}</p>}
        {resultado && (
          <div className="mt-6">
            <ResultadoDelegacion direccion={resultado.direccion} d={resultado.d} />
          </div>
        )}
      </div>
    </section>
  );
}

/** El veredicto de `CiDelegate`, lo que se ve en el código y qué hacer. Lo usa también el analizador. */
export function ResultadoDelegacion({ direccion, d }: { direccion: Address; d: Delegacion }) {
  const { t, i18n } = useTranslation();
  const veredicto = VEREDICTOS_DELEGACION[d.veredicto] ?? 'desconocido';
  const Icono = ICONO[veredicto];
  const nombre = d.delegado ? DELEGADOS_CONOCIDOS[d.delegado.toLowerCase()] : undefined;
  const banderas = BANDERAS_DELEGACION.filter((b) => d.banderas & b.bit);

  return (
    <div className="rounded-2xl border border-line bg-cream p-5 md:p-6">
      <p className="font-mono text-[0.8125rem] text-ink-3">
        {t(`cik.delegacion.tipo.${d.tipo}`)} · {corta(direccion)}
      </p>

      <div className={cn('mt-3 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5', TONO[veredicto])}>
        <Icono size={16} aria-hidden />
        <span className="text-[0.9375rem] font-semibold">{t(`cik.delegacion.veredicto.${veredicto}`)}</span>
      </div>

      <p className="mt-4 max-w-2xl text-[0.9375rem] leading-[1.6] text-ink">
        {t(`cik.delegacion.consejo.${veredicto}`, { tipo: t(`cik.delegacion.tipo.${d.tipo}`) })}
      </p>

      {d.delegado && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 text-[0.875rem] sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-3">{t(d.tipo === 'cuenta' ? 'cik.delegacion.delegadoA' : 'cik.delegacion.contrato')}</dt>
          <dd className="min-w-0">
            <a
              href={EXPLORER_ADDRESS(d.delegado)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-ink hover:text-honey-deep"
            >
              {corta(d.delegado)}
              <ArrowUpRight size={13} aria-hidden />
            </a>
            {nombre && <span className="ml-2 text-ink-2">· {nombre}</span>}
          </dd>
          {d.tamano > 0 && (
            <>
              <dt className="text-ink-3">{t('cik.delegacion.codigo')}</dt>
              <dd className="font-mono text-ink-2">
                {t('cik.delegacion.bytes', { n: d.tamano.toLocaleString(i18n.language) })}
              </dd>
            </>
          )}
        </dl>
      )}

      {banderas.length > 0 && (
        <div className="mt-4">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('cik.delegacion.seVe')}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {banderas.map((b) => (
              <li key={b.bit} className="rounded-full border border-line bg-paper px-2.5 py-1 text-[0.75rem] text-ink-2">
                {t(`cik.delegacion.bandera.${b.clave}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-5 text-[0.75rem] leading-[1.6] text-ink-3">
        {t('cik.delegacion.fuente')}{' '}
        <a href={SOURCIFY(CIK.delegate)} target="_blank" rel="noreferrer" className="font-mono hover:text-honey-deep">
          CiDelegate {corta(CIK.delegate)}
        </a>
      </p>
    </div>
  );
}
