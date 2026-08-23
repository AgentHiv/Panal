import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import type { Address } from 'viem';
import { useWallet } from '@/hooks/useWallet';
import { panalEscrowV2Abi, panalRegistryV2Abi } from '@/contracts/abis';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  currencySymbol,
} from '@/contracts/config';
import { ESTADO } from '@/lib/conversaciones';
import { getTaskBrief } from '@/lib/taskBriefs';
import Hoja, { Boton, Nota } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { armarFicha, partirFicha, useFicha, usePendiente, useTareasDe } from '~/lib/agentes';
import { revisar, cuantasUrgentes } from '~/lib/guardia';
import { monto } from '~/lib/formato';

/**
 * El panel de un agente.
 *
 * La misma pantalla en los dos modos, y la diferencia es una sola cosa: si la
 * wallet conectada ES este agente, los controles firman; si no, se miran. No
 * son dos pantallas porque no es información distinta — es el mismo agente, y
 * fingir lo contrario haría creer que seguir enseña menos de lo que enseña.
 *
 * Lo primero es el dinero sin cobrar, y no un gráfico. Es lo único que esta app
 * le puede decir a un dueño que él no supiera ya.
 */
type Panel = 'cobrar' | 'precio' | 'estado' | 'ficha' | null;

/** Uno solo, para no crear un objeto nuevo en cada render. */
const SIN_PENDIENTE = { panal: 0n, mon: 0n };

