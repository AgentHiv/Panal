import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import Icono from '~/componentes/Icono';
import { esDireccion, seguidos, seguir, useFicha } from '~/lib/agentes';

/**
 * Tus agentes.
 *
 * Hay dos formas de entrar y no son la misma cosa, así que la pantalla las
 * separa antes de que nadie elija: SEGUIR no firma nada, y por eso la clave del
 * agente puede quedarse en su servidor; ADMINISTRAR exige conectar la wallet
 * DEL PROPIO AGENTE, porque el registro actúa sobre quien firma y no distingue
 * entre el agente y su dueño.
 *
 * El modo que viene puesto es seguir. No por costumbre: es el que no obliga a
 * sacar una clave de producción de donde está.
 */
type Modo = 'seguir' | 'administrar';

export default function Agentes(): React.ReactElement {
  const navegar = useNavigate();
  const { address, connected, connect, connecting } = useWallet();
  const [modo, setModo] = useState<Modo>('seguir');
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<string[]>(() => seguidos());

  const alSeguir = (): void => {
    const dir = texto.trim();
    if (!esDireccion(dir)) return;
    seguir(dir);
    setLista(seguidos());
    setTexto('');
    navegar(`/panel/${dir.toLowerCase()}`);
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="shrink-0 px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Tus agentes</h1>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
          Hay dos formas de entrar, y no son la misma cosa. Elige por dónde va a firmar tu agente, no
          por comodidad.
        </p>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
        <Opcion
          puesta={modo === 'seguir'}
          onElegir={() => setModo('seguir')}
          titulo="Seguirlo"
          texto="Pegas su dirección y lo ves entero: cuánto ha ganado, qué le queda por cobrar, qué encargos tiene. No firma nada porque no hay nada que firmar."
          pie="La clave de tu agente no sale de tu servidor."
          pieColor="text-olive"
          icono="buscar"
        />

        <Opcion
          puesta={modo === 'administrar'}
          onElegir={() => setModo('administrar')}
          titulo="Administrarlo"
          texto="Todo lo anterior, y además cobrar, cambiar el precio, pausarlo y editar su ficha. Cada cosa es una firma suya."
          pie="Es la misma clave que firma sus entregas"
          pieColor="text-honey"
          icono="llave"
        />

        {modo === 'seguir' ? (
          <div className="shrink-0 rounded-[14px] border border-line p-3.5">
            <p className="text-[13px] font-medium">La dirección del agente</p>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="mt-2.5 w-full rounded-[11px] border border-line bg-sand px-3 py-2.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-honey"
            />
            <button
              type="button"
              onClick={alSeguir}
              disabled={!esDireccion(texto)}
              className="pulsable tocable mt-2.5 w-full rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white shadow-monad disabled:opacity-40 disabled:shadow-none"
            >
              Verlo
            </button>
          </div>
        ) : (
          <div className="shrink-0 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
            <p className="text-[12.5px] leading-[1.55] text-ink-2">
              El registro no distingue entre el agente y su dueño:{' '}
              <span className="font-mono text-[11.5px] text-honey">updatePrice</span> y{' '}
              <span className="font-mono text-[11.5px] text-honey">setActive</span> actúan sobre
              quien firma. Para mandar desde el móvil tienes que conectar la wallet del propio
              agente — la que ahora mismo está en tu servidor.
            </p>
            {connected ? (
              <button
                type="button"
                onClick={() => navegar(`/panel/${address!.toLowerCase()}`)}
                className="pulsable tocable mt-3 w-full rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white shadow-monad"
              >
                Administrar {address!.slice(0, 6)}…{address!.slice(-4)}
              </button>
            ) : (
              <button
                type="button"
                onClick={connect}
                disabled={connecting}
                className="pulsable tocable mt-3 w-full rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white shadow-monad disabled:opacity-60"
              >
                {connecting ? 'Conectando…' : 'Conectar la wallet del agente'}
              </button>
            )}
          </div>
        )}

        {lista.length > 0 && (
          <>
            <p className="mt-1 shrink-0 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
              Los que sigues
            </p>
            {lista.map((d) => (
              <FilaSeguido key={d} direccion={d} onAbrir={() => navegar(`/panel/${d}`)} />
            ))}
          </>
        )}

        <button
          type="button"
          onClick={() => navegar('/alta')}
          className="pulsable mt-1 flex shrink-0 items-center gap-3 rounded-[14px] border border-dashed border-line p-3.5 text-left"
        >
          <Icono nombre="mas" tamano={18} color="#948DAE" grosor={1.9} className="shrink-0" />
          <div className="min-w-0 grow">
            <p className="text-[13.5px] font-medium">Dar de alta uno nuevo</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
              Con una wallet vacía: la que registres es la que será el agente
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

function Opcion({
  puesta,
  onElegir,
  titulo,
  texto,
  pie,
  pieColor,
  icono,
}: {
  puesta: boolean;
  onElegir: () => void;
  titulo: string;
  texto: string;
  pie: string;
  pieColor: string;
  icono: 'buscar' | 'llave';
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onElegir}
      className={`pulsable shrink-0 rounded-[14px] border p-3.5 text-left ${
        puesta ? 'border-monad bg-cream shadow-monad' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Icono nombre={icono} tamano={17} color={puesta ? '#B7A8FC' : '#948DAE'} />
        <p className="grow text-[14.5px] font-semibold">{titulo}</p>
        <span
          className={`h-[18px] w-[18px] shrink-0 rounded-full border-[5px] ${
            puesta ? 'border-monad' : 'border-line'
          }`}
        />
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-2">{texto}</p>
      <p className={`mt-2 text-[11.5px] ${pieColor}`}>{pie}</p>
    </button>
  );
}

/** Una fila de la lista de seguidos, con su nombre leído del registro. */
function FilaSeguido({
  direccion,
  onAbrir,
}: {
  direccion: string;
  onAbrir: () => void;
}): React.ReactElement {
  const { data: ficha } = useFicha(direccion);

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line bg-cream p-3.5 text-left"
    >
      <div className="min-w-0 grow">
        <p className="truncate text-[14px] font-medium">
          {ficha?.nombre ?? `${direccion.slice(0, 6)}…${direccion.slice(-4)}`}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-3">
          {direccion.slice(0, 6)}…{direccion.slice(-4)}
          {ficha && !ficha.activo && <span className="ml-2 text-terra">pausado</span>}
        </p>
      </div>
      <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180 shrink-0" />
    </button>
  );
}
