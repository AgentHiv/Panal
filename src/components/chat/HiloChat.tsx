/**
 * Panal — el hilo de conversación con un agente.
 *
 * Cada mensaje se paga por x402: se pide precio (gratis), se firma un permiso
 * y el agente cobra y responde en la misma llamada. Ni gas, ni esperar
 * bloques, ni aprobar nada.
 *
 * Tres cosas de esta pantalla no son decorativas:
 *
 *   1. EL PRECIO SIEMPRE A LA VISTA. Un chat que cobra sin recordarlo se
 *      siente como una trampa. Va bajo el campo de escribir, siempre.
 *   2. LA COTIZACIÓN SE PIDE ANTES DE FIRMAR, no se usa la de la tarjeta. Un
 *      agente puede subir su precio entre que se cargó la ficha y que se
 *      escribe el mensaje, y lo que se enseña tiene que ser lo que se firma.
 *   3. SI FALLA, SE DICE SI SE COBRÓ. Es siempre la primera pregunta de quien
 *      ve un error, y callarla es lo que convierte un fallo en desconfianza.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useWalletClient } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2, Send, TriangleAlert } from 'lucide-react';
import type { X402Accept } from '@panal/sdk';
import {
  cotizar,
  enviarMensaje,
  leerCobroPorLlamada,
  motivoLegible,
  type CobroPorLlamada,
} from '@/lib/chat';
import { anadirMensaje, leerHilo, nuevoId, type Mensaje } from '@/lib/historial';
import { activeChain } from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import FirmarMensajeDialog from '@/components/chat/FirmarMensajeDialog';

export interface HiloChatProps {
  /** Dirección on-chain del agente. Es la mitad de la clave del hilo. */
  agente: string;
  nombre: string;
  /** Su endpoint publicado en el registro. Sin esto no hay con quién hablar. */
  botUrl: string | null;
}

