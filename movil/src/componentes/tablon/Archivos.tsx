/**
 * Archivos en el tablón, en la app: elegirlos y bajarlos comprobados.
 *
 * Lo mismo que en la web (`src/components/tablon/Archivos.tsx`) con dos
 * diferencias del teléfono: no hay botón de carpeta —el selector de Android no
 * deja elegir una entera—, y lo bajado se guarda con `guardarArchivo`, que en
 * el teléfono abre el menú de guardar o compartir.
 *
 * La garantía es el hash de cada archivo dentro del texto anclado; el buzón
 * solo guarda los bytes, y bajar es pedirlos y comprobarlos contra ese hash.
 */

import { useRef, useState } from 'react';
import {
  MAX_ARCHIVOS_TABLON,
  MAX_BYTES_ARCHIVOS_TABLON,
  problemaConArchivos,
  type ArchivoParaSubir,
  type HashedFile,
} from '@panal/sdk';
import { archivosElegidos, tamano } from '@/lib/archivosTablon';
import { bajarArchivoDelTablon, type CredencialTablon } from '@/lib/tablonReglas';
import AvisoEjecutable from '~/componentes/AvisoEjecutable';
import Icono from '~/componentes/Icono';
import { guardarArchivo } from '~/lib/copia';
import { useTextos } from '~/i18n/idiomas';
import { Accion } from './Piezas';

export function ElegirArchivos({
  archivos,
  onChange,
  disabled = false,
}: {
  archivos: ArchivoParaSubir[];
  onChange: (a: ArchivoParaSubir[]) => void;
  disabled?: boolean;
}) {
  const A = useTextos().tablon.archivos;
  const entrada = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const problema = archivos.length > 0 ? problemaConArchivos(archivos) : null;

  const leer = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const lista = e.target.files;
    if (!lista || lista.length === 0) return;
    setLeyendo(true);
    try {
      const nuevos = await archivosElegidos(lista);
      // Uno con el mismo nombre sustituye al anterior: se piden por nombre.
      const fuera = new Set(nuevos.map((a) => a.name));
      onChange([...archivos.filter((a) => !fuera.has(a.name)), ...nuevos]);
    } finally {
      setLeyendo(false);
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[12.5px] font-medium text-ink-2">{A.opcional}</span>
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        disabled={disabled || leyendo}
        className="pulsable flex h-10 items-center justify-center gap-2 rounded-full border border-line text-[13px] font-medium text-ink-2 disabled:opacity-40"
      >
        <Icono nombre="eslabon" tamano={16} color="currentColor" />
        {leyendo ? '…' : A.elegir}
      </button>
      <input ref={entrada} type="file" multiple hidden onChange={(e) => void leer(e)} />
      {archivos.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {archivos.map((a) => (
            <li key={a.name} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
              <Icono nombre="hoja" tamano={15} color="#8F89A8" className="shrink-0" />
              <span className="min-w-0 grow truncate text-ink">{a.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-3">{tamano(a.bytes.byteLength)}</span>
              <button
                type="button"
                onClick={() => onChange(archivos.filter((x) => x !== a))}
                disabled={disabled}
                aria-label={A.quitar(a.name)}
                className="pulsable shrink-0 p-1"
              >
                <Icono nombre="cerrar" tamano={14} color="#C9653B" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className={`px-1 text-[11.5px] leading-[1.45] ${problema ? 'text-terra' : 'text-ink-3'}`}>
        {problema ?? A.pista(MAX_ARCHIVOS_TABLON, MAX_BYTES_ARCHIVOS_TABLON / 1024 / 1024)}
      </span>
    </div>
  );
}

/** Los archivos anunciados en un texto anclado, para bajarlos con la firma con que se leyó. */
export function ListaDeArchivos({
  jobId,
  archivos,
  de,
  credencial,
  titulo,
  cifrado = false,
  abrir,
}: {
  jobId: bigint;
  archivos: HashedFile[];
  de: 'adjunto' | 'entrega';
  credencial: () => Promise<CredencialTablon>;
  titulo: string;
  /** Si el texto que los anuncia iba cifrado: se piden por su nombre opaco y se abren aquí. */
  cifrado?: boolean;
  /** Abre los bytes ya comprobados (con la clave de quien mira y sus accesos). */
  abrir?: (bytes: Uint8Array) => Promise<Uint8Array>;
}) {
  const A = useTextos().tablon.archivos;
  const [bajando, setBajando] = useState<string | null>(null);
  const [estado, setEstado] = useState<Record<string, string>>({});
  if (archivos.length === 0) return null;

  const bajar = async (f: HashedFile) => {
    setBajando(f.name);
    setEstado((e) => ({ ...e, [f.name]: '' }));
    try {
      const bajados = await bajarArchivoDelTablon(jobId, f, de, await credencial(), cifrado);
      const bytes = cifrado && abrir ? await abrir(bajados) : bajados;
      const r = await guardarArchivo(f.name, new Blob([bytes as BlobPart], { type: f.mime || 'application/octet-stream' }));
      setEstado((e) => ({ ...e, [f.name]: r.ok ? A.guardado(r.donde) : r.porque }));
    } catch {
      setEstado((e) => ({ ...e, [f.name]: A.errorBajar }));
    } finally {
      setBajando(null);
    }
  };

  return (
    <div className="mt-3">
      <p className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{titulo}</p>
      <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {archivos.map((f) => (
          <li key={f.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]">
            <Icono nombre="hoja" tamano={15} color="#8F89A8" className="shrink-0" />
            <span className="min-w-0 grow truncate text-ink">{f.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">{tamano(f.size)}</span>
            <Accion onClick={() => void bajar(f)} disabled={bajando !== null}>
              {bajando === f.name ? '…' : A.bajar}
            </Accion>
            <AvisoEjecutable nombre={f.name} mime={f.mime} className="w-full" />
            {estado[f.name] && <span className="w-full text-[11.5px] text-ink-3">{estado[f.name]}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
