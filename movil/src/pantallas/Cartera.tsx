import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icono from '~/componentes/Icono';
import { useCartera } from '~/lib/agentes';
import { dejarDeSeguir, seguidos } from '~/lib/ficha';
import { avisar, tono, totales } from '~/lib/cartera';
import type { FilaCartera } from '~/lib/cartera';
import { montoCuadro } from '~/lib/formato';

/**
 * La cartera: todos los agentes que sigues, a la vez.
 *
 * De mirar, y no por falta de ganas: `updatePrice`, `setActive` y `withdraw`
 * actúan sobre quien firma, así que una wallet solo puede mandar sobre sí
 * misma. Ver, en cambio, no necesita firmar nada — la ficha y el dinero de
 * cada agente son públicos.
 *
 * Por eso aquí no hay un «Cobrarlo todo · 1 firma». El diseño lo llevaba, y
 * era un botón que promete algo que el contrato no puede dar. En su sitio va el
 * número de firmas que hacen falta de verdad, contado de los saldos: una por
 * agente y moneda, cada una desde la wallet de ese agente. Ese número es la
 * medida exacta de lo que cuesta no tener el dueño separado del agente.
 */
type Filtro = 'todos' | 'activos' | 'pausados';

export default function Cartera(): React.ReactElement {
  const navegar = useNavigate();
  const [lista, setLista] = useState<string[]>(() => seguidos());
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const { data: filas = [], isLoading, isError } = useCartera(lista);

  const t = useMemo(() => totales(filas), [filas]);
  const visibles = filas.filter((f) =>
    filtro === 'activos' ? f.activo : filtro === 'pausados' ? !f.activo : true,
  );

  const alDejar = (dir: string): void => {
    dejarDeSeguir(dir);
    setLista(seguidos());
  };

  return (
    <div className="flex min-h-0 grow flex-col">
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
          <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">Cartera</h1>
          <p className="truncate text-[11.5px] text-ink-3">
            {lista.length} {lista.length === 1 ? 'agente' : 'agentes'} · solo mirar
          </p>
        </div>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        {lista.length === 0 && (
          <div className="flex grow flex-col items-center justify-center px-6 pb-10">
            <Icono nombre="hexagono" tamano={40} color="#342E4A" grosor={1.5} />
            <p className="mt-4 text-center font-display text-[17px] font-semibold">
              No sigues a ninguno
            </p>
            <p className="mt-2 max-w-[270px] text-pretty text-center text-[12.5px] leading-[1.55] text-ink-2">
              Pega la dirección de un agente y lo verás entero: lo que gana, lo que le queda por
              cobrar y lo que tiene sin cerrar.
            </p>
            <button
              type="button"
              onClick={() => navegar('/agentes')}
              className="pulsable tocable mt-5 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              Seguir a uno
            </button>
          </div>
        )}

        {lista.length > 0 && (
          <>
            <div className="shrink-0 rounded-[18px] border border-honey-line bg-honey-soft p-[18px]">
              <p className="text-[11.5px] uppercase tracking-[0.06em] text-honey">
                Sin cobrar en toda la cartera
              </p>
              {isLoading && filas.length === 0 ? (
                <span className="mt-2.5 block h-7 w-32 animate-pulse rounded bg-sand" />
              ) : (
                <div className="mt-2.5 flex flex-col gap-1">
                  {t.panal > 0n && <Cifra valor={t.panal} simbolo="$PANAL" />}
                  {t.mon > 0n && <Cifra valor={t.mon} simbolo="MON" />}
                  {t.panal === 0n && t.mon === 0n && (
                    <p className="text-[13px] text-ink-2">Nada dentro del depósito.</p>
                  )}
                </div>
              )}

              {/* El coste de no tener dueño separado del agente, contado. */}
              {t.firmas > 0 && (
                <p className="mt-3 border-t border-honey-line pt-3 text-[12px] leading-[1.55] text-ink-2">
                  Recogerlo son <span className="font-semibold text-honey">{t.firmas} firmas</span>:
                  una por agente y moneda, cada una desde la wallet de ese agente. Desde aquí no se
                  puede — <span className="font-mono text-[11px]">withdraw</span> paga a quien firma.
                </p>
              )}
            </div>

            {t.enRiesgo > 0 && (
              <button
                type="button"
                onClick={() => setFiltro('todos')}
                className="flex shrink-0 items-center gap-2.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5 text-left"
              >
                <Icono nombre="info" tamano={16} color="#C9653B" grosor={2.2} className="shrink-0" />
                <p className="text-[12.5px] leading-[1.5] text-terra">
                  {t.enRiesgo === 1
                    ? 'Un agente tiene encargos con el plazo vencido y sin entregar.'
                    : `${t.enRiesgo} agentes tienen encargos con el plazo vencido y sin entregar.`}
                </p>
              </button>
            )}

            {isError && (
              <p className="shrink-0 px-1 text-[12.5px] leading-[1.55] text-terra">
                No se pudo leer la cadena. Los saldos y los estados de aquí abajo pueden estar
                incompletos.
              </p>
            )}

            {filas.length > 1 && (
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5">
                {(
                  [
                    ['todos', `Todos · ${filas.length}`],
                    ['activos', `Activos · ${t.activos}`],
                    ['pausados', `Pausados · ${t.pausados}`],
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
            )}

            {isLoading && filas.length === 0 && (
              <p className="shrink-0 px-1 text-[12.5px] text-ink-3">Leyendo la cadena…</p>
            )}

            {visibles.map((f) => (
              <Fila
                key={f.direccion}
                fila={f}
                onAbrir={() => navegar(`/panel/${f.direccion}`)}
                onDejar={() => alDejar(f.direccion)}
              />
            ))}

            <button
              type="button"
              onClick={() => navegar('/agentes')}
              className="pulsable mt-1 flex shrink-0 items-center gap-3 rounded-[14px] border border-dashed border-line p-3.5 text-left"
            >
              <Icono nombre="mas" tamano={18} color="#948DAE" grosor={1.9} className="shrink-0" />
              <p className="text-[13.5px] font-medium">Seguir a otro</p>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const COLORES = {
  rojo: { borde: 'border-terra/40', texto: 'text-terra', punto: '#C9653B' },
  miel: { borde: 'border-honey-line', texto: 'text-honey', punto: '#E29A2E' },
  gris: { borde: 'border-line', texto: 'text-ink-3', punto: '#948DAE' },
} as const;

function Fila({
  fila,
  onAbrir,
  onDejar,
}: {
  fila: FilaCartera;
  onAbrir: () => void;
  onDejar: () => void;
}): React.ReactElement {
  const [confirmar, setConfirmar] = useState(false);
  const aviso = avisar(fila);
  const t = tono(fila);
  const c = t ? COLORES[t] : null;
  const conDinero = fila.panal > 0n || fila.mon > 0n;

  return (
    <div className={`shrink-0 rounded-[14px] border bg-cream ${c?.borde ?? 'border-line'}`}>
      <button type="button" onClick={onAbrir} className="pulsable w-full p-3.5 text-left">
        <div className="flex items-center gap-3">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: fila.activo ? '#92A268' : '#C9653B' }}
          />
          <div className="min-w-0 grow">
            <p className="truncate text-[14.5px] font-semibold">{fila.nombre}</p>
            {/* La dirección va DELANTE del estado, y no es redundante: dos de
                los nueve agentes de mainnet se llaman «LexPanal» los dos. El
                nombre lo escribe cada uno en su ficha y nadie comprueba que no
                se repita, así que en una cartera es la dirección lo que
                distingue una fila de otra. */}
            <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
              <span className="font-mono">
                {fila.direccion.slice(0, 6)}…{fila.direccion.slice(-4)}
              </span>{' '}
              · {fila.registrado ? (fila.activo ? 'Activo' : 'Pausado') : 'Sin registrar'}
              {fila.registrado && ` · ${montoCuadro(fila.precio)} ${fila.moneda}`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {conDinero ? (
              <>
                {fila.panal > 0n && (
                  <p className="font-mono text-[13.5px] text-honey">{montoCuadro(fila.panal)}</p>
                )}
                {fila.mon > 0n && (
                  <p className="font-mono text-[13.5px] text-monad-mist">
                    {montoCuadro(fila.mon)}
                  </p>
                )}
                <p className="mt-0.5 text-[10.5px] text-ink-3">sin cobrar</p>
              </>
            ) : (
              <p className="font-mono text-[13.5px] text-ink-3">0</p>
            )}
          </div>
        </div>

        {aviso && c && (
          <p className={`mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-[1.45] ${c.texto}`}>
            {aviso}
          </p>
        )}
      </button>

      {confirmar ? (
        <div className="border-t border-line px-3.5 py-2.5">
          <p className="text-[11.5px] leading-[1.5] text-ink-2">
            Se quita de tu lista. El agente sigue igual, y puedes volver a seguirlo pegando su
            dirección.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(false)}
              className="pulsable tocable grow rounded-full border border-line py-2 text-[12.5px] text-ink-2"
            >
              Ahora no
            </button>
            <button
              type="button"
              onClick={onDejar}
              className="pulsable tocable grow rounded-full bg-sand py-2 text-[12.5px] font-medium text-terra"
            >
              Dejar de seguir
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmar(true)}
          className="pulsable tocable w-full border-t border-line py-2 text-center text-[11.5px] text-ink-3"
        >
          Dejar de seguir
        </button>
      )}
    </div>
  );
}

function Cifra({ valor, simbolo }: { valor: bigint; simbolo: string }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[24px] font-medium leading-none text-honey">
        {montoCuadro(valor)}
      </span>
      <span className="text-[12.5px] font-semibold text-honey">{simbolo}</span>
    </div>
  );
}
