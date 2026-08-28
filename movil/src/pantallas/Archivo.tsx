import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useMyTasks } from '@/hooks/useMyTasks';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';
import { ESTADO } from '@/lib/conversaciones';
import Icono from '~/componentes/Icono';
import { armar, salud } from '@/lib/expedientes';
import type { Expediente } from '@/lib/expedientes';
import { guardarCopia, todoAHtml } from '~/lib/copia';
import { monto, cuando } from '~/lib/formato';
import Menu from '~/componentes/Menu';
import { useTextos, textos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * Tus expedientes.
 *
 * Lo que la cadena NO guarda de cada encargo: el texto de lo que pediste, el de
 * lo que te entregaron y la conversación. Eso vive solo en este teléfono, y hay
 * un tope — 200 briefs, 60 hilos — a partir del cual se empieza a tirar lo más
 * viejo sin avisar. Esta pantalla es el aviso.
 */
type Filtro = 'todos' | 'completos' | 'huecos';

export default function Archivo(): React.ReactElement {
  const navegar = useNavigate();
  const { address, connected, connecting, connect } = useWallet();
  const { tasks, loading } = useMyTasks();
  const { agents } = usePanalAgents();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [copiando, setCopiando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const T = useTextos();

  const nombreDeAgente = useMemo(() => {
    const mapa = new Map(agents.map((a) => [a.workerAddress.toLowerCase(), a.name]));
    return (dir: string): string =>
      mapa.get(dir.toLowerCase()) ?? `${dir.slice(0, 6)}…${dir.slice(-4)}`;
  }, [agents]);

  const expedientes = useMemo<Expediente[]>(() => {
    if (!address) return [];
    return tasks.map((t) => armar(t, currencySymbol(t.currency), address));
  }, [tasks, address]);

  // `salud()` lee localStorage, así que no tiene dependencias que React pueda
  // ver. Se ata a `tasks` a propósito: son las tareas nuevas las que traen
  // briefs nuevos, y `useMyTasks` refresca cada 15 s.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => salud(), [tasks]);

  const completos = expedientes.filter(estaCompleto).length;
  const lista = expedientes.filter((e) =>
    filtro === 'completos' ? estaCompleto(e) : filtro === 'huecos' ? !estaCompleto(e) : true,
  );

  const alCopiarTodo = async (): Promise<void> => {
    if (!address || expedientes.length === 0) return;
    setCopiando(true);
    setAviso(null);
    const r = await guardarCopia(
      `panal-expedientes-${new Date().toISOString().slice(0, 10)}.html`,
      todoAHtml(expedientes, address),
    );
    setCopiando(false);
    setAviso(r.ok ? T.archivo.copiaLista(r.donde) : T.archivo.copiaFallo(r.porque));
  };

  // Con la cabecera, no en su lugar: sin ella esta pantalla se quedaba sin
  // título y —desde que el menú vive ahí— sin forma de llegar a nada.
  if (!connected) {
    return (
      <div className="flex min-h-0 grow flex-col">
        <Cabecera />
        <Vacia
          titulo={T.archivo.conectaTitulo}
          texto={T.archivo.conectaTexto}
          conectando={connecting}
          onConectar={connect}
          T={T}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 grow flex-col">
      <Cabecera />

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
        {/* La salud del archivo va ARRIBA del todo, no al final: cuando se lea
            abajo ya se habrá tirado el primer brief. */}
        <div
          className={`shrink-0 rounded-[14px] border p-3.5 ${
            s.apretado ? 'border-honey-line bg-honey-soft' : 'border-line'
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-[13px] font-semibold ${s.apretado ? 'text-honey' : 'text-ink'}`}>
              {s.apretado ? T.archivo.apretado(s.briefsTope - s.briefs) : T.archivo.holgado}
            </p>
            <p className="shrink-0 font-mono text-[12px] text-ink-3">
              {T.archivo.deTantos(s.briefs, s.briefsTope)}
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand">
            <div
              className={`h-full rounded-full ${s.apretado ? 'bg-honey' : 'bg-olive'}`}
              style={{ width: `${Math.min(100, (s.briefs / s.briefsTope) * 100)}%` }}
            />
          </div>
          <p className="mt-2.5 text-[12px] leading-[1.55] text-ink-2">
            {T.archivo.salud(s.briefsTope, s.hilosTope, s.hilos)}
          </p>
        </div>

        <button
          type="button"
          onClick={alCopiarTodo}
          disabled={copiando || expedientes.length === 0}
          className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line bg-cream p-3.5 text-left disabled:opacity-50"
        >
          <Icono nombre="bajar" tamano={18} color="#B7A8FC" grosor={1.9} className="shrink-0" />
          <div className="min-w-0 grow">
            <p className="text-[13.5px] font-medium">
              {copiando ? T.archivo.preparando : T.archivo.sacarCopia}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
              {T.archivo.sacarCopiaPie}
            </p>
          </div>
        </button>

        {aviso && <p className="shrink-0 px-1 text-[12px] text-ink-2">{aviso}</p>}

        <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5">
          {(
            [
              ['todos', T.archivo.todos(expedientes.length)],
              ['completos', T.archivo.completos(completos)],
              ['huecos', T.archivo.conHuecos(expedientes.length - completos)],
            ] as [Filtro, string][]
          ).map(([id, texto]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] ${
                filtro === id
                  ? 'border-honey bg-honey-soft text-honey'
                  : 'border-line text-ink-3'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        {loading && expedientes.length === 0 && (
          <p className="shrink-0 px-1 text-[12.5px] text-ink-3">{T.archivo.leyendo}</p>
        )}

        {!loading && expedientes.length === 0 && (
          <p className="shrink-0 px-1 text-[12.5px] leading-[1.55] text-ink-2">
            {T.archivo.sinNada}
          </p>
        )}

        {lista.map((e) => {
          const roto = !estaCompleto(e);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => navegar(`/expediente/${e.id}`)}
              className="pulsable shrink-0 rounded-[14px] border border-line bg-cream p-3.5 text-left"
            >
              <div className="flex items-start gap-2.5">
                <p className="min-w-0 grow text-[14px] font-medium leading-[1.4]">
                  {e.local.brief ? primeraLinea(e.local.brief) : T.archivo.sinBrief}
                </p>
                <span className="shrink-0 font-mono text-[12px] text-ink-3">#{e.id}</span>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-3">
                {nombreDeAgente(e.agente)} · {cuando(e.cadena.creado)} · {monto(e.cadena.importe)}{' '}
                {e.cadena.simbolo}
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5">
                <Icono
                  nombre={roto ? 'info' : 'check'}
                  tamano={12}
                  color={roto ? '#C9653B' : '#92A268'}
                  grosor={2.4}
                />
                <span className={`text-[11.5px] ${roto ? 'text-terra' : 'text-olive'}`}>
                  {resumen(e)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Completo = está todo lo que la cadena no guarda y este encargo debería tener. */
function estaCompleto(e: Expediente): boolean {
  const yaEntregado =
    e.cadena.estado === ESTADO.Entregado || e.cadena.estado === ESTADO.Completado;
  if (e.local.brief === null) return false;
  return !yaEntregado || e.local.entrega !== null;
}

/**
 * Se lee `textos()` en vez de recibir `T`: esta función la llaman `estaCompleto`
 * y el filtro, fuera de todo componente. Pasar la tabla por ahí obligaría a
 * enhebrarla por tres firmas que no pintan nada.
 */
function resumen(e: Expediente): string {
  const T = textos();
  if (e.local.brief === null) return T.archivo.soloCadena;
  const yaEntregado =
    e.cadena.estado === ESTADO.Entregado || e.cadena.estado === ESTADO.Completado;
  if (yaEntregado && e.local.entrega === null) return T.archivo.faltaEntrega;
  if (!yaEntregado) return T.archivo.sinEntregar;
  return e.local.hilo.length > 0 ? T.archivo.completoConHilo : T.archivo.completoSinHilo;
}

function primeraLinea(texto: string): string {
  const l = texto.trim().split('\n')[0] ?? '';
  return l.length > 68 ? `${l.slice(0, 68)}…` : l;
}

function Cabecera(): React.ReactElement {
  const T = useTextos();
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">
          {T.archivo.titulo}
        </h1>
        <p className="mt-0.5 text-[12.5px] text-ink-3">{T.archivo.subtitulo}</p>
      </div>
      <Menu />
    </header>
  );
}

/**
 * La pantalla vacía.
 *
 * CON BOTÓN cuando lo que falta es la wallet, que es la mitad que faltaba: las
 * otras dos pestañas —Chats y Saldo— ofrecen conectar desde su propio hueco, y
 * ésta enseñaba el mismo caso sin ninguna salida. Media pantalla en blanco
 * diciéndole a alguien lo que le falta y sin dónde pulsar para conseguirlo.
 */
function Vacia({
  titulo,
  texto,
  conectando,
  onConectar,
  T,
}: {
  titulo: string;
  texto: string;
  conectando?: boolean;
  onConectar?: () => void;
  T: Textos;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center px-8 pb-12">
      <Icono nombre="carpeta" tamano={44} color="#342E4A" grosor={1.5} />
      <h2 className="mt-4 text-center font-display text-[19px] font-semibold">{titulo}</h2>
      <p className="mt-2 max-w-[280px] text-pretty text-center text-[13px] leading-[1.55] text-ink-2">
        {texto}
      </p>
      {onConectar && (
        <button
          type="button"
          onClick={onConectar}
          disabled={conectando}
          className="pulsable mt-7 flex h-[52px] w-full max-w-[300px] items-center justify-center rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
        >
          {conectando ? T.comun.conectando : T.comun.conectarWallet}
        </button>
      )}
    </div>
  );
}
