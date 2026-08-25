import { useTranslation } from 'react-i18next';
import { TRAZOS_MARCA } from '@/lib/iconosMarca';
import { cn } from '@/lib/utils';
import { enlacesDe, type Marca } from '@/lib/marca';

/**
 * Los enlaces que un agente publicó en su ficha: su web, su GitHub, sus redes.
 *
 * No devuelve nada si no publicó ninguno, y ese caso es la mayoría: la fila
 * sencillamente no existe en vez de dejar un hueco o un «sin enlaces». Un
 * agente que no puso nada no está peor presentado, está como estaban todos.
 *
 * NO se pinta dentro de la tarjeta del mercado: esa tarjeta entera ya es un
 * enlace a la ficha, y un `<a>` dentro de otro `<a>` no es HTML válido —el
 * navegador parte el árbol y lo que pasa al pulsar deja de ser predecible. En
 * la tarjeta va el logo, que es una imagen; los enlaces, en la ficha.
 *
 * `rel="noopener noreferrer nofollow"` en todos, y las tres partes cuentan:
 * `noopener` porque la página de destino no puede quedarse con un mando a
 * distancia de esta pestaña, `noreferrer` porque el destino no tiene por qué
 * saber desde qué ficha se llegó, y `nofollow` porque cualquiera puede
 * registrar un agente por unos céntimos de gas y el mercado no está para
 * repartir posicionamiento a quien pague el registro.
 */
export default function AgentLinks({
  marca,
  className,
  tamano = 'normal',
}: {
  marca: Marca;
  className?: string;
  /** `compacto` pinta solo los iconos: cabe en una tarjeta de la lista. */
  tamano?: 'normal' | 'compacto';
}) {
  const { t } = useTranslation();
  const enlaces = enlacesDe(marca);
  if (enlaces.length === 0) return null;

  const compacto = tamano === 'compacto';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {enlaces.map(({ clave, url, rotulo }) => (
        <a
          key={clave}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={`${t(`agentLinks.${clave}`)}: ${rotulo}`}
          aria-label={`${t(`agentLinks.${clave}`)}: ${rotulo}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-line bg-paper text-ink-2 transition-colors hover:border-honey hover:text-honey',
            compacto ? 'h-7 w-7 justify-center' : 'h-8 px-3 text-[0.8125rem]',
          )}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden>
            <path d={TRAZOS_MARCA[clave]} />
          </svg>
          {!compacto && <span className="max-w-[12rem] truncate">{rotulo}</span>}
        </a>
      ))}
    </div>
  );
}
