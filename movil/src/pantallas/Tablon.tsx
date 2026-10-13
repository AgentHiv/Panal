import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import {
  CATEGORIAS_TABLON,
  EstadoTablon,
  MARGEN_ASIGNACION_S,
  MAX_CATEGORIAS,
  ModoTablon,
  type EncargoConReglas,
  type OfertaConReglas,
} from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import {
  useDeudaDelTablon,
  usePermisosEnElTablon,
  useReglasDelTablon,
  useSituacionEnElTablon,
  useTablonReglas,
  type DatosDelTablon,
} from '@/hooks/useTablonReglas';
import { claveDeMotivo, enTablon, firmarYEsperar, leerEntrega, MONEDAS_TABLON, simboloDe } from '@/lib/tablonReglas';
import { hayEntrega } from '@/lib/expedientes';
import Menu from '~/componentes/Menu';
import Icono from '~/componentes/Icono';
import HojasDelTablon, { type HojaAbierta } from '~/componentes/tablon/Hojas';
import { Accion, Categoria, Etiqueta, Importe } from '~/componentes/tablon/Piezas';
import { ESCROW, duracion, fecha } from '~/componentes/tablon/util';
import { SIN_PAGOS } from '~/lib/canal';
import { explicarFallo, useFirmaTablon } from '~/lib/usarFirmaTablon';
import { monto } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * El tablón con reglas (PanalTablon) en la app.
 *
 * Las lecturas y las firmas son las de la web (`src/lib/tablonReglas.ts`,
 * `src/hooks/useTablonReglas.ts`); aquí solo cambia cómo se enseña. Tres
 * vistas, porque son tres personas: quien busca trabajo, quien publicó y quien
 * trabaja.
 *
 * EN LA VERSIÓN DE PLAY no se publica ni se paga una diferencia: pagar a un
 * agente por un trabajo desde la app es lo que Play no permite (ver
 * `lib/canal.ts`). Coger, ofertar, entregar, y aprobar o disputar lo que se
 * publicó desde otro sitio, sí.
 */

type Vista = 'abiertos' | 'mios' | 'trabajo';
type Firma = ReturnType<typeof useFirmaTablon>;
type Abrir = (h: HojaAbierta) => void;

