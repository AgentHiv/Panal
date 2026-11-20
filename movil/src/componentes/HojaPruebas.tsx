/**
 * Las pruebas de una disputa, en la app. Las mismas que las del panel de la web
 * (`src/components/dashboard/PruebasDeLaDisputa.tsx`) y sobre la misma librería
 * (`src/lib/pruebas.ts`). Aquí solo para las partes: los jueces preguntan y
 * deciden desde la web.
 *
 * Las reglas de la v2:
 *   - todo va cifrado para los cinco del expediente con clave (las dos partes y
 *     los jueces), quien escribe incluido: sin clave no se escribe, y se activa
 *     desde aquí;
 *   - los jueces preguntan y piden el encargo o la entrega; la parte los aporta
 *     con su texto EXACTO, que se compara con la cadena;
 *   - desde aquí no se adjunta nada: solo se habla y se aporta lo anclado;
 *   - a quien activa su clave tarde le da acceso cualquiera del expediente.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useReadContract, useSignMessage } from 'wagmi';
import { MAX_PIEZA_CHARS, anclaDeLaPieza, cuerpoDePieza, type Acceso, type Destinatario } from '@panal/sdk';
import { useWallet } from '@/hooks/useWallet';
import { panalEscrowV2Abi } from '@/contracts/abis';
import { PANAL_ESCROW_V2_ADDRESS, activeChain } from '@/contracts/config';
import { abrirBytes, abrirTexto, clavePublicaDe, darAccesoA, leerArbitros, publicarMiClave } from '@/lib/cifrado';
import {
  abrirPieza,
  aportarPieza,
  bajarArchivoDePruebas,
  buzonDePruebas,
  credencialDePruebas,
  destinatariosDePruebas,
  faltanPorAcceso,
  leerPruebas,
  marcarAnclados,
  objetosParaDarAcceso,
  puedeEscribir,
  sigueValiendo,
  type ArchivoDePiezaLegible,
  type CredencialDePruebas,
  type PiezaLegible,
} from '@/lib/pruebas';
import { puedeAportar, textoAncladoParaAportar, type QueAnclado } from '@/lib/ancladoParaPruebas';
import { formatBytes } from '@/lib/deliveredFiles';
import { guardarArchivo } from '~/lib/copia';
import { useTextos } from '~/i18n/idiomas';
import Hoja from './Hoja';
import Icono from './Icono';

type Parte = 'cliente' | 'trabajador';
const ES_SOBRE = '{"v":"panal-cifrado-1"';

export default function HojaPruebas({
  encargo,
  botUrl = null,
  onCerrar,
}: {
  /**
   * `id` es la tarea del escrow. En una del tablón con reglas, `client` es el
   * cliente de su encargo (no el contrato) y `jobId` ese encargo: el buzón saca
   * de él quién es el cliente de verdad.
   */
  encargo: { id: bigint; client: Address; worker: Address; jobId?: bigint };
  /**
   * El endpoint registrado de quien trabaja (su buzón o su servidor): de ahí se
   * pide el encargo o la entrega cuando este teléfono no guarda copia.
   */
  botUrl?: string | null;
  onCerrar: () => void;
}): React.ReactElement {
  const T = useTextos();
  const P = T.pruebas;
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const firmar = useCallback((mensaje: string) => signMessageAsync({ message: mensaje }), [signMessageAsync]);
  const base = buzonDePruebas(encargo.worker);
  const delTablon = encargo.jobId !== undefined;

  // Las huellas de la tarea: con ellas se comprueba el encargo y la entrega.
  const { data: enCadena } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'tasks',
    args: [encargo.id],
    chainId: activeChain.id,
    query: { retry: 1 },
  });
  const huellas = useMemo(() => {
    const r = enCadena as unknown as { taskHash?: Hex; resultHash?: Hex } | undefined;
    return r?.taskHash && r.resultHash ? { taskHash: r.taskHash, resultHash: r.resultHash } : undefined;
  }, [enCadena]);

  const [cred, setCred] = useState<CredencialDePruebas | null>(null);
  const [estado, setEstado] = useState<'inicio' | 'firmando' | 'cargando' | 'listo' | 'caducada' | 'error'>('inicio');
  const [piezas, setPiezas] = useState<PiezaLegible[]>([]);
  /** El texto en claro de un encargo o una entrega que se ancló cifrada, por índice. */
  const [claros, setClaros] = useState<Record<number, string>>({});
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [plazo, setPlazo] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [jueces, setJueces] = useState<Address[]>([]);
  /** Para quién se cifra: todos los del expediente con clave. */
  const [para, setPara] = useState<Destinatario[] | undefined>(undefined);
  const [sinClave, setSinClave] = useState<Address[]>([]);
  const [borrador, setBorrador] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [activando, setActivando] = useState(false);
  const [dandoAcceso, setDandoAcceso] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; bien?: boolean } | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const [ahoraS, setAhoraS] = useState(() => Math.floor(Date.now() / 1000));

  const yo = (address ?? '') as Address;
  const miRol: Parte = yo.toLowerCase() === encargo.client.toLowerCase() ? 'cliente' : 'trabajador';

  const cargar = useCallback(
    async (c: CredencialDePruebas) => {
      if (!address) return;
      const e = await leerPruebas(base, encargo.id, c);
      const abrir = async (sobre: string, acc: Acceso[]) => (await abrirTexto(sobre, address as Address, firmar, acc)).legible;
      const abiertas = await Promise.all(e.piezas.map((p) => abrirPieza(encargo.id, p, e.archivos, e.accesos, abrir)));
      // Un encargo o una entrega que se anclaron cifrados: lo que se compara
      // con la cadena es el sobre; lo que se lee, lo de dentro (con un acceso).
      const dentro: Record<number, string> = {};
      for (const [i, p] of abiertas.entries()) {
        if ((p.tipo === 'encargo' || p.tipo === 'entrega') && p.texto?.startsWith(ES_SOBRE)) {
          const legible = await abrir(p.texto, e.accesos).catch(() => null);
          if (legible !== null) dentro[i] = legible;
        }
      }
      setPiezas(abiertas);
      setClaros(dentro);
      setAccesos(e.accesos);
      setPlazo(e.plazo);
      setAbierto(e.abierto);
    },
    [address, base, encargo.id, firmar],
  );

  // Lo anclado se comprueba aquí, con las huellas de la cadena: el encargo y la
  // entrega contra su hash, y los archivos contra lo que dicen ellos.
  const vistas = useMemo(
    () =>
      marcarAnclados(
        piezas.map((p) => ({
          ...p,
          ancla:
            huellas && (p.tipo === 'encargo' || p.tipo === 'entrega') && p.texto !== null
              ? anclaDeLaPieza(cuerpoDePieza({ tipo: p.tipo, texto: p.texto }), huellas)
              : null,
        })),
      ),
    [piezas, huellas],
  );

  const destinatarios = useCallback(
    async (lista: Address[]) => {
      const d = await destinatariosDePruebas(encargo.client, encargo.worker, lista, (a) => clavePublicaDe(a));
      setPara(d.para);
      setSinClave(d.sinClave);
      return d.para;
    },
    [encargo.client, encargo.worker],
  );

  const empezar = async (): Promise<void> => {
    if (!address) return;
    setAviso(null);
    setEstado('firmando');
    try {
      const c = await credencialDePruebas(encargo.id, address, firmar, encargo.jobId);
      setCred(c);
      setEstado('cargando');
      const lista = await leerArbitros();
      setJueces(lista);
      await Promise.all([destinatarios(lista), cargar(c)]);
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

  const activarClave = async (): Promise<void> => {
    if (!address) return;
    setActivando(true);
    setAviso(null);
    try {
      await publicarMiClave(address as Address, firmar);
      await destinatarios(jueces);
      setAviso({ texto: P.claveActivada, bien: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) setAviso({ texto: P.claveError });
    } finally {
      setActivando(false);
    }
  };

  /** Escribe una pieza. Si alguien publicó su clave entretanto, rehace la lista y reintenta una vez. */
  const escribir = async (que: string, o: { texto: string; tipo?: 'mensaje' | QueAnclado }): Promise<boolean> => {
    if (!cred || !address || enviando) return false;
    if (!sigueValiendo(cred)) {
      setEstado('caducada');
      return false;
    }
    setEnviando(que);
    setAviso(null);
    const enviar = (destino: Destinatario[] | undefined) =>
      aportarPieza({ base, taskId: encargo.id, texto: o.texto, archivos: [], para: destino ?? null, cred, yo, firmar, tipo: o.tipo });
    try {
      try {
        await enviar(para);
      } catch (err) {
        if (!(err instanceof Error) || err.message !== 'missing recipients') throw err;
        await enviar(await destinatarios(jueces));
      }
      await cargar(cred);
      return true;
    } catch (err) {
      const detalle = err instanceof Error ? (err.message.split('\n')[0] ?? '') : '';
      if (/reject|denied|user/i.test(detalle)) setAviso(null);
      else if (detalle === 'sin-clave') setAviso({ texto: P.sinClaveMia });
      else if (/evidence period over/.test(detalle)) setAviso({ texto: P.plazoCerrado });
      else setAviso({ texto: P.errorAportar(detalle) });
      return false;
    } finally {
      setEnviando(null);
    }
  };

  const enviarMensaje = async (): Promise<void> => {
    const texto = borrador.trim();
    if (!texto) return;
    if (await escribir('mensaje', { texto })) {
      setBorrador('');
      setAviso({ texto: P.aportada, bien: true });
    }
  };

  /** Aporta el encargo o la entrega: la copia de este teléfono o, si no, la que da el buzón o el agente. */
  const compartir = async (que: QueAnclado): Promise<void> => {
    if (!huellas || !address || enviando) return;
    setEnviando(que);
    setAviso(null);
    let texto: string | null = null;
    try {
      texto = await textoAncladoParaAportar({ que, rol: miRol, taskId: encargo.id, huellas, botUrl, delTablon, yo, firmar });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/reject|denied|user/i.test(msg)) {
        setEnviando(null);
        return;
      }
    }
    setEnviando(null);
    if (!texto) {
      setAviso({ texto: P.sinCopia });
      return;
    }
    if (!(await escribir(que, { texto, tipo: que }))) return;
    // Si lo anclado era un sobre, quien lea necesita además un acceso para abrirlo.
    if (texto.startsWith(ES_SOBRE) && para && cred) {
      await darAccesoA({ base, id: encargo.id, objetos: [texto], accesos, para, cuenta: yo, firmar, job: encargo.jobId }).catch(() => 0);
      await cargar(cred).catch(() => {});
    }
    setAviso({ texto: P.compartido, bien: true });
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
      if (!r.ok && !r.cancelado) setAviso({ texto: r.porque });
    } catch {
      setAviso({ texto: P.archivoError(a.name) });
    } finally {
      setBajando(null);
    }
  };

  // Quien tiene clave y no puede abrir algo que esta cuenta sí: los que la
  // activaron tarde. Cualquiera del expediente puede darles acceso.
  const faltan = para ? faltanPorAcceso(vistas, para).filter((d) => d.cuenta.toLowerCase() !== yo.toLowerCase()) : [];
  const darAcceso = async (): Promise<void> => {
    if (!cred || !address) return;
    setDandoAcceso(true);
    try {
      const objetos = await objetosParaDarAcceso({ base, taskId: encargo.id, piezas: vistas, cred });
      const n = await darAccesoA({ base, id: encargo.id, objetos, accesos, para: faltan, cuenta: yo, firmar, job: encargo.jobId });
      setAviso({ texto: P.accesoDado(n), bien: true });
      await cargar(cred);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/reject|denied|user/i.test(msg)) setAviso({ texto: P.accesoNo });
    } finally {
      setDandoAcceso(false);
    }
  };

  const fecha = (cuando: string | number): string =>
    new Date(cuando).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dias = Math.max(0, (plazo - ahoraS) / 86_400).toFixed(1);
  const puedo = puedeEscribir(para, yo);
  const sinAbrir = vistas.filter((p) => p.texto === null).length;
  const numeroDeJuez = (a: string) => String(jueces.findIndex((j) => j.toLowerCase() === a.toLowerCase()) + 1 || '?');

  /** Quién es el autor de una pieza, dicho para quien lee. */
  const quien = (p: PiezaLegible): string => {
    if (p.autor.toLowerCase() === yo.toLowerCase()) return P.tu;
    if (p.de === 'juez') return P.juez(numeroDeJuez(p.autor));
    return p.de === 'cliente' ? P.cliente : P.trabajador;
  };
  const nombreDe = (a: Address): string =>
    a.toLowerCase() === encargo.client.toLowerCase()
      ? P.cliente
      : a.toLowerCase() === encargo.worker.toLowerCase()
        ? P.trabajador
        : P.juez(numeroDeJuez(a));

  // Lo que los jueces le han pedido a esta parte y todavía no ha llegado.
  const pendientes = (['encargo', 'entrega'] as const).filter((que) => {
    let pedida = -1;
    vistas.forEach((p, i) => {
      if (p.de === 'juez' && p.tipo === 'peticion' && p.dirigida === miRol && p.pide === que) pedida = i;
    });
    if (pedida < 0) return false;
    return !vistas.some((p, i) => i > pedida && p.de === miRol && p.tipo === que && p.ancla === 'coincide');
  });
  const ofrecer = (que: QueAnclado) => puedeAportar({ que, rol: miRol, taskId: encargo.id, huellas, botUrl, delTablon });
  const yaAportado = (que: QueAnclado) => vistas.some((p) => p.de === miRol && p.tipo === que && p.ancla === 'coincide');

  const botonChico =
    'pulsable tocable rounded-full border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-2 disabled:opacity-50';
  const etiqueta = 'rounded-full bg-paper px-2 py-0.5 text-[10.5px] font-semibold';

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
          <p className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-olive">
            <Icono nombre="candado" tamano={12} color="currentColor" className="mt-[2px] shrink-0" />
            {P.cifrado}
          </p>
          {sinClave.length > 0 && <p className="text-[11.5px] leading-[1.45] text-ink-3">{P.faltanClave(sinClave.map(nombreDe).join(', '))}</p>}
          {sinAbrir > 0 && <p className="text-[11.5px] leading-[1.45] text-terra">{P.sinAbrir(sinAbrir)}</p>}

          {/* Lo que te han pedido los jueces */}
          {abierto && pendientes.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[14px] border border-honey-line bg-honey-soft p-3">
              {pendientes.map((que) => (
                <div key={que} className="flex flex-col gap-1.5">
                  <p className="text-[13px] text-ink">{que === 'encargo' ? P.teHanPedidoEncargo : P.teHanPedidoEntrega}</p>
                  {ofrecer(que) ? (
                    <button type="button" disabled={!puedo || enviando !== null} onClick={() => void compartir(que)} className={`${botonChico} self-start bg-paper`}>
                      {enviando === que ? P.aportando : que === 'encargo' ? P.compartirEncargo : P.compartirEntrega}
                    </button>
                  ) : (
                    <p className="text-[11.5px] text-ink-3">{P.sinCopia}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="max-h-[46vh] min-h-[9rem] overflow-y-auto rounded-[14px] border border-line bg-paper p-3">
            {vistas.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-3">{P.vacio}</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {vistas.map((p, i) => (
                  <li key={`${p.recibida}-${i}`} className={`rounded-[14px] border bg-cream p-3 ${p.de === 'juez' ? 'border-monad/40' : 'border-line'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="text-[11.5px] font-medium text-ink-2">
                        {quien(p)}
                        {p.dirigida && <span className="font-normal text-ink-3"> → {p.dirigida === miRol ? P.tu : p.dirigida === 'cliente' ? P.cliente : P.trabajador}</span>}
                        <span className="font-normal text-ink-3"> · {fecha(p.fecha)}</span>
                      </p>
                      <span className={`text-[10.5px] ${p.firmaOk ? 'text-olive' : 'text-terra'}`}>{p.firmaOk ? P.firmaOk : P.firmaMal}</span>
                    </div>

                    {(p.tipo === 'encargo' || p.tipo === 'entrega' || p.auto) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {p.tipo === 'encargo' && <span className={`${etiqueta} text-ink-2`}>{P.tipoEncargo}</span>}
                        {p.tipo === 'entrega' && <span className={`${etiqueta} text-ink-2`}>{P.tipoEntrega}</span>}
                        {p.ancla === 'coincide' && <span className={`${etiqueta} text-olive`}>✓ {P.anclaOk}</span>}
                        {p.ancla === 'no-coincide' && <span className={`${etiqueta} text-terra`}>✗ {P.anclaMal}</span>}
                        {p.auto && <span className={`${etiqueta} font-normal text-ink-3`}>{P.auto}</span>}
                      </div>
                    )}

                    {p.texto === null ? (
                      <p className="mt-1.5 text-[12.5px] italic text-ink-3">{P.noLegible}</p>
                    ) : p.tipo === 'peticion' ? (
                      <p className="mt-1.5 text-[13.5px] font-medium leading-[1.5] text-ink">
                        {p.pide === 'entrega'
                          ? p.dirigida === 'cliente'
                            ? P.pideEntregaCliente
                            : P.pideEntregaTrabajador
                          : p.dirigida === 'cliente'
                            ? P.pideEncargoCliente
                            : P.pideEncargoTrabajador}
                        {p.texto ? <span className="mt-1 block font-normal text-ink-2">{p.texto}</span> : null}
                      </p>
                    ) : (
                      <p className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[13.5px] leading-[1.5] text-ink">{claros[i] ?? p.texto}</p>
                    )}

                    {p.archivos.map((a) =>
                      a.anclado ? (
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
                      ) : (
                        <p key={a.hash} className="mt-1.5 flex items-center gap-2 rounded-[10px] border border-dashed border-line px-2.5 py-1.5 text-[12px] text-ink-3">
                          <span className="min-w-0 truncate">{a.name}</span>
                          <span className="ml-auto shrink-0 text-terra">{P.noAnclado}</span>
                        </p>
                      ),
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {aviso && <p className={`text-[12.5px] ${aviso.bien ? 'text-olive' : 'text-terra'}`}>{aviso.texto}</p>}

          {faltan.length > 0 && (
            <button type="button" onClick={() => void darAcceso()} disabled={dandoAcceso} className={botonChico}>
              {P.darAcceso(faltan.length)}
            </button>
          )}

          {estado === 'caducada' ? (
            <button type="button" onClick={() => void empezar()} className={botonChico}>
              {P.firmarOtraVez}
            </button>
          ) : !abierto ? (
            <p className="text-[12.5px] text-ink-3">{P.cerrado}</p>
          ) : !puedo ? (
            // Sin clave no se escribe: lo que se escribe va cifrado para todos, quien escribe incluido.
            <div className="flex flex-col gap-2 rounded-[14px] border border-honey-line bg-honey-soft p-3">
              <p className="text-[12.5px] leading-[1.5] text-ink-2">{P.sinClaveMia}</p>
              <button type="button" onClick={() => void activarClave()} disabled={activando} className={`${botonChico} self-start bg-paper`}>
                {activando ? P.firmando : P.activarClave}
              </button>
            </div>
          ) : (
            <>
              {(['encargo', 'entrega'] as const).some((q) => ofrecer(q) && !yaAportado(q)) && (
                <div className="flex flex-wrap gap-1.5">
                  {(['encargo', 'entrega'] as const)
                    .filter((q) => ofrecer(q) && !yaAportado(q))
                    .map((q) => (
                      <button key={q} type="button" disabled={enviando !== null} onClick={() => void compartir(q)} className={botonChico}>
                        {enviando === q ? P.aportando : q === 'encargo' ? P.compartirEncargo : P.compartirEntrega}
                      </button>
                    ))}
                  <p className="w-full text-[10.5px] leading-[1.45] text-ink-3">{P.compartirNota}</p>
                </div>
              )}
              <p className="text-[11.5px] leading-[1.45] text-ink-3">{vistas.some((p) => p.de === miRol) ? P.otra : P.primera}</p>
              <textarea
                value={borrador}
                onChange={(e) => setBorrador(e.target.value.slice(0, MAX_PIEZA_CHARS))}
                rows={4}
                placeholder={P.escribe}
                className="min-w-0 resize-none rounded-[14px] border border-line bg-paper px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                onClick={() => void enviarMensaje()}
                disabled={enviando !== null || !borrador.trim()}
                className="pulsable tocable h-11 rounded-full bg-monad px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
              >
                {enviando === 'mensaje' ? P.aportando : P.aportar}
              </button>
              <p className="text-[10.5px] leading-[1.45] text-ink-3">{P.firmaNota}</p>
            </>
          )}
        </div>
      )}
    </Hoja>
  );
}
