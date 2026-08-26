import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { LenguajeBloque } from '@/data/guia';
import { cn } from '@/lib/utils';

/**
 * Bloque de código de la guía, con copiar.
 *
 * El `CodeSnippet` del protocolo tiñe Solidity, y aquí lo que hay son comandos
 * de shell, TypeScript y variables de entorno: sus palabras clave no son las
 * mismas y con ese resaltador el texto salía todo del mismo color.
 *
 * Y lleva botón de copiar porque esto no se lee, se ejecuta. Una guía sin
 * copiar obliga a seleccionar a mano un comando con saltos de línea, que es
 * justo donde se cuela media línea y el error que sale no se parece en nada a
 * la causa.
 */

interface Token {
  text: string;
  cls: string;
}

/** Comentarios, cadenas y las pocas palabras que de verdad se repiten aquí. */
const REGLAS: Record<LenguajeBloque, RegExp> = {
  sh: /(#.*$)|('[^'\n]*'|"[^"\n]*")|\b(npx|npm|cd|run|start|install)\b/g,
  ts: /(\/\/.*$)|('[^'\n]*'|`[^`\n]*`|"[^"\n]*")|\b(export|async|function|return|const|await|import|from)\b/g,
  env: /(#.*$)|\b([A-Z][A-Z0-9_]{2,})(?==)/g,
};

function trocear(linea: string, lenguaje: LenguajeBloque): Token[] {
  const tokens: Token[] = [];
  let ultimo = 0;
  // El regex es global y se reutiliza entre líneas: sin esto, `lastIndex`
  // sobrevive de una a otra y se salta coincidencias sin ningún patrón.
  const re = new RegExp(REGLAS[lenguaje].source, 'gm');
  for (const m of linea.matchAll(re)) {
    const i = m.index;
    if (i > ultimo) tokens.push({ text: linea.slice(ultimo, i), cls: 'text-coal-text/90' });
    const [todo, comentario, cadena, palabra] = m;
    if (comentario) tokens.push({ text: todo, cls: 'italic text-coal-mute' });
    else if (cadena) tokens.push({ text: todo, cls: 'text-olive' });
    else if (palabra) tokens.push({ text: todo, cls: 'text-honey' });
    else tokens.push({ text: todo, cls: 'text-honey-soft' });
    ultimo = i + todo.length;
  }
  if (ultimo < linea.length) tokens.push({ text: linea.slice(ultimo), cls: 'text-coal-text/90' });
  return tokens;
}

export interface BloqueProps {
  codigo: string;
  lenguaje?: LenguajeBloque;
  className?: string;
}

export default function Bloque({ codigo, lenguaje = 'sh', className }: BloqueProps) {
  const { t } = useTranslation();
  const [copiado, setCopiado] = useState(false);

  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codigo);
    } catch {
      /* sin portapapeles —http, permisos— el toast confirma igual la intención */
    }
    setCopiado(true);
    toast(t('guia.copiado'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopiado(false), 1600);
  };

  return (
    <div className={cn('group relative overflow-hidden rounded-xl border border-coal-line bg-coal-2', className)}>
      <span className="absolute inset-y-0 left-0 w-[2px] bg-honey" aria-hidden />
      <button
        type="button"
        onClick={copiar}
        aria-label={t('guia.copiar')}
        title={t('guia.copiar')}
        className="absolute right-2 top-2 z-10 rounded-lg border border-coal-line bg-coal p-2 text-coal-mute opacity-0 transition-all hover:text-honey focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
      >
        {copiado ? <Check size={14} className="text-olive" /> : <Copy size={14} />}
      </button>
      <pre className="overflow-x-auto p-5 pl-6 pr-14 font-mono text-[0.8125rem] leading-[1.75]">
        <code>
          {codigo.split('\n').map((linea, i) => (
            <span key={i} className="block whitespace-pre">
              {trocear(linea, lenguaje).map((tk, j) => (
                <span key={j} className={tk.cls}>
                  {tk.text}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
