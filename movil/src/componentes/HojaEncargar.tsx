import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { keccak256, toBytes } from 'viem';
import {
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  NATIVE_CURRENCY,
  currencySymbol,
  activeChain,
} from '@/contracts/config';
import { panalEscrowV2Abi, panalTokenAbi } from '@/contracts/abis';
import { saveTaskBrief } from '@/lib/taskBriefs';
import type { DatosAgente } from '~/lib/agente';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import { monto } from '~/lib/formato';

const PLAZOS = [
  { etiqueta: '6 h', horas: 6 },
  { etiqueta: '24 h', horas: 24 },
  { etiqueta: '3 d', horas: 72 },
  { etiqueta: '7 d', horas: 168 },
];

/**
 * Encargar un trabajo: escrow.
 *
 * Lo que viaja por la cadena es el HASH del brief, no el texto. El texto queda
 * en este teléfono (`saveTaskBrief`) y es lo que permite reenviárselo al agente
 * si no le llegó: sin él, el encargo existe pero nadie sabe qué se pidió.
 *
 * En $PANAL hacen falta DOS transacciones —aprobar y crear— porque un ERC-20
 * no se puede mandar dentro de la llamada como el MON nativo. Se encadenan
 * solas: al minarse el approve se dispara createTask.
 */
export default function HojaEncargar({
  abierta,
  agente,
  datos,
  onCerrar,
  onHecho,
}: {
  abierta: boolean;
  agente: string;
  datos: DatosAgente | null;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement | null {
  const [brief, setBrief] = useState('');
  const [horas, setHoras] = useState(24);

  const { writeContract, data: hashTx, isPending } = useWriteContract();
  const { writeContract: aprobar, data: hashApprove } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash: hashTx });
  const reciboApprove = useWaitForTransactionReceipt({ hash: hashApprove });

  const enPanal = datos ? currencySymbol(datos.moneda) === '$PANAL' : false;
  const precio = datos?.precioTarea ?? 0n;
  const simbolo = datos ? currencySymbol(datos.moneda) : 'MON';
  // El 2,5 % sale del precio, no se suma: bloqueas el precio y el agente cobra menos.
  const comision = (precio * 250n) / 10_000n;

  const crear = () => {
    if (!datos || !brief.trim()) return;
    const texto = brief.trim();
    const taskHash = keccak256(toBytes(texto));
    saveTaskBrief(taskHash, texto);
    const plazo = BigInt(Math.floor(Date.now() / 1000) + horas * 3600);

    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'createTask',
      args: [
        agente as `0x${string}`,
        taskHash,
        plazo,
        enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY,
        precio,
      ],
      ...(enPanal ? {} : { value: precio }),
      chainId: activeChain.id,
    });
  };

  const empezar = () => {
    if (!datos || !brief.trim()) return;
    if (!enPanal) return crear();
    aprobar({
      address: PANAL_TOKEN_ADDRESS,
      abi: panalTokenAbi,
      functionName: 'approve',
      args: [PANAL_ESCROW_V2_ADDRESS, precio],
      chainId: activeChain.id,
    });
  };

  // Encadenado: en cuanto el approve se mina, se crea la tarea. `crear` solo
  // manda una transaccion —un sistema externo—, no toca estado de React.
  useEffect(() => {
    if (reciboApprove.isSuccess && !hashTx) crear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reciboApprove.isSuccess, hashTx]);

  // Al minarse, avisar al padre y ya. El componente se desmonta al cerrarse la
  // hoja, asi que no hay nada local que limpiar: esa era la duplicacion.
  useEffect(() => {
    if (recibo.isSuccess) onHecho();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  if (!datos) return null;

  // La fase se DEDUCE de las transacciones, no se guarda aparte: dos copias del
  // mismo estado es como se quedan desincronizadas.
  const aprobando = !!hashApprove && !reciboApprove.isSuccess;
  const trabajando = aprobando || isPending || recibo.isLoading;

  return (
    <Hoja abierta={abierta} titulo="Encargar trabajo" onCerrar={onCerrar} bloqueada={trabajando}>
      <p className="mt-3 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Qué le pides</p>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        placeholder="Describe el trabajo. Esto es lo que verá el agente."
        disabled={trabajando}
        className="seleccionable mt-2 w-full resize-none rounded-[14px] border border-line bg-sand px-3.5 py-3 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-ink-3"
      />

      <p className="mt-3.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Plazo</p>
      <div className="mt-2 flex gap-2">
        {PLAZOS.map((p) => {
          const elegido = p.horas === horas;
          return (
            <button
              key={p.etiqueta}
              type="button"
              onClick={() => setHoras(p.horas)}
              disabled={trabajando}
              className={`pulsable h-11 grow rounded-xl border text-[13px] font-medium ${
                elegido ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'
              }`}
            >
              {p.etiqueta}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.45] text-ink-3">
        Si no entrega a tiempo, recuperas el pago entero.
      </p>

      <Tarjeta>
        <Fila
          etiqueta="Precio del agente"
          valor={`${monto(precio)} ${simbolo}`}
          color="text-ink"
        />
        <Fila
          etiqueta="Protocolo · 2,5 %"
          valor={`${monto(comision)} ${simbolo}`}
          color="text-ink-2"
        />
        <Fila
          etiqueta="Bloqueas ahora"
          valor={`${monto(precio)} ${simbolo}`}
          destacada
          color="text-ink"
        />
      </Tarjeta>

      <Nota>
        El dinero queda retenido hasta que apruebes. La entrega se ancla en la cadena y puedes abrir
        una disputa.
      </Nota>

      <div className="mt-[18px] pb-1">
        <Boton onClick={empezar} disabled={!brief.trim() || trabajando}>
          {aprobando
            ? 'Aprobando el token…'
            : trabajando
              ? 'Bloqueando…'
              : `Bloquear ${monto(precio)} ${simbolo}`}
        </Boton>
      </div>
    </Hoja>
  );
}
