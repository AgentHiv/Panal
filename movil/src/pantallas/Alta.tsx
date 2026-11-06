import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { useWallet } from '@/hooks/useWallet';
import { panalRegistryV2Abi } from '@/contracts/abis';
import {
  NATIVE_CURRENCY,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  publicClient,
} from '@/contracts/config';
import { esFaltaDeReserva, monHaciaArriba, reservaParaContrato, type Reserva } from '@/lib/reservaDeGas';
import Icono from '~/componentes/Icono';
import CamposMarca from '~/componentes/CamposMarca';
import { MARCA_VACIA, type Marca } from '@/lib/marca';
import { resumirFicha } from '@/lib/agentMetadata';
import { urlDeBuzon } from '@/lib/botEndpoint';
import type { TipoDeAgente } from '@panal/sdk';
import { armarFicha, useFicha } from '~/lib/agentes';
import { listar } from '~/lib/llavero';
import { useTextos } from '~/i18n/idiomas';

/**
 * Dar de alta un agente.
 *
 * LO PRIMERO ES LA WALLET, y no es un detalle de orden: `registerAgent` no
 * recibe ninguna dirección, así que quien firma SE CONVIERTE en el agente.
 * Elegir la wallet no es un ajuste de la pantalla, es decidir quién va a ser —
 * y su clave va a acabar en el servidor que lo haga funcionar. De ahí que la
 * pantalla insista en que sea una nueva.
 *
 * La ficha NO es un JSON: es texto con las partes separadas por «·» y `bot:`
 * delante de la URL. Así están escritas las nueve de mainnet y así las lee
 * `botEndpoint.ts`, por eso se enseña literalmente lo que se va a escribir.
 */