export default function PanelAgente(): React.ReactElement {
  const { direccion } = useParams();
  const navegar = useNavigate();
  const { address, connected } = useWallet();

  const dir = (direccion ?? '').toLowerCase();
  const { data: ficha, isLoading: cargandoFicha, refetch: releerFicha } = useFicha(dir);
  const { data: pendiente, refetch: releerPendiente } = usePendiente(dir);
  const { data: tareas = [], isLoading: cargandoTareas } = useTareasDe(dir);

  const [hoja, setHoja] = useState<Panel>(null);

  // El muro, aplicado: mandar sobre un agente es SER ese agente.
  const mando = connected && address?.toLowerCase() === dir;

  // `revisar` es barato y puro, así que se llama y ya: el `useMemo` que había
  // aquí no se podía conservar —el `?? {…}` creaba un objeto nuevo en cada
  // render— y una memoización que no memoriza solo estorba al leer.
  const urgentes = cuantasUrgentes(
    revisar(tareas, pendiente ?? SIN_PENDIENTE, currencySymbol),
  );

  if (cargandoFicha) return <Cargando />;

  if (!ficha?.registrado) {
    return (
      <Marco onVolver={() => navegar(-1)} titulo="Sin registrar">
        <p className="px-5 text-[13.5px] leading-[1.55] text-ink-2">
          Esa dirección no está registrada como agente en Panal. Puede que sea una wallet normal, o
          que el alta no llegara a firmarse.
        </p>
      </Marco>
    );
  }

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label="Volver"
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <div className="min-w-0 grow">
          <h1 className="truncate font-display text-[19px] font-semibold -tracking-[0.015em]">
            {ficha.nombre}
          </h1>
          <p className="truncate font-mono text-[11px] text-ink-3">
            {dir.slice(0, 6)}…{dir.slice(-4)} · desde {mes(ficha.desde)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${
            mando ? 'border-monad text-monad-mist' : 'border-line text-ink-3'
          }`}
        >
          {mando ? 'administras' : 'sigues'}
        </span>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        {/* Lo primero: el dinero que está dentro y no sale solo. */}
        <div className="shrink-0 rounded-[18px] border border-honey-line bg-honey-soft p-[18px]">
          <p className="text-[11.5px] uppercase tracking-[0.06em] text-honey">Ganado y sin cobrar</p>
          {pendiente?.hay ? (
            <>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {pendiente.panal > 0n && <Cantidad valor={pendiente.panal} simbolo="$PANAL" />}
                {pendiente.mon > 0n && <Cantidad valor={pendiente.mon} simbolo="MON" />}
              </div>
              {mando ? (
                <button
                  type="button"
                  onClick={() => setHoja('cobrar')}
                  className="pulsable tocable mt-3.5 w-full rounded-full bg-monad py-3 text-[15px] font-semibold text-white shadow-monad"
                >
                  Cobrar
                </button>
              ) : (
                <p className="mt-3 text-[11.5px] leading-[1.5] text-ink-3">
                  Solo puede sacarlo el propio agente:{' '}
                  <span className="font-mono">withdraw</span> paga a quien firma.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">Todo cobrado. Está en su wallet.</p>
          )}
        </div>

        {!ficha.activo && (
          <div className="shrink-0 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
            <div className="flex items-center gap-2">
              <Icono nombre="info" tamano={15} color="#C9653B" grosor={2.2} />
              <p className="text-[13px] font-semibold text-terra">Está pausado</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-ink-2">
              No aparece en el mercado y no puede entrarle ningún encargo nuevo. Los que ya
              estuvieran abiertos siguen su curso.
            </p>
          </div>
        )}

        {/* Los tres mandos. Cada uno lleva escrito qué función firma. */}
        <div className="shrink-0 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          <Mando
            icono="reloj"
            titulo="Aceptar trabajo"
            funcion="setActive"
            mando={mando}
            onTocar={() => setHoja('estado')}
            derecha={
              <span
                className={`block h-6 w-[42px] rounded-full p-[3px] transition-colors ${
                  ficha.activo ? 'bg-olive' : 'bg-line'
                }`}
              >
                <span
                  className={`block h-[18px] w-[18px] rounded-full bg-ink transition-transform ${
                    ficha.activo ? 'translate-x-[18px]' : ''
                  }`}
                />
              </span>
            }
          />
          <Mando
            icono="cartera"
            titulo="Precio por encargo"
            funcion="updatePrice"
            mando={mando}
            onTocar={() => setHoja('precio')}
            derecha={
              <span className="font-mono text-[13px] text-ink-2">
                {monto(ficha.precio)} {currencySymbol(ficha.moneda)}
              </span>
            }
          />
          <Mando
            icono="fuera"
            titulo="Ficha y endpoint"
            funcion="updateMetadata"
            mando={mando}
            onTocar={() => setHoja('ficha')}
            derecha={
              ficha.botUrl ? (
                <Icono nombre="check" tamano={14} color="#92A268" grosor={2.4} />
              ) : (
                <span className="flex items-center gap-1 text-[11.5px] text-terra">
                  <Icono nombre="info" tamano={12} color="#C9653B" grosor={2.4} />
                  sin endpoint
                </span>
              )
            }
          />
        </div>

        {!ficha.botUrl && (
          <Nota tono="miel">
            Su ficha no declara <span className="font-mono">bot:</span>, así que nadie puede hablarle
            por mensaje. Solo acepta encargos {ficha.activo ? '' : '— y ahora mismo tampoco'}.
          </Nota>
        )}

        <button
          type="button"
          onClick={() => navegar(`/guardia/${dir}`)}
          className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line p-3.5 text-left"
        >
          <Icono
            nombre="escudo"
            tamano={18}
            color={urgentes > 0 ? '#C9653B' : '#948DAE'}
            className="shrink-0"
          />
          <div className="min-w-0 grow">
            <p className="text-[13.5px] font-medium">Guardia</p>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              {cargandoTareas
                ? 'Mirando…'
                : urgentes > 0
                  ? `${urgentes} sin cerrar que corren prisa`
                  : 'Nada pendiente'}
            </p>
          </div>
          <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180 shrink-0" />
        </button>

        <p className="mt-1 shrink-0 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
          Últimos encargos
        </p>
        {tareas.length === 0 ? (
          // Mientras se lee NO se dice que no hay nada: la pantalla llegó a
          // decir «todavía no le han encargado nada» de un agente que sí tenía
          // un encargo abierto, y eso es peor que un momento en blanco.
          <p className="shrink-0 px-1 text-[12.5px] text-ink-3">
            {cargandoTareas ? 'Leyendo la cadena…' : 'Todavía no le han encargado nada.'}
          </p>
        ) : (
          <div className="shrink-0 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
            {tareas.slice(0, 8).map((t) => {
              const e = pinta(t.status);
              return (
                <div key={t.id.toString()} className="flex items-center gap-2.5 px-3.5 py-3">
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: e.color }}
                  />
                  <div className="min-w-0 grow">
                    <p className="truncate text-[13px]">
                      {getTaskBrief(t.taskHash) ?? `Encargo #${t.id}`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-3">{e.texto}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[12.5px]" style={{ color: e.color }}>
                    {monto(t.amountWei)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hoja === 'cobrar' && pendiente && (
        <HojaCobrar
          pendiente={pendiente}
          onCerrar={() => setHoja(null)}
          onHecho={() => void releerPendiente()}
        />
      )}
      {hoja === 'precio' && (
        <HojaPrecio
          precio={ficha.precio}
          moneda={ficha.moneda}
          onCerrar={() => setHoja(null)}
          onHecho={() => void releerFicha()}
        />
      )}
      {hoja === 'estado' && (
        <HojaEstado
          activo={ficha.activo}
          onCerrar={() => setHoja(null)}
          onHecho={() => void releerFicha()}
        />
      )}
      {hoja === 'ficha' && (
        <HojaFicha
          uri={ficha.metadataURI}
          onCerrar={() => setHoja(null)}
          onHecho={() => void releerFicha()}
        />
      )}
    </div>
  );
}

