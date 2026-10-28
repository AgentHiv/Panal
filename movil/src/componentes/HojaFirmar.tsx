import { X402_NATIVE_SCHEME, type X402Accept } from '@panal/sdk';
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
  archivos = 0,
  subiendo = false,
  onCerrar,
  onConfirmar,
}: {
  abierta: boolean;
  cobro: CobroPorLlamada | null;
  cotizacion: X402Accept | null;
  enviando: boolean;
  /** Cuántos archivos van con el mensaje. Se suben antes de firmar el pago. */
  archivos?: number;
  /** Mientras se suben: la hoja sigue puesta, y dice qué está pasando. */
  subiendo?: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
}): React.ReactElement | null {
  const T = useTextos();
  if (!cobro || !cotizacion) return null;

  const importe = BigInt(cotizacion.amount);
  // En MON la cotización lleva unos wei de más, como mucho 2²⁰, para reconocer
  // el pago (`buildNativeQuote` del SDK). Eso no es subir el precio, y avisarlo
  // salía en todos los mensajes a un agente que cobra en MON.
  const enMon = cotizacion.scheme === X402_NATIVE_SCHEME;
  const cola = enMon ? 1n << 20n : 0n;
  const subio = importe > cobro.amount + cola;

  return (
    <Hoja abierta={abierta} titulo={T.firmar.titulo} onCerrar={onCerrar} bloqueada={enviando}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{enMon ? T.firmar.entradillaMon : T.firmar.entradilla}</p>

      <Tarjeta>
        <Fila
          etiqueta={T.firmar.coste}
          valor={`${monto(importe, cobro.decimales)} ${cobro.simbolo}`}
          color="text-ink"
        />
        {/* En MON no se firma un permiso: se manda una transferencia, y su gas lo
            paga quien la manda. */}
        <Fila
          etiqueta={T.firmar.gas}
          valor={enMon ? T.firmar.gasLoPagasTu : T.firmar.gasLoPaga}
          color={enMon ? 'text-ink-2' : 'text-olive'}
        />
        {archivos > 0 && <Fila etiqueta={T.firmar.archivos} valor={String(archivos)} color="text-ink" />}
      </Tarjeta>

      {/* Si el precio subió respecto a la tarjeta, se dice. El SDK no firmaría
          por encima del tope, pero enterarse por un fallo es enterarse tarde. */}
      {subio && (
        <Nota tono="miel">
          {T.firmar.subioPrecio(monto(cobro.amount, cobro.decimales), cobro.simbolo)}
        </Nota>
      )}

      {archivos > 0 && <Nota>{T.firmar.archivosNota}</Nota>}
      <Nota>{T.firmar.sinConstancia}</Nota>

      <div className="mt-[18px] flex gap-2.5 pb-1">
        <div className="grow">
          <Boton variante="secundario" onClick={onCerrar} disabled={enviando}>
            {T.comun.cancelar}
          </Boton>
        </div>
        <div className="grow-[1.6]">
          <Boton onClick={onConfirmar} disabled={enviando}>
            {subiendo ? T.firmar.subiendo : enviando ? T.firmar.esperando : T.firmar.firmarYEnviar}
          </Boton>
        </div>
      </div>
    </Hoja>
  );
}
