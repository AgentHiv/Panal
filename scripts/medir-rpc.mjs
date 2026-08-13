#!/usr/bin/env node
/**
 * Mide un RPC de Monad contra lo que el INDEXADOR necesita de verdad.
 *
 *   node scripts/medir-rpc.mjs https://tu-rpc-candidato
 *   node scripts/medir-rpc.mjs                      # el publico, como referencia
 *
 * Se ejecuta ANTES de pagar. Un indexador no necesita un RPC rapido, necesita
 * uno que le deje pedir rangos grandes de `eth_getLogs`: es lo unico que
 * decide si reconstruir el indice desde cero tarda dos minutos o tres horas, y
 * si un dia caido se recupera o no.
 *
 * Lo que mide, y por que:
 *
 *   1. La cadena. Que sea Monad mainnet (143) y no otra cosa.
 *   2. El rango maximo de eth_getLogs. EL NUMERO QUE IMPORTA. El publico corta
 *      en 100 bloques, y con bloques de 0,30 s eso son 30 segundos de cadena
 *      por llamada.
 *   3. Cuanto aguanta en paralelo. El indexador no necesita mucho —es un solo
 *      proceso— pero si necesita que no le corten a mitad de una recuperacion.
 *   4. Latencia. Importa poco aqui, pero delata un nodo saturado.
 *
 * No firma nada ni gasta: son todo lecturas.
 */

const RPC = process.argv[2] ?? 'https://rpc.monad.xyz';

/** Segundos por bloque en Monad, medidos. Sirve para traducir bloques a tiempo. */
const SEG_POR_BLOQUE = 0.3;

async function llamada(method, params, timeoutMs = 20_000) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const cuerpo = await res.json().catch(() => ({}));
  return { status: res.status, error: cuerpo.error?.message, result: cuerpo.result };
}

function fmt(n) {
  return n.toLocaleString('es-ES');
}

console.log(`\nMidiendo ${RPC}\n${'─'.repeat(60)}`);

// ── 1. ¿Es la cadena que decimos? ──────────────────────────────────────────
const cadena = await llamada('eth_chainId', []);
if (cadena.status !== 200 || !cadena.result) {
  console.error(`  ✗ no responde (HTTP ${cadena.status}${cadena.error ? `: ${cadena.error}` : ''})`);
  process.exit(1);
}
const chainId = Number(cadena.result);
console.log(`  cadena         ${chainId}${chainId === 143 ? ' (Monad mainnet ✓)' : ' ✗ NO es Monad mainnet'}`);
if (chainId !== 143) process.exit(1);

const alturaRes = await llamada('eth_blockNumber', []);
const altura = Number(alturaRes.result);
console.log(`  altura         ${fmt(altura)}`);

// ── 2. El rango maximo de getLogs. Busqueda binaria. ───────────────────────
//
// Se prueba sin filtro de direccion a proposito: algunos proveedores dan
// rangos mas grandes cuando filtras, y aqui interesa el caso peor.
async function aceptaRango(bloques) {
  const r = await llamada('eth_getLogs', [
    { fromBlock: `0x${(altura - bloques).toString(16)}`, toBlock: `0x${altura.toString(16)}` },
  ]);
  return r.status === 200 && !r.error;
}

let bajo = 1;
let alto = 200_000;
if (!(await aceptaRango(bajo))) {
  console.log('  getLogs        ✗ rechaza hasta un rango de 1 bloque');
  process.exit(1);
}
if (await aceptaRango(alto)) {
  bajo = alto;
} else {
  while (alto - bajo > Math.max(50, bajo * 0.05)) {
    const medio = Math.floor((bajo + alto) / 2);
    if (await aceptaRango(medio)) bajo = medio;
    else alto = medio;
  }
}
const minutosCadena = (bajo * SEG_POR_BLOQUE) / 60;
console.log(`  getLogs        hasta ${fmt(bajo)} bloques por llamada  (${minutosCadena.toFixed(1)} min de cadena)`);

// Lo que eso significa en trabajo real.
const desdeDespliegue = altura - 91_000_000; // aproximado; solo para dar magnitud
const llamadasBackfill = Math.ceil(Math.max(desdeDespliegue, 1) / bajo);
console.log(
  `                 reconstruir el indice ≈ ${fmt(llamadasBackfill)} llamadas ` +
    `(${(llamadasBackfill / 5 / 60).toFixed(0)} min a 5/s)`,
);

// ── 3. ¿Cuanto aguanta a la vez? ───────────────────────────────────────────
for (const n of [25, 100]) {
  const t0 = Date.now();
  const res = await Promise.all(Array.from({ length: n }, () => llamada('eth_blockNumber', [])));
  const ok = res.filter((r) => r.status === 200 && !r.error).length;
  const cortadas = res.filter((r) => r.status === 429).length;
  console.log(
    `  ${String(n).padStart(3)} en paralelo  ${ok}/${n} servidas` +
      `${cortadas ? `, ${cortadas} con 429` : ''}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
}

// ── 4. Latencia de una lectura normal ──────────────────────────────────────
const tiempos = [];
for (let i = 0; i < 5; i++) {
  const t0 = Date.now();
  await llamada('eth_blockNumber', []);
  tiempos.push(Date.now() - t0);
}
tiempos.sort((a, b) => a - b);
console.log(`  latencia       mediana ${tiempos[2]} ms, peor ${tiempos[4]} ms`);

console.log(`${'─'.repeat(60)}`);
console.log('Lo que hay que mirar es la linea de getLogs: es la que decide');
console.log('si el indexador puede recuperarse de una caida.\n');
