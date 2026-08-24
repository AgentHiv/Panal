import { useState } from 'react';
import { formatUnits } from 'viem';
import { EXPLORER_TX, activeChain } from '@/contracts/config';
import Hoja, { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { cuentaDe } from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';
import { maximo, revisar } from '~/lib/envio';
import type { Moneda } from '~/lib/envio';
import { enviar, esperar } from '~/lib/enviar';
import type { Par } from '~/lib/usarSaldos';
import { conDecimales } from '~/lib/usarSaldos';
import { exacto, troceada } from '~/lib/formato';

/**
 * Mandar dinero desde una wallet del llavero.
 *
 * Dos pasos, y el segundo no es un adorno. En el resto de la app quien enseña
 * lo que se firma es la wallet de la persona, que se abre encima con su propia
 * pantalla. Aquí la clave está dentro y no se abre nada: si esta hoja no
 * enseña la dirección ENTERA antes de firmar, no la enseña nadie. Por eso el
 * paso de confirmar existe y por eso el destino va sin recortar.
 *
 * Las pegas se calculan en `lib/envio.ts` y se enseñan mientras se escribe, no
 * al pulsar. Enterarse de que falta MON para la comisión después de firmar es
 * enterarse cuando ya da igual.
 */
export default function HojaEnviar({
  wallet,
  llave,
  saldos,
  onCerrar,
  onHecho,
}: {
  wallet: WalletGuardada;
  llave: Llave;
  saldos: Par;
  onCerrar: () => void;
  onHecho: () => void;
}): React.ReactElement {
  const [moneda, setMoneda] = useState<Moneda>('MON');
  const [destino, setDestino] = useState('');
  const [importe, setImporte] = useState('');
  const [paso, setPaso] = useState<'escribir' | 'confirmar' | 'yendo' | 'hecho'>('escribir');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [pega, setPega] = useState<string | null>(null);

  const chequeo = revisar({
    moneda,
    importe,
    destino,
    mio: wallet.direccion,
    saldoMon: saldos.mon,
    saldoPanal: saldos.panal,
  });

  const saldo = moneda === '$PANAL' ? saldos.panal : saldos.mon;

  const alPegar = async (): Promise<void> => {
    try {
      const texto = await navigator.clipboard.readText();
      if (texto.trim()) setDestino(texto.trim());
    } catch {
      /* sin permiso de portapapeles: se escribe a mano y ya está */
    }
  };

  const alTodo = (): void => {
    const m = maximo(moneda, saldos.mon, saldos.panal);
    // Con la coma, que es lo que la casilla acepta y lo que se lee en español.
    setImporte(formatUnits(m, 18).replace('.', ','));
  };

  const alFirmar = async (): Promise<void> => {
    setPaso('yendo');
    setPega(null);
    const cuenta = await cuentaDe(llave, wallet.id);
    const r = await enviar({
      cuenta,
      moneda,
      wei: chequeo.wei,
      destino: destino.trim() as `0x${string}`,
    });
    if (!r.ok) {
      setPega(r.pega);
      setPaso('confirmar');
      return;
    }
    setHash(r.hash);
    try {
      const bien = await esperar(r.hash);
      if (!bien) {
        setPega('La red la ha rechazado al ejecutarla. No se ha movido nada.');
        setPaso('confirmar');
        return;
      }
    } catch {
      // El hash existe: la transacción está mandada aunque no la hayamos visto
      // entrar. Decir «ha fallado» aquí sería mentir, y peligroso: alguien
      // volvería a mandarla.
    }
    setPaso('hecho');
    onHecho();
  };

  /* ── ya está mandada ───────────────────────────────────────────────────── */

  if (paso === 'hecho' || paso === 'yendo') {
    return (
      <Hoja
        abierta
        titulo={paso === 'hecho' ? 'Mandado' : 'Mandando…'}
        onCerrar={onCerrar}
        bloqueada={paso === 'yendo'}
      >
        <div className="flex flex-col items-center py-6">
          {paso === 'hecho' ? (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-olive/15">
              <Icono nombre="check" tamano={26} color="#92A268" grosor={2.4} />
            </span>
          ) : (
            <span className="h-14 w-14 animate-pulse rounded-full bg-sand" />
          )}
          <p className="mt-4 font-mono text-[22px] font-medium">
            {exacto(chequeo.wei)} {moneda}
          </p>
          <p className="mt-1.5 text-[12.5px] text-ink-3">a {corta(destino.trim())}</p>
        </div>

        {hash && (
          <a
            href={EXPLORER_TX(hash)}
            target="_blank"
            rel="noreferrer"
            className="pulsable tocable flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
          >
            <Icono nombre="fuera" tamano={15} color="#948DAE" />
            Verla en el explorador
          </a>
        )}

        {paso === 'hecho' && (
          <div className="mt-2.5 pb-1">
            <Boton onClick={onCerrar}>Listo</Boton>
          </div>
        )}
        {paso === 'yendo' && (
          <Nota>
            No cierres la app. Si tarda, la transacción ya está mandada: se ve en el explorador con
            el enlace de arriba.
          </Nota>
        )}
      </Hoja>
    );
  }

  /* ── confirmar ─────────────────────────────────────────────────────────── */

  if (paso === 'confirmar') {
    return (
      <Hoja abierta titulo="Repásalo" onCerrar={onCerrar}>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
          Se firma con la clave de este teléfono, así que no se va a abrir ninguna otra app a
          enseñártelo. Esto es lo que se manda.
        </p>

        <div className="mt-4 rounded-[14px] border border-line p-3.5">
          <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">A esta dirección</p>
          <p className="seleccionable mt-2 font-mono text-[13.5px] leading-[1.7] tracking-[0.02em]">
            {troceada(destino.trim())}
          </p>
        </div>

        <Tarjeta>
          {/* Sin redondear: lo que se lee aquí es exactamente lo que se firma. */}
          <Fila etiqueta="Cantidad" valor={`${exacto(chequeo.wei)} ${moneda}`} destacada />
          <Fila etiqueta="Desde" pie={wallet.nombre} valor={corta(wallet.direccion)} />
          <Fila etiqueta="Red" valor={activeChain.name} />
          <Fila etiqueta="Comisión de red" pie="La paga esta wallet" valor="En MON" />
        </Tarjeta>

        <Nota tono="miel">
          Una vez mandado no hay quien lo devuelva, ni Panal ni nadie. Si esa dirección no es, el
          dinero se queda donde caiga.
        </Nota>

        {pega && <p className="mt-3 text-[12.5px] leading-[1.5] text-terra">{pega}</p>}

        <div className="mt-[18px] flex gap-2.5 pb-1">
          <div className="grow">
            <Boton variante="secundario" onClick={() => setPaso('escribir')}>
              Atrás
            </Boton>
          </div>
          <div className="grow-[1.6]">
            <Boton onClick={() => void alFirmar()}>Firmar y mandar</Boton>
          </div>
        </div>
      </Hoja>
    );
  }

  /* ── escribir ──────────────────────────────────────────────────────────── */

  return (
    <Hoja abierta titulo={`Mandar desde ${wallet.nombre}`} onCerrar={onCerrar}>
      <div className="mt-3.5 flex gap-2">
        {(['MON', '$PANAL'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMoneda(m)}
            className={`pulsable tocable grow rounded-full border py-2.5 text-[13.5px] font-semibold ${
              moneda === m ? 'border-monad bg-monad/15 text-ink' : 'border-line text-ink-3'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">
        Tienes {conDecimales(saldo, 18)} {moneda} en esta wallet.
      </p>

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        A quién
      </label>
      <div className="mt-2 flex gap-2">
        <input
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          placeholder="0x…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 grow rounded-[12px] border border-line bg-cream px-3.5 py-3 font-mono text-[13px] outline-none placeholder:text-ink-3 focus:border-monad"
        />
        <button
          type="button"
          onClick={() => void alPegar()}
          className="pulsable tocable shrink-0 rounded-[12px] border border-line px-3.5 text-[13px] font-medium text-ink-2"
        >
          Pegar
        </button>
      </div>

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        Cuánto
      </label>
      <div className="mt-2 flex gap-2">
        <input
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          className="min-w-0 grow rounded-[12px] border border-line bg-cream px-3.5 py-3 font-mono text-[16px] outline-none placeholder:text-ink-3 focus:border-monad"
        />
        <button
          type="button"
          onClick={alTodo}
          className="pulsable tocable shrink-0 rounded-[12px] border border-line px-3.5 text-[13px] font-medium text-ink-2"
        >
          Todo
        </button>
      </div>

      {/* La pega aparece mientras se escribe, y solo cuando ya hay algo que
          juzgar: gritarle «falta la dirección» a una casilla vacía que acabas
          de abrir no ayuda a nadie. */}
      {(destino.trim() || importe.trim()) && chequeo.pega && (
        <p className="mt-3 text-[12.5px] leading-[1.5] text-terra">{chequeo.pega}</p>
      )}
      {chequeo.aviso && <Nota tono="miel">{chequeo.aviso}</Nota>}

      {moneda === 'MON' && (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-ink-3">
          «Todo» deja una pizca de MON para la comisión de red. Sin ella la transacción no sale.
        </p>
      )}

      <div className="mt-[18px] pb-1">
        <Boton onClick={() => setPaso('confirmar')} disabled={!chequeo.ok}>
          Continuar
        </Boton>
      </div>
    </Hoja>
  );
}

function corta(dir: string): string {
  return dir.length > 12 ? `${dir.slice(0, 8)}…${dir.slice(-6)}` : dir;
}