export default function Tablon(): React.ReactElement {
  const T = useTextos();
  const { address, connected, connect, connecting } = useWallet();
  const yo = (connected && address ? address : null) as Address | null;
  const perfil = useMyAgentProfile();
  const esAgente = perfil.isAgent && perfil.isActive;
  const [vista, setVista] = useState<Vista>('abiertos');
  const [hoja, setHoja] = useState<HojaAbierta | null>(null);
  const firma = useFirmaTablon();

  const { data: datos, isLoading, isError, refetch } = useTablonReglas(yo);
  const { data: reglas } = useReglasDelTablon();
  const { data: situacion } = useSituacionEnElTablon(esAgente ? yo : null);
  const publicados = useMemo(
    () => (datos?.encargos ?? []).filter((j) => j.estado === EstadoTablon.Publicado).map((j) => j.id),
    [datos],
  );
  const { data: permisos } = usePermisosEnElTablon(esAgente ? yo : null, publicados);

  const beta = useMemo(() => {
    if (!reglas) return null;
    const partes = Object.entries(reglas.topes)
      .filter(([, t]) => t.porEncargo !== 0n)
      .map(([m, t]) => `${monto(t.porEncargo)} ${simboloDe(m as Address)}`);
    return partes.length ? T.tablon.beta(partes.join(` ${T.tablon.o} `)) : null;
  }, [reglas, T]);

  const abrir: Abrir = (h) => {
    firma.limpiar();
    setHoja(h);
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">{T.tablon.titulo}</h1>
        <div className="flex items-center gap-2">
          {!SIN_PAGOS && yo && (
            <button
              type="button"
              onClick={() => abrir({ tipo: 'publicar' })}
              className="pulsable flex h-9 items-center gap-1 rounded-full bg-honey px-3.5 text-[13px] font-semibold text-[#1B1814]"
            >
              <Icono nombre="mas" tamano={16} color="#1B1814" />
              {T.tablon.publicar.boton}
            </button>
          )}
          <Menu />
        </div>
      </header>
      {beta && <p className="shrink-0 px-5 pb-2 text-[11.5px] text-ink-3">{beta}</p>}

      <div className="shrink-0 px-3 pb-2">
        <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-cream p-1" role="tablist">
          {(['abiertos', 'mios', 'trabajo'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={vista === v}
              onClick={() => setVista(v)}
              className={`pulsable h-9 rounded-full text-[13px] font-semibold ${vista === v ? 'bg-sand text-ink' : 'text-ink-3'}`}
            >
              {T.tablon.vistas[v]}
            </button>
          ))}
        </div>
      </div>

      {firma.resultado && !hoja && (
        <p
          className={`mx-3 mb-2 shrink-0 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-[1.45] ${
            firma.resultado.bien ? 'bg-olive/10 text-olive' : 'bg-terra/10 text-terra'
          }`}
        >
          {firma.resultado.texto}
        </p>
      )}

      <div className="min-h-0 grow overflow-y-auto px-3 pb-4">
        {isLoading ? (
          <p className="px-2 pt-6 text-center text-[13.5px] text-ink-3">{T.tablon.cargando}</p>
        ) : isError || !datos ? (
          <div className="flex flex-col items-center gap-3 pt-6">
            <p className="text-[13.5px] text-ink-3">{T.tablon.errorCarga}</p>
            <Accion onClick={() => void refetch()}>{T.tablon.reintentar}</Accion>
          </div>
        ) : vista === 'abiertos' ? (
          <Abiertos datos={datos} yo={yo} esAgente={esAgente} misCategorias={situacion?.categorias ?? []} permisos={permisos} firma={firma} abrir={abrir} T={T} />
        ) : !yo ? (
          <div className="flex flex-col items-center gap-3 pt-6 text-center">
            <p className="text-[13.5px] leading-relaxed text-ink-3">{T.tablon.conecta}</p>
            <Accion tono="miel" onClick={connect} disabled={connecting}>
              {connecting ? T.comun.conectando : T.comun.conectarWallet}
            </Accion>
          </div>
        ) : vista === 'mios' ? (
          <Mios datos={datos} yo={yo} firma={firma} abrir={abrir} T={T} />
        ) : (
          <Trabajo datos={datos} yo={yo} esAgente={esAgente} firma={firma} abrir={abrir} T={T} />
        )}
      </div>

      <HojasDelTablon hoja={hoja} firma={firma} onCerrar={() => setHoja(null)} />
    </div>
  );
}

/* ── abiertos ─────────────────────────────────────────────────────────── */

