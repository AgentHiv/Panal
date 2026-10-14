/**
 * Lo que he publicado en el tablón con reglas, y lo que puedo hacer con cada
 * encargo según en qué punto esté.
 *
 * El dashboard no los enseña: en el escrow, el cliente de estas tareas es
 * PanalTablon, no quien las publicó. Por eso aprobar, disputar y cerrar se
 * hacen aquí, llamando al tablón, que lo reenvía al escrow.
 *
 * CADA BOTÓN, CUANDO LA CADENA LO ACEPTA. Los plazos de abajo son los del
 * contrato (`_applyEnd`, `_lastAssign`, `_settle`): un botón que sale es una
 * llamada que no va a revertir por el reloj.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSignMessage } from 'wagmi';
import { Star, User } from 'lucide-react';
import type { Address } from 'viem';
import {
  EstadoTablon,
  MARGEN_ASIGNACION_S,
  ModoTablon,
  audienciaAdmite,
  parseFilesManifest,
  stripFilesManifest,
  type EncargoConReglas,
  type OfertaConReglas,
} from '@panal/sdk';
import HexAvatar from '@/components/HexAvatar';
import { useAhora } from '@/hooks/useAhora';
import { useFirmaDelTablon } from '@/hooks/useFirmaDelTablon';
import { useLogoDeAgente } from '@/hooks/useLogoDeAgente';
import { useDeudaDelTablon, useReglasDelTablon, type DatosDelTablon } from '@/hooks/useTablonReglas';
import {
  MONEDAS_TABLON,
  credencialTablon,
  credencialVigente,
  enTablon,
  firmarYEsperar,
  leerEntregaConFirma,
  permitirPanal,
  simboloDe,
  type CredencialTablon,
  type TareaDelTablon,
} from '@/lib/tablonReglas';
import { hayEntrega } from '@/lib/expedientes';
import { cn } from '@/lib/utils';
import { ListaDeArchivos } from './Archivos';
import { Chip, Girando, Importe, NombreDeCategoria } from './comun';
import { BOTON_LINEA, BOTON_MIEL, BOTON_OLIVA, BOTON_PELIGRO, cantidad, useAgenteDe, useDuracion, useFecha } from './util';

/** Estados del escrow (PanalEscrowV2.Status). */
const ABIERTA = 0;
const ENTREGADA = 1;
const COMPLETADA = 2;
const EN_DISPUTA = 3;
const CANCELADA = 4;

