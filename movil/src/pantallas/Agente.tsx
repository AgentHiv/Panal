import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { MARCA_VACIA, enlacesDe } from '@/lib/marca';
import { TRAZOS_MARCA } from '@/lib/iconosMarca';
import type { OnchainAgent } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';
import { useAhora } from '@/hooks/useAhora';
import { useAgente } from '~/lib/agente';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import { monto, precio } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * La ficha del agente.
 *
 * LO PRIMERO ES LA VERIFICACIÓN, y no por costumbre: el nombre no es único en
 * el registro, así que un suplantador con el mismo nombre y la misma
 * descripción cuesta una transacción. Lo único que es de alguien es su
 * dominio. Elegir sin mirar esto es el fallo que más caro sale.
 *
 * Y son TRES estados, no dos: verificado, no verificado y sin comprobar. Un
 * `unchecked` tratado como bueno es exactamente el error que la distinción
 * existe para evitar.
 *
 * LO QUE NO SE ENSEÑA: el «% de éxito». No se mide en ninguna parte —se asigna
 * 100 fijo en usePanalAgents— así que todos los agentes saldrían perfectos y el
 * número no significaría nada delante de alguien que va a pagar.
 */
export default function Agente(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const direccion = (id ?? '').toLowerCase();
  const navegar = useNavigate();
  const { agents, loading } = usePanalAgents();
  const { data: datos } = useAgente(direccion);
  const T = useTextos();

  const agente = useMemo(
    () =>
      agents.find(
        (a) => 'workerAddress' in a && a.workerAddress.toLowerCase() === direccion,
      ) as OnchainAgent | undefined,
    [agents, direccion],
  );

  // Lo que el creador publicó en su ficha. Vacío es lo normal.
  const marca = agente ? agente.marca : MARCA_VACIA;
  const enlaces = enlacesDe(marca);

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center px-3 pt-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          aria-label={T.agente.volver}
          className="pulsable flex h-11 w-11 items-center justify-center"
        >
          <Icono nombre="atras" tamano={24} color="#C8C3DC" grosor={2} />
        </button>
      </header>

      {/* `shrink-0` en TODOS los hijos. En una columna flex encogen antes de que
          el contenedor se decida a desplazarse, y `min-height: auto` solo los
          protege mientras `overflow` sea `visible` — las dos tarjetas de aquí
          llevan `overflow-hidden` para redondear las esquinas, así que no las
          protege nada. Medido en 360x640 con enlaces: la tarjeta de precios se
          quedaba en 16 px de los 128 que ocupa, o sea «Hablar» cortado por la
          mitad y «Encargar» sin llegar a verse, y la pantalla no se movía
          porque scrollHeight y clientHeight coincidían. Se notaba al añadir los
          enlaces porque son 80 px más, pero el fallo estaba desde antes. */}
      <div className="flex min-h-0 grow flex-col gap-3.5 overflow-y-auto px-[18px] pb-4">
        <div className="flex shrink-0 items-center gap-3.5">
          <Hexagono
            semilla={direccion}
            inicial={(agente?.name ?? datos?.nombre ?? 'A').slice(0, 1)}
            tamano={64}
            logo={marca.logo}
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[24px] font-semibold -tracking-[0.02em]">
              {agente?.name ?? datos?.nombre ?? '…'}
            </h1>
            <p className="seleccionable mt-1 font-mono text-[12px] text-ink-3">
              {`${direccion.slice(0, 6)}…${direccion.slice(-4)}`}
            </p>
          </div>
        </div>

        {agente && <Verificacion agente={agente} T={T} />}
        {agente && <OrigenDelNombre agente={agente} T={T} />}

        {agente && (
          <div className="flex shrink-0 divide-x divide-line overflow-hidden rounded-[14px] border border-line">
            <Dato valor={String(agente.tasksCompleted)} pie={T.agente.tareasCompletadas} />
            <Dato
              valor={agente.reviews > 0 ? agente.rating.toFixed(1) : '—'}
              pie={
                agente.reviews > 0 ? T.agente.valoraciones(agente.reviews) : T.agente.sinValoraciones
              }
              color={agente.reviews > 0 ? 'text-honey' : 'text-ink-3'}
            />
            <Dato
              valor={precio(agente.totalEarned) ?? '0'}
              pie={T.agente.cobrados(currencySymbol(agente.currency))}
            />
          </div>
        )}

        {agente?.tagline && (
          <p className="seleccionable shrink-0 break-words text-[14px] leading-[1.55] text-ink-2">
            {agente.tagline}
          </p>
        )}

        {/*
          Sus enlaces: web, repositorio, cuentas. Esta es la pantalla donde
          alguien decide pagarle a un desconocido, y hasta ahora no había nada
          que mirar fuera de lo que el propio agente escribía de sí mismo.

          `_blank` no abre una pestaña dentro de la app: en Android sale al
          navegador del teléfono, que es lo que hay que querer aquí — la app
          guarda un llavero, y no tiene por qué enseñar dentro páginas de nadie.
        */}
        {enlaces.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {enlaces.map(({ clave, url, rotulo }) => (
              <a
                key={clave}
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="pulsable flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-ink-2"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden>
                  <path d={TRAZOS_MARCA[clave]} />
                </svg>
                <span className="max-w-[140px] truncate">{rotulo}</span>
              </a>
            ))}
          </div>
        )}

        <div className="shrink-0 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          <Precio
            titulo={T.agente.hablar}
            pie={T.agente.hablarPie}
            valor={
              datos?.cobro
                ? `${monto(datos.cobro.amount)} ${datos.cobro.simbolo}`
                : T.agente.noDisponible
            }
            color={datos?.cobro ? 'text-honey' : 'text-ink-3'}
          />
          <Precio
            titulo={T.agente.encargar}
            pie={T.agente.encargarPie}
            valor={
              !agente
                ? '…'
                : precio(agente.pricePerTask)
                  ? `${precio(agente.pricePerTask)} ${currencySymbol(agente.currency)}`
                  : T.agente.sinPrecio
            }
            color={agente && precio(agente.pricePerTask) ? 'text-monad-mist' : 'text-ink-3'}
          />
        </div>

        {loading && !agente && (
          <p className="shrink-0 pt-4 text-center text-[13px] text-ink-3">{T.agente.buscando}</p>
        )}
      </div>

      <div className="con-barra-abajo flex shrink-0 gap-2.5 border-t border-line bg-noche px-[18px] pt-3">
        <button
          type="button"
          onClick={() => navegar(`/chat/${direccion}`)}
          disabled={!datos?.cobro}
          className="pulsable h-[52px] grow rounded-full border border-honey text-[15px] font-semibold text-honey disabled:opacity-40"
        >
          {T.agente.botonHablar}
        </button>
        <button
          type="button"
          onClick={() => navegar(`/chat/${direccion}?encargar=1`)}
          className="pulsable h-[52px] grow rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
        >
          {T.agente.botonEncargar}
        </button>
      </div>
    </div>
  );
}

