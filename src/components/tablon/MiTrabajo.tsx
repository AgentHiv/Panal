/**
 * El tablón con reglas visto por quien trabaja: dónde está (nivel, cupo,
 * sanciones), qué categorías declara, qué ha ofertado y lo que tiene que
 * entregar.
 *
 * ENTREGAR SON DOS PASOS, EN ESTE ORDEN. Primero el texto al buzón, firmado
 * con su hash dentro; después el hash al escrow. Al revés, un fallo del buzón
 * dejaría al cliente con una entrega anclada que no puede leer, y el reloj de
 * las 72 h corriendo contra él.
 *
 * El cobro no pasa por aquí: al aprobarse, el escrow deja el pago en
 * `pendingWithdrawals` del agente, y se retira desde el panel como cualquier
 * otro.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import {
  CATEGORIAS_TABLON,
  EstadoTablon,
  MAX_CATEGORIAS,
  ModoTablon,
  parseAttachmentsManifest,
  problemaConArchivos,
  stripFilesManifest,
  type ArchivoParaSubir,
  type EncargoConReglas,
} from '@panal/sdk';
import { useAhora } from '@/hooks/useAhora';
import { useFirmaDelTablon } from '@/hooks/useFirmaDelTablon';
import { useReglasDelTablon, useSituacionEnElTablon, type DatosDelTablon } from '@/hooks/useTablonReglas';
import {
  credencialTablon,
  credencialVigente,
  dejarEntrega,
  enTablon,
  entregaConArchivos,
  entregarEnEscrow,
  firmarYEsperar,
  leerEncargoConFirma,
  simboloDe,
  subirArchivosDelTablon,
  type CredencialTablon,
} from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';
import { ElegirArchivos, ListaDeArchivos } from './Archivos';
import { Chip, Girando, Importe, NombreDeCategoria } from './comun';
import { BOTON_LINEA, BOTON_MIEL, BOTON_PELIGRO, CAMPO, cantidad, useDuracion, useFecha } from './util';

const ABIERTA = 0;
const ENTREGADA = 1;
const EN_DISPUTA = 3;
// El del buzón (`MAX_ENTREGA_CHARS` en bot/src/buzon.ts).
const MAX_ENTREGA = 200_000;

export default function MiTrabajo({ datos, yo, esAgente }: { datos: DatosDelTablon; yo: Address; esAgente: boolean }) {
  const { t } = useTranslation();
  const ahora = useAhora();
  const duracion = useDuracion();
  const fecha = useFecha();
  const { data: situacion } = useSituacionEnElTablon(yo);
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const yoLc = yo.toLowerCase();

  const asignados = useMemo(
    () => datos.encargos.filter((j) => j.estado === EstadoTablon.Asignado && j.agente.toLowerCase() === yoLc),
    [datos.encargos, yoLc],
  );
  const cerrados = useMemo(
    () => datos.encargos.filter((j) => j.estado === EstadoTablon.Cerrado && j.agente.toLowerCase() === yoLc).slice(0, 10),
    [datos.encargos, yoLc],
  );
  const conOferta = useMemo(
    () =>
      datos.encargos.filter(
        (j) =>
          j.estado === EstadoTablon.Publicado &&
          j.modo === ModoTablon.Seleccion &&
          (datos.ofertas.get(j.id.toString()) ?? []).some((o) => o.agente.toLowerCase() === yoLc),
      ),
    [datos.encargos, datos.ofertas, yoLc],
  );

  if (!esAgente) {
    return (
      <section className="rounded-2xl border border-line bg-cream p-6">
        <p className="text-[0.9375rem] leading-relaxed text-ink-2">
          {t('tablon.paraCoger')}{' '}
          <Link to="/dashboard" className="font-medium text-honey-deep underline decoration-dotted underline-offset-4">
            {t('tablon.paraCogerEnlace')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-6">
      {situacion && (
        <div className="grid gap-3 rounded-2xl border border-line bg-paper p-5 shadow-card sm:grid-cols-4">
          <Dato titulo={t('tablon.trabajo.nivel')} valor={String(situacion.nivel)} />
          {situacion.nivel === 0 ? (
            <Dato titulo={t('tablon.trabajo.novato')} valor={`${situacion.novatoLibres}`} pista={t('tablon.trabajo.novatoPista')} />
          ) : (
            <Dato titulo={t('tablon.trabajo.hoy')} valor={`${situacion.hoyLibres} / ${situacion.cupoDiario}`} pista={t('tablon.trabajo.hoyPista')} />
          )}
          <Dato titulo={t('tablon.trabajo.abiertos')} valor={String(situacion.abiertos)} />
          <Dato
            titulo={t('tablon.trabajo.estado')}
            valor={situacion.suspendidoHasta > ahora ? t('tablon.trabajo.suspendido') : t('tablon.trabajo.alDia')}
            pista={situacion.suspendidoHasta > ahora ? t('tablon.trabajo.hasta', { cuando: fecha(situacion.suspendidoHasta) }) : undefined}
            mal={situacion.suspendidoHasta > ahora}
          />
        </div>
      )}

      {situacion && <Categorias actuales={situacion.categorias} />}

      <div>
        <h2 className="display-s text-ink">{t('tablon.trabajo.asignados', { n: asignados.length })}</h2>
        {asignados.length === 0 ? (
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">{t('tablon.trabajo.sinAsignados')}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {asignados.map((j) => (
              <Asignado key={j.id.toString()} job={j} datos={datos} yo={yo} />
            ))}
          </ul>
        )}
      </div>

      {conOferta.length > 0 && (
        <div>
          <h2 className="display-s text-ink">{t('tablon.trabajo.ofertas', { n: conOferta.length })}</h2>
          <ul className="mt-5 flex flex-col gap-3">
            {conOferta.map((j) => {
              const o = datos.ofertas.get(j.id.toString())!.find((x) => x.agente.toLowerCase() === yoLc)!;
              const finOfertas = j.publicadoEn + j.ventanaOfertasS;
              const clave = `retirar:${j.id.toString()}`;
              return (
                <li key={j.id.toString()} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.875rem] text-ink">{datos.anuncios.get(j.id.toString()) ?? `#${j.id.toString()}`}</p>
                    <p className="mt-1 text-[0.75rem] text-ink-3">
                      {t('tablon.tuOferta', { n: cantidad(o.precio), moneda: simboloDe(j.moneda), dur: duracion(o.plazoEntregaS) })}
                      {' · '}
                      {ahora < finOfertas
                        ? t('tablon.ofertasQuedan', { dur: duracion(finOfertas - ahora), n: (datos.ofertas.get(j.id.toString()) ?? []).length })
                        : t('tablon.trabajo.clienteEligiendo')}
                    </p>
                  </div>
                  {ahora < finOfertas && (
                    <button
                      type="button"
                      disabled={ocupado !== null}
                      onClick={() => void ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon('withdrawOffer', [j.id])))}
                      className={BOTON_PELIGRO}
                    >
                      {ocupado === clave && <Girando />}
                      {t('tablon.retirarOferta')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cerrados.length > 0 && (
        <div>
          <h2 className="display-s text-ink">{t('tablon.trabajo.cerrados')}</h2>
          <ul className="mt-5 flex flex-col gap-2">
            {cerrados.map((j) => {
              const tarea = datos.tareas.get(j.escrowTaskId.toString());
              return (
                <li key={j.id.toString()} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-[0.8125rem]">
                  <span className="min-w-0 flex-1 truncate text-ink-2">{datos.anuncios.get(j.id.toString()) ?? `#${j.id.toString()}`}</span>
                  <Importe wei={j.importe} moneda={j.moneda} className="text-[0.8125rem]" enLinea />
                  <Chip tono={tarea?.estado === 2 ? 'oliva' : 'terra'}>
                    {tarea?.estado === 2 ? t('tablon.trabajo.cobrado') : t('tablon.trabajo.noCobrado')}
                  </Chip>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-3">
            {t('tablon.trabajo.retirar')}{' '}
            <Link to="/dashboard#pagos" className="text-honey-deep underline decoration-dotted underline-offset-4">
              {t('tablon.trabajo.retirarEnlace')}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

function Dato({ titulo, valor, pista, mal }: { titulo: string; valor: string; pista?: string; mal?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{titulo}</span>
      <span className={cn('font-mono text-[1.25rem] font-semibold', mal ? 'text-terra' : 'text-ink')}>{valor}</span>
      {pista && <span className="text-[0.6875rem] leading-snug text-ink-3">{pista}</span>}
    </div>
  );
}

/** Hasta tres categorías: sin ninguna no se puede coger nada. */
function Categorias({ actuales }: { actuales: number[] }) {
  const { t } = useTranslation();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const [elegidas, setElegidas] = useState<number[] | null>(null);
  const lista = elegidas ?? actuales;
  const cambiadas = elegidas !== null && [...elegidas].sort().join() !== [...actuales].sort().join();

  const alternar = (c: number) =>
    setElegidas((prev) => {
      const base = prev ?? actuales;
      if (base.includes(c)) return base.filter((x) => x !== c);
      return base.length >= MAX_CATEGORIAS ? base : [...base, c];
    });

  const guardar = () =>
    void ejecutar('categorias', async (e, c) => {
      await firmarYEsperar(e, c, enTablon('setCategories', [lista]));
      setElegidas(null);
    });

  return (
    <div className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[0.9375rem] font-semibold text-ink">{t('tablon.trabajo.categorias')}</h3>
        <span className="text-[0.75rem] text-ink-3">{t('tablon.trabajo.categoriasCuenta', { n: lista.length, max: MAX_CATEGORIAS })}</span>
      </div>
      {actuales.length === 0 && elegidas === null && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-terra">{t('tablon.trabajo.sinCategorias')}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CATEGORIAS_TABLON.map((c, i) => {
          const on = lista.includes(i);
          return (
            <button
              key={c}
              type="button"
              onClick={() => alternar(i)}
              aria-pressed={on}
              disabled={!on && lista.length >= MAX_CATEGORIAS}
              className={cn(
                'rounded-full border px-3 py-1 text-[0.75rem] font-medium transition-colors disabled:opacity-40',
                on ? 'border-honey bg-honey-soft text-honey-deep' : 'border-line text-ink-2 hover:border-honey',
              )}
            >
              {t(`tablon.cat.${c}`)}
            </button>
          );
        })}
      </div>
      {cambiadas && (
        <button type="button" onClick={guardar} disabled={ocupado !== null} className={cn(BOTON_MIEL, 'mt-4')}>
          {ocupado === 'categorias' && <Girando />}
          {t('tablon.trabajo.guardarCategorias')}
        </button>
      )}
    </div>
  );
}

