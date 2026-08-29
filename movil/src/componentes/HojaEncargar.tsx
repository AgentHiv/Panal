import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSignMessage, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { keccak256, parseEventLogs, toBytes } from 'viem';
import {
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  NATIVE_CURRENCY,
  currencySymbol,
  activeChain,
} from '@/contracts/config';
import { panalEscrowV2Abi, panalTokenAbi } from '@/contracts/abis';
import { saveTaskBrief } from '@/lib/taskBriefs';
import {
  briefSignMessage,
  buildBriefUrl,
  buildUploadUrl,
  enviarBriefConReintento,
  leerCapacidades,
  type CapacidadesAgente,
} from '@/lib/botEndpoint';
import {
  MAX_ADJUNTOS,
  MAX_ADJUNTO_BYTES,
  appendAttachmentsManifest,
  describirArchivo,
  limpiarNombre,
  tamanoLegible,
  type Adjunto,
} from '@/lib/adjuntos';
import type { Nivel } from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import type { DatosAgente } from '~/lib/agente';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { monto } from '~/lib/formato';
import { useIdioma, useTextos } from '~/i18n/idiomas';

/** El número y su unidad van aparte: en chino «6 h» se escribe «6 小时». */
const PLAZOS: { horas: number; unidad: 'horas' | 'dias'; cuantos: number }[] = [
  { horas: 6, unidad: 'horas', cuantos: 6 },
  { horas: 24, unidad: 'horas', cuantos: 24 },
  { horas: 72, unidad: 'dias', cuantos: 3 },
  { horas: 168, unidad: 'dias', cuantos: 7 },
];

/** En qué punto va el encargo DESPUÉS de que el pago esté bloqueado. */
type Entrega = 'nada' | 'enviando' | 'subiendo' | 'hecho' | 'fallo';

/**
 * Encargar un trabajo: escrow.
 *
 * Lo que viaja por la cadena es el HASH del brief, no el texto. Así que hay dos
 * mitades, y las dos hacen falta:
 *
 *   1. `createTask` bloquea el pago y ancla `keccak256(brief)`.
 *   2. Un POST firmado al bot del agente le lleva el TEXTO, y detrás los bytes
 *      de los archivos que el encargo anunciaba.
 *
 * LA SEGUNDA MITAD NO EXISTÍA. Esta hoja guardaba el brief en el teléfono y se
 * cerraba: el agente veía aparecer una tarea con un hash y nada más. El texto
 * no se puede sacar de un hash, así que un encargo hecho desde el móvil no
 * llegaba a ninguna parte y el cliente no veía un solo error — el pago salía
 * bien, la tarea existía. De ahí que ahora la hoja se quede abierta hasta que
 * el agente confirme que lo tiene, y que diga en voz alta cuando no.
 *
 * LOS ARCHIVOS van dentro del encargo antes de pagar, como hashes:
 *
 *     [panal-attach/1]
 *     name: contrato.pdf
 *     hash: 0x8f3a…
 *
 * Ese bloque forma parte del texto que se hashea, así que el escrow los cubre
 * y el agente puede rechazar cualquier byte que su encargo no anuncie. Por eso
 * los bytes pueden subirse DESPUÉS, por una ruta aparte, sin que nadie pueda
 * colarle nada por ella.
 *
 * Y por eso se pregunta antes si el agente sabe recibirlos: uno con la
 * plantilla anterior aceptaría el encargo igual —el manifiesto es texto y el
 * hash cuadra—, trabajaría sin el archivo, entregaría y cobraría. Nadie vería
 * un error; solo el resultado ignoraría la mitad de lo que se pidió.
 *
 * En $PANAL hacen falta DOS transacciones —aprobar y crear— porque un ERC-20
 * no se puede mandar dentro de la llamada como el MON nativo. Se encadenan
 * solas: al minarse el approve se dispara createTask.
 */
