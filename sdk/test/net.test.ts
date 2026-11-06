/**
 * El fetch del RPC: espera cuando el RPC dice 429, y solo entonces.
 *
 * Lo que tiene que quedar demostrado:
 *   - un 429 se reintenta, con la espera que pida `Retry-After`;
 *   - cualquier otra respuesta pasa tal cual, a la primera: los fallos de
 *     verdad los decide viem, no esto;
 *   - hay un final: si el RPC sigue diciendo 429, se devuelve ese 429;
 *   - si quien llama aborta (el plazo de viem), no se queda esperando.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchQueEsperaAlRpc } from '../src/net.js';

/** Un RPC de mentira que responde lo que se le diga, en orden. */
function rpc(respuestas: { status: number; retryAfter?: string }[]) {
  let llamadas = 0;
  const base = (async () => {
    const r = respuestas[Math.min(llamadas, respuestas.length - 1)]!;
    llamadas++;
    return new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', {
      status: r.status,
      headers: r.retryAfter === undefined ? {} : { 'retry-after': r.retryAfter },
    });
  }) as typeof fetch;
  return { base, llamadas: () => llamadas };
}

test('un 429 se reintenta hasta que el RPC contesta', async () => {
  const { base, llamadas } = rpc([{ status: 429 }, { status: 429 }, { status: 200 }]);
  const res = await fetchQueEsperaAlRpc(base, { baseMs: 1 })('https://rpc.prueba', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(llamadas(), 3);
});

test('respeta Retry-After', async () => {
  const { base, llamadas } = rpc([{ status: 429, retryAfter: '0' }, { status: 200 }]);
  const antes = Date.now();
  // Con una base de 10 s, solo vuelve enseguida si obedece al «0».
  const res = await fetchQueEsperaAlRpc(base, { baseMs: 10_000 })('https://rpc.prueba');
  assert.equal(res.status, 200);
  assert.equal(llamadas(), 2);
  assert.ok(Date.now() - antes < 1000);
});

test('cualquier otra respuesta pasa a la primera', async () => {
  for (const status of [200, 400, 403, 500, 503]) {
    const { base, llamadas } = rpc([{ status }]);
    const res = await fetchQueEsperaAlRpc(base, { baseMs: 1 })('https://rpc.prueba');
    assert.equal(res.status, status);
    assert.equal(llamadas(), 1, `un ${status} no se reintenta aquí`);
  }
});

test('si el RPC sigue diciendo 429, se devuelve el 429', async () => {
  const { base, llamadas } = rpc([{ status: 429 }]);
  const res = await fetchQueEsperaAlRpc(base, { intentos: 3, baseMs: 1 })('https://rpc.prueba');
  assert.equal(res.status, 429);
  assert.equal(llamadas(), 4, 'la primera más tres reintentos');
});

test('si quien llama aborta, deja de esperar', async () => {
  const { base, llamadas } = rpc([{ status: 429 }]);
  const plazo = new AbortController();
  setTimeout(() => plazo.abort(new Error('plazo')), 20);
  await assert.rejects(
    fetchQueEsperaAlRpc(base, { baseMs: 10_000 })('https://rpc.prueba', { signal: plazo.signal }),
    /plazo/,
  );
  assert.equal(llamadas(), 1);
});