function Verificacion({ agente, T }: { agente: OnchainAgent; T: Textos }): React.ReactElement {
  const caso = {
    verified: {
      color: 'text-olive',
      borde: 'border-olive/35',
      fondo: 'bg-olive/10',
      titulo: T.agente.verificado,
      texto: T.agente.verificadoTexto,
    },
    unverified: {
      color: 'text-terra',
      borde: 'border-terra/40',
      fondo: 'bg-terra/10',
      titulo: T.agente.noVerificado,
      // El motivo lo escribe el verificador y llega ya en un idioma: se enseña
      // tal cual, que decir algo concreto vale más que decirlo traducido.
      texto: agente.verificationReason ?? T.agente.noVerificadoTexto,
    },
    unchecked: {
      color: 'text-honey',
      borde: 'border-honey-line',
      fondo: 'bg-honey-soft',
      titulo: T.agente.sinComprobar,
      texto: T.agente.sinComprobarTexto,
    },
  }[agente.verification];

  return (
    <div className={`shrink-0 rounded-[14px] border px-3.5 py-3 ${caso.borde} ${caso.fondo}`}>
      <p className={`text-[13.5px] font-semibold ${caso.color}`}>{caso.titulo}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-2">{caso.texto}</p>
    </div>
  );
}

/**
 * De dónde salió el nombre.
 *
 * Un nombre comprado la semana pasada y uno reclamado hace un año valen lo
 * mismo como identificador y NO valen lo mismo como señal: en una venta lo
 * único que viaja es el nombre, y la reputación se queda con quien lo vendió.
 */
function OrigenDelNombre({
  agente,
  T,
}: {
  agente: OnchainAgent;
  T: Textos;
}): React.ReactElement | null {
  // `useAhora` en vez de Date.now(): leer el reloj en el render da resultados
  // distintos en cada repintado y React no puede garantizar nada sobre eso.
  const ahora = useAhora(60_000);
  const n = agente.nombreOnchain;
  if (!n) return null;

  const dias = Math.floor((ahora - n.desdeTs) / 86_400);
  const comprado = n.origen === 'comprado' || n.origen === 'recibido';
  const reciente = comprado && dias <= 30;

  const texto = !n.origen
    ? T.agente.nombreSinOrigen(dias)
    : T.agente.nombreOrigen(T.agente.origenes[n.origen], dias);

  return (
    <div className="flex shrink-0 items-start gap-2.5">
      <Icono
        nombre="hexagono"
        tamano={15}
        color={reciente ? '#C9653B' : '#948DAE'}
        grosor={1.9}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0">
        <p className={`text-[12.5px] font-medium ${reciente ? 'text-terra' : 'text-ink-3'}`}>
          {texto}
        </p>
        {reciente && (
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
            {T.agente.nombreReciente}
          </p>
        )}
      </div>
    </div>
  );
}

function Dato({
  valor,
  pie,
  color = 'text-ink',
}: {
  valor: string;
  pie: string;
  color?: string;
}): React.ReactElement {
  return (
    <div className="grow px-3.5 py-3">
      <p className={`font-mono text-[19px] font-medium ${color}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-ink-3">{pie}</p>
    </div>
  );
}

function Precio({
  titulo,
  pie,
  valor,
  color,
}: {
  titulo: string;
  pie: string;
  valor: string;
  color: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 grow">
        <p className="text-[13.5px] font-medium">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-3">{pie}</p>
      </div>
      <p className={`shrink-0 font-mono text-[13.5px] ${color}`}>{valor}</p>
    </div>
  );
}
