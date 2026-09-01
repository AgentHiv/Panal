import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { PANAL_ESCROW_V2_ADDRESS, activeChain } from '@/contracts/config';
import { panalEscrowV2Abi } from '@/contracts/abis';
import type { EncargoEnHilo } from '@/lib/conversaciones';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import { monto, restante } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';


/**
 * Revisar una entrega: aprobar con nota, o disputar.
 *
 * LAS ESTRELLAS NO SON UN ADORNO. `approveAndRelease(taskId, rating)` exige una
 * nota de 1 a 5: aprobar sin puntuar no existe en el contrato, así que el botón
 * espera a que elijas en vez de mandar un 5 por defecto en tu nombre.
 *
 * Y la cuenta atrás va arriba del todo porque callarse NO es neutral: a los
 * tres días de la entrega `autoRelease` lo cobra cualquiera y deja un 5
 * registrado. No decir nada es pagar y poner sobresaliente.
 */
export default function HojaRevisar({
  encargo,
  onCerrar,
  onHecho,
}: {
  encargo: EncargoEnHilo | null;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement | null {
  const [estrellas, setEstrellas] = useState(0);
  const [disputando, setDisputando] = useState(false);
  const T = useTextos();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });

  // Solo avisar al padre: la hoja se desmonta al cerrarse, asi que las
  // estrellas y la vista de disputa se reinician solas.
  useEffect(() => {
    if (recibo.isSuccess) onHecho();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  if (!encargo) return null;

  const trabajando = isPending || recibo.isLoading;
  const alAgente = (BigInt(encargo.importe) * 9_750n) / 10_000n;
  const comision = BigInt(encargo.importe) - alAgente;

  const aprobar = () => {
    if (estrellas < 1) return;
    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'approveAndRelease',
      args: [BigInt(encargo.id), estrellas],
      chainId: activeChain.id,
    });
  };

  const abrirDisputa = () => {
    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'openDispute',
      args: [BigInt(encargo.id)],
      chainId: activeChain.id,
    });
  };

  if (disputando) {
    return (
      <Hoja
        abierta
        titulo={T.revisar.disputaTitulo}
        onCerrar={() => setDisputando(false)}
        bloqueada={trabajando}
      >
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
          {T.revisar.disputaTexto(monto(encargo.importe), encargo.simbolo)}
        </p>

        {/* Sin campo de motivo a propósito: openDispute no acepta texto, y
            guardarlo en otro sitio sería inventar infraestructura. El árbitro
            ya puede ver lo que hace falta para juzgar. */}
        <div className="mt-4 rounded-[14px] border border-line px-4 py-3.5">
          <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
            {T.revisar.loQueVeraQuienDecide}
          </p>
          <ul className="mt-2.5 flex flex-col gap-2 text-[13px] text-ink-2">
            <li>{T.revisar.pruebaBrief}</li>
            <li>{T.revisar.pruebaEntrega}</li>
            <li>{T.revisar.pruebaHilo}</li>
          </ul>
        </div>

        <Tarjeta>
          <Fila
            etiqueta={T.revisar.decide}
            pie={T.revisar.decidePie}
            valor="0xc384…1Fe0"
            color="text-ink-3"
          />
        </Tarjeta>

        <Nota>{T.revisar.catorceDias}</Nota>

        <div className="mt-[18px] flex gap-2.5 pb-1">
          <div className="grow">
            <Boton variante="secundario" onClick={() => setDisputando(false)} disabled={trabajando}>
              {T.comun.ahoraNo}
            </Boton>
          </div>
          <div className="grow-[1.4]">
            <Boton variante="peligro" onClick={abrirDisputa} disabled={trabajando}>
              {trabajando ? T.revisar.abriendo : T.revisar.abrirDisputa}
            </Boton>
          </div>
        </div>
      </Hoja>
    );
  }

  return (
    <Hoja abierta titulo={T.revisar.titulo} onCerrar={onCerrar} bloqueada={trabajando}>
      {encargo.entregado && (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-honey-line bg-honey-soft px-3.5 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#E29A2E"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            aria-hidden
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          <p className="text-[12.5px] leading-[1.45] text-honey">
            {T.revisar.seApruebaSolo}{' '}
            <strong className="font-semibold">{restante(encargo.entregado)}</strong>
            , con 5 estrellas.
          </p>
        </div>
      )}

      <div className="mt-3.5 rounded-[14px] border border-line px-4 py-3">
        <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
          {T.revisar.loQuePediste}
        </p>
        <p className="seleccionable mt-1.5 break-words text-[13.5px] leading-[1.5] text-ink-2">
          {encargo.brief ?? T.revisar.briefPerdido}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[13.5px] font-semibold">{T.revisar.tuValoracion}</p>
          <p className={`text-[12.5px] ${estrellas > 0 ? 'text-ink-2' : 'text-ink-3'}`}>
            {T.revisar.leyendas[estrellas]}
          </p>
        </div>
        <div className="-ml-2.5 mt-0.5 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setEstrellas(v)}
              disabled={trabajando}
              aria-label={T.revisar.estrellas(v)}
              className="pulsable flex h-11 w-11 items-center justify-center"
            >
              <svg
                width="27"
                height="27"
                viewBox="0 0 24 24"
                fill={v <= estrellas ? '#E29A2E' : 'none'}
                stroke={v <= estrellas ? '#E29A2E' : '#4A4363'}
                strokeWidth="1.7"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3.4l2.7 5.5 6 .9-4.35 4.2 1.03 6-5.38-2.83L6.62 20l1.03-6L3.3 9.8l6-.9z" />
              </svg>
            </button>
          ))}
        </div>
        <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
          {T.revisar.quedaEnElRegistro}
        </p>
      </div>

      <Tarjeta>
        <Fila
          etiqueta={T.revisar.alAgente}
          valor={`${monto(alAgente)} ${encargo.simbolo}`}
          color="text-ink"
        />
        <Fila
          etiqueta={T.revisar.protocolo}
          valor={`${monto(comision)} ${encargo.simbolo}`}
          color="text-ink-2"
        />
      </Tarjeta>

      <div className="mt-4">
        <Boton
          onClick={aprobar}
          variante={estrellas > 0 ? 'principal' : 'apagado'}
          disabled={estrellas < 1 || trabajando}
        >
          {trabajando
            ? T.revisar.firmando
            : estrellas > 0
              ? T.revisar.aprobarYPagar(monto(encargo.importe), encargo.simbolo)
              : T.revisar.eligeValoracion}
        </Boton>
      </div>

      <button
        type="button"
        onClick={() => setDisputando(true)}
        disabled={trabajando}
        className="pulsable mt-0.5 flex h-11 w-full items-center justify-center gap-2 pb-1 text-[13.5px] font-medium text-terra"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#C9653B"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 4.5l8.5 15h-17z" />
          <path d="M12 10v4" />
        </svg>
        {T.revisar.algoNoCuadra}
      </button>
    </Hoja>
  );
}
