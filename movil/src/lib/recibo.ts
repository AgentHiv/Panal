/**
 * Panal — el recibo de un cobro, y la hoja de cálculo del informe.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ESTO ACREDITA UN COBRO. NO ES UNA FACTURA, y el papel lo dice de su puño y
 * letra abajo del todo, porque va a viajar solo.
 *
 * Una factura necesita un cliente identificado y un tratamiento fiscal que
 * depende de dónde tributes. Aquí el cliente es una dirección de Monad: nadie
 * sabe quién hay detrás, ni Panal ni tú, y la app tampoco sabe qué IVA te toca.
 *
 * Y las cifras van en $PANAL o en MON, SIN CONVERTIR. Poner euros exigiría el
 * precio del token en el momento de cada cobro; ese precio lo pone un mercado,
 * se mueve, y no está en ninguna parte de esto. Escribir una cifra en euros
 * sería inventársela — que es exactamente lo que la web hacía en la página del
 * token cuando decía que no había mercado.
 *
 * Lo que sí da este papel es la prueba: cuánto entró, cuándo, de qué dirección
 * y con qué transacción se comprueba en la cadena. Con eso una gestoría emite
 * la factura que corresponda.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Se imprime, así que va en CLARO. Un A5 casi negro sale gris sucio y se bebe
 * el tóner.
 */