/* ── cobrar ──────────────────────────────────────────────────────────────── */

/**
 * Dos monedas son DOS firmas.
 *
 * `withdraw(token)` recibe UN token: no hay forma de sacar las dos de una vez.
 * Sale escrito en la hoja porque esconderlo haría que la segunda petición de
 * firma pareciera un fallo de la app.
 */
function HojaCobrar({
  pendiente,
  onCerrar,
  onHecho,
}: {
  pendiente: { panal: bigint; mon: bigint };
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement {
  const { writeContract, data: hash, isPending, variables, reset } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  // La hoja NO se cierra al cobrar la primera moneda: si quedan las dos, cerrar
  // aquí escondería la segunda firma y parecería que ya está todo sacado.
  useEffect(() => {
    if (!recibo.isSuccess) return;
    onHecho();
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  const sacar = (token: Address): void =>
    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'withdraw',
      args: [token],
    });

  // Cuál se está sacando lo dice la propia llamada en curso, no un estado
  // paralelo que haya que acordarse de limpiar.
  const enCurso = (variables?.args as readonly string[] | undefined)?.[0]?.toLowerCase();
  const trabajando = isPending || recibo.isLoading;

  return (
    <Hoja abierta titulo="Cobrar lo ganado" onCerrar={onCerrar} bloqueada={trabajando}>
      <Nota>
        Cada moneda se saca por separado: el contrato cobra de una en una. Son dos firmas.
      </Nota>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {pendiente.panal > 0n && (
          <LineaCobro
            valor={pendiente.panal}
            simbolo="$PANAL"
            trabajando={trabajando && enCurso === PANAL_TOKEN_ADDRESS.toLowerCase()}
            deshabilitado={trabajando}
            onSacar={() => sacar(PANAL_TOKEN_ADDRESS)}
          />
        )}
        {pendiente.mon > 0n && (
          <LineaCobro
            valor={pendiente.mon}
            simbolo="MON"
            trabajando={trabajando && enCurso === NATIVE_CURRENCY.toLowerCase()}
            deshabilitado={trabajando}
            onSacar={() => sacar(NATIVE_CURRENCY)}
          />
        )}
      </div>

      <p className="mt-3.5 text-[11.5px] leading-[1.5] text-ink-3">
        Lo cobrado va a esta misma dirección, que es la del agente. Para que vaya a otra hace falta
        cambiar el contrato.
      </p>

      <div className="mt-4">
        <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>
          Cerrar
        </Boton>
      </div>
    </Hoja>
  );
}

function LineaCobro({
  valor,
  simbolo,
  trabajando,
  deshabilitado,
  onSacar,
}: {
  valor: bigint;
  simbolo: string;
  trabajando: boolean;
  deshabilitado: boolean;
  onSacar: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-line p-3.5">
      <div className="min-w-0 grow">
        <p className="font-mono text-[17px] text-ink">
          {monto(valor)} <span className="text-[13px] text-ink-2">{simbolo}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-ink-3">una firma</p>
      </div>
      <button
        type="button"
        onClick={onSacar}
        disabled={deshabilitado}
        className="pulsable tocable shrink-0 rounded-full bg-monad px-4 py-2 text-[13.5px] font-semibold text-white disabled:opacity-40"
      >
        {trabajando ? 'Firmando…' : 'Sacar'}
      </button>
    </div>
  );
}

/* ── precio ──────────────────────────────────────────────────────────────── */

function HojaPrecio({
  precio,
  moneda,
  onCerrar,
  onHecho,
}: {
  precio: bigint;
  moneda: Address;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement {
  const [texto, setTexto] = useState(() => monto(precio).replace(/\./g, ''));
  const [enPanal, setEnPanal] = useState(currencySymbol(moneda) === '$PANAL');
  const { writeContract, data: hash, isPending } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!recibo.isSuccess) return;
    onHecho();
    onCerrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  const nuevo = parsear(texto);
  const trabajando = isPending || recibo.isLoading;

  return (
    <Hoja abierta titulo="Precio por encargo" onCerrar={onCerrar} bloqueada={trabajando}>
      <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-2">
        Lo que cobra por un trabajo con depósito. Los mensajes sueltos se cobran aparte, en su
        servidor.
      </p>

      <div className="mt-3.5 flex items-center gap-2.5 rounded-[14px] border border-line p-3.5">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          inputMode="decimal"
          className="min-w-0 grow bg-transparent font-mono text-[22px] text-ink outline-none"
        />
        <div className="flex shrink-0 gap-1.5">
          {(['$PANAL', 'MON'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEnPanal(m === '$PANAL')}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                enPanal === (m === '$PANAL')
                  ? 'border-honey bg-honey-soft text-honey'
                  : 'border-line text-ink-3'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <Nota>
        Solo afecta a los encargos que entren a partir de ahora. Lo que ya está bloqueado se liquida
        al precio que se pactó.
      </Nota>

      <div className="mt-4 flex gap-2.5">
        <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>
          Cancelar
        </Boton>
        <Boton
          onClick={() =>
            writeContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'updatePrice',
              args: [nuevo!, enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY],
            })
          }
          disabled={nuevo === null || trabajando}
        >
          {trabajando ? 'Firmando…' : 'Firmar el cambio'}
        </Boton>
      </div>
    </Hoja>
  );
}

/* ── pausar y reactivar ──────────────────────────────────────────────────── */

function HojaEstado({
  activo,
  onCerrar,
  onHecho,
}: {
  activo: boolean;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!recibo.isSuccess) return;
    onHecho();
    onCerrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  const trabajando = isPending || recibo.isLoading;

  return (
    <Hoja
      abierta
      titulo={activo ? 'Pausar el agente' : 'Volver a aceptar trabajo'}
      onCerrar={onCerrar}
      bloqueada={trabajando}
    >
      <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-2">
        {activo
          ? 'Dejará de salir en el mercado y no podrá entrarle ningún encargo nuevo. Los que ya estén abiertos siguen su curso, y sigues teniendo que entregarlos.'
          : 'Volverá a salir en el mercado y podrá entrarle trabajo. Asegúrate de que su servidor está en pie antes de firmar esto.'}
      </p>

      <div className="mt-4 flex gap-2.5">
        <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>
          Ahora no
        </Boton>
        <Boton
          variante={activo ? 'peligro' : 'principal'}
          onClick={() =>
            writeContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'setActive',
              args: [!activo],
            })
          }
          disabled={trabajando}
        >
          {trabajando ? 'Firmando…' : activo ? 'Pausar' : 'Reactivar'}
        </Boton>
      </div>
    </Hoja>
  );
}

/* ── la ficha ────────────────────────────────────────────────────────────── */

function HojaFicha({
  uri,
  onCerrar,
  onHecho,
}: {
  uri: string;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement {
  const inicial = partirFicha(uri);
  const [nombre, setNombre] = useState(inicial.nombre);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [bot, setBot] = useState(() => {
    const parte = uri.split('·').find((p) => p.trim().toLowerCase().startsWith('bot:'));
    return parte ? parte.trim().slice(4) : '';
  });
  const { writeContract, data: hash, isPending } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!recibo.isSuccess) return;
    onHecho();
    onCerrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  const nueva = armarFicha(nombre, descripcion, bot);
  const trabajando = isPending || recibo.isLoading;

  return (
    <Hoja abierta titulo="Ficha y endpoint" onCerrar={onCerrar} bloqueada={trabajando}>
      <Campo etiqueta="Nombre" valor={nombre} onCambio={setNombre} />
      <Campo etiqueta="Qué hace" valor={descripcion} onCambio={setDescripcion} />
      <Campo
        etiqueta="Dónde escucha"
        valor={bot}
        onCambio={setBot}
        marcador="https://tu-agente.lat"
        mono
      />

      {!bot.trim() && (
        <Nota tono="miel">
          Sin dirección nadie podrá hablarle. La app busca <span className="font-mono">bot:</span> en
          la ficha para saber dónde mandar los mensajes; sin eso solo aceptará encargos con depósito.
        </Nota>
      )}

      <p className="mt-3.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        Lo que se va a escribir
      </p>
      {/* Se enseña literalmente: la ficha es texto libre separado por «·», no
          un JSON, y descubrir el formato al ver tu agente mal listado es peor. */}
      <p className="seleccionable mt-1.5 break-all rounded-[11px] border border-line bg-sand px-3 py-2.5 font-mono text-[11.5px] leading-[1.5] text-ink-2">
        {nueva || '—'}
      </p>

      <div className="mt-4 flex gap-2.5">
        <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>
          Cancelar
        </Boton>
        <Boton
          onClick={() =>
            writeContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'updateMetadata',
              args: [nueva],
            })
          }
          disabled={!nueva || trabajando}
        >
          {trabajando ? 'Firmando…' : 'Firmar'}
        </Boton>
      </div>
    </Hoja>
  );
}

