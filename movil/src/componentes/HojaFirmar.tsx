import type { X402Accept } from '@panal/sdk';
import type { CobroPorLlamada } from '@/lib/chat';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import { monto } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';

/**
 * Pagar un mensaje: x402.
 *
 * El número que se enseña es el de la COTIZACIÓN recién pedida, no el de la
 * tarjeta del agente. Entre una cosa y la otra un agente puede subir su
 * precio, y lo que se firma tiene que ser lo que se lee.
 *
 * Mientras se firma la hoja no se puede cerrar: cerrarla con la wallet abierta
 * deja a la persona sin saber si pagó, que es la peor pregunta posible.
 */
export default function HojaFirmar({
  abierta,
  cobro,
  cotizacion,
  enviando,
  onCerrar,
  onConfirmar,
}: {
  abierta: boolean;
  cobro: CobroPorLlamada | null;
  cotizacion: X402Accept | null;
  enviando: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
}): React.ReactElement | null {
  const T = useTextos();
  if (!cobro || !cotizacion) return null;

  const importe = BigInt(cotizacion.amount);
  const subio = importe > cobro.amount;

  return (
    <Hoja abierta={abierta} titulo={T.firmar.titulo} onCerrar={onCerrar} bloqueada={enviando}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{T.firmar.entradilla}</p>

      <Tarjeta>
        <Fila
          etiqueta={T.firmar.coste}
          valor={`${monto(importe)} ${cobro.simbolo}`}
          color="text-ink"
        />
        <Fila etiqueta={T.firmar.gas} valor={T.firmar.gasLoPaga} color="text-olive" />
      </Tarjeta>

      {/* Si el precio subió respecto a la tarjeta, se dice. El SDK no firmaría
          por encima del tope, pero enterarse por un fallo es enterarse tarde. */}
      {subio && (
        <Nota tono="miel">
          {T.firmar.subioPrecio(monto(cobro.amount), cobro.simbolo)}
        </Nota>
      )}

      <Nota>{T.firmar.sinConstancia}</Nota>

      <div className="mt-[18px] flex gap-2.5 pb-1">
        <div className="grow">
          <Boton variante="secundario" onClick={onCerrar} disabled={enviando}>
            {T.comun.cancelar}
          </Boton>
        </div>
        <div className="grow-[1.6]">
          <Boton onClick={onConfirmar} disabled={enviando}>
            {enviando ? T.firmar.esperando : T.firmar.firmarYEnviar}
          </Boton>
        </div>
      </div>
    </Hoja>
  );
}