export default function HojaEncargar({
  abierta,
  agente,
  datos,
  onCerrar,
  onHecho,
}: {
  abierta: boolean;
  agente: string;
  datos: DatosAgente | null;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement | null {
  const [brief, setBrief] = useState('');
  const [horas, setHoras] = useState(24);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null);
  /**
   * Lo que su tarjeta dice que sabe hacer. `null` = todavía no ha contestado.
   *
   * Se guarda la respuesta y se DEDUCE de ella lo que enseña la pantalla, en
   * vez de guardar aparte «acepta/no acepta»: dos copias del mismo hecho es
   * como se quedan desincronizadas.
   */
  const [capacidades, setCapacidades] = useState<CapacidadesAgente | null>(null);
  const [nivel, setNivel] = useState<Nivel | null>(null);
  const entradaArchivos = useRef<HTMLInputElement>(null);

  const [entrega, setEntrega] = useState<Entrega>('nada');
  const [porQue, setPorQue] = useState<string | null>(null);
  /**
   * El encargo TAL Y COMO se hasheó al contratar.
   *
   * Lo que se le manda al agente tiene que ser ESTE texto, no el que compondría
   * el estado de ahora: si difieren en un solo byte, el `keccak256` no cuadra
   * con el `taskHash` que la cadena ancló, el agente rechaza el encargo y el
   * cliente se queda con el pago bloqueado hasta que venza el plazo.
   */
  const briefFirmado = useRef<string | null>(null);

  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const { writeContract, data: hashTx, isPending } = useWriteContract();
  const { writeContract: aprobar, data: hashApprove } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash: hashTx });
  const reciboApprove = useWaitForTransactionReceipt({ hash: hashApprove });

  const enPanal = datos ? currencySymbol(datos.moneda) === '$PANAL' : false;
  /** Los niveles que vende este agente. Vacío es lo normal. */
  /**
   * Los niveles, con los de la CADENA por delante.
   *
   * Se derivan en vez de guardarse: son los únicos que siguen ahí con el bot
   * caído, así que no pueden depender de que una respuesta llegue. Si mandara
   * la tarjeta, un agente que no contesta se quedaría sin niveles y esta hoja
   * ofrecería su precio suelto —el del más barato— para el tamaño grande.
   * Los de la tarjeta son el respaldo de quien aún no los ha subido.
   */
  const niveles = datos?.niveles?.length ? datos.niveles : (capacidades?.niveles ?? []);
  /**
   * El elegido. Sin tocar nada es el más barato, que debería costar lo mismo
   * que su precio registrado: quien no elija bloquea lo de siempre.
   */
  const elegido = nivel ?? niveles[0] ?? null;
  /**
   * Lo que se bloquea: el nivel elegido, o el precio del registro.
   *
   * Es el único número que le dice al agente qué se compró, porque es el que
   * queda en la cadena. Lo que ponga el encargo no cuenta: lo escribe el
   * cliente.
   */
  const precio = elegido?.wei ?? datos?.precioTarea ?? 0n;
  const simbolo = datos ? currencySymbol(datos.moneda) : 'MON';
  // El 2,5 % sale del precio, no se suma: bloqueas el precio y el agente cobra menos.
  const comision = (precio * 250n) / 10_000n;

  const T = useTextos();
  const idioma = useIdioma();

  /* ── ¿acepta archivos? ¿vende niveles? ─────────────────────────────────── */

  useEffect(() => {
    const botUrl = datos?.botUrl;
    // Sin endpoint no hay tarjeta que preguntar. Los niveles de la cadena se
    // ven igual: se derivan arriba y no dependen de que nadie conteste, que es
    // justo el motivo de haberlos subido ahí.
    if (!botUrl) return;
    let vigente = true;
    void (async () => {
      // En el idioma de la app: los niveles se llaman «Un archivo» o «El
      // repositorio», y quien tiene el teléfono en chino no lee eso.
      const leidas = await leerCapacidades(botUrl, 6_000, idioma);
      if (vigente) setCapacidades(leidas);
    })();
    return () => {
      vigente = false;
    };
  }, [datos?.botUrl, idioma]);

  /**
   * ¿Este agente sabe recibir archivos?
   *
   * Falla CERRADO: sin endpoint publicado, o con una tarjeta que no contesta,
   * no se ofrece el clip. Descubrirlo subiendo sería descubrirlo con el pago
   * ya bloqueado.
   */
  const aceptaArchivos: 'mirando' | 'si' | 'no' = !datos?.botUrl
    ? 'no'
    : capacidades === null
      ? 'mirando'
      : capacidades.adjuntos
        ? 'si'
        : 'no';
  /** El tope del AGENTE si lo anuncia, y nunca por encima del nuestro. */
  const topeArchivo = Math.min(capacidades?.maxAdjuntoBytes ?? MAX_ADJUNTO_BYTES, MAX_ADJUNTO_BYTES);

  /**
   * El encargo, tal y como se va a hashear. Se compone AQUÍ y en ningún otro
   * sitio: dos sitios que lo compongan son dos textos que pueden separarse.
   */
  const componer = useCallback(
    (): string => appendAttachmentsManifest(brief.trim(), adjuntos),
    [brief, adjuntos],
  );

  /**
   * Añade archivos: los lee, los hashea y los deja listos para anunciarse.
   *
   * El hash se calcula AHORA, antes de pagar, porque es lo que hace que el
   * escrow los cubra. Un archivo elegido después de contratar ya no cabe en el
   * encargo: habría que cancelar y volver a empezar.
   */
  const anadirArchivos = useCallback(
    async (lista: FileList | null): Promise<void> => {
      if (!lista || lista.length === 0) return;
      setAvisoArchivo(null);
      const nuevos: Adjunto[] = [];
      for (const archivo of Array.from(lista)) {
        // El tope del AGENTE, que puede ser menor que el nuestro. Rechazarlo
        // aquí evita descubrirlo subiendo, con el pago ya bloqueado.
        if (archivo.size > topeArchivo) {
          setAvisoArchivo(T.encargar.archivoGrande(archivo.name, tamanoLegible(topeArchivo)));
          continue;
        }
        // El nombre se comprueba APARTE de leer los bytes, y no es lo mismo:
        // un archivo llamado «...» no tiene nombre que anunciar, y uno de
        // Drive que aún no se ha descargado al teléfono sí lo tiene pero no se
        // deja leer. Con un solo mensaje, el segundo caso —el normal en un
        // móvil— salía acusando al nombre, que estaba perfectamente bien.
        try {
          limpiarNombre(archivo.name);
        } catch {
          setAvisoArchivo(T.encargar.archivoSinNombre(archivo.name));
          continue;
        }
        try {
          nuevos.push(await describirArchivo(archivo));
        } catch {
          setAvisoArchivo(T.encargar.archivoNoSeLee(archivo.name));
        }
      }
      setAdjuntos((previos) => {
        // Por hash: el mismo archivo elegido dos veces es un adjunto, no dos.
        const porHash = new Map(previos.map((a) => [a.hash, a]));
        for (const a of nuevos) if (!porHash.has(a.hash)) porHash.set(a.hash, a);
        const todos = [...porHash.values()];
        if (todos.length > MAX_ADJUNTOS) {
          setAvisoArchivo(T.encargar.archivosDemasiados(MAX_ADJUNTOS));
          return todos.slice(0, MAX_ADJUNTOS);
        }
        return todos;
      });
    },
    [T, topeArchivo],
  );

  /* ── pagar ─────────────────────────────────────────────────────────────── */

  const crear = () => {
    if (!datos || !brief.trim()) return;
    const texto = componer();
    const taskHash = keccak256(toBytes(texto));
    briefFirmado.current = texto;
    saveTaskBrief(taskHash, texto);
    const plazo = BigInt(Math.floor(Date.now() / 1000) + horas * 3600);

    writeContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'createTask',
      args: [
        agente as `0x${string}`,
        taskHash,
        plazo,
        enPanal ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY,
        precio,
      ],
      ...(enPanal ? {} : { value: precio }),
      chainId: activeChain.id,
    });
  };

  const empezar = () => {
    if (!datos || !brief.trim()) return;
    if (!enPanal) return crear();
    aprobar({
      address: PANAL_TOKEN_ADDRESS,
      abi: panalTokenAbi,
      functionName: 'approve',
      args: [PANAL_ESCROW_V2_ADDRESS, precio],
      chainId: activeChain.id,
    });
  };

  // Encadenado: en cuanto el approve se mina, se crea la tarea. `crear` solo
  // manda una transaccion —un sistema externo—, no toca estado de React.
  useEffect(() => {
    if (reciboApprove.isSuccess && !hashTx) crear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reciboApprove.isSuccess, hashTx]);

  /* ── llevarle el encargo al agente ─────────────────────────────────────── */

  /**
   * El número que le tocó a la tarea, sacado del `TaskCreated` del recibo.
   *
   * Se deduce del recibo en vez de guardarse: es el mismo dato mirado de otra
   * manera. Y se calcula durante el render para poder decidir con él —sin
   * este número no hay a dónde mandar el encargo— antes de tocar la red.
   */
  const idDeTarea = useMemo(() => {
    if (!recibo.data) return undefined;
    const [creada] = parseEventLogs({
      abi: panalEscrowV2Abi,
      eventName: 'TaskCreated',
      logs: recibo.data.logs,
    });
    return creada?.args?.taskId;
  }, [recibo.data]);

  /**
   * Sube los bytes de cada archivo, uno a uno.
   *
   * Va DESPUÉS del brief y no puede ir antes: el agente solo acepta lo que su
   * encargo anuncia, y hasta tener el encargo no sabe cuáles son.
   *
   * Se firma con la MISMA firma que abrió el encargo. No es un atajo: lo que
   * decide qué entra es el manifiesto que la cadena ya cubre, no la firma.
   * Pedir una por archivo serían tres confirmaciones más a alguien que acaba
   * de pagar.
   *
   * El nombre va percent-encoded porque una cabecera HTTP no admite caracteres
   * fuera de latin-1, y «recibo ñ.png» es un nombre perfectamente normal.
   */
  const subir = async (botUrl: string, taskId: bigint, firma: string, quien: string): Promise<number> => {
    let fallos = 0;
    for (const a of adjuntos) {
      try {
        const res = await fetch(buildUploadUrl(botUrl, taskId), {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-panal-address': quien,
            'x-panal-signature': firma,
            'x-panal-filename': encodeURIComponent(a.name),
          },
          body: new Blob([a.bytes]),
        });
        if (!res.ok) {
          fallos += 1;
          console.warn(`[panal] el agente rechazó "${a.name}" con ${res.status}`);
        }
      } catch (err) {
        fallos += 1;
        console.warn(`[panal] no se pudo subir "${a.name}": ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      }
    }
    return fallos;
  };

  /**
   * Le lleva el encargo al agente: primero el texto, luego los archivos.
   *
   * Si algo falla, el encargo NO se pierde: el pago sigue bloqueado, la tarea
   * existe y el texto está guardado en este teléfono. Lo que se pierde es el
   * tiempo hasta que se reintente, y por eso se dice en pantalla en vez de
   * cerrarse como si todo hubiera ido bien.
   */
  const entregar = useCallback(async (): Promise<void> => {
    const taskId = idDeTarea;
    const botUrl = datos?.botUrl;
    // Los dos casos sin salida —sin número de tarea, sin endpoint— ya se
    // decidieron antes de llamar aquí: esta función solo se usa cuando hay a
    // dónde mandarlo.
    if (taskId === undefined || !botUrl || !address) return;
    try {
      const texto = briefFirmado.current ?? componer();
      const firma = await signMessageAsync({ message: briefSignMessage(taskId) });
      const res = await enviarBriefConReintento(buildBriefUrl(botUrl, taskId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: texto, address, signature: firma }),
      });
      if (!res.ok) {
        setEntrega('fallo');
        setPorQue(T.encargar.agenteRespondio(res.status));
        return;
      }

      if (adjuntos.length > 0) {
        setEntrega('subiendo');
        const fallos = await subir(botUrl, taskId, firma, address);
        if (fallos > 0) {
          setEntrega('fallo');
          setPorQue(T.encargar.archivosFallaron(fallos));
          return;
        }
      }
      setEntrega('hecho');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntrega('fallo');
      setPorQue(/reject|denied|user/i.test(msg) ? T.encargar.firmaCancelada : T.encargar.noSePudoHablar);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDeTarea, address, datos?.botUrl, adjuntos, componer, signMessageAsync, T]);

  /**
   * Con el pago minado, la entrega arranca sola.
   *
   * El paso se da AQUÍ, durante el render, y no en un efecto: es estado que se
   * deduce de otro estado. Y los dos callejones sin salida se ven ya, antes de
   * tocar la red, así que la pantalla dice por qué en vez de intentarlo.
   *
   * La hoja se queda abierta hasta saber si llegó. Cerrarla al minarse es lo
   * que hacía que un encargo que no llegaba pareciera uno que sí.
   */
  if (recibo.isSuccess && entrega === 'nada') {
    if (idDeTarea === undefined) {
      setEntrega('fallo');
      setPorQue(T.encargar.sinIdDeTarea);
    } else if (!datos?.botUrl) {
      setEntrega('fallo');
      setPorQue(T.encargar.sinEndpoint);
    } else {
      setEntrega('enviando');
      setPorQue(null);
    }
  }

  // Y el efecto solo hace lo que sí es un sistema de fuera: hablar con el bot.
  const yendo = useRef(false);
  useEffect(() => {
    if (entrega !== 'enviando' || yendo.current) return;
    yendo.current = true;
    void entregar().finally(() => {
      yendo.current = false;
    });
  }, [entrega, entregar]);

  // Cuando ya está entregado, la hoja se cierra sola.
  useEffect(() => {
    if (entrega === 'hecho') onHecho();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrega]);

  if (!datos) return null;

  // La fase se DEDUCE de las transacciones, no se guarda aparte: dos copias del
  // mismo estado es como se quedan desincronizadas.
  const aprobando = !!hashApprove && !reciboApprove.isSuccess;
  const pagando = aprobando || isPending || recibo.isLoading;
  const entregando = entrega === 'enviando' || entrega === 'subiendo';
  const trabajando = pagando || entregando;
  // Con el pago ya bloqueado, la hoja deja de ser un formulario: no se puede
  // volver a cambiar lo que se pidió, porque su hash ya está en la cadena.
  const pagado = recibo.isSuccess;

  return (
    <Hoja abierta={abierta} titulo={T.encargar.titulo} onCerrar={onCerrar} bloqueada={trabajando}>
      {!pagado && (
        <>
          {/* Niveles. Sólo si el agente vende alguno; casi ninguno lo hace. */}
          {niveles.length > 0 && (
            <>
              <p className="mt-3 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
                {T.encargar.nivel}
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {niveles.map((n) => {
                  const activo = elegido?.wei === n.wei;
                  return (
                    <li key={n.wei.toString()}>
                      <button
                        type="button"
                        onClick={() => setNivel(n)}
                        disabled={trabajando}
                        className={`pulsable flex w-full items-center gap-3 rounded-[13px] border px-3.5 py-2.5 text-left disabled:opacity-40 ${
                          activo ? 'border-honey bg-honey/10' : 'border-line bg-sand'
                        }`}
                      >
                        <span className="min-w-0 grow">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">
                            {n.name ?? T.encargar.titulo}
                          </span>
                          {n.description !== null && (
                            <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-ink-2">
                              {n.description}
                            </span>
                          )}
                          {n.maxBriefChars !== null && (
                            <span className="mt-0.5 block text-[11.5px] text-ink-3">
                              {T.encargar.nivelTope(n.maxBriefChars)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-[12.5px] text-ink">
                          {monto(n.wei)} {simbolo}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <p className="mt-3 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
            {T.encargar.quePides}
          </p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder={T.encargar.briefHueco}
            disabled={trabajando}
            className="seleccionable mt-2 w-full resize-none rounded-[14px] border border-line bg-sand px-3.5 py-3 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-ink-3"
          />

          {/* Archivos. Solo si el agente sabe recibirlos. */}
          {aceptaArchivos === 'si' && (
            <>
              <div className="mt-3.5 flex items-center justify-between gap-3">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
                  {T.encargar.archivos}
                </p>
                <button
                  type="button"
                  onClick={() => entradaArchivos.current?.click()}
                  disabled={trabajando || adjuntos.length >= MAX_ADJUNTOS}
                  className="pulsable flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-ink-2 disabled:opacity-40"
                >
                  <Icono nombre="eslabon" tamano={14} color="#C8C3DC" grosor={2} />
                  {T.encargar.anadirArchivo}
                </button>
              </div>
              <input
                ref={entradaArchivos}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void anadirArchivos(e.target.files);
                  // Se limpia para que elegir el MISMO archivo otra vez vuelva
                  // a disparar el evento: sin esto, quitarlo y volver a
                  // ponerlo no hace nada.
                  e.target.value = '';
                }}
              />

              {adjuntos.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {adjuntos.map((a) => (
                    <li
                      key={a.hash}
                      className="flex items-center gap-2 rounded-[11px] border border-line bg-sand px-3 py-2"
                    >
                      <Icono nombre="hoja" tamano={15} color="#948DAE" grosor={1.8} />
                      <span className="min-w-0 grow truncate text-[12.5px] text-ink">{a.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-3">
                        {tamanoLegible(a.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAdjuntos((p) => p.filter((x) => x.hash !== a.hash))}
                        disabled={trabajando}
                        aria-label={T.encargar.quitarArchivo(a.name)}
                        className="pulsable -mr-1 shrink-0 p-1"
                      >
                        <Icono nombre="cerrar" tamano={14} color="#948DAE" grosor={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-1.5 text-[11.5px] leading-[1.45] text-ink-3">
                {T.encargar.archivosPie(MAX_ADJUNTOS, tamanoLegible(topeArchivo))}
              </p>
              {avisoArchivo && <p className="mt-1 text-[11.5px] text-terra">{avisoArchivo}</p>}
            </>
          )}

          {aceptaArchivos === 'no' && (
            <p className="mt-3 text-[11.5px] leading-[1.45] text-ink-3">
              {T.encargar.sinArchivos}
            </p>
          )}

          <p className="mt-3.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
            {T.encargar.plazo}
          </p>
          <div className="mt-2 flex gap-2">
            {PLAZOS.map((p) => {
              const elegido = p.horas === horas;
              return (
                <button
                  key={p.horas}
                  type="button"
                  onClick={() => setHoras(p.horas)}
                  disabled={trabajando}
                  className={`pulsable h-11 grow rounded-xl border text-[13px] font-medium ${
                    elegido ? 'border-honey bg-honey-soft text-honey' : 'border-line text-ink-2'
                  }`}
                >
                  {T.encargar[p.unidad](p.cuantos)}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-ink-3">{T.encargar.plazoPie}</p>

          <Tarjeta>
            <Fila
              etiqueta={T.encargar.precioAgente}
              valor={`${monto(precio)} ${simbolo}`}
              color="text-ink"
            />
            <Fila
              etiqueta={T.encargar.protocolo}
              valor={`${monto(comision)} ${simbolo}`}
              color="text-ink-2"
            />
            <Fila
              etiqueta={T.encargar.bloqueasAhora}
              valor={`${monto(precio)} ${simbolo}`}
              destacada
              color="text-ink"
            />
          </Tarjeta>

          <Nota>{T.encargar.retenido}</Nota>

          <div className="mt-[18px] pb-1">
            <Boton onClick={empezar} disabled={!brief.trim() || trabajando}>
              {aprobando
                ? T.encargar.aprobandoToken
                : pagando
                  ? T.encargar.bloqueando
                  : T.encargar.bloquear(monto(precio), simbolo)}
            </Boton>
          </div>
        </>
      )}

      {/*
        Pagado. Lo que queda es que el encargo LLEGUE, y eso ya no depende de la
        cadena sino del servidor del agente. Se cuenta paso a paso porque cada
        uno puede fallar por su cuenta y el cliente tiene derecho a saber en
        cuál se quedó: el pago está bloqueado igual.
      */}
      {pagado && (
        <div className="mt-4 pb-1">
          <p className="text-[13.5px] leading-[1.55] text-ink">
            {entrega === 'enviando'
              ? T.encargar.enviandoAlAgente
              : entrega === 'subiendo'
                ? T.encargar.subiendoArchivos(adjuntos.length)
                : entrega === 'hecho'
                  ? T.encargar.entregado
                  : T.encargar.noLlego}
          </p>

          {entrega === 'fallo' && (
            <>
              {porQue && <p className="mt-1.5 text-[12.5px] leading-[1.5] text-terra">{porQue}</p>}
              <Nota tono="miel">{T.encargar.pagoASalvo}</Nota>
              <div className="mt-4 flex gap-2.5">
                <Boton variante="secundario" onClick={onHecho}>
                  {T.comun.cerrar}
                </Boton>
                <Boton
                  onClick={() => {
                    setPorQue(null);
                    setEntrega('enviando');
                  }}
                >
                  {T.encargar.reintentar}
                </Boton>
              </div>
            </>
          )}
        </div>
      )}
    </Hoja>
  );
}