import type { Cuentas, Linea } from '~/lib/cuentas';
import { montoCuadro } from '~/lib/formato';

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fechaLarga(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const corta = (h: string): string => `${h.slice(0, 10)}…${h.slice(-8)}`;

export interface DatosRecibo {
  linea: Linea;
  agente: string;
  direccionAgente: string;
  /** Lo que se pidió, si está en este teléfono. Casi nunca lo está. */
  brief: string | null;
}

/** Un A5 que se imprime. Sin una sola petición de red. */
export function reciboHtml({ linea, agente, direccionAgente, brief }: DatosRecibo): string {
  const filas = [
    ['Precio del encargo', `${montoCuadro(linea.bruto)} ${linea.moneda}`, false],
    ...(linea.devuelto > 0n
      ? [['Devuelto al cliente (disputa)', `−${montoCuadro(linea.devuelto)} ${linea.moneda}`, false]]
      : []),
    ['Comisión de Panal', `−${montoCuadro(linea.comision)} ${linea.moneda}`, false],
    ['Cobrado', `${montoCuadro(linea.pagado)} ${linea.moneda}`, true],
  ]
    .map(
      ([et, cif, fuerte]) =>
        `<tr class="${fuerte ? 'total' : ''}"><td>${escapar(String(et))}</td><td class="num">${escapar(
          String(cif),
        )}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recibo · encargo ${escapar(linea.id)}</title>
<style>
  /* A5 y en claro: esto se imprime. */
  @page { size: A5; margin: 14mm; }
  body { margin: 0 auto; padding: 26px 24px 40px; max-width: 148mm; background: #FBF8F0; color: #1A1726;
         font: 14px/1.55 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  h1 { font-size: 21px; margin: 0 0 3px; letter-spacing: -0.015em; }
  .sub { color: #4A4363; font-size: 13px; margin: 0 0 22px; }
  h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: #6B6480;
       margin: 20px 0 6px; font-weight: 600; }
  .caja { border: 1px solid #DEDAD0; border-radius: 8px; padding: 12px 14px; background: #fff; }
  .mono { font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 12px; word-break: break-all; }
  .hueco { color: #8C8499; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px;
          border: 1px solid #DEDAD0; border-radius: 8px; overflow: hidden; }
  td { padding: 11px 14px; border-bottom: 1px solid #DEDAD0; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-family: ui-monospace, monospace; white-space: nowrap; }
  .total td { background: #F3EEE2; font-weight: 600; font-size: 15px; }
  .aviso { margin-top: 22px; border-top: 2px solid #DEDAD0; padding-top: 12px; }
  .aviso b { display: block; font-size: 13.5px; margin-bottom: 4px; }
  .aviso p { margin: 0; font-size: 11.5px; line-height: 1.55; color: #4A4363; }
  .dosc { display: flex; gap: 12px; }
  .dosc > div { flex: 1; min-width: 0; }
  @media print { body { background: #fff; padding: 0; } }
</style>
</head><body>

<h1>Recibo de cobro</h1>
<p class="sub">Encargo n.º ${escapar(linea.id)} · ${escapar(fechaLarga(linea.ts))}</p>

<div class="dosc">
  <div>
    <h2>Cobra</h2>
    <div class="caja">
      <div class="hueco">[TU NOMBRE O RAZÓN SOCIAL]</div>
      <div class="hueco">[NIF / VAT]</div>
      <div class="hueco">[DIRECCIÓN]</div>
      <div class="mono" style="margin-top:7px">agente ${escapar(agente)}<br>${escapar(
        corta(direccionAgente),
      )}</div>
    </div>
  </div>
  <div>
    <h2>Pagó</h2>
    <div class="caja">
      <div class="mono">${escapar(linea.cliente)}</div>
      <p style="margin:7px 0 0;font-size:11px;color:#6B6480;line-height:1.5">
        Es una dirección de Monad, no una identidad fiscal. Panal no sabe quién hay detrás.
      </p>
    </div>
  </div>
</div>

<h2>Por</h2>
<div class="caja">${
    brief
      ? escapar(brief)
      : `<span class="hueco">[DESCRIPCIÓN DEL TRABAJO]</span><p style="margin:7px 0 0;font-size:11px;color:#6B6480;line-height:1.5">El texto de lo que se pidió no está en este teléfono: la cadena solo guarda su hash, y quien lo escribió fue el cliente.</p>`
  }</div>

<table>${filas}</table>

<h2>La transacción que lo prueba</h2>
<div class="caja mono">${escapar(linea.txHash ?? '—')}</div>

${
  linea.resultHash
    ? `<h2>Huella de lo entregado</h2>
<div class="caja mono">${escapar(linea.resultHash)}</div>`
    : ''
}

<div class="aviso">
  <b>Esto acredita un cobro. No es una factura.</b>
  <p>
    Una factura necesita un cliente identificado y un tratamiento fiscal que dependen de dónde
    tributes, y aquí el cliente es una dirección. Este papel dice cuánto entró, cuándo, de dónde y
    con qué transacción se puede comprobar en la cadena — que es lo que tu gestoría necesita para
    emitir la factura que corresponda. Las cifras están en ${escapar(linea.moneda)}, sin convertir:
    su precio lo pone un mercado y cambia, así que ponerle euros aquí sería inventarse una cifra.
  </p>
</div>
</body></html>
`;
}

/**
 * El informe como hoja de cálculo.
 *
 * CSV y no PDF a propósito: esto va a una gestoría, que lo va a abrir, sumar y
 * cruzar. Un PDF sería más bonito y menos útil.
 *
 * Separador `;` y coma decimal: es lo que abre Excel en español sin preguntar
 * nada. Con `,` de separador, un Excel en es-ES mete toda la fila en una celda.
 */
export function informeCsv(cuentas: Cuentas[], agente: string, direccion: string): string {
  const es = (v: bigint): string => montoCuadro(v).replace(/\./g, '');
  const filas: string[][] = [
    ['encargo', 'fecha', 'cliente', 'moneda', 'facturado', 'devuelto', 'comision', 'cobrado', 'nota', 'transaccion', 'hash_entrega'],
  ];

  for (const c of cuentas) {
    for (const l of c.lineas) {
      filas.push([
        l.id,
        new Date(l.ts * 1000).toISOString().slice(0, 10),
        l.cliente,
        l.moneda,
        es(l.bruto),
        es(l.devuelto),
        es(l.comision),
        es(l.pagado),
        l.rating !== null ? `${l.rating} estrellas` : '',
        l.txHash ?? '',
        l.resultHash ?? '',
      ]);
    }
    filas.push([]);
    filas.push([`TOTAL ${c.moneda}`, '', '', c.moneda, es(c.bruto), es(c.devuelto), es(c.comision), es(c.neto), '', '', '']);
    filas.push([]);
  }

  filas.push([]);
  filas.push([`Agente ${agente} (${direccion}). Cifras sin convertir a euros: su precio lo pone un mercado.`]);
  filas.push(['Esto acredita cobros; no es una factura. Lo que se cobra por mensaje suelto NO aparece aquí.']);

  // Se citan siempre: un `;` dentro de un campo partiría la fila, y las notas
  // las escribe gente.
  return filas.map((f) => f.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
