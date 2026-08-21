/**
 * Panal — un encargo, dentro de la conversación.
 *
 * No es una burbuja de chat y no debe parecerlo: un mensaje cuesta céntimos y
 * se responde al momento; un encargo bloquea el pago, tiene plazo, entrega
 * verificable y derecho a disputa. Se ve distinto porque ES distinto.
 *
 * Lo que se enseña sale de la CADENA, así que el estado es el de verdad y no
 * una copia local que se queda vieja. Lo único que puede faltar es el texto de
 * lo que se pidió: on-chain sólo viaja su hash, y el texto se guardó en el
 * navegador desde el que se contrató. Cuando no está, se dice.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Y AQUÍ SE PUEDE REENVIAR EL ENCARGO, que es la razón de que esta tarjeta
 * tenga pie.
 *
 * El brief se manda por HTTP justo después de minar `createTask`, y ese envío
 * puede no llegar: la wallet se traga la firma, el móvil recarga la página al
 * volver del navegador de la wallet, alguien cierra el diálogo antes de
 * tiempo. Cuando pasa, el pago queda bloqueado y el agente no se entera de que
 * tiene trabajo — hasta hoy sin ninguna forma de arreglarlo desde la web,
 * porque el único botón de reintento vivía dentro del diálogo de contratación
 * y desaparecía con él.
 *
 * Reenviar de más es inofensivo: el agente ignora el duplicado si ya está
 * trabajando y responde 409 si ya entregó. Quedarse sin poder reenviar no lo
 * es.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useSignMessage } from 'wagmi';
import { formatUnits } from 'viem';
import { ExternalLink, FileText, Loader2, SendHorizontal } from 'lucide-react';
import { ESTADO, type EncargoEnHilo } from '@/lib/conversaciones';
import { briefSignMessage, buildBriefUrl, enviarBriefConReintento } from '@/lib/botEndpoint';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';

/** Cómo se llama y de qué color va cada estado del escrow. */
function estadoDe(estado: number): { clave: string; color: string } {
  switch (estado) {
    case ESTADO.Entregado:
      return { clave: 'chat.order.delivered', color: 'bg-monad/15 text-monad-mist' };
    case ESTADO.Completado:
      return { clave: 'chat.order.completed', color: 'bg-olive/15 text-olive' };
    case ESTADO.Disputado:
      return { clave: 'chat.order.disputed', color: 'bg-terra/15 text-terra' };
    case ESTADO.Cancelado:
      return { clave: 'chat.order.cancelled', color: 'bg-line text-ink-3' };
    default:
      return { clave: 'chat.order.open', color: 'bg-honey/15 text-honey' };
  }
}

/**
 * Lo que dijo el agente al rechazar, para poder enseñarlo.
 *
 * Sus errores son informativos —"esa tarea no es de este agente", "ese texto
 * no es el que se registró en la cadena"— y esconderlos detrás de un "no se
 * pudo" deja a alguien con el pago bloqueado sin saber qué mirar.
 */
async function motivoDelAgente(res: Response): Promise<string> {
  try {
    const cuerpo = (await res.json()) as { error?: string };
    if (typeof cuerpo.error === 'string' && cuerpo.error) return cuerpo.error;
  } catch {
    /* no era JSON: nos queda el código */
  }
  return `HTTP ${res.status}`;
}

export interface TarjetaEncargoProps {
  encargo: EncargoEnHilo;
  /** El endpoint del agente. Sin él no hay a dónde reenviar. */
  botUrl: string | null;
}

export default function TarjetaEncargo({ encargo, botUrl }: TarjetaEncargoProps) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const [enviando, setEnviando] = useState(false);

  const { clave, color } = estadoDe(encargo.estado);
  const importe = `${formatUnits(BigInt(encargo.importe), 18)} ${encargo.simbolo}`;
  const abierto = encargo.estado === ESTADO.Abierto;

  const reenviar = useCallback(async () => {
    if (!botUrl || !encargo.brief || !address) return;
    const taskId = BigInt(encargo.id);
    setEnviando(true);
    try {
      // La misma firma de siempre: `Panal brief #<id>`. No cuesta gas.
      const signature = await signMessageAsync({ message: briefSignMessage(taskId) });
      const res = await enviarBriefConReintento(buildBriefUrl(botUrl, taskId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: encargo.brief, address, signature }),
      });
      if (res.ok) toast.success(t('chat.order.resent'));
      else toast.error(t('chat.order.resendFailed'), { description: await motivoDelAgente(res) });
    } catch (err) {
      toast.error(t('chat.order.resendFailed'), {
        description: err instanceof Error ? err.message.split('\n')[0] : String(err),
      });
    } finally {
      setEnviando(false);
    }
  }, [botUrl, encargo.brief, encargo.id, address, signMessageAsync, t]);

  return (
    <div className="mx-auto w-full max-w-[92%] rounded-2xl border border-line bg-sand/60 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
          <FileText className="size-3.5 text-ink-3" aria-hidden />
          {t('chat.order.title', { id: encargo.id })}
        </span>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium', color)}>
          {t(clave)}
        </span>
      </div>

      {encargo.brief ? (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink-2">
          {encargo.brief}
        </p>
      ) : (
        <p className="mt-2.5 text-[0.8125rem] italic leading-relaxed text-ink-3">
          {t('chat.order.noBrief')}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <span className="font-mono text-[0.75rem] text-ink-3">
          {t('chat.order.locked', { amount: importe })}
        </span>
        <Link
          to="/dashboard"
          className="shrink-0 text-[0.75rem] font-medium text-honey transition-colors hover:text-honey-deep"
        >
          {t('chat.order.follow')}
        </Link>
      </div>

      {/* Mientras siga abierta, se puede volver a mandar. Después no hace falta. */}
      {abierto && botUrl && (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <p className="text-[0.6875rem] leading-relaxed text-ink-3">{t('chat.order.notArrived')}</p>
          {encargo.brief ? (
            <button
              type="button"
              onClick={() => void reenviar()}
              disabled={enviando || !address}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-monad/40 bg-monad/10 px-3.5 py-1.5 text-[0.75rem] font-medium text-monad-mist transition-colors hover:border-monad disabled:opacity-40"
            >
              {enviando ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <SendHorizontal className="size-3.5" aria-hidden />
              )}
              {t('chat.order.resend')}
            </button>
          ) : (
            // Sin el texto en este navegador no podemos reenviarlo nosotros: el
            // agente comprueba keccak256(brief) contra el taskHash. Su propia
            // página de reenvío acepta que lo pegues a mano.
            <a
              href={`${botUrl.replace(/\/+$/, '')}/reenviar?task=${encargo.id}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink"
            >
              {t('chat.order.resendManual')}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
