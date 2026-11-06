/**
 * Las pruebas de una disputa, en la app. Las mismas que las del panel de la web
 * (`src/components/dashboard/PruebasDeLaDisputa.tsx`) y sobre la misma librería
 * (`src/lib/pruebas.ts`): el motivo, lo que aporta cada parte y su respuesta,
 * cada pieza firmada por su autor, con siete días desde que se abrió la
 * disputa. Aquí solo para las partes: los jueces deciden desde la web.
 *
 * Si las dos partes tienen clave, cada pieza va cifrada para ellas y para los
 * jueces que tengan la suya; a un juez que la active después se le da acceso
 * desde aquí. Los archivos que llegan pasan por la revisión antes de guardarse.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { useSignMessage } from 'wagmi';
import { MAX_ARCHIVOS_POR_PIEZA, MAX_PIEZA_CHARS, type Acceso, type Destinatario } from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import { abrirBytes, abrirTexto, clavePublicaDe, darAccesoALosArbitros, leerArbitros } from '@/lib/cifrado';
import {
  abrirPieza,
  aportarPieza,
  bajarArchivoDePruebas,
  buzonDePruebas,
  credencialDePruebas,
  destinatariosDePruebas,
  leerPruebas,
  objetosParaDarAcceso,
  sigueValiendo,
  type ArchivoDePiezaLegible,
  type CredencialDePruebas,
  type PiezaLegible,
} from '@/lib/pruebas';
import { formatBytes } from '@/lib/deliveredFiles';
import { guardarArchivo } from '~/lib/copia';
import { useTextos } from '~/i18n/idiomas';
import Hoja from './Hoja';
import Icono from './Icono';

const MAX_BYTES = 25 * 1024 * 1024;

export default function HojaPruebas({
  encargo,
  onCerrar,
}: {
  encargo: { id: bigint; client: Address; worker: Address };
  onCerrar: () => void;
}): React.ReactElement {
  const T = useTextos();
  const P = T.pruebas;
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);
  const base = buzonDePruebas(encargo.worker);

  const [cred, setCred] = useState<CredencialDePruebas | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [piezas, setPiezas] = useState<PiezaLegible[]>([]);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [plazo, setPlazo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [para, setPara] = useState<Destinatario[] | null | undefined>(undefined);
  const [juecesSinClave, setJuecesSinClave] = useState(0);
  const [borrador, setBorrador] = useState('');
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [dandoAcceso, setDandoAcceso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const [ahoraS, setAhoraS] = useState(() => Math.floor(Date.now() / 1000));
  const elegir = useRef<HTMLInputElement>(null);

  const yo = (address ?? '') as Address;
  const miRol = yo.toLowerCase() === encargo.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDePruebas) => {
      if (!address) return;
      const e = await leerPruebas(base, encargo.id, c);
      const abrir = async (sobre: string, acc: Acceso[]) => (await abrirTexto(sobre, address as Address, firmar, acc)).legible;
      setPiezas(await Promise.all(e.piezas.map((p) => abrirPieza(encargo.id, p, e.archivos, e.accesos, abrir))));
      setAccesos(e.accesos);
      setPlazo(e.plazo);
      setAbierto(e.abierto);
    },
    [address, base, encargo.id, firmar],
  );

  const empezar = async (): Promise<void> => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDePruebas(encargo.id, address, firmar);
      setCred(c);
      setEstado('cargando');
      const [destino] = await Promise.all([
        leerArbitros().then((jueces) => destinatariosDePruebas(encargo.client, encargo.worker, jueces, (a) => clavePublicaDe(a))),
        cargar(c),
      ]);
      setPara(destino.para);
      setJuecesSinClave(destino.juecesSinClave.length);
      setEstado('listo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEstado(/reject|denied|user/i.test(msg) ? 'inicio' : 'error');
    }
  };

  // La firma de sesión caduca y el plazo corre: los dos se miran cada poco.
  useEffect(() => {
    if (estado !== 'listo' || !cred) return;
    const id = setInterval(() => {
      setAhoraS(Math.floor(Date.now() / 1000));
      if (!sigueValiendo(cred)) setEstado('caducada');
    }, 20_000);
    return () => clearInterval(id);
  }, [estado, cred]);

  const anadir = (lista: FileList | null): void => {
    if (!lista) return;
    const nuevos = [...adjuntos, ...Array.from(lista)];
    if (nuevos.length > MAX_ARCHIVOS_POR_PIEZA) {
      setAviso(P.maxArchivos(MAX_ARCHIVOS_POR_PIEZA));
      return;
    }
    const grande = nuevos.find((f) => f.size > MAX_BYTES);
    if (grande) {
      setAviso(P.archivoGrande(grande.name));
      return;
    }
    setAviso(null);
    setAdjuntos(nuevos);
  };

  const aportar = async (): Promise<void> => {
    if (!cred || !address || enviando) return;
    const texto = borrador.trim();
    if (!texto) return;
    if (!sigueValiendo(cred)) {
      setEstado('caducada');
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      const archivos = await Promise.all(
        adjuntos.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), ...(f.type ? { mime: f.type } : {}) })),
      );
      await aportarPieza({ base, taskId: encargo.id, texto, archivos, para: para ?? null, cred, yo, firmar });
      setBorrador('');
      setAdjuntos([]);
      await cargar(cred);
      setAviso(P.aportada);
    } catch (err) {
      const detalle = err instanceof Error ? (err.message.split('\n')[0] ?? '') : '';
      if (/reject|denied|user/i.test(detalle)) setAviso(null);
      else if (/^malware/i.test(detalle)) setAviso(P.malware(detalle));
      else if (/evidence period over/.test(detalle)) setAviso(P.plazoCerrado);
      else setAviso(P.errorAportar(detalle));
    } finally {
      setEnviando(false);
    }
  };

  const bajar = async (a: ArchivoDePiezaLegible): Promise<void> => {
    if (!cred || !address) return;
    setBajando(a.hash);
    try {
      const bytes = await bajarArchivoDePruebas({
        base,
        taskId: encargo.id,
        archivo: a,
        cred,
        accesos,
        abrir: (b, acc) => abrirBytes(b, address as Address, firmar, acc),
      });
      // Pasa por la revisión: si es sospechoso, la hoja de aviso pregunta antes.
      const r = await guardarArchivo(a.name, new Blob([bytes as BlobPart], { type: a.mime || 'application/octet-stream' }));
      if (!r.ok && !r.cancelado) setAviso(r.porque);
    } catch {
      setAviso(P.archivoError(a.name));
    } finally {
      setBajando(null);
    }
  };

  // Jueces con clave que faltan en alguna pieza que esta parte sí abre: los que
  // la activaron después. El buzón sustituye un acceso repetido.
  const juecesConClave = (para ?? []).slice(2).map((d) => d.cuenta.toLowerCase());
  const faltanJueces =
    juecesConClave.length > 0 && piezas.some((p) => p.cifrada && p.texto !== null && juecesConClave.some((j) => !p.para.includes(j)));

  const darAcceso = async (): Promise<void> => {
    if (!cred || !address) return;
    setDandoAcceso(true);
    try {
      const objetos = await objetosParaDarAcceso({ base, taskId: encargo.id, piezas, cred });
      const r = await darAccesoALosArbitros({ base, id: encargo.id, esTablon: false, objetos, accesos: [], cuenta: address as Address, firmar });
      setAviso(P.accesoDado(r.arbitros));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) setAviso(P.accesoNo);
    } finally {
      setDandoAcceso(false);
    }
  };

  const fecha = (cuando: string | number): string =>
    new Date(cuando).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dias = Math.max(0, (plazo - ahoraS) / 86_400).toFixed(1);
  const mias = piezas.filter((p) => p.de === miRol).length;

  return (
    <Hoja abierta titulo={P.titulo(String(encargo.id))} onCerrar={onCerrar}>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-3">{P.desc}</p>

      {estado === 'inicio' || estado === 'firmando' || estado === 'error' ? (
        <div className="mt-4 flex flex-col gap-3 pb-5">
          <p className="text-[12.5px] leading-[1.55] text-ink-2">{P.abrirNota}</p>
          <button
            type="button"
            onClick={() => void empezar()}
            disabled={estado === 'firmando'}
            className="pulsable tocable rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white disabled:opacity-60"
          >
            {estado === 'firmando' ? P.firmando : P.abrir}
          </button>
          {estado === 'error' && <p className="text-[12.5px] text-terra">{P.errorCargar}</p>}
        </div>
      ) : estado === 'cargando' ? (
        <p className="py-8 text-center text-[13px] text-ink-3">{P.cargando}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 pb-5">
          <p className={`text-[12px] leading-[1.45] ${abierto ? 'text-ink-2' : 'text-terra'}`}>
            {plazo === 0 ? P.sinPlazo : abierto ? P.plazoHasta(fecha(plazo * 1000), dias) : P.plazoTerminado(fecha(plazo * 1000))}
          </p>
          {para !== undefined && (
            <p className={`text-[11.5px] leading-[1.45] ${para ? 'text-oliva' : 'text-terra'}`}>
              {para ? (juecesSinClave > 0 ? P.cifradoFaltanJueces(juecesSinClave) : P.cifrado) : P.sinCifrar}
            </p>
          )}

          <div className="max-h-[46vh] min-h-[9rem] overflow-y-auto rounded-[14px] border border-line bg-paper p-3">
            {piezas.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-3">{P.vacio}</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {piezas.map((p, i) => (
                  <li key={`${p.recibida}-${i}`} className="rounded-[14px] border border-line bg-cream p-3">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[11.5px] font-medium text-ink-2">
                        {p.de === miRol ? P.tu : p.de === 'cliente' ? P.cliente : P.trabajador} ·{' '}
                        <span className="font-normal text-ink-3">{fecha(p.fecha)}</span>
                      </p>
                      <span className={`text-[10.5px] ${p.firmaOk ? 'text-oliva' : 'text-terra'}`}>
                        {p.firmaOk ? P.firmaOk : P.firmaMal}
                      </span>
                    </div>
                    {p.texto === null ? (
                      <p className="mt-1.5 text-[12.5px] italic text-ink-3">{P.noLegible}</p>
                    ) : (
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink">{p.texto}</p>
                    )}
                    {p.archivos.map((a) => (
                      <button
                        key={a.hash}
                        type="button"
                        onClick={() => void bajar(a)}
                        disabled={bajando === a.hash}
                        className="pulsable mt-1.5 flex w-full items-center gap-2 rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-left text-[12px] text-ink-2"
                      >
                        <Icono nombre="bajar" tamano={13} color="#948DAE" className="shrink-0" />
                        <span className="min-w-0 truncate">{a.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-ink-3">{formatBytes(a.size)}</span>
                      </button>
                    ))}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {aviso && <p className="text-[12.5px] text-terra">{aviso}</p>}

          {faltanJueces && (
            <button
              type="button"
              onClick={() => void darAcceso()}
              disabled={dandoAcceso}
              className="pulsable tocable rounded-full border border-line py-2.5 text-[13px] font-medium text-ink-2 disabled:opacity-60"
            >
              {P.darAcceso}
            </button>
          )}

          {estado === 'caducada' ? (
            <button
              type="button"
              onClick={() => void empezar()}
              className="pulsable tocable rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              {P.firmarOtraVez}
            </button>
          ) : abierto ? (
            <>
              <p className="text-[11.5px] leading-[1.45] text-ink-3">{mias === 0 ? P.primera : P.otra}</p>
              {adjuntos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {adjuntos.map((f, i) => (
                    <button
                      key={`${f.name}-${i}`}
                      type="button"
                      onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                      aria-label={P.quitar(f.name)}
                      className="pulsable flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-2"
                    >
                      <span className="max-w-[9rem] truncate">{f.name}</span>
                      <Icono nombre="cerrar" tamano={11} color="#948DAE" />
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={borrador}
                onChange={(e) => setBorrador(e.target.value.slice(0, MAX_PIEZA_CHARS))}
                rows={4}
                placeholder={P.escribe}
                className="min-w-0 resize-none rounded-[14px] border border-line bg-paper px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <div className="flex items-center gap-2">
                <input ref={elegir} type="file" multiple hidden onChange={(e) => anadir(e.target.files)} />
                <button
                  type="button"
                  onClick={() => elegir.current?.click()}
                  aria-label={P.adjuntar}
                  className="pulsable tocable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line"
                >
                  <Icono nombre="mas" tamano={17} color="#948DAE" />
                </button>
                <button
                  type="button"
                  onClick={() => void aportar()}
                  disabled={enviando || !borrador.trim()}
                  className="pulsable tocable h-11 grow rounded-full bg-monad px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
                >
                  {enviando ? P.aportando : P.aportar}
                </button>
              </div>
              <p className="text-[10.5px] leading-[1.45] text-ink-3">{P.firmaNota}</p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">{P.cerrado}</p>
          )}
        </div>
      )}
    </Hoja>
  );
}