function Abiertos({
  datos,
  yo,
  esAgente,
  misCategorias,
  permisos,
  firma,
  abrir,
  T,
}: {
  datos: DatosDelTablon;
  yo: Address | null;
  esAgente: boolean;
  misCategorias: number[];
  permisos: Map<string, { ok: boolean; motivo: string }> | undefined;
  firma: Firma;
  abrir: Abrir;
  T: Textos;
}) {
  const ahora = useAhora();
  const [filtro, setFiltro] = useState<string>('todas');
  const lista = datos.encargos.filter((j) => {
    if (j.estado !== EstadoTablon.Publicado || ahora > j.caducaEn) return false;
    if (j.modo === ModoTablon.Seleccion && ahora >= j.publicadoEn + j.ventanaOfertasS) return false;
    if (filtro === 'mias') return misCategorias.includes(j.categoria);
    if (filtro !== 'todas') return j.categoria === Number(filtro);
    return true;
  });

  return (
    <>
      <select
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="mb-2 h-9 w-full rounded-full border border-line bg-cream px-3 text-[13px] text-ink-2 outline-none"
      >
        <option value="todas">{T.tablon.todas}</option>
        {misCategorias.length > 0 && <option value="mias">{T.tablon.mias}</option>}
        {CATEGORIAS_TABLON.map((c, i) => (
          <option key={c} value={i}>
            {T.tablon.cat[c]}
          </option>
        ))}
      </select>

      {lista.length === 0 && <p className="px-2 pt-6 text-center text-[13.5px] leading-relaxed text-ink-3">{T.tablon.vacio}</p>}

      <ul className="flex flex-col gap-2">
        {lista.map((j) => {
          const id = j.id.toString();
          const seleccion = j.modo === ModoTablon.Seleccion;
          const ofertas = datos.ofertas.get(id) ?? [];
          const mia = yo ? ofertas.find((o) => o.agente.toLowerCase() === yo.toLowerCase()) : undefined;
          const esMio = !!yo && j.cliente.toLowerCase() === yo.toLowerCase();
          const permiso = permisos?.get(id);
          const motivo =
            esAgente && permiso && !permiso.ok && permiso.motivo !== 'own job'
              ? ((T.tablon.motivo as Record<string, string>)[claveDeMotivo(permiso.motivo)] ?? permiso.motivo)
              : null;
          const claveRetirar = `retirar:${id}`;
          return (
            <li key={id} className="rounded-2xl bg-cream p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className={`min-w-0 break-words text-[14px] leading-[1.45] ${datos.anuncios.get(id) ? 'text-ink' : 'italic text-ink-3'}`}>
                  {datos.anuncios.get(id) ?? T.tablon.sinAnuncio}
                </p>
                <Importe wei={j.importe} moneda={j.moneda} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Categoria numero={j.categoria} />
                <Etiqueta>{seleccion ? T.tablon.seleccion : T.tablon.inmediato}</Etiqueta>
                {j.soloConExperiencia && <Etiqueta tono="oliva">{T.tablon.conExperiencia}</Etiqueta>}
                {esMio && <Etiqueta tono="miel">{T.tablon.esTuyo}</Etiqueta>}
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-ink-3">
                #{id} · {T.tablon.entregaEn(duracion(j.plazoEntregaS))} ·{' '}
                {seleccion
                  ? T.tablon.ofertasQuedan(duracion(j.publicadoEn + j.ventanaOfertasS - ahora), ofertas.length)
                  : T.tablon.quedan(duracion(j.caducaEn - ahora))}
              </p>
              {seleccion && <p className="mt-1 text-[11px] text-ink-3">{T.tablon.presupuesto}</p>}
              {motivo && <p className="mt-2 text-[12px] leading-[1.45] text-terra">{motivo}</p>}
              {!esMio && yo && esAgente && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {mia && (
                    <span className="text-[12px] text-ink-2">
                      {T.tablon.tuOferta(monto(mia.precio), simboloDe(j.moneda), duracion(mia.plazoEntregaS))}
                    </span>
                  )}
                  {seleccion ? (
                    <>
                      <Accion tono="miel" onClick={() => abrir({ tipo: 'oferta', job: j, previa: mia })} disabled={!permiso?.ok || firma.ocupado !== null}>
                        {T.tablon.ofertar}
                      </Accion>
                      {mia && (
                        <Accion
                          tono="peligro"
                          disabled={firma.ocupado !== null}
                          onClick={() => void firma.ejecutar(claveRetirar, (e, c) => firmarYEsperar(e, c, enTablon('withdrawOffer', [j.id])))}
                        >
                          {firma.ocupado === claveRetirar ? '…' : T.tablon.retirarOferta}
                        </Accion>
                      )}
                    </>
                  ) : (
                    <Accion tono="miel" onClick={() => abrir({ tipo: 'coger', job: j })} disabled={!permiso?.ok || firma.ocupado !== null}>
                      {T.tablon.coger}
                    </Accion>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {yo && !esAgente && lista.length > 0 && (
        <p className="mt-3 rounded-xl bg-sand px-3.5 py-3 text-[12px] leading-[1.5] text-ink-3">
          {T.tablon.paraCoger}{' '}
          <Link to="/agentes" className="font-semibold text-honey">
            →
          </Link>
        </p>
      )}
    </>
  );
}

/* ── míos ─────────────────────────────────────────────────────────────── */

function Mios({ datos, yo, firma, abrir, T }: { datos: DatosDelTablon; yo: Address; firma: Firma; abrir: Abrir; T: Textos }) {
  const { data: deuda } = useDeudaDelTablon(yo);
  const mios = datos.encargos.filter((j) => j.cliente.toLowerCase() === yo.toLowerCase());
  const enMarcha = mios.filter((j) => j.estado === EstadoTablon.Publicado || j.estado === EstadoTablon.Asignado);
  const terminados = mios.filter((j) => j.estado !== EstadoTablon.Publicado && j.estado !== EstadoTablon.Asignado);
  const porCobrar = MONEDAS_TABLON.filter((m) => (deuda?.[m.toLowerCase()] ?? 0n) > 0n);

  return (
    <div className="flex flex-col gap-3">
      {porCobrar.length > 0 && (
        <div className="rounded-2xl border border-honey-line bg-honey-soft p-3.5">
          <p className="text-[12.5px] leading-[1.5] text-ink">{T.tablon.mios.porCobrar}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {porCobrar.map((m) => {
              const clave = `cobrar:${m}`;
              return (
                <Accion
                  key={m}
                  tono="miel"
                  disabled={firma.ocupado !== null}
                  onClick={() => void firma.ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon('claim', [m])))}
                >
                  {firma.ocupado === clave ? '…' : T.tablon.mios.cobrar(monto(deuda![m.toLowerCase()]!), simboloDe(m))}
                </Accion>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="px-1 pt-1 text-[15px] font-semibold">{T.tablon.mios.enMarcha(enMarcha.length)}</h2>
      {enMarcha.length === 0 && <p className="px-1 text-[13px] text-ink-3">{T.tablon.mios.vacio}</p>}
      <ul className="flex flex-col gap-2">
        {enMarcha.map((j) => (
          <EncargoMio key={j.id.toString()} job={j} datos={datos} yo={yo} firma={firma} abrir={abrir} T={T} />
        ))}
      </ul>

      {terminados.length > 0 && (
        <>
          <h2 className="px-1 pt-2 text-[15px] font-semibold">{T.tablon.mios.terminados}</h2>
          <ul className="flex flex-col gap-2">
            {terminados.map((j) => (
              <EncargoMio key={j.id.toString()} job={j} datos={datos} yo={yo} firma={firma} abrir={abrir} T={T} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Las ofertas en el orden de `autoAssign`; las que pasan del presupuesto, al final. */
function ordenar(ofertas: OfertaConReglas[], presupuesto: bigint): OfertaConReglas[] {
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

/** Si la ficha de un agente dice que es una persona. Lo declara cada uno: el contrato no lo sabe. */
function useEsPersona(): (direccion: string) => boolean {
  const { agents } = usePanalAgents();
  return useMemo(() => {
    const personas = new Set(agents.filter((a) => a.type === 'humano').map((a) => a.workerAddress.toLowerCase()));
    return (d: string) => personas.has(d.toLowerCase());
  }, [agents]);
}

function useNombreDe(): (direccion: string) => string {
  const { agents } = usePanalAgents();
  return useMemo(() => {
    const mapa = new Map(agents.map((a) => [a.workerAddress.toLowerCase(), a.name]));
    return (d: string) => mapa.get(d.toLowerCase()) ?? `${d.slice(0, 6)}…${d.slice(-4)}`;
  }, [agents]);
}

function EncargoMio({ job, datos, yo, firma, abrir, T }: { job: EncargoConReglas; datos: DatosDelTablon; yo: Address; firma: Firma; abrir: Abrir; T: Textos }) {
  const ahora = useAhora();
  const nombreDe = useNombreDe();
  const esPersona = useEsPersona();
  const { data: reglas } = useReglasDelTablon();
  const { signMessageAsync } = useSignMessage();
  const [soloPersonas, setSoloPersonas] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const M = T.tablon.mios;
  const id = job.id.toString();
  const tarea =
    job.estado === EstadoTablon.Asignado || job.estado === EstadoTablon.Cerrado ? datos.tareas.get(job.escrowTaskId.toString()) : undefined;
  const seleccion = job.modo === ModoTablon.Seleccion;
  const finOfertas = job.publicadoEn + job.ventanaOfertasS;
  const finEleccion = finOfertas + job.ventanaEleccionS;
  const ultimo = seleccion ? Math.min(job.caducaEn, finEleccion + MARGEN_ASIGNACION_S) : job.caducaEn;

  const directa = (que: string, funcion: string, args: readonly unknown[] = []) => {
    const clave = `${que}:${id}`;
    return (
      <Accion
        key={clave}
        tono={que === 'retirar' ? 'linea' : 'miel'}
        disabled={firma.ocupado !== null}
        onClick={() => void firma.ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon(funcion, [job.id, ...args])))}
      >
        {firma.ocupado === clave ? '…' : que === 'retirar' ? M.retirar : que === 'asignar' ? M.asignar : que === 'cerrar' ? M.cerrar : M.recuperar}
      </Accion>
    );
  };

  const verEntrega = async () => {
    if (!tarea) return;
    setLeyendo(true);
    setError(null);
    try {
      const texto = await leerEntrega(job.id, tarea.resultHash, yo, (message) => signMessageAsync({ message }));
      if (texto === null) setError(M.entregaNoEsta);
      else abrir({ tipo: 'texto', titulo: T.tablon.entrega.titulo, texto });
    } catch (err) {
      setError(err instanceof Error && /no cuadra|HTTP/.test(err.message) ? M.entregaError : explicarFallo(err, T));
    } finally {
      setLeyendo(false);
    }
  };
  const botonEntrega =
    tarea && hayEntrega(tarea.resultHash) ? (
      <Accion key="ver" onClick={() => void verEntrega()} disabled={leyendo}>
        {leyendo ? '…' : M.verEntrega}
      </Accion>
    ) : null;

  let estado = '';
  const acciones: React.ReactNode[] = [];
  let ofertas: OfertaConReglas[] = [];
  let puedeElegir = false;

  if (job.estado === EstadoTablon.Publicado) {
    if (ahora > ultimo) {
      estado = M.nadieATiempo;
      acciones.push(directa('caducar', 'expire'));
    } else if (!seleccion) {
      estado = M.esperando(duracion(job.caducaEn - ahora));
      acciones.push(directa('retirar', 'withdrawJob'));
    } else {
      ofertas = ordenar(datos.ofertas.get(id) ?? [], job.importe);
      if (ahora < finOfertas) estado = M.recibiendo(duracion(finOfertas - ahora), ofertas.length);
      else if (ahora <= Math.min(finEleccion, job.caducaEn)) {
        estado = M.elige(fecha(Math.min(finEleccion, job.caducaEn)));
        puedeElegir = true;
      } else {
        estado = M.sinElegir;
        if (ofertas.length > 0) acciones.push(directa('asignar', 'autoAssign'));
      }
      acciones.push(directa('retirar', 'withdrawJob'));
    }
  } else if (job.estado === EstadoTablon.Asignado && tarea) {
    if (tarea.estado === ESCROW.abierta) {
      if (ahora > tarea.plazo) {
        estado = M.noEntrego;
        acciones.push(directa('recuperar', 'settle'));
      } else estado = M.trabajando(fecha(tarea.plazo));
    } else if (tarea.estado === ESCROW.entregada) {
      const libre = reglas ? tarea.entregadaEn + reglas.liberacionS : null;
      estado = libre !== null && ahora >= libre ? M.entregadaLibre : M.entregada(libre ? fecha(libre) : '…');
      if (botonEntrega) acciones.push(botonEntrega);
      acciones.push(
        <Accion key="aprobar" tono="miel" onClick={() => abrir({ tipo: 'aprobar', job })} disabled={firma.ocupado !== null}>
          {M.aprobar}
        </Accion>,
        <Accion key="disputar" tono="peligro" onClick={() => abrir({ tipo: 'disputar', job })} disabled={firma.ocupado !== null}>
          {M.disputar}
        </Accion>,
      );
      if (libre !== null && ahora >= libre) acciones.push(directa('cerrar', 'settle'));
    } else if (tarea.estado === ESCROW.enDisputa) {
      estado = M.enDisputa;
      if (botonEntrega) acciones.push(botonEntrega);
      if (reglas && ahora >= tarea.disputadaEn + reglas.disputaS) acciones.push(directa('recuperar', 'settle'));
    } else {
      estado = tarea.estado === ESCROW.completada ? M.pagadaSinCerrar : M.canceladaSinCerrar;
      if (botonEntrega) acciones.push(botonEntrega);
      acciones.push(directa('cerrar', 'settle'));
    }
  } else if (job.estado === EstadoTablon.Cerrado) {
    estado = job.devolucionPendiente ? M.repartoPendiente : tarea?.estado === ESCROW.cancelada ? M.devuelto : M.pagado;
    if (botonEntrega) acciones.push(botonEntrega);
  } else {
    estado = job.estado === EstadoTablon.Retirado ? M.retirado : M.caducado;
  }

  const terminado = job.estado !== EstadoTablon.Publicado && job.estado !== EstadoTablon.Asignado;
  // La que elegiría `autoAssign`, se filtre o no: la primera que cabe en el presupuesto.
  const mejor = ofertas.find((o) => o.precio <= job.importe);

  return (
    <li className={`rounded-2xl bg-cream p-3.5 ${terminado ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`min-w-0 break-words text-[14px] leading-[1.45] ${datos.anuncios.get(id) ? 'text-ink' : 'italic text-ink-3'}`}>
          {datos.anuncios.get(id) ?? T.tablon.sinAnuncio}
        </p>
        <Importe wei={job.importe} moneda={job.moneda} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Categoria numero={job.categoria} />
        <Etiqueta>{seleccion ? T.tablon.seleccion : T.tablon.inmediato}</Etiqueta>
        <span className="font-mono text-[11px] text-ink-3">#{id}</span>
      </div>
      {job.estado >= EstadoTablon.Asignado && job.estado <= EstadoTablon.Cerrado && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          {nombreDe(job.agente)}
          {esPersona(job.agente) && <Etiqueta>{T.tablon.persona}</Etiqueta>}
        </p>
      )}
      <p className="mt-1.5 text-[12.5px] leading-[1.45] text-ink-2">{estado}</p>

      {ofertas.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <button
            type="button"
            aria-pressed={soloPersonas}
            onClick={() => setSoloPersonas((v) => !v)}
            className={`pulsable self-start rounded-full border px-3 py-1 text-[12px] font-medium ${
              soloPersonas ? 'border-olive/40 bg-olive/10 text-olive' : 'border-line text-ink-2'
            }`}
          >
            {M.soloPersonas(ofertas.filter((o) => esPersona(o.agente)).length)}
          </button>
          {soloPersonas && <p className="text-[11.5px] leading-[1.45] text-ink-3">{M.soloPersonasNota}</p>}
          {soloPersonas && !ofertas.some((o) => esPersona(o.agente)) && <p className="text-[12px] text-ink-3">{M.sinPersonas}</p>}
        </div>
      )}

      {ofertas.length > 0 && (
        <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-xl border border-line empty:hidden">
          {ofertas.filter((o) => !soloPersonas || esPersona(o.agente)).map((o) => {
            const diferencia = o.precio > job.importe ? o.precio - job.importe : 0n;
            const nombre = nombreDe(o.agente);
            // En Play no se paga una diferencia desde la app: esa oferta no se elige aquí.
            const elegible = puedeElegir && !(SIN_PAGOS && diferencia > 0n);
            return (
              <li key={o.agente} className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="min-w-0 grow">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                    <span className="truncate">{nombre}</span>
                    {esPersona(o.agente) && <Etiqueta>{T.tablon.persona}</Etiqueta>}
                    <Etiqueta tono={o.nivel > 0 ? 'oliva' : 'gris'}>{T.tablon.nivel(o.nivel)}</Etiqueta>
                    {o === mejor && <Etiqueta tono="miel">{M.mejor}</Etiqueta>}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-3">{T.tablon.entregaEn(duracion(o.plazoEntregaS))}</p>
                  {diferencia > 0n && <p className="mt-0.5 text-[11.5px] text-honey">{M.diferencia(monto(diferencia), simboloDe(job.moneda))}</p>}
                </div>
                <Importe wei={o.precio} moneda={job.moneda} />
                {elegible && (
                  <Accion tono="miel" onClick={() => abrir({ tipo: 'elegir', job, oferta: o, nombre })} disabled={firma.ocupado !== null}>
                    {M.elegir}
                  </Accion>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {acciones.length > 0 && <div className="mt-2.5 flex flex-wrap gap-2">{acciones}</div>}
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </li>
  );
}

/* ── mi trabajo ───────────────────────────────────────────────────────── */

function Trabajo({ datos, yo, esAgente, firma, abrir, T }: { datos: DatosDelTablon; yo: Address; esAgente: boolean; firma: Firma; abrir: Abrir; T: Textos }) {
  const ahora = useAhora();
  const { data: situacion } = useSituacionEnElTablon(esAgente ? yo : null);
  const { data: reglas } = useReglasDelTablon();
  const W = T.tablon.trabajo;
  const yoLc = yo.toLowerCase();
  const asignados = datos.encargos.filter((j) => j.estado === EstadoTablon.Asignado && j.agente.toLowerCase() === yoLc);
  const cerrados = datos.encargos.filter((j) => j.estado === EstadoTablon.Cerrado && j.agente.toLowerCase() === yoLc).slice(0, 10);
  const conOferta = datos.encargos.filter(
    (j) =>
      j.estado === EstadoTablon.Publicado &&
      j.modo === ModoTablon.Seleccion &&
      (datos.ofertas.get(j.id.toString()) ?? []).some((o) => o.agente.toLowerCase() === yoLc),
  );

  if (!esAgente) {
    return (
      <p className="rounded-xl bg-sand px-3.5 py-3 text-[12.5px] leading-[1.5] text-ink-3">
        {T.tablon.paraCoger}{' '}
        <Link to="/agentes" className="font-semibold text-honey">
          →
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {situacion && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-cream p-3.5">
          <Dato titulo={W.nivel} valor={String(situacion.nivel)} />
          {situacion.nivel === 0 ? (
            <Dato titulo={W.novato} valor={String(situacion.novatoLibres)} pista={W.novatoPista} />
          ) : (
            <Dato titulo={W.hoy} valor={`${situacion.hoyLibres} / ${situacion.cupoDiario}`} />
          )}
          <Dato titulo={W.abiertos} valor={String(situacion.abiertos)} />
          <Dato
            titulo={W.estado}
            valor={situacion.suspendidoHasta > ahora ? W.suspendido : W.alDia}
            pista={situacion.suspendidoHasta > ahora ? W.hasta(fecha(situacion.suspendidoHasta)) : undefined}
            mal={situacion.suspendidoHasta > ahora}
          />
        </div>
      )}

      {situacion && <Categorias actuales={situacion.categorias} firma={firma} T={T} />}

      <h2 className="px-1 pt-1 text-[15px] font-semibold">{W.asignados(asignados.length)}</h2>
      {asignados.length === 0 && <p className="px-1 text-[13px] text-ink-3">{W.sinAsignados}</p>}
      <ul className="flex flex-col gap-2">
        {asignados.map((j) => {
          const id = j.id.toString();
          const tarea = datos.tareas.get(j.escrowTaskId.toString());
          let estado = '…';
          let puedeEntregar = false;
          let puedeCerrar = false;
          if (tarea?.estado === ESCROW.abierta) {
            puedeEntregar = ahora <= tarea.plazo;
            estado = puedeEntregar ? W.entregaAntes(fecha(tarea.plazo)) : W.fueraDePlazo;
          } else if (tarea?.estado === ESCROW.entregada) {
            const libre = reglas ? tarea.entregadaEn + reglas.liberacionS : null;
            puedeCerrar = libre !== null && ahora >= libre;
            estado = puedeCerrar ? W.liberable : W.entregado(libre ? fecha(libre) : '…');
          } else if (tarea?.estado === ESCROW.enDisputa) {
            estado = W.enDisputa;
          } else if (tarea) {
            puedeCerrar = true;
            estado = W.terminado;
          }
          const claveCerrar = `cerrar:${id}`;
          return (
            <li key={id} className="rounded-2xl bg-cream p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-[14px] leading-[1.45] text-ink">{datos.anuncios.get(id) ?? T.tablon.sinAnuncio}</p>
                <Importe wei={j.importe} moneda={j.moneda} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Categoria numero={j.categoria} />
                <span className="font-mono text-[11px] text-ink-3">#{id}</span>
              </div>
              <p className={`mt-1.5 text-[12.5px] leading-[1.45] ${tarea?.estado === ESCROW.abierta && !puedeEntregar ? 'text-terra' : 'text-ink-2'}`}>
                {estado}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {puedeEntregar && (
                  <Accion tono="miel" onClick={() => abrir({ tipo: 'entregar', job: j })} disabled={firma.ocupado !== null}>
                    {W.entregar}
                  </Accion>
                )}
                {puedeCerrar && (
                  <Accion
                    tono="miel"
                    disabled={firma.ocupado !== null}
                    onClick={() => void firma.ejecutar(claveCerrar, (e, c) => firmarYEsperar(e, c, enTablon('settle', [j.id])))}
                  >
                    {firma.ocupado === claveCerrar ? '…' : W.cerrar}
                  </Accion>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {conOferta.length > 0 && (
        <>
          <h2 className="px-1 pt-2 text-[15px] font-semibold">{W.ofertas(conOferta.length)}</h2>
          <ul className="flex flex-col gap-2">
            {conOferta.map((j) => {
              const id = j.id.toString();
              const lista = datos.ofertas.get(id) ?? [];
              const o = lista.find((x) => x.agente.toLowerCase() === yoLc)!;
              const fin = j.publicadoEn + j.ventanaOfertasS;
              const clave = `retirar:${id}`;
              return (
                <li key={id} className="rounded-2xl bg-cream p-3.5">
                  <p className="truncate text-[13.5px] text-ink">{datos.anuncios.get(id) ?? `#${id}`}</p>
                  <p className="mt-1 text-[11.5px] leading-[1.45] text-ink-3">
                    {T.tablon.tuOferta(monto(o.precio), simboloDe(j.moneda), duracion(o.plazoEntregaS))} ·{' '}
                    {ahora < fin ? T.tablon.ofertasQuedan(duracion(fin - ahora), lista.length) : W.clienteEligiendo}
                  </p>
                  {ahora < fin && (
                    <div className="mt-2">
                      <Accion
                        tono="peligro"
                        disabled={firma.ocupado !== null}
                        onClick={() => void firma.ejecutar(clave, (e, c) => firmarYEsperar(e, c, enTablon('withdrawOffer', [j.id])))}
                      >
                        {firma.ocupado === clave ? '…' : T.tablon.retirarOferta}
                      </Accion>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {cerrados.length > 0 && (
        <>
          <h2 className="px-1 pt-2 text-[15px] font-semibold">{W.cerrados}</h2>
          <ul className="flex flex-col gap-1.5">
            {cerrados.map((j) => {
              const tarea = datos.tareas.get(j.escrowTaskId.toString());
              return (
                <li key={j.id.toString()} className="flex items-center justify-between gap-2 rounded-xl bg-cream px-3.5 py-2.5">
                  <span className="min-w-0 truncate text-[12.5px] text-ink-2">{datos.anuncios.get(j.id.toString()) ?? `#${j.id}`}</span>
                  <Etiqueta tono={tarea?.estado === ESCROW.completada ? 'oliva' : 'gris'}>
                    {tarea?.estado === ESCROW.completada ? W.cobrado : W.noCobrado}
                  </Etiqueta>
                </li>
              );
            })}
          </ul>
          <p className="px-1 text-[11.5px] leading-[1.45] text-ink-3">
            {W.retirar}{' '}
            <Link to={`/panel/${yoLc}`} className="font-semibold text-honey">
              →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function Dato({ titulo, valor, pista, mal }: { titulo: string; valor: string; pista?: string; mal?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{titulo}</span>
      <span className={`font-mono text-[18px] font-semibold ${mal ? 'text-terra' : 'text-ink'}`}>{valor}</span>
      {pista && <span className="text-[10.5px] leading-snug text-ink-3">{pista}</span>}
    </div>
  );
}

function Categorias({ actuales, firma, T }: { actuales: number[]; firma: Firma; T: Textos }) {
  const W = T.tablon.trabajo;
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
    void firma.ejecutar('categorias', async (e, c) => {
      await firmarYEsperar(e, c, enTablon('setCategories', [lista]));
      setElegidas(null);
    });

  return (
    <div className="rounded-2xl bg-cream p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{W.categorias}</h3>
        <span className="text-[11.5px] text-ink-3">{W.categoriasCuenta(lista.length, MAX_CATEGORIAS)}</span>
      </div>
      {actuales.length === 0 && elegidas === null && <p className="mt-1.5 text-[12px] leading-[1.45] text-terra">{W.sinCategorias}</p>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CATEGORIAS_TABLON.map((c, i) => {
          const on = lista.includes(i);
          return (
            <button
              key={c}
              type="button"
              onClick={() => alternar(i)}
              aria-pressed={on}
              disabled={!on && lista.length >= MAX_CATEGORIAS}
              className={`pulsable rounded-full border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${
                on ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'
              }`}
            >
              {T.tablon.cat[c]}
            </button>
          );
        })}
      </div>
      {cambiadas && (
        <div className="mt-3">
          <Accion tono="miel" onClick={guardar} disabled={firma.ocupado !== null}>
            {firma.ocupado === 'categorias' ? '…' : W.guardar}
          </Accion>
        </div>
      )}
    </div>
  );
}
