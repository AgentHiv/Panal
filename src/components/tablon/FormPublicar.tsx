/**
 * Publicar un encargo en el tablón con reglas.
 *
 * Son hasta tres pasos y solo los dos primeros cuestan gas:
 *
 *   1. En $PANAL, el permiso EXACTO al tablón (`approve`). En MON no hace falta.
 *   2. `post()`: el dinero queda en PanalTablon, con el keccak256 del anuncio y
 *      del encargo. Nada de texto va a la cadena.
 *   3. Los dos textos al buzón, que solo los acepta si dan esos hashes. Sin
 *      firma: el hash ya dice que son los de quien pagó.
 *
 * El 3 va DESPUÉS de la cadena porque hasta que el encargo existe no hay
 * número al que atarlos. Si falla, el encargo está pagado y sin texto: se dice
 * y se puede reintentar, que es mejor que anunciar algo que no existe.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Hexagon, Lock } from 'lucide-react';
import { keccak256, parseEther, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import { useSignMessage } from 'wagmi';
import { cifrarArchivos, publicarMiClave } from '@/lib/cifrado';
import {
  CATEGORIAS_TABLON,
  MAX_TEXTO_ANUNCIO,
  ModoTablon,
  anuncioPara,
  appendAttachmentsManifest,
  attachmentFrom,
  cifrarTexto,
  panalTablonAbi,
  problemaConArchivos,
  type ArchivoParaSubir,
  type AudienciaTablon,
} from '@panal/sdk';
import Dolares from '@/components/Dolares';
import { Checkbox } from '@/components/ui/checkbox';
import TxHash from '@/components/TxHash';
import { NATIVE_CURRENCY, PANAL_TOKEN_ADDRESS, publicClient } from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';
import { useFirmaDelTablon } from '@/hooks/useFirmaDelTablon';
import { useReglasDelTablon } from '@/hooks/useTablonReglas';
import {
  buzonAceptaArchivos,
  buzonAceptaElTablon,
  enTablon,
  firmarYEsperar,
  guardarTextos,
  permitirPanal,
  subirArchivosDelTablon,
} from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';
import { ElegirArchivos } from './Archivos';
import { Girando } from './comun';
import { BOTON_LINEA, CAMPO, cantidad, useDuracion } from './util';

const MIN_ANUNCIO = 10;
const MAX_ENCARGO = 32_000;
/** Para quién es: el contrato no lo sabe, va en el anuncio (ver `anuncioPara`). */
const AUDIENCIAS: readonly AudienciaTablon[] = ['todos', 'personas', 'agentes'];
const HORA = 3600;
const DIA = 86_400;

/** Tiempo para entregar desde que se asigna. Una hora como mínimo (contrato). */
const PLAZOS = [6 * HORA, DIA, 3 * DIA, 7 * DIA] as const;
/** Selección: tiempo para ofertar. 2 h por defecto (BOARD.md, decisión 5). */
const VENTANAS_OFERTAS = [2 * HORA, DIA, 3 * DIA] as const;
/** Selección: tiempo para elegir. 24 h por defecto; 7 días como mucho. */
const VENTANAS_ELECCION = [DIA, 3 * DIA, 7 * DIA] as const;
/** Hasta cuándo se puede coger. */
const CADUCIDADES = [DIA, 3 * DIA, 7 * DIA, 14 * DIA] as const;

/** El reloj, fuera del componente: solo se lee al pulsar, nunca al pintar. */
function ahoraS(): number {
  return Math.floor(Date.now() / 1000);
}

interface Hecho {
  jobId: bigint;
  hash: Hex;
  textos: boolean;
  /** Si los adjuntos están en el buzón (sin adjuntos, sí). */
  archivos: boolean;
  /** Los textos tal y como se hashearon: reintentar tiene que mandar esos. */
  anuncio: string;
  encargo: string;
  adjuntos: ArchivoParaSubir[];
}

function Opciones<T extends number>({
  valores,
  valor,
  onChange,
  etiqueta,
  fluido = false,
}: {
  valores: readonly T[];
  valor: T;
  onChange: (v: T) => void;
  etiqueta: (v: T) => string;
  /**
   * Cada botón al ancho de su texto, y a otra fila si no caben. Para etiquetas
   * largas: en columnas iguales, «Personnes uniquement» o «Только агенты» se
   * salían del botón en la columna estrecha del formulario.
   */
  fluido?: boolean;
}) {
  return (
    <div
      className={fluido ? 'flex flex-wrap gap-2' : 'grid gap-2'}
      style={fluido ? undefined : { gridTemplateColumns: `repeat(${valores.length}, minmax(0, 1fr))` }}
    >
      {valores.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={cn(
            'whitespace-nowrap rounded-full border py-1.5 text-[0.8125rem] font-medium transition-colors',
            fluido ? 'px-3.5' : 'px-1',
            valor === v ? 'border-honey bg-honey-soft text-honey-deep' : 'border-line text-ink-2 hover:border-honey',
          )}
        >
          {etiqueta(v)}
        </button>
      ))}
    </div>
  );
}

