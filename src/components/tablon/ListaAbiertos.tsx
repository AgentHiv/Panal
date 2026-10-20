/**
 * Los encargos publicados: lo que se puede coger o en lo que se puede ofertar.
 *
 * Cada fila pregunta al contrato (`canTake`) si esta wallet puede, y por qué
 * no: el motivo sale en el idioma de quien lee antes de gastar gas. Es la
 * misma comprobación que hace `take()`/`applyFor()`, así que si aquí dice que
 * sí, la cadena dice que sí.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { Lock, TriangleAlert } from 'lucide-react';
import { parseEther, type Address } from 'viem';
import {
  CATEGORIAS_TABLON,
  EstadoTablon,
  ModoTablon,
  audienciaAdmite,
  type AudienciaTablon,
  type EncargoConReglas,
  type OfertaConReglas,
  type TipoDeAgente,
} from '@panal/sdk';
import HexAvatar from '@/components/HexAvatar';
import { shortAddress } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { useLogoDeAgente } from '@/hooks/useLogoDeAgente';
import { useFirmaDelTablon } from '@/hooks/useFirmaDelTablon';
import type { DatosDelTablon } from '@/hooks/useTablonReglas';
import { claveDeMotivo, enTablon, firmarYEsperar, simboloDe } from '@/lib/tablonReglas';
import { clavePublicaDe, publicarMiClave } from '@/lib/cifrado';
import { cn } from '@/lib/utils';
import { Chip, Girando, Importe, NombreDeCategoria } from './comun';
import { BOTON_LINEA, BOTON_MIEL, BOTON_PELIGRO, CAMPO, cantidad, useDuracion } from './util';

const HORA = 3600;
/** Plazos que se pueden ofrecer: el del encargo y los más cortos de estos. */
const PLAZOS_OFERTA = [HORA, 6 * HORA, 24 * HORA, 72 * HORA, 168 * HORA];

interface Props {
  datos: DatosDelTablon;
  yo: Address | null;
  /** Si la wallet es un agente activo del registro. Sin eso no se coge nada. */
  esAgente: boolean;
  /** Sus categorías en el tablón, para el filtro «las mías». */
  misCategorias: number[];
  /** Lo que dice su ficha que es: persona o programa. `null` si no es agente. */
  miTipo: TipoDeAgente | null;
  permisos: Map<string, { ok: boolean; motivo: string }> | undefined;
  /** Tras coger u ofertar: para llevarle a su pestaña. */
  onCogido?: () => void;
}

type Filtro = number | 'todas' | 'mias' | 'personas' | 'agentes';