export default function Alta(): React.ReactElement {
  const navegar = useNavigate();
  const { address, connected, connect, connecting } = useWallet();

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [bot, setBot] = useState('');
  /**
   * Quién se da de alta: una persona que ofrece su trabajo o un programa. Lo
   * dice el sitio desde donde se llega (`/alta?tipo=persona` sale del menú;
   * `/alta`, de «Tus agentes»), no un interruptor aquí dentro: una persona no
   * tiene por qué pasar por un formulario de agentes.
   */
  const [params] = useSearchParams();
  const tipo: TipoDeAgente = params.get('tipo') === 'persona' ? 'persona' : 'bot';
  const [precio, setPrecio] = useState('');
  const [enPanal, setEnPanal] = useState(true);
  /** Logo y enlaces del creador. Todo opcional; lo vacío no escribe nada. */
  const [marca, setMarca] = useState<Marca>(MARCA_VACIA);
  const T = useTextos();
  /** Los textos del alta, en la voz de quien se registra. */
  const A = tipo === 'persona' ? { ...T.alta, ...T.altaPersona } : T.alta;

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  // Ya registrado: no se puede volver a dar de alta la misma wallet.
  const { data: yaEs } = useFicha(connected ? (address ?? undefined) : undefined);

  // Del llavero salen los candidatos, y se marca si alguno es el conectado.
  const [delLlavero] = useState(() => listar());

  useEffect(() => {
    if (recibo.isSuccess && address) navegar(`/panel/${address.toLowerCase()}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  // Una persona no escribe dirección: recibe en el buzón de Panal, a su nombre.
  const donde = tipo === 'persona' ? (address ? urlDeBuzon(address) : '') : bot;
  const ficha = armarFicha(nombre, descripcion, donde, marca, [], tipo);
  const wei = parsear(precio);
  /**
   * Lo que falta para la reserva de gas de Monad, mirado antes de firmar.
   * El porqué entero está en `lib/reservaDeGas.ts`, que comparte con la web.
   */
  const [faltaGas, setFaltaGas] = useState<Reserva | null>(null);
  const [mirandoGas, setMirandoGas] = useState(false);
  const trabajando = isPending || recibo.isLoading || mirandoGas;
  const listo = connected && !!nombre.trim() && wei !== null && !yaEs?.registrado;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label={A.volver}
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">
          {A.titulo}
        </h1>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        <Titulo>{A.quienSera}</Titulo>

        {connected ? (
          <div className="shrink-0 rounded-[14px] border border-line bg-cream p-3.5">
            <p className="font-mono text-[13px] text-ink">
              {address!.slice(0, 10)}…{address!.slice(-8)}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-3">
              {delLlavero.some((w) => w.direccion.toLowerCase() === address!.toLowerCase())
                ? A.delLlavero
                : A.laConectada}
            </p>
            {yaEs?.registrado && (
              <p className="mt-2 text-[12px] leading-[1.5] text-terra">
                {A.yaRegistrada(yaEs.nombre)}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="pulsable tocable shrink-0 rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white shadow-monad disabled:opacity-60"
          >
            {connecting ? T.comun.conectando : A.conectarLaQueSera}
          </button>
        )}

        <div className="flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
          <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
          {tipo === 'persona' ? (
            // Una persona no pone su clave en ningún servidor: el aviso de usar
            // una wallet nueva es de los agentes, y aquí sería falso.
            <p className="text-[12px] leading-[1.55] text-ink-2">{T.altaPersona.aviso}</p>
          ) : (
            <p className="text-[12px] leading-[1.55] text-ink-2">
              {A.avisoClaveAntes}{' '}
              <span className="font-semibold text-honey">{A.seConvierteEn}</span>
              {A.avisoClaveDespues}
            </p>
          )}
        </div>

        {delLlavero.length > 0 && (
          <button
            type="button"
            onClick={() => navegar('/llavero')}
            className="pulsable shrink-0 rounded-[14px] border border-dashed border-line p-3 text-left"
          >
            <p className="text-[12.5px] text-ink-2">
              {A.tienesEnLlavero(delLlavero.length)}
            </p>
          </button>
        )}

        {tipo === 'persona' && (
          <div className="flex shrink-0 gap-2.5 rounded-[14px] border border-line bg-cream p-3.5">
            <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
            <p className="min-w-0 text-[12px] leading-[1.55] text-ink-2">{A.buzonNota}</p>
          </div>
        )}

        <Titulo>{A.suFicha}</Titulo>
        <Campo
          etiqueta={A.nombre}
          valor={nombre}
          onCambio={setNombre}
          marcador={A.nombreHueco}
        />
        <Campo
          etiqueta={A.queHace}
          valor={descripcion}
          onCambio={setDescripcion}
          marcador={A.queHaceHueco}
        />
        {tipo !== 'persona' && (
          <Campo
            etiqueta={A.dondeEscucha}
            valor={bot}
            onCambio={setBot}
            marcador={A.dondeEscuchaHueco}
            mono
          />
        )}

        {tipo !== 'persona' && !bot.trim() && (
          <div className="flex shrink-0 gap-2.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
            <Icono nombre="info" tamano={16} color="#C9653B" grosor={2} className="mt-px shrink-0" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-terra">
                {A.sinDireccionTitulo}
              </p>
              <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
                {A.sinDireccionAntes} <span className="font-mono">bot:</span>{' '}
                {A.sinDireccionDespues}
              </p>
            </div>
          </div>
        )}

        <CamposMarca
          marca={marca}
          onCambio={setMarca}
          semilla={address ?? nombre}
          titulo={tipo === 'persona' ? T.altaPersona.tuMarca : undefined}
        />

        <Titulo>{A.loQueCobra}</Titulo>
        <div className="flex shrink-0 items-center gap-2.5 rounded-[14px] border border-line p-3.5">
          <input
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="min-w-0 grow bg-transparent font-mono text-[22px] text-ink outline-none placeholder:text-ink-3"
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

        <Titulo>{A.loQueSeEscribe}</Titulo>
        <p className="seleccionable shrink-0 break-all rounded-[11px] border border-line bg-sand px-3 py-2.5 font-mono text-[11.5px] leading-[1.5] text-ink-2">
          {resumirFicha(ficha) || '—'}
        </p>

        {faltaGas && (
          <p className="shrink-0 px-1 text-[12px] leading-[1.5] text-terra">
            {A.faltaGas(
              monHaciaArriba(faltaGas.reserva),
              Number(formatEther(faltaGas.saldo)).toFixed(4).replace(/\.?0+$/, ''),
              monHaciaArriba(faltaGas.falta),
            )}
          </p>
        )}

        {error && (
          <p className="shrink-0 px-1 text-[12px] text-terra">
            {esFaltaDeReserva(error)
              ? A.reservaGas
              : /rejected|denied|user/i.test(error.message)
                ? A.firmaCancelada
                : A.noSePudoFirmar}
          </p>
        )}

        <button
          type="button"
          onClick={async () => {
            const args = [ficha, wei!, enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY] as const;
            // Antes de firmar: una wallet recién cargada con «lo justo» no
            // cubre lo que Monad reserva, y el rechazo no dice cuánto falta.
            if (address) {
              setMirandoGas(true);
              const reserva = await reservaParaContrato(publicClient as never, {
                account: address as `0x${string}`,
                address: PANAL_REGISTRY_V2_ADDRESS,
                abi: panalRegistryV2Abi as never,
                functionName: 'registerAgent',
                args,
              });
              setMirandoGas(false);
              if (reserva && reserva.falta > 0n) {
                setFaltaGas(reserva);
                return;
              }
            }
            setFaltaGas(null);
            writeContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'registerAgent',
              args,
            });
          }}
          disabled={!listo || trabajando}
          className="pulsable tocable mt-1 shrink-0 rounded-full bg-monad py-3.5 text-[15px] font-semibold text-white shadow-monad disabled:opacity-40 disabled:shadow-none"
        >
          {trabajando ? A.firmando : A.firmarAlta}
        </button>
        <p className="shrink-0 px-1 text-[11.5px] leading-[1.5] text-ink-3">
          {A.pieGas}
        </p>
      </div>
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="mt-1 shrink-0 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{children}</p>
  );
}

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
    <div className="shrink-0">
      <p className="text-[11.5px] text-ink-3">{etiqueta}</p>
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={marcador}
        spellCheck={false}
        autoCapitalize="none"
        className={`mt-1 w-full rounded-[11px] border border-line bg-sand px-3 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-honey ${
          mono ? 'font-mono text-[12.5px]' : ''
        }`}
      />
    </div>
  );
}

function parsear(texto: string): bigint | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  try {
    return parseEther(limpio);
  } catch {
    return null;
  }
}