/* ── piezas ──────────────────────────────────────────────────────────────── */

function Campo({
  etiqueta,
  valor,
  onCambio,
  marcador,
  mono,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  marcador?: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="mt-3.5">
      <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{etiqueta}</p>
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={marcador}
        spellCheck={false}
        autoCapitalize="none"
        className={`mt-1.5 w-full rounded-[11px] border border-line bg-sand px-3 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-honey ${
          mono ? 'font-mono text-[12.5px]' : ''
        }`}
      />
    </div>
  );
}

function Mando({
  icono,
  titulo,
  funcion,
  mando,
  onTocar,
  derecha,
}: {
  icono: 'reloj' | 'cartera' | 'fuera';
  titulo: string;
  funcion: string;
  mando: boolean;
  onTocar: () => void;
  derecha: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={mando ? onTocar : undefined}
      disabled={!mando}
      className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left disabled:opacity-70"
    >
      <Icono nombre={icono} tamano={17} color="#948DAE" className="shrink-0" />
      <div className="min-w-0 grow">
        <p className="text-[13.5px] font-medium">{titulo}</p>
        {/* La función que se firma va escrita: quien administra un agente sabe
            leerla, y es la forma más corta de decir qué hace exactamente. */}
        <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">{funcion}</p>
      </div>
      <span className="shrink-0">{derecha}</span>
    </button>
  );
}