export default function ListaAbiertos({ datos, yo, esAgente, misCategorias, miTipo, permisos, onCogido }: Props) {
  const { t } = useTranslation();
  const ahora = useAhora();
  const [categoria, setCategoria] = useState<Filtro>('todas');
  /**
   * Si quien mira tiene su clave publicada. Hace falta para un encargo
   * confidencial: si le eligen sin ella, su cliente no puede darle acceso y
   * no podría leer lo que tiene que hacer.
   */
  const [tengoClave, setTengoClave] = useState<boolean | null>(null);
  useEffect(() => {
    if (!yo) return;
    let vigente = true;
    void clavePublicaDe(yo).then((c) => {
      if (vigente) setTengoClave(c !== null);
    });
    return () => {
      vigente = false;
    };
  }, [yo]);

  const abiertos = useMemo(
    () =>
      datos.encargos.filter((j) => {
        if (j.estado !== EstadoTablon.Publicado) return false;
        // Lo que ya no se puede coger ni ofertar no es tablón: es espera.
        if (ahora > j.caducaEn) return false;
        if (j.modo === ModoTablon.Seleccion && ahora >= j.publicadoEn + j.ventanaOfertasS) return false;
        if (categoria === 'mias') return misCategorias.includes(j.categoria);
        if (categoria === 'personas' || categoria === 'agentes') return datos.audiencias.get(j.id.toString()) === categoria;
        if (categoria !== 'todas') return j.categoria === categoria;
        return true;
      }),
    [datos.encargos, datos.audiencias, ahora, categoria, misCategorias],
  );

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display-s text-ink">{t('tablon.abiertos', { n: abiertos.length })}</h2>
        <select
          aria-label={t('tablon.pub.categoria')}
          value={String(categoria)}
          onChange={(e) => {
            const v = e.target.value;
            setCategoria(v === 'todas' || v === 'mias' || v === 'personas' || v === 'agentes' ? v : Number(v));
          }}
          className="rounded-full border border-line bg-paper px-3 py-1.5 text-[0.8125rem] text-ink-2 focus:border-honey focus:outline-none"
        >
          <option value="todas">{t('tablon.filtro.todas')}</option>
          {misCategorias.length > 0 && <option value="mias">{t('tablon.filtro.mias')}</option>}
          <option value="personas">{t('tablon.filtro.personas')}</option>
          <option value="agentes">{t('tablon.filtro.agentes')}</option>
          {CATEGORIAS_TABLON.map((c, i) => (
            <option key={c} value={i}>
              {t(`tablon.cat.${c}`)}
            </option>
          ))}
        </select>
      </div>

      {abiertos.length === 0 ? (
        <p className="mt-6 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">{t('tablon.vacio')}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {abiertos.map((j) => (
            <TarjetaAbierta
              key={j.id.toString()}
              job={j}
              anuncio={datos.anuncios.get(j.id.toString())}
              audiencia={datos.audiencias.get(j.id.toString()) ?? 'todos'}
              confidencial={datos.confidenciales.has(j.id.toString())}
              tengoClave={tengoClave}
              onClaveActivada={() => setTengoClave(true)}
              miTipo={miTipo}
              ofertas={datos.ofertas.get(j.id.toString()) ?? []}
              yo={yo}
              esAgente={esAgente}
              permiso={permisos?.get(j.id.toString())}
              ahora={ahora}
              onCogido={onCogido}
            />
          ))}
        </ul>
      )}

      {!esAgente && abiertos.length > 0 && (
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
  );
}

function TarjetaAbierta({
  job,
  anuncio,
  audiencia,
  confidencial,
  tengoClave,
  onClaveActivada,
  miTipo,
  ofertas,
  yo,
  esAgente,
  permiso,
  ahora,
  onCogido,
}: {
  job: EncargoConReglas;
  anuncio: string | undefined;
  audiencia: AudienciaTablon;
  confidencial: boolean;
  tengoClave: boolean | null;
  onClaveActivada: () => void;
  miTipo: TipoDeAgente | null;
  ofertas: OfertaConReglas[];
  yo: Address | null;
  esAgente: boolean;
  permiso: { ok: boolean; motivo: string } | undefined;
  ahora: number;
  onCogido?: () => void;
}) {
  const { t } = useTranslation();
  const logoDe = useLogoDeAgente();
  const duracion = useDuracion();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const id = job.id.toString();
  const seleccion = job.modo === ModoTablon.Seleccion;
  const finOfertas = job.publicadoEn + job.ventanaOfertasS;
  const esMio = !!yo && job.cliente.toLowerCase() === yo.toLowerCase();
  const miOferta = yo ? ofertas.find((o) => o.agente.toLowerCase() === yo.toLowerCase()) : undefined;
  const [ofertando, setOfertando] = useState(false);
  const { signMessageAsync } = useSignMessage();
  const [activando, setActivando] = useState(false);
  /** Publica la clave de cifrado: dos firmas, una vez. Desde entonces se le puede dar acceso. */
  const activarClave = async () => {
    if (!yo) return;
    setActivando(true);
    try {
      await publicarMiClave(yo, (message) => signMessageAsync({ message }));
      onClaveActivada();
      toast.success(t('tablon.claveActivada'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) toast.error(t('tasks.cifrado.errorActivar'));
    } finally {
      setActivando(false);
    }
  };

  const coger = () =>
    void ejecutar(`coger:${id}`, async (escribir, cuenta) => {
      await firmarYEsperar(escribir, cuenta, enTablon('take', [job.id]));
      onCogido?.();
    });

  const retirarOferta = () =>
    void ejecutar(`retirar:${id}`, (escribir, cuenta) => firmarYEsperar(escribir, cuenta, enTablon('withdrawOffer', [job.id])));

  /**
   * Para quién es. La cadena no lo sabe —lo dice el anuncio—, así que aquí se
   * corta: una persona no coge uno «solo agentes», ni un programa uno «solo
   * personas». Va antes que el permiso del contrato, que diría que sí.
   */
  const fueraDeAudiencia = esAgente && miTipo !== null && !audienciaAdmite(audiencia, miTipo);
  // Confidencial y sin clave: si le eligieran, no podría leer el encargo.
  const sinClave = confidencial && esAgente && tengoClave === false;
  const puede = !!permiso?.ok && !fueraDeAudiencia && !sinClave;
  const motivo = fueraDeAudiencia
    ? t(`tablon.audienciaNo.${audiencia}`)
    : sinClave
      ? t('tablon.confidencialSinClave')
    : esAgente && permiso && !permiso.ok && permiso.motivo !== 'own job'
      ? t(`tablon.motivo.${claveDeMotivo(permiso.motivo)}`, { defaultValue: permiso.motivo })
      : null;

  return (
    <li className="rounded-2xl border border-line bg-paper p-5 shadow-card transition-[border-color] hover:border-honey">
      <div className="flex flex-wrap items-start gap-3">
        <HexAvatar seed={job.cliente} size={40} logo={logoDe(job.cliente)} />
        <div className="min-w-0 flex-1">
          {anuncio ? (
            <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55] text-ink">{anuncio}</p>
          ) : (
            <p className="text-[0.875rem] italic text-ink-3">{t('tablon.sinAnuncio')}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip tono="miel">
              <NombreDeCategoria numero={job.categoria} />
            </Chip>
            <Chip>{seleccion ? t('tablon.modo.seleccion') : t('tablon.modo.inmediato')}</Chip>
            {audiencia !== 'todos' && <Chip tono="oliva">{t(`tablon.audiencia.${audiencia}`)}</Chip>}
            {confidencial && (
              <Chip tono="oliva">
                <span className="inline-flex items-center gap-1">
                  <Lock size={11} aria-hidden />
                  {t('tablon.confidencial')}
                </span>
              </Chip>
            )}
            {job.soloConExperiencia && <Chip tono="oliva">{t('tablon.soloExperiencia')}</Chip>}
            {esMio && <Chip tono="miel">{t('tablon.esTuyo')}</Chip>}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-ink-3">
            <span>#{id}</span>
            <span>{shortAddress(job.cliente)}</span>
            <span>{t('tablon.entregaEn', { dur: duracion(job.plazoEntregaS) })}</span>
            <span>
              {seleccion
                ? t('tablon.ofertasQuedan', { dur: duracion(finOfertas - ahora), n: ofertas.length })
                : t('tablon.quedan', { dur: duracion(job.caducaEn - ahora) })}
            </span>
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-end sm:gap-0">
            {seleccion && <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-3">{t('tablon.presupuesto')}</span>}
            <Importe wei={job.importe} moneda={job.moneda} className="text-right text-[0.9375rem] font-semibold" />
          </div>
          {!esMio &&
            (seleccion ? (
              miOferta ? (
                <div className="flex flex-col items-end gap-1.5 text-right">
                  <span className="text-[0.75rem] text-ink-2">
                    {t('tablon.tuOferta', { n: cantidad(miOferta.precio), moneda: simboloDe(job.moneda), dur: duracion(miOferta.plazoEntregaS) })}
                  </span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setOfertando((v) => !v)} disabled={ocupado !== null} className={BOTON_LINEA}>
                      {t('tablon.cambiarOferta')}
                    </button>
                    <button type="button" onClick={retirarOferta} disabled={ocupado !== null} className={BOTON_PELIGRO}>
                      {ocupado === `retirar:${id}` && <Girando />}
                      {t('tablon.retirarOferta')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOfertando((v) => !v)}
                  disabled={!yo || !esAgente || !puede || ocupado !== null}
                  className={BOTON_MIEL}
                >
                  {t('tablon.ofertar')}
                </button>
              )
            ) : (
              <button type="button" onClick={coger} disabled={!yo || !esAgente || !puede || ocupado !== null} className={BOTON_MIEL}>
                {ocupado === `coger:${id}` && <Girando />}
                {t('tablon.coger')}
              </button>
            ))}
        </div>
      </div>

      {motivo && <p className="mt-3 text-[0.75rem] leading-relaxed text-terra">{motivo}</p>}
      {sinClave && (
        <button type="button" onClick={() => void activarClave()} disabled={activando} className={cn(BOTON_LINEA, 'mt-2')}>
          {activando ? <Girando /> : <Lock size={13} aria-hidden />}
          {t('tablon.activarCifrado')}
        </button>
      )}

      {ofertando && seleccion && (
        <FormOferta
          job={job}
          previa={miOferta}
          onHecho={() => {
            setOfertando(false);
            onCogido?.();
          }}
        />
      )}
    </li>
  );
}

function FormOferta({ job, previa, onHecho }: { job: EncargoConReglas; previa?: OfertaConReglas; onHecho: () => void }) {
  const { t } = useTranslation();
  const duracion = useDuracion();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const simbolo = simboloDe(job.moneda);
  const [precio, setPrecio] = useState(cantidad(previa?.precio ?? job.importe));
  const plazos = [...new Set([...PLAZOS_OFERTA.filter((p) => p < job.plazoEntregaS), job.plazoEntregaS])].sort((a, b) => a - b);
  const [plazo, setPlazo] = useState(previa?.plazoEntregaS ?? job.plazoEntregaS);
  const precioStr = precio.replace(',', '.').trim();
  const precioWei = /^\d+(\.\d{1,18})?$/.test(precioStr) ? parseEther(precioStr) : null;
  const porEncima = precioWei !== null && precioWei > job.importe;
  const clave = `ofertar:${job.id.toString()}`;

  const enviar = () =>
    void ejecutar(clave, async (escribir, cuenta) => {
      if (precioWei === null) return;
      await firmarYEsperar(escribir, cuenta, enTablon('applyFor', [job.id, precioWei, BigInt(plazo)]));
      onHecho();
    });

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-cream p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1.5 text-[0.75rem] font-medium text-ink-2">
          {t('tablon.oferta.precio', { moneda: simbolo })}
          <input
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            inputMode="decimal"
            className={cn(CAMPO, 'font-mono', precioWei === null && 'border-terra')}
          />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1.5 text-[0.75rem] font-medium text-ink-2">
          {t('tablon.oferta.plazo')}
          <select value={plazo} onChange={(e) => setPlazo(Number(e.target.value))} className={CAMPO}>
            {plazos.map((p) => (
              <option key={p} value={p}>
                {duracion(p)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={enviar} disabled={precioWei === null || precioWei === 0n || ocupado !== null} className={BOTON_MIEL}>
          {ocupado === clave && <Girando />}
          {previa ? t('tablon.oferta.cambiar') : t('tablon.oferta.enviar')}
        </button>
      </div>
      {precioWei !== null && precioWei > 0n && <Importe wei={precioWei} moneda={job.moneda} className="text-[0.75rem] text-ink-3" enLinea />}
      <p className="text-[0.75rem] leading-relaxed text-ink-3">
        {porEncima ? t('tablon.oferta.porEncima') : t('tablon.oferta.pista')}
      </p>
    </div>
  );
}
