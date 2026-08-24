import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getTaskBrief } from '@/lib/taskBriefs';
import Icono from '~/componentes/Icono';
import Hoja, { Boton } from '~/componentes/Hoja';
import { useFicha, useTareasDe } from '~/lib/agentes';
import { armar, enPeriodo, periodosDe, traerEventos, traerTareas } from '~/lib/informe';
import type { Cuentas, Linea, Periodo } from '~/lib/informe';
import { informeCsv, reciboHtml } from '~/lib/recibo';
import { guardarCopia } from '~/lib/copia';
import { montoCuadro } from '~/lib/formato';
import { etiquetaIdioma, useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';
import Barras from '~/componentes/Barras';

/**
 * Informe · lo que entró y lo que se quedó.
 *
 * La cascada no es un adorno: se suma lo que de verdad se pagó, encargo por
 * encargo, en vez de multiplicar el bruto por la comisión. Con los siete
 * encargos de Audit en agosto la diferencia entre las dos formas de calcularlo
 * son quinientos $PANAL — y solo una de las dos coincide con lo que el escrow
 * tiene guardado para él. `lib/cuentas.ts` lo cuenta entero.
 *
 * Y el informe dice en su cara lo que NO enseña: lo que se cobra por mensaje
 * suelto es una transferencia del token, no un encargo, y el indexador solo
 * sigue tres contratos. Para un agente que vive del chat esto es una porción
 * pequeña, y conviene saberlo antes de dárselo a nadie.
 */
export default function Informe(): React.ReactElement {
  const { direccion } = useParams();
  const navegar = useNavigate();
  const dir = (direccion ?? '').toLowerCase();

  const { data: ficha } = useFicha(dir);
  const { data: enCadena = [] } = useTareasDe(dir);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [recibo, setRecibo] = useState<Linea | null>(null);
  const [bajando, setBajando] = useState(false);
  const T = useTextos();
  const [aviso, setAviso] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['informe', dir],
    enabled: !!dir,
    staleTime: 60_000,
    queryFn: async (): Promise<Cuentas[]> => {
      const [tareas, eventos] = await Promise.all([traerTareas(dir), traerEventos()]);
      return armar(tareas, eventos, dir);
    },
  });

  const todo = useMemo(() => consulta.data ?? [], [consulta.data]);
  const periodos = useMemo(() => periodosDe(todo), [todo]);
  const cuentas = useMemo(() => enPeriodo(todo, periodo), [todo, periodo]);

  // El brief solo está si lo escribió ESTE teléfono, o sea casi nunca cuando
  // quien mira es el dueño del agente. Se busca igual: cuando está, el recibo
  // sale completo.
  const briefDe = useMemo(() => {
    const hashes = new Map(enCadena.map((t) => [t.id.toString(), t.taskHash]));
    return (id: string): string | null => {
      const h = hashes.get(id);
      return h ? getTaskBrief(h) : null;
    };
  }, [enCadena]);

  const nombre = ficha?.nombre ?? `${dir.slice(0, 6)}…${dir.slice(-4)}`;

  const alBajar = async (): Promise<void> => {
    setBajando(true);
    setAviso(null);
    const sufijo = periodo ? periodo.clave : 'todo';
    const r = await guardarCopia(
      `panal-informe-${nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sufijo}.csv`,
      informeCsv(cuentas, nombre, dir),
      'text/csv',
    );
    setBajando(false);
    setAviso(r.ok ? T.informe.informeListo(r.donde) : T.informe.reciboFallo(r.porque));
  };

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label={T.informe.volver}
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <div className="min-w-0 grow">
          <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">
            {T.informe.titulo}
          </h1>
          <p className="truncate text-[11.5px] text-ink-3">{T.informe.subtitulo(nombre)}</p>
        </div>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        {periodos.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5">
            <Chip puesto={periodo === null} onElegir={() => setPeriodo(null)} texto={T.informe.todo} />
            {periodos.map((p) => (
              <Chip
                key={p.clave}
                puesto={periodo?.clave === p.clave}
                onElegir={() => setPeriodo(p)}
                texto={mesDe(p)}
              />
            ))}
          </div>
        )}

        {consulta.isLoading && (
          <p className="shrink-0 px-1 text-[12.5px] text-ink-3">{T.informe.leyendo}</p>
        )}

        {consulta.isError && (
          <p className="shrink-0 px-1 text-[12.5px] leading-[1.55] text-terra">
            {T.informe.indiceCaido}
          </p>
        )}

        {/* `isError` manda: si el índice no respondió, decir además «no se ha
            liquidado nada» sería afirmar algo que no se ha podido comprobar. */}
        {!consulta.isLoading && !consulta.isError && cuentas.length === 0 && (
          <p className="shrink-0 px-1 text-[12.5px] leading-[1.55] text-ink-2">
            {periodo ? T.informe.periodoVacio : T.informe.nadaLiquidado}
          </p>
        )}

        {/* El gráfico va con el bloque principal y solo con él: la segunda
            moneda se lleva aparte y sumarlas daría una barra sin significado. */}
        {cuentas.length > 0 && <Barras cuentas={cuentas[0]!} />}

        {cuentas.map((c, i) => (
          <Bloque
            key={c.moneda}
            cuentas={c}
            principal={i === 0}
            onRecibo={(l) => setRecibo(l)}
            T={T}
          />
        ))}

        {cuentas.length > 0 && (
          <>
            {/* El hueco, dicho dentro del propio informe y no en una nota al
                pie: quien se lo dé a su gestoría tiene que saber qué falta. */}
            <div className="mt-1 flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
              <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-honey">
                  {T.informe.faltanMensajesTitulo}
                </p>
                <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
                  {T.informe.faltanMensajesTexto}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={alBajar}
              disabled={bajando}
              className="pulsable tocable mt-1 flex shrink-0 items-center justify-center gap-2 rounded-full bg-monad py-3.5 text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
            >
              <Icono nombre="bajar" tamano={16} color="#fff" />
              {bajando ? T.informe.preparando : T.informe.descargar}
            </button>
            <p className="shrink-0 px-1 text-[11.5px] leading-[1.5] text-ink-3">
              {T.informe.descargarPie}
            </p>
            {aviso && <p className="shrink-0 px-1 text-[12px] text-ink-2">{aviso}</p>}
          </>
        )}
      </div>

      {recibo && (
        <HojaRecibo
          linea={recibo}
          agente={nombre}
          direccion={dir}
          brief={briefDe(recibo.id)}
          onCerrar={() => setRecibo(null)}
        />
      )}
    </div>
  );
}