function Cantidad({ valor, simbolo }: { valor: bigint; simbolo: string }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[26px] font-medium leading-none text-honey">
        {monto(valor)}
      </span>
      <span className="text-[13px] font-semibold text-honey">{simbolo}</span>
    </div>
  );
}

function Marco({
  titulo,
  onVolver,
  children,
}: {
  titulo: string;
  onVolver: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onVolver}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label="Volver"
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">{titulo}</h1>
      </header>
      <div className="grow pt-4">{children}</div>
    </div>
  );
}

function Cargando(): React.ReactElement {
  return (
    <div className="flex min-h-0 grow items-center justify-center">
      <p className="text-[13px] text-ink-3">Leyendo el registro…</p>
    </div>
  );
}

const PINTA: Record<number, { texto: string; color: string }> = {
  [ESTADO.Abierto]: { texto: 'Abierto · sin entregar', color: '#B7A8FC' },
  [ESTADO.Entregado]: { texto: 'Entregado · esperando al cliente', color: '#E29A2E' },
  [ESTADO.Completado]: { texto: 'Cobrado', color: '#92A268' },
  [ESTADO.Disputado]: { texto: 'En disputa', color: '#C9653B' },
  [ESTADO.Cancelado]: { texto: 'Cancelado', color: '#948DAE' },
};

const pinta = (estado: number) => PINTA[estado] ?? { texto: '—', color: '#948DAE' };

function mes(ms: number): string {
  return new Date(ms).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
}

/** «12,5» o «12.5» → wei. `null` si no es un número que se pueda firmar. */
function parsear(texto: string): bigint | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  try {
    return parseEther(limpio);
  } catch {
    return null;
  }
}
