/**
 * Las hojas del tablón en la app. Todo lo que cuesta dinero o compromete a
 * alguien pasa por una: es la pantalla de confirmar que la wallet del
 * teléfono no tiene. Publicar y elegir, además, arman en `signingPolicy.ts`
 * exactamente lo que enseñan; sin eso no se firma.
 */

import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { formatEther, keccak256, parseEther, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import {
  CATEGORIAS_TABLON,
  MAX_TEXTO_ANUNCIO,
  ModoTablon,
  anuncioPara,
  appendAttachmentsManifest,
  attachmentFrom,
  panalTablonAbi,
  parseAttachmentsManifest,
  parseFilesManifest,
  problemaConArchivos,
  stripFilesManifest,
  type ArchivoParaSubir,
  type AudienciaTablon,
  type EncargoConReglas,
  type OfertaConReglas,
} from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import { NATIVE_CURRENCY, PANAL_TOKEN_ADDRESS, publicClient } from '@/contracts/config';
import { useReglasDelTablon } from '@/hooks/useTablonReglas';
import {
  buzonAceptaArchivos,
  buzonAceptaElTablon,
  credencialTablon,
  credencialVigente,
  dejarEntrega,
  enTablon,
  entregaConArchivos,
  entregarEnEscrow,
  firmarYEsperar,
  guardarTextos,
  leerEncargoConFirma,
  permitirPanal,
  simboloDe,
  subirArchivosDelTablon,
  type CredencialTablon,
} from '@/lib/tablonReglas';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { SIN_PAGOS } from '~/lib/canal';
import { permitirTablon } from '~/lib/signingPolicy';
import type { useFirmaTablon } from '~/lib/usarFirmaTablon';
import { explicarFallo } from '~/lib/usarFirmaTablon';
import { monto } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';
import { ElegirArchivos, ListaDeArchivos } from './Archivos';
import { Importe } from './Piezas';
import { ahoraS, duracion, fecha } from './util';

type Firma = ReturnType<typeof useFirmaTablon>;

export type HojaAbierta =
  | { tipo: 'coger'; job: EncargoConReglas }
  | { tipo: 'oferta'; job: EncargoConReglas; previa?: OfertaConReglas }
  | { tipo: 'elegir'; job: EncargoConReglas; oferta: OfertaConReglas; nombre: string }
  | { tipo: 'aprobar'; job: EncargoConReglas }
  | { tipo: 'disputar'; job: EncargoConReglas }
  | { tipo: 'texto'; titulo: string; texto: string }
  /** La entrega, para su cliente, con sus archivos y la firma con que se leyó. */
  | { tipo: 'entrega'; job: EncargoConReglas; texto: string; cred: CredencialTablon }
  | { tipo: 'entregar'; job: EncargoConReglas }
  | { tipo: 'publicar' };

const CAMPO =
  'seleccionable w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-honey';

/** «1,5» o «1.5» → wei; `null` si no es un número. */
function aWei(texto: string): bigint | null {
  const t = texto.replace(',', '.').trim();
  return /^\d+(\.\d{1,18})?$/.test(t) ? parseEther(t) : null;
}

export default function HojasDelTablon({
  hoja,
  firma,
  onCerrar,
}: {
  hoja: HojaAbierta | null;
  firma: Firma;
  onCerrar: () => void;
}): React.ReactElement | null {
  if (!hoja) return null;
  switch (hoja.tipo) {
    case 'coger':
      return <HojaCoger job={hoja.job} firma={firma} onCerrar={onCerrar} />;
    case 'oferta':
      return <HojaOferta job={hoja.job} previa={hoja.previa} firma={firma} onCerrar={onCerrar} />;
    case 'elegir':
      return <HojaElegir job={hoja.job} oferta={hoja.oferta} nombre={hoja.nombre} firma={firma} onCerrar={onCerrar} />;
    case 'aprobar':
      return <HojaAprobar job={hoja.job} firma={firma} onCerrar={onCerrar} />;
    case 'disputar':
      return <HojaDisputar job={hoja.job} firma={firma} onCerrar={onCerrar} />;
    case 'texto':
      return <HojaTexto titulo={hoja.titulo} texto={hoja.texto} onCerrar={onCerrar} />;
    case 'entrega':
      return <HojaEntrega job={hoja.job} texto={hoja.texto} cred={hoja.cred} onCerrar={onCerrar} />;
    case 'entregar':
      return <HojaEntregar job={hoja.job} firma={firma} onCerrar={onCerrar} />;
    case 'publicar':
      // En Play no existe: con `SIN_PAGOS` fijado al compilar, la hoja ni
      // siquiera viaja dentro del paquete.
      return SIN_PAGOS ? null : <HojaPublicar firma={firma} onCerrar={onCerrar} />;
  }
}

/** El error de la última firma, dentro de la hoja que la pidió. */
function Fallo({ firma }: { firma: Firma }) {
  if (!firma.resultado || firma.resultado.bien) return null;
  return <p className="mt-3 px-1 text-[12.5px] leading-[1.5] text-terra">{firma.resultado.texto}</p>;
}

function HojaCoger({ job, firma, onCerrar }: { job: EncargoConReglas; firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const clave = `coger:${job.id}`;
  const ocupado = firma.ocupado === clave;
  const coger = async () => {
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      await firmarYEsperar(e, c, enTablon('take', [job.id]));
      return true;
    });
    if (hecho) onCerrar();
  };
  return (
    <Hoja abierta titulo={T.tablon.cogerHoja.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <Tarjeta>
        <Fila etiqueta={`#${job.id}`} valor={<Importe wei={job.importe} moneda={job.moneda} />} />
        <Fila etiqueta={T.tablon.entregaEn(duracion(job.plazoEntregaS))} valor="" />
      </Tarjeta>
      <Nota tono="miel">{T.tablon.cogerHoja.nota(fecha(ahoraS() + job.plazoEntregaS))}</Nota>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton onClick={() => void coger()} disabled={firma.ocupado !== null}>
          {ocupado ? '…' : T.tablon.cogerHoja.boton}
        </Boton>
      </div>
    </Hoja>
  );
}

const PLAZOS_OFERTA = [3600, 6 * 3600, 24 * 3600, 72 * 3600, 168 * 3600];

function HojaOferta({ job, previa, firma, onCerrar }: { job: EncargoConReglas; previa?: OfertaConReglas; firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const simbolo = simboloDe(job.moneda);
  const [precio, setPrecio] = useState(formatEther(previa?.precio ?? job.importe));
  const plazos = [...new Set([...PLAZOS_OFERTA.filter((p) => p < job.plazoEntregaS), job.plazoEntregaS])].sort((a, b) => a - b);
  const [plazo, setPlazo] = useState(previa?.plazoEntregaS ?? job.plazoEntregaS);
  const wei = aWei(precio);
  const clave = `ofertar:${job.id}`;
  const ocupado = firma.ocupado === clave;
  const enviar = async () => {
    if (wei === null) return;
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      await firmarYEsperar(e, c, enTablon('applyFor', [job.id, wei, BigInt(plazo)]));
      return true;
    });
    if (hecho) onCerrar();
  };
  return (
    <Hoja abierta titulo={T.tablon.oferta.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
          {T.tablon.oferta.precio(simbolo)}
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" className={`${CAMPO} font-mono`} />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
          {T.tablon.oferta.plazo}
          <select value={plazo} onChange={(e) => setPlazo(Number(e.target.value))} className={CAMPO}>
            {plazos.map((p) => (
              <option key={p} value={p}>
                {duracion(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Nota tono={wei !== null && wei > job.importe ? 'miel' : 'gris'}>
        {wei !== null && wei > job.importe ? T.tablon.oferta.porEncima : T.tablon.oferta.pista}
      </Nota>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton onClick={() => void enviar()} disabled={wei === null || wei === 0n || firma.ocupado !== null}>
          {ocupado ? '…' : T.tablon.oferta.enviar}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaElegir({
  job,
  oferta,
  nombre,
  firma,
  onCerrar,
}: {
  job: EncargoConReglas;
  oferta: OfertaConReglas;
  nombre: string;
  firma: Firma;
  onCerrar: () => void;
}) {
  const T = useTextos();
  const diferencia = oferta.precio > job.importe ? oferta.precio - job.importe : 0n;
  const nativa = simboloDe(job.moneda) === 'MON';
  const clave = `elegir:${job.id}`;
  const ocupado = firma.ocupado === clave;
  const elegir = async () => {
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      // Lo que esta hoja enseña, y nada más: la wallet del teléfono no firma otro.
      permitirTablon({ funcion: 'choose', amount: diferencia, currency: job.moneda, jobId: job.id, agente: oferta.agente });
      if (diferencia > 0n && !nativa) await permitirPanal(e, c, diferencia);
      await firmarYEsperar(e, c, enTablon('choose', [job.id, oferta.agente], nativa && diferencia > 0n ? diferencia : undefined));
      return true;
    });
    if (hecho) onCerrar();
  };
  return (
    <Hoja abierta titulo={T.tablon.elegir.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <Tarjeta>
        <Fila etiqueta={nombre} pie={T.tablon.entregaEn(duracion(oferta.plazoEntregaS))} valor={<Importe wei={oferta.precio} moneda={job.moneda} />} />
        {diferencia > 0n && (
          <Fila etiqueta={T.tablon.elegir.pones} valor={`${monto(diferencia)} ${simboloDe(job.moneda)}`} color="text-honey" destacada />
        )}
      </Tarjeta>
      <Nota>{T.tablon.elegir.nota}</Nota>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton onClick={() => void elegir()} disabled={firma.ocupado !== null}>
          {ocupado ? '…' : T.tablon.elegir.boton}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaAprobar({ job, firma, onCerrar }: { job: EncargoConReglas; firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const [nota, setNota] = useState(5);
  const clave = `aprobar:${job.id}`;
  const ocupado = firma.ocupado === clave;
  const aprobar = async () => {
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      await firmarYEsperar(e, c, enTablon('approve', [job.id, nota]));
      return true;
    });
    if (hecho) onCerrar();
  };
  return (
    <Hoja abierta titulo={T.tablon.aprobar.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <Tarjeta>
        <Fila etiqueta={`#${job.id}`} valor={<Importe wei={job.importe} moneda={job.moneda} />} />
      </Tarjeta>
      <Nota>{T.tablon.aprobar.nota}</Nota>
      <div className="mt-3 flex justify-center gap-2" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={nota === n}
            onClick={() => setNota(n)}
            className={`pulsable h-10 w-10 rounded-full border text-[15px] font-semibold ${n <= nota ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-3'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton onClick={() => void aprobar()} disabled={firma.ocupado !== null}>
          {ocupado ? '…' : T.tablon.aprobar.boton}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaDisputar({ job, firma, onCerrar }: { job: EncargoConReglas; firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const clave = `disputar:${job.id}`;
  const ocupado = firma.ocupado === clave;
  const disputar = async () => {
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      await firmarYEsperar(e, c, enTablon('dispute', [job.id]));
      return true;
    });
    if (hecho) onCerrar();
  };
  return (
    <Hoja abierta titulo={T.tablon.disputar.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <Nota>{T.tablon.disputar.nota}</Nota>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton variante="peligro" onClick={() => void disputar()} disabled={firma.ocupado !== null}>
          {ocupado ? '…' : T.tablon.disputar.boton}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaTexto({ titulo, texto, onCerrar }: { titulo: string; texto: string; onCerrar: () => void }) {
  const T = useTextos();
  return (
    <Hoja abierta titulo={titulo} onCerrar={onCerrar}>
      <p className="seleccionable mt-3 max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-sand px-3.5 py-3 text-[13.5px] leading-[1.55] text-ink">
        {texto}
      </p>
      <div className="mt-4 pb-4">
        <Boton variante="secundario" onClick={onCerrar}>
          {T.comun.cerrar}
        </Boton>
      </div>
    </Hoja>
  );
}

/** La entrega, para su cliente: el texto sin el manifiesto y sus archivos para bajar. */
function HojaEntrega({ job, texto, cred, onCerrar }: { job: EncargoConReglas; texto: string; cred: CredencialTablon; onCerrar: () => void }) {
  const T = useTextos();
  const { signMessageAsync } = useSignMessage();
  const [firmaVigente, setFirmaVigente] = useState(cred);
  // La firma con que se leyó la entrega abre también sus archivos; si caducó, otra.
  const credencial = async () => {
    if (credencialVigente(firmaVigente)) return firmaVigente;
    const nueva = await credencialTablon('resultado', job.id, cred.yo, (message) => signMessageAsync({ message }));
    setFirmaVigente(nueva);
    return nueva;
  };
  return (
    <Hoja abierta titulo={T.tablon.entrega.titulo} onCerrar={onCerrar}>
      <p className="seleccionable mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-sand px-3.5 py-3 text-[13.5px] leading-[1.55] text-ink">
        {stripFilesManifest(texto)}
      </p>
      <ListaDeArchivos jobId={job.id} archivos={parseFilesManifest(texto)} de="entrega" credencial={credencial} titulo={T.tablon.archivos.deLaEntrega} />
      <div className="mt-4 pb-4">
        <Boton variante="secundario" onClick={onCerrar}>
          {T.comun.cerrar}
        </Boton>
      </div>
    </Hoja>
  );
}

function HojaEntregar({ job, firma, onCerrar }: { job: EncargoConReglas; firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const { signMessageAsync } = useSignMessage();
  const [encargo, setEncargo] = useState<string | null>(null);
  // La firma con que se leyó el encargo: abre también sus adjuntos.
  const [cred, setCred] = useState<CredencialTablon | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState<ArchivoParaSubir[]>([]);
  const firmar = (message: string) => signMessageAsync({ message });
  const clave = `entregar:${job.id}`;
  const ocupado = firma.ocupado === clave;
  // Quién soy lo sabe la wallet; aquí solo hace falta para las cabeceras del buzón.
  const leer = async (cuenta: Address) => {
    setLeyendo(true);
    setError(null);
    try {
      const leido = await leerEncargoConFirma(job, await credencialTablon('encargo', job.id, cuenta, firmar));
      setCred(leido.cred);
      const brief = leido.brief;
      if (brief === null) setError(T.tablon.trabajo.encargoNoEsta);
      else setEncargo(brief);
    } catch (err) {
      // Un «no cuadra» o un fallo del buzón es del encargo; lo demás (firma
      // cancelada, bloqueada) se dice como cualquier otra firma.
      setError(err instanceof Error && /no cuadra|HTTP/.test(err.message) ? T.tablon.trabajo.encargoError : explicarFallo(err, T));
    } finally {
      setLeyendo(false);
    }
  };
  const entregar = async () => {
    const hecho = await firma.ejecutar(clave, async (e, c) => {
      // Los archivos primero, y su hash dentro del texto que se ancla: si el
      // buzón no los acepta, no se ancla nada.
      await subirArchivosDelTablon(job.id, archivos, c, firmar);
      const final = archivos.length > 0 ? entregaConArchivos(job.id, texto.trim(), archivos) : texto.trim();
      const hash = await dejarEntrega(job.id, final, c, firmar);
      await firmarYEsperar(e, c, entregarEnEscrow(job.escrowTaskId, hash));
      return true;
    });
    if (hecho) onCerrar();
  };
  const credencialDelEncargo = async () => {
    if (credencialVigente(cred)) return cred;
    const nueva = await credencialTablon('encargo', job.id, job.agente, firmar);
    setCred(nueva);
    return nueva;
  };
  return (
    <Hoja abierta titulo={T.tablon.trabajo.entregar} onCerrar={onCerrar} bloqueada={ocupado}>
      {encargo === null ? (
        <div className="mt-3">
          <Boton variante="secundario" onClick={() => void leer(job.agente)} disabled={leyendo}>
            <Icono nombre="hoja" tamano={17} color="currentColor" />
            {leyendo ? '…' : T.tablon.trabajo.leerEncargo}
          </Boton>
          {error && <p className="mt-2 px-1 text-[12.5px] text-terra">{error}</p>}
        </div>
      ) : (
        <div className="mt-3">
          <p className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{T.tablon.trabajo.elEncargo}</p>
          <p className="seleccionable mt-1.5 max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-sand px-3.5 py-3 text-[13.5px] leading-[1.55] text-ink">
            {stripFilesManifest(encargo)}
          </p>
          <ListaDeArchivos
            jobId={job.id}
            archivos={parseAttachmentsManifest(encargo)}
            de="adjunto"
            credencial={credencialDelEncargo}
            titulo={T.tablon.archivos.delEncargo}
          />
        </div>
      )}
      <label className="mt-4 flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-2">
        {T.tablon.trabajo.tuEntrega}
        <textarea value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 200_000))} rows={6} className={`${CAMPO} resize-none`} />
      </label>
      <div className="mt-3">
        <ElegirArchivos archivos={archivos} onChange={setArchivos} disabled={firma.ocupado !== null} />
      </div>
      <Nota>{T.tablon.trabajo.entregarPista}</Nota>
      <Fallo firma={firma} />
      <div className="mt-4 pb-4">
        <Boton
          onClick={() => void entregar()}
          disabled={(!texto.trim() && archivos.length === 0) || (archivos.length > 0 && problemaConArchivos(archivos) !== null) || firma.ocupado !== null}
        >
          {ocupado ? '…' : T.tablon.trabajo.entregar}
        </Boton>
      </div>
    </Hoja>
  );
}

const HORA = 3600;
const DIA = 86_400;
const MIN_ANUNCIO = 10;
/** Para quién es: el contrato no lo sabe, va en el anuncio (ver `anuncioPara`). */
const AUDIENCIAS: readonly AudienciaTablon[] = ['todos', 'personas', 'agentes'];
const PLAZOS = [6 * HORA, DIA, 3 * DIA, 7 * DIA];
const VENTANAS_OFERTAS = [2 * HORA, DIA, 3 * DIA];
const VENTANAS_ELECCION = [DIA, 3 * DIA, 7 * DIA];
const CADUCIDADES = [DIA, 3 * DIA, 7 * DIA, 14 * DIA];

function Opciones({ valores, valor, onChange }: { valores: number[]; valor: number; onChange: (v: number) => void }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${valores.length}, minmax(0, 1fr))` }}>
      {valores.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={`pulsable h-9 whitespace-nowrap rounded-full border px-1 text-[12.5px] font-medium ${
            valor === v ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'
          }`}
        >
          {duracion(v)}
        </button>
      ))}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[12.5px] font-medium text-ink-2">{etiqueta}</span>
      {children}
    </div>
  );
}

function HojaPublicar({ firma, onCerrar }: { firma: Firma; onCerrar: () => void }) {
  const T = useTextos();
  const P = T.tablon.publicar;
  const { data: reglas } = useReglasDelTablon();
  const [anuncio, setAnuncio] = useState('');
  const [encargo, setEncargo] = useState('');
  const [categoria, setCategoria] = useState<number | null>(null);
  const [audiencia, setAudiencia] = useState<AudienciaTablon>('todos');
  const [enPanal, setEnPanal] = useState(false);
  const [importe, setImporte] = useState('');
  const [modo, setModo] = useState<ModoTablon>(ModoTablon.Seleccion);
  const [plazo, setPlazo] = useState(3 * DIA);
  const [ofertas, setOfertas] = useState(2 * HORA);
  const [eleccion, setEleccion] = useState(DIA);
  const [caduca, setCaduca] = useState(3 * DIA);
  const [experiencia, setExperiencia] = useState(false);
  const [republicar, setRepublicar] = useState(false);
  const [paso, setPaso] = useState<'permiso' | 'publicando' | 'textos' | 'archivos' | null>(null);
  const [adjuntos, setAdjuntos] = useState<ArchivoParaSubir[]>([]);
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  // Con los textos tal y como se hashearon: reintentar tiene que mandar esos.
  const [hecho, setHecho] = useState<{
    jobId: bigint;
    textos: boolean;
    archivos: boolean;
    anuncio: string;
    encargo: string;
    adjuntos: ArchivoParaSubir[];
  } | null>(null);

  const moneda = (enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY) as Address;
  const simbolo = enPanal ? '$PANAL' : 'MON';
  const anuncioT = anuncio.trim();
  const encargoT = encargo.trim();
  const wei = aWei(importe);
  const seleccion = modo === ModoTablon.Seleccion;

  const problema = ((): string | null => {
    if (anuncioT.length < MIN_ANUNCIO || !encargoT) return null;
    if (categoria === null) return P.faltaCategoria;
    if (wei === null || wei === 0n) return importe ? P.importeMal : null;
    if (reglas) {
      const minimo = enPanal ? reglas.minimoPanal : reglas.minimoMon;
      if (wei < minimo) return P.minimo(monto(minimo), simbolo);
      const tope = reglas.topes[moneda.toLowerCase()];
      if (tope && tope.porEncargo !== 0n && wei > tope.porEncargo) return P.topeEncargo(monto(tope.porEncargo), simbolo);
      if (tope && tope.total !== 0n && tope.ocupado + wei > tope.total) {
        return P.topeTotal(monto(tope.total), monto(tope.total > tope.ocupado ? tope.total - tope.ocupado : 0n), simbolo);
      }
    }
    if (seleccion && caduca < ofertas + eleccion) return P.caducaCorta;
    return null;
  })();
  const listo = (adjuntos.length === 0 || problemaConArchivos(adjuntos) === null) && anuncioT.length >= MIN_ANUNCIO && !!encargoT && categoria !== null && wei !== null && wei > 0n && !problema && !reglas?.pausado;
  /**
   * Lo que falta, cuando el botón está apagado sin un problema que decir. Sin
   * esto se quedaba gris y callado con un anuncio de nueve letras o sin
   * importe, y desde fuera parecía que publicar no funcionaba.
   */
  const falta =
    anuncioT.length < MIN_ANUNCIO
      ? P.faltaAnuncio(MIN_ANUNCIO)
      : !encargoT
        ? P.faltaEncargo
        : categoria === null
          ? P.faltaCategoria
          : !importe.trim()
            ? P.faltaImporte
            : null;

  const publicar = async () => {
    if (wei === null || categoria === null) return;
    // El anuncio lleva delante para quién es; su hash lo deja fijo.
    const textoAnuncio = anuncioPara(audiencia, anuncioT);
    // Los adjuntos se anuncian DENTRO del encargo, con su hash: el taskHash
    // que va a la cadena los cubre desde el momento del pago.
    const archivos = adjuntos;
    const textoEncargo = appendAttachmentsManifest(
      encargoT,
      archivos.map((a) => attachmentFrom(a.name, a.bytes, a.mime)),
    );
    await firma.ejecutar('publicar', async (e, c) => {
      try {
        // Antes de cobrar nada: sin buzón, el encargo quedaría pagado y mudo.
        if (!(await buzonAceptaElTablon())) throw new Error(P.buzonNoListo);
        if (archivos.length > 0 && !(await buzonAceptaArchivos())) throw new Error(T.tablon.archivos.buzonSinArchivos);
        // Lo que esta hoja enseña, y nada más: la wallet del teléfono no firma otro.
        permitirTablon({ funcion: 'post', amount: wei, currency: moneda });
        if (enPanal) {
          setPaso('permiso');
          await permitirPanal(e, c, wei);
        }
        setPaso('publicando');
        const params = {
          taskHash: keccak256(toBytes(textoEncargo)),
          advertHash: keccak256(toBytes(textoAnuncio)),
          category: categoria,
          currency: moneda,
          amount: wei,
          workDuration: BigInt(plazo),
          expiresAt: BigInt(ahoraS() + caduca),
          mode: modo,
          applyWindow: BigInt(seleccion ? ofertas : 0),
          chooseWindow: BigInt(seleccion ? eleccion : 0),
          experiencedOnly: experiencia,
          relist: republicar,
          campaignId: `0x${'0'.repeat(64)}` as Hex,
          campaignCapPerAgent: 0,
        };
        const hash = await firmarYEsperar(e, c, enTablon('post', [params], enPanal ? undefined : wei));
        const recibo = await publicClient.getTransactionReceipt({ hash });
        const [ev] = parseEventLogs({ abi: panalTablonAbi, logs: recibo.logs, eventName: 'JobPosted' });
        if (!ev) throw new Error('JobPosted');
        setPaso('textos');
        let textos = true;
        try {
          await guardarTextos(ev.args.jobId, textoAnuncio, textoEncargo);
        } catch {
          textos = false;
        }
        // Los bytes, después del encargo: el buzón solo acepta los que anuncia.
        let subidos = archivos.length === 0;
        if (textos && archivos.length > 0) {
          setPaso('archivos');
          try {
            await subirArchivosDelTablon(ev.args.jobId, archivos, c, (message) => signMessageAsync({ message }));
            subidos = true;
          } catch {
            subidos = false;
          }
        }
        setHecho({ jobId: ev.args.jobId, textos, archivos: subidos, anuncio: textoAnuncio, encargo: textoEncargo, adjuntos: archivos });
      } finally {
        setPaso(null);
      }
    });
  };

  const reintentar = async () => {
    if (!hecho) return;
    setPaso('textos');
    try {
      if (!hecho.textos) {
        await guardarTextos(hecho.jobId, hecho.anuncio, hecho.encargo);
        setHecho((h) => (h ? { ...h, textos: true } : h));
      }
      if (!hecho.archivos && address) {
        setPaso('archivos');
        await subirArchivosDelTablon(hecho.jobId, hecho.adjuntos, address as Address, (message) => signMessageAsync({ message }));
        setHecho((h) => (h ? { ...h, textos: true, archivos: true } : h));
      }
    } catch {
      // sigue ofreciendo el reintento
    } finally {
      setPaso(null);
    }
  };

  const trabajando = firma.ocupado === 'publicar' || paso !== null;

  if (hecho) {
    return (
      <Hoja abierta titulo={P.titulo} onCerrar={onCerrar} bloqueada={paso !== null}>
        <Nota tono="miel">{P.hecho(hecho.jobId.toString())}</Nota>
        {(!hecho.textos || !hecho.archivos) && (
          <>
            <p className="mt-3 px-1 text-[12.5px] leading-[1.5] text-terra">{hecho.textos ? T.tablon.archivos.sinSubir : P.sinTextos}</p>
            <div className="mt-3">
              <Boton variante="secundario" onClick={() => void reintentar()} disabled={paso !== null}>
                {paso ? '…' : P.reintentar}
              </Boton>
            </div>
          </>
        )}
        <div className="mt-4 pb-4">
          <Boton onClick={onCerrar} disabled={!hecho.textos || !hecho.archivos}>
            {T.comun.listo}
          </Boton>
        </div>
      </Hoja>
    );
  }

  return (
    <Hoja abierta titulo={P.titulo} onCerrar={onCerrar} bloqueada={trabajando}>
      <div className="mt-3 flex flex-col gap-3.5 pb-4">
        {reglas?.pausado && <Nota tono="miel">{T.tablon.pausado}</Nota>}
        <Campo etiqueta={P.anuncio}>
          <textarea value={anuncio} onChange={(e) => setAnuncio(e.target.value.slice(0, MAX_TEXTO_ANUNCIO))} rows={2} className={`${CAMPO} resize-none`} />
          <span className="px-1 text-[11.5px] text-ink-3">{P.anuncioPista}</span>
        </Campo>
        <Campo etiqueta={P.encargo}>
          <textarea value={encargo} onChange={(e) => setEncargo(e.target.value.slice(0, 32_000))} rows={4} className={`${CAMPO} resize-none`} />
        </Campo>
        <ElegirArchivos archivos={adjuntos} onChange={setAdjuntos} disabled={trabajando} />
        <Campo etiqueta={P.categoria}>
          <select value={categoria ?? ''} onChange={(e) => setCategoria(e.target.value === '' ? null : Number(e.target.value))} className={CAMPO}>
            <option value="">{P.eligeCategoria}</option>
            {CATEGORIAS_TABLON.map((c, i) => (
              <option key={c} value={i}>
                {T.tablon.cat[c]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta={P.paraQuien}>
          <div className="grid grid-cols-3 gap-1.5">
            {AUDIENCIAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setAudiencia(a);
                  // Solo personas va en selección: en inmediato lo cogería el
                  // primero que pase las reglas, y la cadena no sabe quién es persona.
                  if (a === 'personas') setModo(ModoTablon.Seleccion);
                }}
                aria-pressed={audiencia === a}
                className={`pulsable h-9 whitespace-nowrap rounded-full border px-1 text-[12.5px] font-medium ${audiencia === a ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'}`}
              >
                {T.tablon.audiencia[a]}
              </button>
            ))}
          </div>
          <span className="px-1 text-[11.5px] leading-[1.45] text-ink-3">{P.audienciaPista[audiencia]}</span>
        </Campo>
        <Campo etiqueta={P.importe}>
          <div className="flex gap-2">
            <input
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              inputMode="decimal"
              placeholder={enPanal ? '5000' : '1,5'}
              className={`${CAMPO} min-w-0 grow font-mono`}
            />
            <div className="flex shrink-0 rounded-full border border-line bg-sand p-1">
              {(['MON', '$PANAL'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEnPanal(m === '$PANAL')}
                  className={`pulsable rounded-full px-3 text-[12px] font-semibold ${simbolo === m ? 'bg-cream text-ink' : 'text-ink-3'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {wei !== null && wei > 0n && (
            <span className="px-1">
              <Importe wei={wei} moneda={moneda} alineado="izquierda" />
            </span>
          )}
        </Campo>
        <Campo etiqueta={P.modo}>
          <div className={`grid gap-1.5 ${audiencia === 'personas' ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {(audiencia === 'personas' ? [ModoTablon.Seleccion] : [ModoTablon.Seleccion, ModoTablon.Inmediato]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                aria-pressed={modo === m}
                className={`pulsable h-9 rounded-full border text-[12.5px] font-medium ${modo === m ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'}`}
              >
                {m === ModoTablon.Seleccion ? T.tablon.seleccion : T.tablon.inmediato}
              </button>
            ))}
          </div>
          <span className="px-1 text-[11.5px] leading-[1.45] text-ink-3">{seleccion ? P.modoSeleccion : P.modoInmediato}</span>
          {audiencia !== 'personas' && categoria === CATEGORIAS_TABLON.indexOf('humanos') && (
            <span className="px-1 text-[11.5px] leading-[1.45] text-honey">{P.personasSeleccion}</span>
          )}
        </Campo>
        {seleccion && (
          <>
            <Campo etiqueta={P.ventanaOfertas}>
              <Opciones valores={VENTANAS_OFERTAS} valor={ofertas} onChange={setOfertas} />
            </Campo>
            <Campo etiqueta={P.ventanaEleccion}>
              <Opciones valores={VENTANAS_ELECCION} valor={eleccion} onChange={setEleccion} />
            </Campo>
          </>
        )}
        <Campo etiqueta={P.plazo}>
          <Opciones valores={PLAZOS} valor={plazo} onChange={setPlazo} />
        </Campo>
        <Campo etiqueta={P.caduca}>
          <Opciones valores={CADUCIDADES} valor={caduca} onChange={setCaduca} />
          <span className="px-1 text-[11.5px] text-ink-3">{P.caducaPista}</span>
        </Campo>
        {[
          [experiencia, setExperiencia, P.experiencia] as const,
          [republicar, setRepublicar, P.republicar] as const,
        ].map(([valor, cambiar, texto]) => (
          <label key={texto} className="flex items-start gap-2.5 px-1 text-[13px] leading-[1.45] text-ink-2">
            <input type="checkbox" checked={valor} onChange={(e) => cambiar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#E29A2E]" />
            <span>{texto}</span>
          </label>
        ))}
        {problema && <p className="px-1 text-[12.5px] leading-[1.5] text-terra">{problema}</p>}
        {!problema && falta && <p className="px-1 text-[12.5px] leading-[1.5] text-ink-3">{falta}</p>}
        <Fallo firma={firma} />
        <Boton onClick={() => void publicar()} disabled={!listo || firma.ocupado !== null}>
          {paso === 'permiso'
            ? P.pasoPermiso
            : paso === 'publicando'
              ? P.pasoPublicar
              : paso === 'textos'
                ? P.pasoTextos
                : paso === 'archivos'
                  ? T.tablon.archivos.subiendo
                  : P.confirmar}
        </Boton>
      </div>
    </Hoja>
  );
}
