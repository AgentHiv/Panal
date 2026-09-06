/**
 * Panal — demostrar que tu cuenta pública es tuya.
 *
 * La insignia del dominio solo la puede ganar quien tiene servidor propio, y
 * quien se registra como persona recibe en el buzón de Panal, que es nuestro.
 * Esta es la que sí está a su alcance: la ficha ya declara `github:usuario`, y
 * aquí se firma la otra mitad de la prueba.
 *
 * TRES PASOS Y NINGUNA TRANSACCIÓN. Firmar no cuesta gas: es una firma, no un
 * encargo. Lo que se publica es la firma, no la clave, y lo que demuestra no es
 * más que esto: que la cuenta y la wallet tienen el mismo dueño.
 *
 * EL MENSAJE SE ENSEÑA ENTERO antes de firmarlo. Quien va a firmar algo con su
 * wallet tiene derecho a leerlo aquí y no solo en el aviso del monedero, y
 * además explica por qué la firma deja de valer si luego cambia su `github:`:
 * el nombre de la cuenta está dentro de lo firmado.
 *
 * El formato lo manda `src/lib/cuenta.ts`.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSignMessage } from 'wagmi';
import { Check, Copy, ExternalLink, Github, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FICHERO_DE_PRUEBA, componerMensajeDeCuenta, normalizarUsuario } from '@/lib/cuenta';
import { leerMarca } from '@/lib/marca';
import { activeChain } from '@/contracts/config';

export interface VerificarCuentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La ficha on-chain del agente, de donde sale el `github:` declarado. */
  metadataURI: string;
  /** La dirección registrada. Es la que hay que demostrar. */
  address: string;
  /** Abre «editar perfil», para quien todavía no declara ninguna cuenta. */
  onEditarPerfil: () => void;
}

export default function VerificarCuentaDialog({
  open,
  onOpenChange,
  metadataURI,
  address,
  onEditarPerfil,
}: VerificarCuentaDialogProps) {
  const { t } = useTranslation();
  const { signMessageAsync } = useSignMessage();

  const [firma, setFirma] = useState<string | null>(null);
  const [firmando, setFirmando] = useState(false);
  const [copiada, setCopiada] = useState(false);

  /** El usuario declarado en la ficha, ya sin el `/repo` y en minúsculas. */
  const usuario = useMemo(() => {
    const declarado = leerMarca(metadataURI).github;
    return declarado ? normalizarUsuario(declarado) : '';
  }, [metadataURI]);

  const mensaje = useMemo(
    () =>
      usuario
        ? componerMensajeDeCuenta({ direccion: address, red: 'github', usuario, chainId: activeChain.id })
        : '',
    [address, usuario],
  );

  const firmar = async () => {
    setFirmando(true);
    try {
      setFirma(await signMessageAsync({ message: mensaje }));
    } catch {
      // Rechazar la firma en el monedero es una decisión, no un error que
      // haya que gritar: el diálogo se queda como estaba y se puede repetir.
    } finally {
      setFirmando(false);
    }
  };

  const copiar = async () => {
    if (!firma) return;
    await navigator.clipboard.writeText(firma);
    setCopiada(true);
    toast.success(t('cuentaGh.copiada'));
    setTimeout(() => setCopiada(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto border-line bg-paper sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-ink">
            <Github size={18} className="shrink-0 text-ink-2" aria-hidden />
            {t('cuentaGh.title')}
          </DialogTitle>
          <DialogDescription className="text-ink-2">{t('cuentaGh.desc')}</DialogDescription>
        </DialogHeader>

        {!usuario ? (
          /*
           * Sin `github:` en la ficha no hay nada que demostrar, y el mensaje
           * ni siquiera se puede componer: el nombre de la cuenta va dentro.
           * Así que se manda a declararla primero, que es una transacción, en
           * vez de enseñar tres pasos que no llevan a ninguna parte.
           */
          <div className="rounded-xl border border-line bg-cream p-5">
            <p className="text-[0.9375rem] font-semibold text-ink">{t('cuentaGh.sinCuenta.title')}</p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">{t('cuentaGh.sinCuenta.desc')}</p>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onEditarPerfil();
              }}
              className="mt-3 text-[0.875rem] font-medium text-honey-deep underline decoration-dotted underline-offset-4 transition-colors hover:text-honey"
            >
              {t('cuentaGh.sinCuenta.cta')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* ---- 1. Firmar ------------------------------------------- */}
            <section className="flex flex-col gap-2.5">
              <p className="text-[0.9375rem] font-semibold text-ink">{t('cuentaGh.paso1.title')}</p>
              <p className="text-[0.875rem] leading-relaxed text-ink-2">{t('cuentaGh.paso1.desc')}</p>

              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-cream p-3.5 font-mono text-[0.75rem] leading-[1.55] text-ink-2">
                {mensaje}
              </pre>

              {firma ? (
                <div className="flex items-center gap-2 rounded-xl border border-olive/40 bg-olive/10 p-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-ink-2">{firma}</code>
                  <button
                    type="button"
                    onClick={copiar}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                  >
                    {copiada ? <Check size={14} className="text-olive" /> : <Copy size={14} />}
                    {copiada ? t('cuentaGh.copiada') : t('cuentaGh.copiar')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={firmar}
                  disabled={firmando}
                  className="inline-flex w-fit items-center gap-2 rounded-full bg-honey px-5 py-2.5 text-[0.875rem] font-medium text-coal transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {firmando && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {firmando ? t('cuentaGh.paso1.firmando') : t('cuentaGh.paso1.boton')}
                </button>
              )}
            </section>

            {/* ---- 2. Publicar ----------------------------------------- */}
            <section className="flex flex-col gap-2.5 border-t border-line pt-5">
              <p className="text-[0.9375rem] font-semibold text-ink">{t('cuentaGh.paso2.title')}</p>
              <p className="text-[0.875rem] leading-relaxed text-ink-2">
                {t('cuentaGh.paso2.desc', { fichero: FICHERO_DE_PRUEBA, usuario })}
              </p>
              <a
                href="https://gist.github.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                {t('cuentaGh.paso2.enlace')}
                <ExternalLink size={14} aria-hidden />
              </a>
            </section>

            {/* ---- 3. Esperar ------------------------------------------ */}
            <section className="flex flex-col gap-2 border-t border-line pt-5">
              <p className="text-[0.9375rem] font-semibold text-ink">{t('cuentaGh.paso3.title')}</p>
              <p className="text-[0.875rem] leading-relaxed text-ink-2">{t('cuentaGh.paso3.desc')}</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