export default function MisEncargos({ datos, yo }: { datos: DatosDelTablon; yo: Address }) {
  const { t } = useTranslation();
  const { data: deuda } = useDeudaDelTablon(yo);
  const { ejecutar, ocupado } = useFirmaDelTablon();

  const mios = useMemo(
    () => datos.encargos.filter((j) => j.cliente.toLowerCase() === yo.toLowerCase()),
    [datos.encargos, yo],
  );
  const enMarcha = mios.filter((j) => j.estado === EstadoTablon.Publicado || j.estado === EstadoTablon.Asignado);
  const terminados = mios.filter((j) => j.estado !== EstadoTablon.Publicado && j.estado !== EstadoTablon.Asignado);

  const porCobrar = MONEDAS_TABLON.filter((m) => (deuda?.[m.toLowerCase()] ?? 0n) > 0n);

  return (
    <section className="flex min-w-0 flex-col gap-6">
      {porCobrar.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-honey/60 bg-honey-soft/60 p-5">
          <p className="text-[0.875rem] leading-relaxed text-ink">{t('tablon.mios.porCobrar')}</p>
          <div className="flex flex-wrap gap-2">
            {porCobrar.map((m) => {
              const clave = `cobrar:${m}`;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => void ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon('claim', [m])))}
                  className={BOTON_MIEL}
                >
                  {ocupado === clave && <Girando />}
                  {t('tablon.mios.cobrar', { n: cantidad(deuda![m.toLowerCase()]!), moneda: simboloDe(m) })}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="display-s text-ink">{t('tablon.mios.enMarcha', { n: enMarcha.length })}</h2>
        {enMarcha.length === 0 ? (
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">{t('tablon.mios.vacio')}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {enMarcha.map((j) => (
              <EncargoMio key={j.id.toString()} job={j} datos={datos} yo={yo} />
            ))}
          </ul>
        )}
      </div>

      {terminados.length > 0 && (
        <div>
          <h2 className="display-s text-ink">{t('tablon.mios.terminados')}</h2>
          <ul className="mt-5 flex flex-col gap-3">
            {terminados.map((j) => (
              <EncargoMio key={j.id.toString()} job={j} datos={datos} yo={yo} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function EncargoMio({ job, datos, yo }: { job: EncargoConReglas; datos: DatosDelTablon; yo: Address }) {
  const { t } = useTranslation();
  const ahora = useAhora();
  const duracion = useDuracion();
  const fecha = useFecha();
  const agenteDe = useAgenteDe();
  const logoDe = useLogoDeAgente();
  const { data: reglas } = useReglasDelTablon();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const { signMessageAsync } = useSignMessage();
  const [entrega, setEntrega] = useState<string | null>(null);
  // La firma con la que se abrió la entrega: abre también sus archivos.
  const [cred, setCred] = useState<CredencialTablon | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [nota, setNota] = useState(5);
  const [soloPersonas, setSoloPersonas] = useState(false);

  const id = job.id.toString();
  const anuncio = datos.anuncios.get(id);
  /**
   * Solo personas o solo agentes: se enseñan y se eligen solo esas ofertas. El
   * contrato dejaría elegir cualquiera; quien publicó dijo para quién era.
   */
  const audiencia = datos.audiencias.get(id) ?? 'todos';
  const admite = (o: OfertaConReglas) => audienciaAdmite(audiencia, agenteDe(o.agente).persona ? 'persona' : 'bot');
  const tarea: TareaDelTablon | undefined =
    job.estado === EstadoTablon.Asignado || job.estado === EstadoTablon.Cerrado
      ? datos.tareas.get(job.escrowTaskId.toString())
      : undefined;
  const seleccion = job.modo === ModoTablon.Seleccion;
  const finOfertas = job.publicadoEn + job.ventanaOfertasS;
  const finEleccion = finOfertas + job.ventanaEleccionS;
  // El último momento en que se puede asignar (`_lastAssign` del contrato).
  const ultimo = seleccion ? Math.min(job.caducaEn, finEleccion + MARGEN_ASIGNACION_S) : job.caducaEn;
  const agente = agenteDe(job.agente);

  /** Una acción sobre este encargo: `funcion(jobId, ...args)` en el tablón. */
  const accion = (que: string, funcion: string, args: readonly unknown[] = []) => {
    const clave = `${que}:${id}`;
    return {
      clave,
      ir: () => void ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon(funcion, [job.id, ...args]))),
    };
  };
  const retirar = accion('retirar', 'withdrawJob');
  const caducar = accion('caducar', 'expire');
  const asignar = accion('asignar', 'autoAssign');
  const cerrar = accion('cerrar', 'settle');
  const aprobar = accion('aprobar', 'approve', [nota]);
  const disputar = accion('disputar', 'dispute');

  const elegir = (o: OfertaConReglas) => {
    const clave = `elegir:${id}:${o.agente}`;
    void ejecutar(clave, async (e, c) => {
      const diferencia = o.precio > job.importe ? o.precio - job.importe : 0n;
      const nativa = simboloDe(job.moneda) === 'MON';
      if (diferencia > 0n && !nativa) await permitirPanal(e, c, diferencia);
      await firmarYEsperar(e, c, enTablon('choose', [job.id, o.agente], nativa && diferencia > 0n ? diferencia : undefined));
    });
  };

  const verEntrega = () =>
    void (async () => {
      if (!tarea) return;
      setLeyendo(true);
      setErrorEntrega(null);
      try {
        const leida = await leerEntregaConFirma(
          job.id,
          tarea.resultHash,
          await credencialTablon('resultado', job.id, yo, (message) => signMessageAsync({ message })),
        );
        setCred(leida.cred);
        if (leida.texto === null) setErrorEntrega(t('tablon.mios.entregaNoEsta'));
        else setEntrega(leida.texto);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorEntrega(/user (rejected|denied)/i.test(msg) ? t('hire.step3.rejected') : t('tablon.mios.entregaError'));
      } finally {
        setLeyendo(false);
      }
    })();

  const credencialDeLaEntrega = async () => {
    if (credencialVigente(cred)) return cred;
    const nueva = await credencialTablon('resultado', job.id, yo, (message) => signMessageAsync({ message }));
    setCred(nueva);
    return nueva;
  };

  const descargar = () => {
    if (entrega === null) return;
    const url = URL.createObjectURL(new Blob([entrega], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `panal-tablon-${id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const boton = (a: { clave: string; ir: () => void }, estilo: string, texto: string) => (
    <button key={a.clave} type="button" onClick={a.ir} disabled={ocupado !== null} className={estilo}>
      {ocupado === a.clave && <Girando />}
      {texto}
    </button>
  );

  /* ── en qué punto está, y qué se puede hacer ── */

  let estado: ReactNode = null;
  let acciones: ReactNode = null;
  let ofertas: OfertaConReglas[] | null = null;
  let puedeElegir = false;

  if (job.estado === EstadoTablon.Publicado) {
    if (ahora > ultimo) {
      estado = t('tablon.mios.nadieATiempo');
      acciones = boton(caducar, BOTON_MIEL, t('tablon.mios.recuperar'));
    } else if (!seleccion) {
      estado = t('tablon.mios.esperando', { dur: duracion(job.caducaEn - ahora) });
      acciones = boton(retirar, BOTON_LINEA, t('tablon.mios.retirar'));
    } else {
      ofertas = ordenarOfertas(datos.ofertas.get(id) ?? [], job.importe);
      if (ahora < finOfertas) {
        estado = t('tablon.mios.recibiendo', { dur: duracion(finOfertas - ahora), n: ofertas.length });
      } else if (ahora <= Math.min(finEleccion, job.caducaEn)) {
        estado = t('tablon.mios.elige', { cuando: fecha(Math.min(finEleccion, job.caducaEn)) });
        puedeElegir = true;
      } else {
        estado = t('tablon.mios.sinElegir');
      }
      acciones = (
        <>
          {!puedeElegir && ahora >= finEleccion && ofertas.length > 0 && (
            boton(asignar, BOTON_MIEL, t('tablon.mios.asignar'))
          )}
          {boton(retirar, BOTON_LINEA, t('tablon.mios.retirar'))}
        </>
      );
    }
  } else if (job.estado === EstadoTablon.Asignado && tarea) {
    const verBoton = hayEntrega(tarea.resultHash) && (
      <button type="button" onClick={verEntrega} disabled={leyendo} className={BOTON_LINEA}>
        {leyendo && <Girando />}
        {t('tablon.mios.verEntrega')}
      </button>
    );
    if (tarea.estado === ABIERTA) {
      if (ahora > tarea.plazo) {
        estado = t('tablon.mios.noEntrego');
        acciones = boton(cerrar, BOTON_MIEL, t('tablon.mios.recuperar'));
      } else {
        estado = t('tablon.mios.trabajando', { cuando: fecha(tarea.plazo) });
      }
    } else if (tarea.estado === ENTREGADA) {
      const libre = reglas ? tarea.entregadaEn + reglas.liberacionS : null;
      estado = libre && ahora >= libre ? t('tablon.mios.entregadaLibre') : t('tablon.mios.entregada', { cuando: libre ? fecha(libre) : '…' });
      acciones = (
        <>
          {verBoton}
          <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label={t('tasks.dialog.approve.ratingLabel')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={nota === n} onClick={() => setNota(n)} className="p-0.5" title={String(n)}>
                <Star size={15} className={n <= nota ? 'fill-honey text-honey' : 'text-ink-3'} aria-hidden />
              </button>
            ))}
          </span>
          {boton(aprobar, BOTON_OLIVA, t('tablon.mios.aprobar'))}
          {boton(disputar, BOTON_PELIGRO, t('tablon.mios.disputar'))}
          {libre !== null && ahora >= libre && boton(cerrar, BOTON_LINEA, t('tablon.mios.cerrar'))}
        </>
      );
    } else if (tarea.estado === EN_DISPUTA) {
      const atascada = reglas ? tarea.disputadaEn + reglas.disputaS : null;
      estado = t('tablon.mios.enDisputa');
      acciones = (
        <>
          {verBoton}
          {atascada !== null && ahora >= atascada && boton(cerrar, BOTON_MIEL, t('tablon.mios.recuperar'))}
        </>
      );
    } else {
      // El escrow ya terminó (resuelta o cancelada) y el tablón aún no cerró cuentas.
      estado = tarea.estado === COMPLETADA ? t('tablon.mios.pagadaSinCerrar') : t('tablon.mios.canceladaSinCerrar');
      acciones = (
        <>
          {verBoton}
          {boton(cerrar, BOTON_MIEL, t('tablon.mios.cerrar'))}
        </>
      );
    }
  } else if (job.estado === EstadoTablon.Cerrado) {
    estado = job.devolucionPendiente
      ? t('tablon.mios.repartoPendiente')
      : tarea?.estado === CANCELADA
        ? t('tablon.mios.devuelto')
        : t('tablon.mios.pagado');
    acciones = tarea && hayEntrega(tarea.resultHash) && (
      <button type="button" onClick={verEntrega} disabled={leyendo} className={BOTON_LINEA}>
        {leyendo && <Girando />}
        {t('tablon.mios.verEntrega')}
      </button>
    );
  } else {
    estado = job.estado === EstadoTablon.Retirado ? t('tablon.mios.retirado') : t('tablon.mios.caducado');
  }

  const terminado = job.estado !== EstadoTablon.Publicado && job.estado !== EstadoTablon.Asignado;
  // La que elegiría `autoAssign`, se filtre o no: la primera que cabe en el presupuesto.
  const mejor = ofertas?.find((o) => o.precio <= job.importe);

  return (
    <li className={cn('rounded-2xl border border-line bg-paper p-5', terminado ? 'opacity-80' : 'shadow-card')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn('whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55]', anuncio ? 'text-ink' : 'italic text-ink-3')}>
            {anuncio ?? t('tablon.sinAnuncio')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip tono="miel">
              <NombreDeCategoria numero={job.categoria} />
            </Chip>
            <Chip>{seleccion ? t('tablon.modo.seleccion') : t('tablon.modo.inmediato')}</Chip>
            {audiencia !== 'todos' && <Chip tono="oliva">{t(`tablon.audiencia.${audiencia}`)}</Chip>}
            <span className="font-mono text-[12px] text-ink-3">#{id}</span>
          </div>
        </div>
        <Importe wei={job.importe} moneda={job.moneda} className="text-right text-[0.9375rem] font-semibold" />
      </div>

      {job.estado >= EstadoTablon.Asignado && job.estado <= EstadoTablon.Cerrado && job.agente !== '0x0000000000000000000000000000000000000000' && (
        <div className="mt-3 flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <HexAvatar seed={job.agente} size={24} logo={logoDe(job.agente)} />
          {agente.ruta ? (
            <Link to={agente.ruta} className="font-medium text-ink hover:text-honey-deep">
              {agente.nombre}
            </Link>
          ) : (
            <span className="font-mono">{agente.nombre}</span>
          )}
          {agente.persona && <EtiquetaPersona />}
        </div>
      )}

      {estado && <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-2">{estado}</p>}

      {ofertas && ofertas.length > 0 && audiencia !== 'todos' && (
        <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-3">{t(`tablon.mios.soloAudiencia.${audiencia}`)}</p>
      )}

      {ofertas && ofertas.length > 0 && audiencia === 'todos' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={soloPersonas}
            onClick={() => setSoloPersonas((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[0.75rem] font-medium transition-colors',
              soloPersonas ? 'border-olive/40 bg-olive/10 text-olive' : 'border-line text-ink-2 hover:border-honey',
            )}
          >
            <User size={12} aria-hidden />
            {t('tablon.mios.soloPersonas', { n: ofertas.filter((o) => agenteDe(o.agente).persona).length })}
          </button>
          {soloPersonas && <span className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.mios.soloPersonasNota')}</span>}
        </div>
      )}

      {ofertas && ofertas.length > 0 && soloPersonas && !ofertas.some((o) => agenteDe(o.agente).persona) && (
        <p className="mt-3 text-[0.8125rem] text-ink-3">{t('tablon.mios.sinPersonas')}</p>
      )}

      {ofertas && ofertas.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-xl border border-line empty:hidden">
          {ofertas.filter((o) => (!soloPersonas || agenteDe(o.agente).persona) && admite(o)).map((o) => {
            const a = agenteDe(o.agente);
            const clave = `elegir:${id}:${o.agente}`;
            const diferencia = o.precio > job.importe ? o.precio - job.importe : 0n;
            return (
              <li key={o.agente} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <HexAvatar seed={o.agente} size={28} logo={logoDe(o.agente)} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                    {a.ruta ? (
                      <Link to={a.ruta} className="font-medium text-ink hover:text-honey-deep">
                        {a.nombre}
                      </Link>
                    ) : (
                      <span className="font-mono text-ink">{a.nombre}</span>
                    )}
                    {a.persona && <EtiquetaPersona />}
                    <Chip tono={o.nivel > 0 ? 'oliva' : 'neutro'}>{t('tablon.nivel', { n: o.nivel })}</Chip>
                    {o === mejor && <Chip tono="miel">{t('tablon.mios.mejor')}</Chip>}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-3">{t('tablon.entregaEn', { dur: duracion(o.plazoEntregaS) })}</p>
                  {diferencia > 0n && (
                    <p className="mt-0.5 text-[0.75rem] text-honey-deep">
                      {t('tablon.mios.diferencia', { n: cantidad(diferencia), moneda: simboloDe(job.moneda) })}
                    </p>
                  )}
                </div>
                <Importe wei={o.precio} moneda={job.moneda} className="text-right text-[0.875rem] font-semibold" />
                {puedeElegir && (
                  <button type="button" onClick={() => elegir(o)} disabled={ocupado !== null} className={BOTON_MIEL}>
                    {ocupado === clave && <Girando />}
                    {t('tablon.mios.elegir')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {acciones && <div className="mt-4 flex flex-wrap items-center gap-2">{acciones}</div>}

      {errorEntrega && <p className="mt-3 text-[0.8125rem] text-terra">{errorEntrega}</p>}
      {entrega !== null && (
        <div className="mt-4 rounded-xl border border-line bg-cream p-4">
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink">
            {stripFilesManifest(entrega)}
          </p>
          <ListaDeArchivos
            jobId={job.id}
            archivos={parseFilesManifest(entrega)}
            de="entrega"
            credencial={credencialDeLaEntrega}
            titulo={t('tablon.archivos.deLaEntrega')}
          />
          <button type="button" onClick={descargar} className={cn(BOTON_LINEA, 'mt-3')}>
            {t('tablon.mios.descargar')}
          </button>
        </div>
      )}
    </li>
  );
}

/** «Persona», como la declara su ficha. */
function EtiquetaPersona() {
  const { t } = useTranslation();
  return (
    <Chip>
      <User size={11} className="mr-1" aria-hidden />
      {t('tablon.persona')}
    </Chip>
  );
}

/**
 * Las ofertas en el orden en que las elegiría `autoAssign`: nivel más alto;
 * a igualdad, precio más bajo, plazo más corto y la primera en llegar. Las que
 * piden más que el presupuesto van al final: solo las elige el cliente.
 */
function ordenarOfertas(ofertas: OfertaConReglas[], presupuesto: bigint): OfertaConReglas[] {
  return [...ofertas].sort((a, b) => {
    const fa = a.precio > presupuesto ? 1 : 0;
    const fb = b.precio > presupuesto ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (a.nivel !== b.nivel) return b.nivel - a.nivel;
    if (a.precio !== b.precio) return a.precio < b.precio ? -1 : 1;
    if (a.plazoEntregaS !== b.plazoEntregaS) return a.plazoEntregaS - b.plazoEntregaS;
    return a.orden < b.orden ? -1 : 1;
  });
}