export default function HiloChat({ agente, nombre, botUrl }: HiloChatProps) {
  const { t } = useTranslation();
  const { address, connected, connect } = useWallet();
  const { data: walletClient } = useWalletClient();

  /**
   * Todo lo que depende de CON QUIÉN se habla y COMO QUIÉN.
   *
   * Se reinicia comparando la clave en el render y no desde un efecto: hacerlo
   * en un efecto encadena un render de más y, sobre todo, deja un instante en
   * el que se enseña el hilo de la wallet ANTERIOR. En una app donde la wallet
   * es la identidad, ese instante es enseñarle a alguien una conversación que
   * no es suya.
   */
  const claveHilo = `${address ?? ''}|${agente}|${botUrl ?? ''}`;
  const [clavePrevia, setClavePrevia] = useState(claveHilo);
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => (address ? leerHilo(address, agente) : []));
  /** `undefined` = todavía no se sabe · `null` = no cobra por llamada. */
  const [cobro, setCobro] = useState<CobroPorLlamada | null | undefined>(botUrl ? undefined : null);
  const [borrador, setBorrador] = useState('');
  const [cotizacion, setCotizacion] = useState<X402Accept | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  if (clavePrevia !== claveHilo) {
    setClavePrevia(claveHilo);
    setMensajes(address ? leerHilo(address, agente) : []);
    setCobro(botUrl ? undefined : null);
    setCotizacion(null);
  }

  const estadoCobro = cobro === undefined ? 'leyendo' : cobro === null ? 'sin' : 'listo';

  // ¿Cobra por llamada este agente? Hay agentes que sólo aceptan encargos del
  // escrow: con esos no se puede chatear, y es mejor decirlo que ofrecer un
  // campo de texto que no va a poder enviarse.
  useEffect(() => {
    if (!botUrl) return;
    let vigente = true;
    void leerCobroPorLlamada(botUrl).then((c) => {
      if (vigente) setCobro(c);
    });
    return () => {
      vigente = false;
    };
  }, [botUrl]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes.length, enviando]);

  const precio = cobro ? `${formatUnits(cobro.amount, 18)} ${cobro.simbolo}` : '';

  /** Paso 1: pedir el precio de ESTE mensaje. Gratis, y no compromete a nada. */
  const pedirCotizacion = useCallback(async () => {
    if (!cobro || !address || !borrador.trim()) return;
    setPidiendo(true);
    try {
      setCotizacion(await cotizar(cobro, borrador.trim(), address as `0x${string}`));
    } catch (err) {
      toast.error(t('chat.quoteFailed'), { description: motivoLegible(err) });
    } finally {
      setPidiendo(false);
    }
  }, [cobro, address, borrador, t]);

  /** Paso 2: firmar y enviar. Aquí es donde se cobra. */
  const confirmar = useCallback(async () => {
    if (!cobro || !cotizacion || !walletClient || !address) return;
    const texto = borrador.trim();
    setCotizacion(null);
    setEnviando(true);

    // El mensaje propio se pinta y se guarda ANTES de la respuesta: si el
    // agente tarda o falla, lo que se escribió no se pierde de la pantalla.
    const mio: Mensaje = { id: nuevoId(), de: 'yo', texto, cuando: Date.now() };
    setMensajes(anadirMensaje(address, agente, mio));
    setBorrador('');

    try {
      const res = await enviarMensaje({
        cobro,
        mensaje: texto,
        wallet: walletClient,
        account: walletClient.account,
        topeMaximo: cobro.amount,
        cotizacion,
        chainId: activeChain.id,
      });
      setMensajes(
        anadirMensaje(address, agente, {
          id: nuevoId(),
          de: 'agente',
          texto: res.texto,
          cuando: Date.now(),
          pagado: res.pagado.toString(),
          simbolo: cobro.simbolo,
        }),
      );
    } catch (err) {
      toast.error(t('chat.sendFailed'), { description: motivoLegible(err) });
      // El borrador vuelve para que no haya que reescribirlo.
      setBorrador(texto);
    } finally {
      setEnviando(false);
    }
  }, [cobro, cotizacion, walletClient, address, borrador, agente, t]);

  const puedeEnviar = estadoCobro === 'listo' && connected && borrador.trim().length > 0 && !enviando && !pidiendo;

  return (
    <div className="flex h-full flex-col">
      {/* Los mensajes */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {mensajes.length === 0 && (
          <p className="mx-auto max-w-sm py-10 text-center text-[0.875rem] leading-relaxed text-ink-3">
            {t('chat.empty', { name: nombre })}
          </p>
        )}

        {mensajes.map((m) => (
          <div
            key={m.id}
            className={cn(
              'max-w-[82%] rounded-2xl border px-3.5 py-2.5 text-[0.875rem] leading-relaxed',
              m.de === 'yo'
                ? 'ml-auto rounded-br-sm border-monad/40 bg-monad/15 text-ink'
                : 'mr-auto rounded-bl-sm border-line bg-cream text-ink',
            )}
          >
            <p className="whitespace-pre-wrap break-words">{m.texto}</p>
          </div>
        ))}

        {enviando && (
          <div className="mr-auto flex max-w-[82%] items-center gap-2 rounded-2xl rounded-bl-sm border border-line bg-cream px-3.5 py-2.5 text-[0.8125rem] text-ink-3">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t('chat.working', { name: nombre })}
          </div>
        )}
        <div ref={finRef} />
      </div>

      {/* Escribir */}
      <div className="border-t border-line bg-coal-2 px-3 py-3">
        {estadoCobro === 'sin' ? (
          <p className="flex items-start gap-2 px-1 py-2 text-[0.8125rem] leading-relaxed text-ink-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-honey" aria-hidden />
            {t('chat.noPerCall', { name: nombre })}
          </p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <textarea
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                rows={1}
                placeholder={t('chat.placeholder')}
                disabled={estadoCobro === 'leyendo' || enviando}
                className="max-h-32 min-h-11 w-full flex-1 resize-none rounded-2xl border border-line bg-sand px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => (connected ? void pedirCotizacion() : connect())}
                disabled={connected && !puedeEnviar}
                aria-label={t('chat.send')}
                className="btn-monad flex size-11 shrink-0 disabled:opacity-40"
              >
                {pidiendo || enviando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
              </button>
            </div>

            {/* El precio, siempre. Y la limitación del historial, dicha una vez. */}
            <p className="mt-2 px-1 text-[0.6875rem] leading-snug text-ink-3">
              {estadoCobro === 'leyendo'
                ? t('chat.loadingPrice')
                : t('chat.perMessage', { price: precio })}
              {' · '}
              {t('chat.localHistory')}
            </p>
          </>
        )}
      </div>

      <FirmarMensajeDialog
        open={cotizacion !== null}
        onOpenChange={(abierto) => !abierto && setCotizacion(null)}
        cotizacion={cotizacion}
        nombre={nombre}
        onConfirmar={() => void confirmar()}
      />
    </div>
  );
}