function Asignado({ job, datos, yo }: { job: EncargoConReglas; datos: DatosDelTablon; yo: Address }) {
  const { t } = useTranslation();
  const ahora = useAhora();
  const fecha = useFecha();
  const { data: reglas } = useReglasDelTablon();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const { signMessageAsync } = useSignMessage();
  const [encargo, setEncargo] = useState<string | null>(null);
  // La firma con la que se leyó el encargo: abre también sus adjuntos.
  const [cred, setCred] = useState<CredencialTablon | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState<ArchivoParaSubir[]>([]);

  const id = job.id.toString();
  const tarea = datos.tareas.get(job.escrowTaskId.toString());
  const firmar = (message: string) => signMessageAsync({ message });

  const leer = () =>
    void (async () => {
      setLeyendo(true);
      setError(null);
      try {
        const leido = await leerEncargoConFirma(job, await credencialTablon('encargo', job.id, yo, firmar));
        setCred(leido.cred);
        if (leido.brief === null) setError(t('tablon.trabajo.encargoNoEsta'));
        else setEncargo(leido.brief);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/user (rejected|denied)/i.test(msg) ? t('hire.step3.rejected') : t('tablon.trabajo.encargoError'));
      } finally {
        setLeyendo(false);
      }
    })();

  const claveEntregar = `entregar:${id}`;
  const entregar = () =>
    void ejecutar(claveEntregar, async (e, c) => {
      // Los archivos primero, y su hash dentro del texto que se ancla: si el
      // buzón no los acepta, no se ancla nada.
      await subirArchivosDelTablon(job.id, archivos, c, firmar);
      const final = archivos.length > 0 ? entregaConArchivos(job.id, texto.trim(), archivos) : texto.trim();
      const hash = await dejarEntrega(job.id, final, c, firmar);
      await firmarYEsperar(e, c, entregarEnEscrow(job.escrowTaskId, hash));
      setTexto('');
      setArchivos([]);
    });
  const credencialDelEncargo = async () => {
    if (credencialVigente(cred)) return cred;
    const nueva = await credencialTablon('encargo', job.id, yo, firmar);
    setCred(nueva);
    return nueva;
  };
  const adjuntos = encargo !== null ? parseAttachmentsManifest(encargo) : [];
  const claveCerrar = `cerrar:${id}`;
  const cerrar = () => void ejecutar(claveCerrar, (e, c) => firmarYEsperar(e, c, enTablon('settle', [job.id])));

  let estado: string;
  let puedeEntregar = false;
  let puedeCerrar = false;
  if (!tarea) {
    estado = '…';
  } else if (tarea.estado === ABIERTA) {
    puedeEntregar = ahora <= tarea.plazo;
    estado = puedeEntregar ? t('tablon.trabajo.entregaAntes', { cuando: fecha(tarea.plazo) }) : t('tablon.trabajo.fueraDePlazo');
  } else if (tarea.estado === ENTREGADA) {
    const libre = reglas ? tarea.entregadaEn + reglas.liberacionS : null;
    puedeCerrar = libre !== null && ahora >= libre;
    estado = puedeCerrar ? t('tablon.trabajo.liberable') : t('tablon.trabajo.entregado', { cuando: libre ? fecha(libre) : '…' });
  } else if (tarea.estado === EN_DISPUTA) {
    estado = t('tablon.trabajo.enDisputa');
  } else {
    // El escrow ya terminó: falta cerrar cuentas en el tablón, que libera el hueco.
    puedeCerrar = true;
    estado = t('tablon.trabajo.terminado');
  }

  return (
    <li className="rounded-2xl border border-line bg-paper p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55] text-ink">
            {datos.anuncios.get(id) ?? t('tablon.sinAnuncio')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip tono="miel">
              <NombreDeCategoria numero={job.categoria} />
            </Chip>
            <span className="font-mono text-[12px] text-ink-3">
              #{id} · {t('tablon.trabajo.tarea', { id: job.escrowTaskId.toString() })}
            </span>
          </div>
        </div>
        <Importe wei={job.importe} moneda={job.moneda} className="text-right text-[0.9375rem] font-semibold" />
      </div>

      <p className={cn('mt-3 text-[0.8125rem] leading-relaxed', tarea?.estado === ABIERTA && !puedeEntregar ? 'text-terra' : 'text-ink-2')}>{estado}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {encargo === null && (
          <button type="button" onClick={leer} disabled={leyendo} className={BOTON_LINEA}>
            {leyendo && <Girando />}
            {t('tablon.trabajo.leerEncargo')}
          </button>
        )}
        {puedeCerrar && (
          <button type="button" onClick={cerrar} disabled={ocupado !== null} className={BOTON_MIEL}>
            {ocupado === claveCerrar && <Girando />}
            {t('tablon.trabajo.cerrar')}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-[0.8125rem] text-terra">{error}</p>}

      {encargo !== null && (
        <div className="mt-4 rounded-xl border border-line bg-cream p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tablon.trabajo.elEncargo')}</p>
          <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink">
            {stripFilesManifest(encargo)}
          </p>
          <ListaDeArchivos
            jobId={job.id}
            archivos={adjuntos}
            de="adjunto"
            credencial={credencialDelEncargo}
            titulo={t('tablon.archivos.delEncargo')}
          />
        </div>
      )}

      {puedeEntregar && (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor={`entrega-${id}`} className="text-[0.8125rem] font-medium text-ink-2">
            {t('tablon.trabajo.tuEntrega')}
          </label>
          <textarea
            id={`entrega-${id}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, MAX_ENTREGA))}
            rows={6}
            className={cn(CAMPO, 'resize-y')}
          />
          <ElegirArchivos
            archivos={archivos}
            onChange={setArchivos}
            disabled={ocupado !== null}
            etiqueta={t('tablon.archivos.opcional')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={entregar}
              disabled={(!texto.trim() && archivos.length === 0) || (archivos.length > 0 && problemaConArchivos(archivos) !== null) || ocupado !== null}
              className={BOTON_MIEL}
            >
              {ocupado === claveEntregar && <Girando />}
              {t('tablon.trabajo.entregar')}
            </button>
            <span className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.trabajo.entregarPista')}</span>
          </div>
        </div>
      )}
    </li>
  );
}
