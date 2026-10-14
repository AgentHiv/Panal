/**
 * Archivos en el tablón, en la web: elegirlos (sueltos o una carpeta, que viaja
 * como `.zip`) y bajarlos comprobados byte a byte.
 *
 * Lo que garantiza la cadena es el HASH de cada archivo, que va dentro del
 * texto que se ancla —el encargo o la entrega—; el buzón solo guarda los
 * bytes. Por eso bajar un archivo es pedirlo y comprobarlo contra ese hash, y
 * un buzón que cambiara una coma no pasaría la comprobación.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, FolderUp, Paperclip, X } from 'lucide-react';
import {
  MAX_ARCHIVOS_TABLON,
  MAX_BYTES_ARCHIVOS_TABLON,
  problemaConArchivos,
  type ArchivoParaSubir,
  type HashedFile,
} from '@panal/sdk';
import { archivosElegidos, carpetaComoZip, guardarComoArchivo, tamano } from '@/lib/archivosTablon';
import { bajarArchivoDelTablon, type CredencialTablon } from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';
import { Girando } from './comun';
import { BOTON_LINEA } from './util';

export function ElegirArchivos({
  archivos,
  onChange,
  disabled = false,
  etiqueta,
}: {
  archivos: ArchivoParaSubir[];
  onChange: (a: ArchivoParaSubir[]) => void;
  disabled?: boolean;
  etiqueta: string;
}) {
  const { t } = useTranslation();
  const sueltos = useRef<HTMLInputElement>(null);
  const carpeta = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const problema = archivos.length > 0 ? problemaConArchivos(archivos) : null;

  const anadir = (nuevos: ArchivoParaSubir[]) => {
    // Uno con el mismo nombre sustituye al anterior: se piden por nombre.
    const fuera = new Set(nuevos.map((a) => a.name));
    onChange([...archivos.filter((a) => !fuera.has(a.name)), ...nuevos]);
  };
  const leer = (de: 'sueltos' | 'carpeta') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const lista = e.target.files;
    if (!lista || lista.length === 0) return;
    setLeyendo(true);
    try {
      if (de === 'sueltos') anadir(await archivosElegidos(lista));
      else {
        const zip = await carpetaComoZip(lista);
        if (zip) anadir([zip]);
      }
    } finally {
      setLeyendo(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-ink-2">{etiqueta}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => sueltos.current?.click()} disabled={disabled || leyendo} className={BOTON_LINEA}>
          <Paperclip size={14} aria-hidden />
          {t('tablon.archivos.elegir')}
        </button>
        <button type="button" onClick={() => carpeta.current?.click()} disabled={disabled || leyendo} className={BOTON_LINEA}>
          <FolderUp size={14} aria-hidden />
          {t('tablon.archivos.carpeta')}
        </button>
        {leyendo && <Girando />}
      </div>
      <input ref={sueltos} type="file" multiple hidden onChange={(e) => void leer('sueltos')(e)} />
      <input
        ref={carpeta}
        type="file"
        hidden
        onChange={(e) => void leer('carpeta')(e)}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      {archivos.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {archivos.map((a) => (
            <li key={a.name} className="flex items-center gap-2 px-3 py-2 text-[0.8125rem]">
              <FileText size={14} className="shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{a.name}</span>
              <span className="shrink-0 font-mono text-[12px] text-ink-3">{tamano(a.bytes.byteLength)}</span>
              <button
                type="button"
                onClick={() => onChange(archivos.filter((x) => x !== a))}
                disabled={disabled}
                aria-label={t('tablon.archivos.quitar', { nombre: a.name })}
                className="shrink-0 rounded-full p-1 text-ink-3 transition-colors hover:text-terra"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problema ? (
        <p className="text-[0.75rem] leading-relaxed text-terra">{problema}</p>
      ) : (
        <p className="text-[0.75rem] leading-relaxed text-ink-3">
          {t('tablon.archivos.pista', { n: MAX_ARCHIVOS_TABLON, mb: MAX_BYTES_ARCHIVOS_TABLON / 1024 / 1024 })}
        </p>
      )}
    </div>
  );
}

/**
 * Los archivos anunciados en un texto anclado, para bajarlos. `credencial`
 * devuelve la firma con la que se leyó ese texto —o una nueva si caducó—: así
 * bajar no abre otra ventana de la wallet por cada archivo.
 */
export function ListaDeArchivos({
  jobId,
  archivos,
  de,
  credencial,
  titulo,
}: {
  jobId: bigint;
  archivos: HashedFile[];
  de: 'adjunto' | 'entrega';
  credencial: () => Promise<CredencialTablon>;
  titulo: string;
}) {
  const { t } = useTranslation();
  const [bajando, setBajando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, boolean>>({});
  if (archivos.length === 0) return null;

  const bajar = (f: HashedFile) =>
    void (async () => {
      setBajando(f.name);
      setErrores((e) => ({ ...e, [f.name]: false }));
      try {
        const bytes = await bajarArchivoDelTablon(jobId, f, de, await credencial());
        guardarComoArchivo(f.name, bytes, f.mime);
      } catch {
        setErrores((e) => ({ ...e, [f.name]: true }));
      } finally {
        setBajando(null);
      }
    })();

  return (
    <div className="mt-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{titulo}</p>
      <ul className="mt-2 flex flex-col divide-y divide-line rounded-xl border border-line bg-paper">
        {archivos.map((f) => (
          <li key={f.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[0.8125rem]">
            <FileText size={14} className="shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
            <span className="shrink-0 font-mono text-[12px] text-ink-3">{tamano(f.size)}</span>
            <button type="button" onClick={() => bajar(f)} disabled={bajando !== null} className={cn(BOTON_LINEA, 'px-3 py-1')}>
              {bajando === f.name ? <Girando /> : <Download size={13} aria-hidden />}
              {t('tablon.archivos.bajar')}
            </button>
            {errores[f.name] && <span className="w-full text-[0.75rem] text-terra">{t('tablon.archivos.errorBajar')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
