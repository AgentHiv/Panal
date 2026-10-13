/**
 * Lo que comparten las pestañas del tablón con reglas y no es un componente:
 * estilos de botón, formatos y los hooks de nombres y fechas. Aparte de
 * `comun.tsx` porque el refresco en caliente de Vite solo funciona en archivos
 * que exportan componentes y nada más.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import { shortAddress } from '@/hooks/useWallet';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { cn } from '@/lib/utils';

export const BOTON =
  'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[0.8125rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const BOTON_MIEL = cn(BOTON, 'bg-honey text-[#1B1814] hover:bg-honey-deep');
export const BOTON_LINEA = cn(BOTON, 'border border-line text-ink-2 hover:border-honey hover:text-ink');
export const BOTON_PELIGRO = cn(BOTON, 'border border-terra/30 text-terra hover:bg-terra/10');
export const BOTON_OLIVA = cn(BOTON, 'bg-olive text-paper hover:opacity-85');

export const CAMPO =
  'w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none';

/**
 * «1.5» o «2,066,000» a partir de wei: tres decimales como mucho, sin ceros de
 * cola y con separador de miles, que en $PANAL las cantidades son de siete
 * cifras. Con punto decimal, como el resto de cantidades de la web.
 */
export function cantidad(wei: bigint): string {
  return Number(formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * Una duración en el idioma de quien lee: «3 días», «2 horas», «45 minutos».
 * Con `Intl`, que ya sabe los plurales de los diez idiomas (el ruso y el árabe
 * tienen más de dos).
 */
export function useDuracion(): (segundos: number) => string {
  const { i18n } = useTranslation();
  return (s: number) => {
    const [n, unidad] =
      s >= 2 * 86_400 ? [Math.round(s / 86_400), 'day'] : s >= 3600 ? [Math.round(s / 3600), 'hour'] : [Math.max(1, Math.round(s / 60)), 'minute'];
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'unit', unit: unidad, unitDisplay: 'long' }).format(n);
    } catch {
      return `${n} ${unidad === 'day' ? 'd' : unidad === 'hour' ? 'h' : 'min'}`;
    }
  };
}

/** Una fecha corta en el idioma de quien lee. */
export function useFecha(): (ts: number) => string {
  const { i18n } = useTranslation();
  return (ts: number) =>
    new Date(ts * 1000).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** El nombre de un agente del catálogo y su ruta, o su dirección corta. */
export function useAgenteDe(): (direccion: string) => { nombre: string; ruta: string | null } {
  const { agents } = usePanalAgents();
  return useMemo(() => {
    const porDireccion = new Map(agents.map((a) => [a.workerAddress.toLowerCase(), a]));
    return (direccion: string) => {
      const a = porDireccion.get(direccion.toLowerCase());
      return a ? { nombre: a.name, ruta: `/agente/${a.id}` } : { nombre: shortAddress(direccion), ruta: null };
    };
  }, [agents]);
}