/* ── un bloque por moneda ────────────────────────────────────────────────── */

function Bloque({
  cuentas: c,
  principal,
  onRecibo,
  T,
}: {
  cuentas: Cuentas;
  principal: boolean;
  onRecibo: (l: Linea) => void;
  T: Textos;
}): React.ReactElement {
  if (!principal) {
    // La segunda moneda va aparte y sin cascada: sumarla con la primera daría
    // un número que no significa nada.
    return (
      <div className="shrink-0 rounded-[14px] border border-line p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium">{T.informe.en(c.moneda)}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-3">{T.informe.aparte}</p>
          </div>
          <p className="shrink-0 font-mono text-[17px] text-monad-mist">{montoCuadro(c.neto)}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="shrink-0 rounded-[18px] border border-line bg-cream p-[18px]">
        <Escalon
          etiqueta={T.informe.facturado}
          pie={T.informe.encargosLiquidados(c.lineas.length)}
          cifra={montoCuadro(c.bruto)}
        />
        {c.devuelto > 0n && (
          <Escalon
            etiqueta={T.informe.devueltoEnDisputa}
            pie={devueltas(c, T)}
            cifra={`−${montoCuadro(c.devuelto)}`}
            color="#C9653B"
            linea
          />
        )}
        <Escalon
          etiqueta={T.informe.comision}
          pie={T.informe.comisionPie}
          cifra={`−${montoCuadro(c.comision)}`}
          color="#948DAE"
          linea
        />
        <Escalon etiqueta={T.informe.tuyo} cifra={montoCuadro(c.neto)} color="#E29A2E" grande linea />
        <p className="mt-2.5 text-right text-[11.5px] text-ink-3">{T.informe.todoEn(c.moneda)}</p>
      </div>

      <p className="mt-1 shrink-0 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        {T.informe.encargoPorEncargo}
      </p>
      <div className="shrink-0 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
        {c.lineas.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onRecibo(l)}
            className="pulsable flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
          >
            <div className="min-w-0 grow">
              <p className="text-[13px]">
                <span className="font-mono text-ink-3">#{l.id}</span>{' '}
                {dia(l.ts)} · <span className="font-mono text-[11.5px]">{l.cliente.slice(0, 6)}…</span>
              </p>
              {l.disputada && (
                <p className="mt-0.5 text-[11px] text-terra">{T.informe.disputada}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`font-mono text-[13px] ${l.disputada ? 'text-terra' : 'text-ink-2'}`}
              >
                {montoCuadro(l.pagado)}
              </p>
              {l.rating !== null && (
                <p className="mt-0.5 text-[10.5px] text-ink-3">{l.rating}★</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function Escalon({
  etiqueta,
  pie,
  cifra,
  color = '#C8C3DC',
  grande,
  linea,
}: {
  etiqueta: string;
  pie?: string;
  cifra: string;
  color?: string;
  grande?: boolean;
  linea?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${linea ? 'mt-3 border-t border-line pt-3' : ''}`}
    >
      <div className="min-w-0">
        <p className={grande ? 'text-[15px] font-semibold' : 'text-[13.5px] text-ink-2'}>
          {etiqueta}
        </p>
        {pie && <p className="mt-0.5 text-[11px] text-ink-3">{pie}</p>}
      </div>
      <p
        className={`shrink-0 font-mono ${grande ? 'text-[24px] font-semibold' : 'text-[15px]'}`}
        style={{ color }}
      >
        {cifra}
      </p>
    </div>
  );
}

/* ── el recibo ───────────────────────────────────────────────────────────── */

function HojaRecibo({
  linea,
  agente,
  direccion,
  brief,
  onCerrar,
}: {
  linea: Linea;
  agente: string;
  direccion: string;
  brief: string | null;
  onCerrar: () => void;
}): React.ReactElement {
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const T = useTextos();

  const alGuardar = async (): Promise<void> => {
    setGuardando(true);
    const r = await guardarCopia(
      `panal-recibo-${linea.id}.html`,
      reciboHtml({ linea, agente, direccionAgente: direccion, brief }),
    );
    setGuardando(false);
    setAviso(r.ok ? T.informe.reciboListo(r.donde) : T.informe.reciboFallo(r.porque));
  };

  return (
    <Hoja abierta titulo={T.informe.reciboTitulo(String(linea.id))} onCerrar={onCerrar}>
      <p className="mt-1 text-[12.5px] text-ink-3">{dia(linea.ts)} · {linea.moneda}</p>

      <div className="mt-3.5 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
        <Fila k={T.informe.precioEncargo} v={montoCuadro(linea.bruto)} />
        {linea.devuelto > 0n && (
          <Fila
            k={T.informe.devueltoAlCliente}
            v={`−${montoCuadro(linea.devuelto)}`}
            color="text-terra"
          />
        )}
        <Fila k={T.informe.comision} v={`−${montoCuadro(linea.comision)}`} color="text-ink-3" />
        <Fila k={T.informe.cobrado} v={montoCuadro(linea.pagado)} color="text-honey" fuerte />
      </div>

      <p className="mt-3.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        {T.informe.laTransaccion}
      </p>
      <p className="seleccionable mt-1.5 break-all font-mono text-[11.5px] leading-[1.5] text-ink-2">
        {linea.txHash ?? '—'}
      </p>

      <div className="mt-4">
        <Boton onClick={alGuardar} disabled={guardando}>
          {guardando ? T.informe.preparando : T.informe.guardarRecibo}
        </Boton>
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">
        {T.informe.reciboPie}
      </p>
      {aviso && <p className="mt-2 text-[12px] text-ink-2">{aviso}</p>}
    </Hoja>
  );
}

function Fila({
  k,
  v,
  color = 'text-ink-2',
  fuerte,
}: {
  k: string;
  v: string;
  color?: string;
  fuerte?: boolean;
}): React.ReactElement {
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-3 ${fuerte ? 'bg-sand' : ''}`}>
      <span className={`text-[13px] ${fuerte ? 'font-semibold text-ink' : 'text-ink-2'}`}>{k}</span>
      <span className={`shrink-0 font-mono ${fuerte ? 'text-[16px]' : 'text-[13.5px]'} ${color}`}>
        {v}
      </span>
    </div>
  );
}

/* ── piezas ──────────────────────────────────────────────────────────────── */

function Chip({
  puesto,
  onElegir,
  texto,
}: {
  puesto: boolean;
  onElegir: () => void;
  texto: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onElegir}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] ${
        puesto ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-3'
      }`}
    >
      {texto}
    </button>
  );
}

function devueltas(c: Cuentas, T: Textos): string {
  const ids = c.lineas.filter((l) => l.devuelto > 0n).map((l) => `#${l.id}`);
  return ids.length === 1
    ? T.informe.unEncargo(ids[0]!)
    : T.informe.variosEncargos(ids.length, ids.join(', '));
}

function dia(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(etiquetaIdioma(), {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * «agosto de 2026», en el idioma puesto.
 *
 * El nombre del mes lo da `Intl`, no una lista escrita a mano: son doce
 * palabras por idioma que ya vienen con el navegador, y en chino además el
 * orden es otro —«2026年8月»— que una plantilla nuestra no acertaría.
 */
function mesDe(p: Periodo): string {
  return new Date(p.anio, p.mes - 1, 1).toLocaleDateString(etiquetaIdioma(), {
    month: 'long',
    year: 'numeric',
  });
}