export default function FormPublicar({ onPublicado }: { onPublicado?: () => void }) {
  const { t } = useTranslation();
  const { address, connected, connect, connecting } = useWallet();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const { data: reglas } = useReglasDelTablon();
  const duracion = useDuracion();

  const [anuncio, setAnuncio] = useState('');
  const [encargo, setEncargo] = useState('');
  const [categoria, setCategoria] = useState<number | null>(null);
  const [audiencia, setAudiencia] = useState<AudienciaTablon>('todos');
  const [adjuntos, setAdjuntos] = useState<ArchivoParaSubir[]>([]);
  const { signMessageAsync } = useSignMessage();
  const [enPanal, setEnPanal] = useState(false);
  const [importe, setImporte] = useState('');
  const [modo, setModo] = useState<ModoTablon>(ModoTablon.Seleccion);
  const [plazo, setPlazo] = useState<number>(3 * DIA);
  const [ofertas, setOfertas] = useState<number>(2 * HORA);
  const [eleccion, setEleccion] = useState<number>(DIA);
  const [caduca, setCaduca] = useState<number>(3 * DIA);
  const [experiencia, setExperiencia] = useState(false);
  const [republicar, setRepublicar] = useState(false);
  /**
   * Confidencial: el encargo y sus adjuntos se cifran para quien publica, y al
   * elegir una oferta se le da acceso solo a quien se elige. Solo en selección:
   * en inmediato lo cogería el primero que pasara las reglas, sin que nadie le
   * diera acceso.
   */
  const [confidencial, setConfidencial] = useState(false);
  const [paso, setPaso] = useState<'permiso' | 'publicando' | 'textos' | 'archivos' | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);

  const moneda = (enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY) as Address;
  const simbolo = enPanal ? '$PANAL' : 'MON';
  const anuncioT = anuncio.trim();
  const encargoT = encargo.trim();
  const importeStr = importe.replace(',', '.').trim();
  const importeWei = /^\d+(\.\d{1,18})?$/.test(importeStr) ? parseEther(importeStr) : null;
  const seleccion = modo === ModoTablon.Seleccion;

  /** Lo primero que impide publicar, o null. Las reglas de la beta, del contrato. */
  const problema = ((): string | null => {
    if (anuncioT.length < MIN_ANUNCIO) return null; // aún escribiendo: no se riñe
    if (!encargoT) return null;
    if (categoria === null) return t('tablon.pub.faltaCategoria');
    if (importeWei === null || importeWei === 0n) return importe ? t('tablon.pub.importeMal') : null;
    if (reglas) {
      const minimo = enPanal ? reglas.minimoPanal : reglas.minimoMon;
      if (importeWei < minimo) return t('tablon.pub.minimo', { n: cantidad(minimo), moneda: simbolo });
      const tope = reglas.topes[moneda.toLowerCase()];
      if (tope && tope.porEncargo !== 0n && importeWei > tope.porEncargo) {
        return t('tablon.pub.topeEncargo', { n: cantidad(tope.porEncargo), moneda: simbolo });
      }
      if (tope && tope.total !== 0n && tope.ocupado + importeWei > tope.total) {
        const queda = tope.total > tope.ocupado ? tope.total - tope.ocupado : 0n;
        return t('tablon.pub.topeTotal', { n: cantidad(tope.total), queda: cantidad(queda), moneda: simbolo });
      }
    }
    if (seleccion && caduca < ofertas + eleccion) return t('tablon.pub.caducaCorta');
    return null;
  })();

  /**
   * Lo que falta, cuando el botón está apagado sin un problema que decir. Sin
   * esto el botón se quedaba gris y callado con un anuncio de nueve letras o
   * sin importe, y desde fuera parecía que publicar no funcionaba.
   */
  const falta =
    anuncioT.length < MIN_ANUNCIO
      ? t('tablon.pub.faltaAnuncio', { n: MIN_ANUNCIO })
      : !encargoT
        ? t('tablon.pub.faltaEncargo')
        : categoria === null
          ? t('tablon.pub.faltaCategoria')
          : !importeStr
            ? t('tablon.pub.faltaImporte')
            : null;

  const problemaArchivos = adjuntos.length > 0 ? problemaConArchivos(adjuntos) : null;

  const listo =
    problemaArchivos === null &&
    anuncioT.length >= MIN_ANUNCIO &&
    encargoT.length > 0 &&
    categoria !== null &&
    importeWei !== null &&
    importeWei > 0n &&
    problema === null &&
    !reglas?.pausado;

  const publicar = () =>
    void ejecutar('publicar', async (escribir, cuenta) => {
      if (importeWei === null || categoria === null) return;
      // Los textos tal y como se hashean: el estado puede cambiar entre medias.
      // El anuncio lleva delante para quién es; su hash lo deja fijo.
      const textoAnuncio = anuncioPara(audiencia, anuncioT);
      // Los adjuntos se anuncian DENTRO del encargo, con su hash: el taskHash
      // que va a la cadena los cubre desde el momento del pago.
      let archivos = adjuntos;
      let textoEncargo = appendAttachmentsManifest(
        encargoT,
        archivos.map((a) => attachmentFrom(a.name, a.bytes, a.mime)),
      );
      if (confidencial && seleccion) {
        /*
         * Cifrado solo para quien publica: a quien coja el encargo se le da
         * acceso al elegirlo. Antes de pagar nada; la primera vez publica
         * también la clave (dos firmas, una vez). Los adjuntos se anuncian en
         * abierto por su hash y su tamaño: el buzón solo acepta los que el
         * encargo anuncia, y no puede leerlo.
         */
        const firmar = (message: string) => signMessageAsync({ message });
        // La de esta sesión, publicada: con ella se abrirá luego el encargo.
        const miPublica = (await publicarMiClave(cuenta, firmar)).clave.publica;
        const para = [{ cuenta, clave: miPublica }];
        const { anunciar, subir } = cifrarArchivos(adjuntos, para);
        const enClaro = appendAttachmentsManifest(
          encargoT,
          anunciar.map((a) => attachmentFrom(a.name, a.bytes, a.mime)),
        );
        textoEncargo = cifrarTexto(enClaro, para, {
          anunciar: anunciar.map((a) => ({ hash: keccak256(a.bytes), size: a.bytes.byteLength })),
        });
        archivos = subir;
      }
      try {
        // Antes de cobrar nada: sin buzón, el encargo quedaría pagado y mudo.
        if (!(await buzonAceptaElTablon())) throw new Error(t('tablon.pub.buzonNoListo'));
        if (archivos.length > 0 && !(await buzonAceptaArchivos())) throw new Error(t('tablon.archivos.buzonSinArchivos'));
        if (enPanal) {
          setPaso('permiso');
          await permitirPanal(escribir, cuenta, importeWei);
        }
        setPaso('publicando');
        const params = {
          taskHash: keccak256(toBytes(textoEncargo)),
          advertHash: keccak256(toBytes(textoAnuncio)),
          category: categoria,
          currency: moneda,
          amount: importeWei,
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
        const hash = await firmarYEsperar(escribir, cuenta, enTablon('post', [params], enPanal ? undefined : importeWei));
        const recibo = await publicClient.getTransactionReceipt({ hash });
        const [ev] = parseEventLogs({ abi: panalTablonAbi, logs: recibo.logs, eventName: 'JobPosted' });
        if (!ev) throw new Error('JobPosted');
        const jobId = ev.args.jobId;
        setPaso('textos');
        let textos = true;
        try {
          await guardarTextos(jobId, textoAnuncio, textoEncargo);
        } catch {
          textos = false;
        }
        // Los bytes, después del encargo: el buzón solo acepta los que anuncia.
        let subidos = archivos.length === 0;
        if (textos && archivos.length > 0) {
          setPaso('archivos');
          try {
            await subirArchivosDelTablon(jobId, archivos, cuenta, (message) => signMessageAsync({ message }));
            subidos = true;
          } catch {
            subidos = false;
          }
        }
        setHecho({ jobId, hash, textos, archivos: subidos, anuncio: textoAnuncio, encargo: textoEncargo, adjuntos: archivos });
        onPublicado?.();
      } finally {
        setPaso(null);
      }
    });

  const reintentarTextos = () =>
    void (async () => {
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
    })();

  const otro = () => {
    setHecho(null);
    setAnuncio('');
    setEncargo('');
    setImporte('');
    setAdjuntos([]);
  };

  if (hecho) {
    return (
      <div className="mt-5 flex flex-col items-center gap-4 text-center">
        <p className="text-[0.9375rem] text-ink">{t('tablon.pub.hecho', { id: hecho.jobId.toString() })}</p>
        <TxHash hash={hecho.hash} className="rounded-full border border-line bg-cream px-4 py-2" />
        {hecho.textos && hecho.archivos ? (
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{seleccion ? t('tablon.pub.hechoSeleccion') : t('tablon.pub.hechoInmediato')}</p>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-terra/30 bg-terra/5 px-4 py-3 text-[0.8125rem] text-ink-2">
            <p>{hecho.textos ? t('tablon.archivos.sinSubir') : t('tablon.pub.sinTextos')}</p>
            <button type="button" onClick={reintentarTextos} disabled={paso !== null} className={BOTON_LINEA}>
              {paso !== null && <Girando />}
              {t('tablon.pub.reintentar')}
            </button>
          </div>
        )}
        <button type="button" onClick={otro} disabled={!hecho.textos || !hecho.archivos} className={BOTON_LINEA}>
          {t('tablon.pub.otro')}
        </button>
      </div>
    );
  }

  const ocupadoAqui = ocupado === 'publicar';

  return (
    <div className="mt-5 flex flex-col gap-4">
      {reglas?.pausado && (
        <p className="rounded-xl border border-terra/30 bg-terra/5 px-4 py-3 text-[0.8125rem] text-terra">{t('tablon.pausado')}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tab-anuncio" className="text-[0.8125rem] font-medium text-ink-2">
          {t('tablon.anuncioLabel')}
        </label>
        <textarea
          id="tab-anuncio"
          value={anuncio}
          onChange={(e) => setAnuncio(e.target.value.slice(0, MAX_TEXTO_ANUNCIO))}
          rows={3}
          placeholder={t('tablon.anuncioHueco')}
          className={cn(CAMPO, 'resize-none')}
        />
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.anuncioPista')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tab-encargo" className="text-[0.8125rem] font-medium text-ink-2">
          {t('tablon.encargoLabel')}
        </label>
        <textarea
          id="tab-encargo"
          value={encargo}
          onChange={(e) => setEncargo(e.target.value.slice(0, MAX_ENCARGO))}
          rows={5}
          placeholder={t('tablon.encargoHueco')}
          className={cn(CAMPO, 'resize-none')}
        />
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.encargoPista')}</p>
      </div>

      <ElegirArchivos
        archivos={adjuntos}
        onChange={setAdjuntos}
        disabled={ocupado !== null}
        etiqueta={t('tablon.archivos.opcional')}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tab-categoria" className="text-[0.8125rem] font-medium text-ink-2">
          {t('tablon.pub.categoria')}
        </label>
        <select
          id="tab-categoria"
          value={categoria ?? ''}
          onChange={(e) => setCategoria(e.target.value === '' ? null : Number(e.target.value))}
          className={CAMPO}
        >
          <option value="">{t('tablon.pub.eligeCategoria')}</option>
          {CATEGORIAS_TABLON.map((c, i) => (
            <option key={c} value={i}>
              {t(`tablon.cat.${c}`)}
            </option>
          ))}
        </select>
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.pub.categoriaPista')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.paraQuien')}</span>
        <Opciones
          valores={[0, 1, 2] as const}
          valor={AUDIENCIAS.indexOf(audiencia) as 0 | 1 | 2}
          onChange={(i) => {
            const a = AUDIENCIAS[i]!;
            setAudiencia(a);
            // Solo personas va en selección: en inmediato lo cogería el
            // primero que pase las reglas, y la cadena no sabe quién es persona.
            if (a === 'personas') setModo(ModoTablon.Seleccion);
          }}
          etiqueta={(i) => t(`tablon.audiencia.${AUDIENCIAS[i]}`)}
          fluido
        />
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t(`tablon.pub.audienciaPista.${audiencia}`)}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.importe')}</span>
        <div className="flex gap-2">
          <input
            id="tab-importe"
            aria-label={t('tablon.pub.importe')}
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            inputMode="decimal"
            placeholder={enPanal ? '5000' : '1.5'}
            className={cn(CAMPO, 'min-w-0 flex-1 font-mono', importe && importeWei === null && 'border-terra')}
          />
          <div className="flex shrink-0 rounded-full border border-line bg-cream p-1" role="radiogroup" aria-label={t('tablon.pub.moneda')}>
            {(['MON', '$PANAL'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={simbolo === m}
                onClick={() => setEnPanal(m === '$PANAL')}
                className={cn(
                  'rounded-full px-3 py-1 text-[0.75rem] font-semibold transition-colors',
                  simbolo === m ? 'bg-paper text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {importeWei !== null && importeWei > 0n && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-[0.75rem] leading-relaxed text-ink-3">
            <Dolares cantidad={importeWei} moneda={simbolo} avisarSinPrecio className="text-[0.8125rem]" />
            <span>{t('dolares.formulario', { moneda: simbolo })}</span>
          </p>
        )}
        {reglas && (
          <p className="text-[0.75rem] leading-relaxed text-ink-3">
            {(() => {
              const tope = reglas.topes[moneda.toLowerCase()];
              return tope && tope.porEncargo !== 0n
                ? t('tablon.pub.topeBeta', { n: cantidad(tope.porEncargo), moneda: simbolo })
                : null;
            })()}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.modo')}</span>
        <Opciones
          valores={audiencia === 'personas' ? ([ModoTablon.Seleccion] as const) : ([ModoTablon.Seleccion, ModoTablon.Inmediato] as const)}
          valor={modo}
          onChange={setModo}
          etiqueta={(m) => (m === ModoTablon.Seleccion ? t('tablon.modo.seleccion') : t('tablon.modo.inmediato'))}
        />
        <p className="text-[0.75rem] leading-relaxed text-ink-3">
          {seleccion ? t('tablon.pub.modoSeleccion') : t('tablon.pub.modoInmediato')}
        </p>
        {audiencia !== 'personas' && categoria === CATEGORIAS_TABLON.indexOf('humanos') && (
          <p className="text-[0.75rem] leading-relaxed text-honey-deep">{t('tablon.pub.personasSeleccion')}</p>
        )}
      </div>

      {seleccion && (
        <>
          <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
            <Checkbox
              checked={confidencial}
              onCheckedChange={(v) => setConfidencial(v === true)}
              className="mt-0.5 border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-medium text-ink">
                <Lock size={12} aria-hidden />
                {t('tablon.pub.confidencial')}
              </span>
              <span className="block text-ink-3">{t('tablon.pub.confidencialPista')}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.ventanaOfertas')}</span>
            <Opciones valores={VENTANAS_OFERTAS} valor={ofertas as (typeof VENTANAS_OFERTAS)[number]} onChange={setOfertas} etiqueta={duracion} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.ventanaEleccion')}</span>
            <Opciones valores={VENTANAS_ELECCION} valor={eleccion as (typeof VENTANAS_ELECCION)[number]} onChange={setEleccion} etiqueta={duracion} />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.plazo')}</span>
        <Opciones valores={PLAZOS} valor={plazo as (typeof PLAZOS)[number]} onChange={setPlazo} etiqueta={duracion} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] font-medium text-ink-2">{t('tablon.pub.caduca')}</span>
        <Opciones valores={CADUCIDADES} valor={caduca as (typeof CADUCIDADES)[number]} onChange={setCaduca} etiqueta={duracion} />
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('tablon.pub.caducaPista')}</p>
      </div>

      <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
        <Checkbox
          checked={experiencia}
          onCheckedChange={(v) => setExperiencia(v === true)}
          className="mt-0.5 border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
        />
        <span>{t('tablon.pub.experiencia')}</span>
      </label>
      <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
        <Checkbox
          checked={republicar}
          onCheckedChange={(v) => setRepublicar(v === true)}
          className="mt-0.5 border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
        />
        <span>{t('tablon.pub.republicar')}</span>
      </label>

      {problema && <p className="text-[0.8125rem] leading-relaxed text-terra">{problema}</p>}
      {!problema && falta && <p className="text-[0.8125rem] leading-relaxed text-ink-3">{falta}</p>}

      {connected ? (
        <button
          type="button"
          onClick={publicar}
          disabled={!listo || ocupado !== null}
          className="btn-monad inline-flex items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
        >
          {ocupadoAqui && <Girando size={14} />}
          {paso === 'permiso'
            ? t('tablon.pub.pasoPermiso')
            : paso === 'publicando'
              ? t('tablon.pub.pasoPublicar')
              : paso === 'textos'
                ? t('tablon.guardando')
                : paso === 'archivos'
                  ? t('tablon.archivos.subiendo')
                  : t('tablon.publicarBoton')}
        </button>
      ) : (
        <button type="button" onClick={connect} disabled={connecting} className="btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40">
          {connecting ? t('nav.connecting') : t('nav.connect')}
        </button>
      )}

      <p className="flex items-start gap-2 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-3">
        <Hexagon size={12} className="mt-0.5 shrink-0 fill-honey text-honey" aria-hidden />
        <span className="min-w-0 break-words">
          {t('tablon.pub.nota')}{' '}
          <Link to="/protocolo" className="text-honey-deep underline decoration-dotted underline-offset-4">
            {t('tablon.pub.notaEnlace')}
          </Link>
        </span>
      </p>
    </div>
  );
}
