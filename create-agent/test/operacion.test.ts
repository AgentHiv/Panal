/**
 * Lo que evita que alguien pague y se quede sin respuesta, y `npm run doctor`.
 *
 *   npx tsx test/operacion.test.ts
 *
 * HERMÉTICO: los servidores que hacen falta se levantan aquí, en 127.0.0.1.
 */

import { createServer, type RequestListener, type Server } from 'node:http';
import { apagarEnOrden, conPlazo, PlazoAgotado, plazoApagadoMs, plazoX402Ms } from '../template/src/operacion.js';
import { informe, revisarEndpoint, revisarEntorno, revisarLocal } from '../template/src/doctor.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function servidor(h: RequestListener): Promise<{ server: Server; base: string }> {
  const server = createServer(h);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = server.address();
  return { server, base: `http://127.0.0.1:${typeof dir === 'object' ? dir?.port : 0}` };
}

async function main(): Promise<void> {
  console.log('── plazos ──');
  check('por defecto, 100 s', plazoX402Ms({}) === 100_000);
  check('se puede bajar para Cloudflare', plazoX402Ms({ X402_PLAZO_SEGUNDOS: '85' }) === 85_000);
  check('no pasa de lo que promete la cotización', plazoX402Ms({ X402_PLAZO_SEGUNDOS: '900' }) === 110_000);
  check('ni baja de lo razonable', plazoX402Ms({ X402_PLAZO_SEGUNDOS: '1' }) === 5_000);
  check('un valor raro es el de por defecto', plazoX402Ms({ X402_PLAZO_SEGUNDOS: 'mucho' }) === 100_000);
  check('el apagado espera 110 s', plazoApagadoMs({}) === 110_000);

  console.log('\n── conPlazo ──');
  check('devuelve lo que llega a tiempo', (await conPlazo(Promise.resolve('hola'), 100)) === 'hola');
  const lento = await conPlazo(new Promise((r) => setTimeout(() => r('tarde'), 500)), 30).catch((e: unknown) => e);
  check('corta lo que no llega', lento instanceof PlazoAgotado, String(lento));
  const propio = await conPlazo(Promise.reject(new Error('el modelo reventó')), 100).catch((e: Error) => e.message);
  check('un fallo del trabajo sigue siendo ese fallo', propio === 'el modelo reventó');
  const sueltos: unknown[] = [];
  const oyente = (e: unknown): void => void sueltos.push(e);
  process.on('unhandledRejection', oyente);
  await conPlazo(
    new Promise((_, no) => setTimeout(() => no(new Error('falla después del plazo')), 40)),
    10,
  ).catch(() => undefined);
  await espera(80);
  process.off('unhandledRejection', oyente);
  check('si falla después del plazo, no tumba el proceso', sueltos.length === 0, `${sueltos.length} sin atender`);

  console.log('\n── apagarEnOrden ──');
  {
    let ocupado = true;
    let codigo: number | null = null;
    let idles = 0;
    let cerrar: () => void = () => undefined;
    const server = {
      close: (cb?: () => void) => {
        cerrar = cb ?? (() => undefined);
        return server;
      },
      closeIdleConnections: () => void (idles += 1),
    };
    apagarEnOrden({ server: server as never, ocupado: () => ocupado, plazoMs: 5_000, salir: (c) => (codigo = c), log: () => undefined, intervaloMs: 10 });
    await espera(60);
    check('no sale mientras haya algo en curso', codigo === null);
    check('y va soltando las conexiones que no hacen nada', idles > 1, `${idles}`);
    ocupado = false;
    cerrar();
    await espera(60);
    check('al acabar y cerrar, sale limpio', codigo === 0, String(codigo));
  }
  {
    let codigo: number | null = null;
    const server = { close: () => server, closeIdleConnections: () => undefined };
    apagarEnOrden({ server: server as never, ocupado: () => true, plazoMs: 40, salir: (c) => (codigo = c), log: () => undefined, intervaloMs: 10 });
    await espera(120);
    check('con trabajo atascado, sale al agotar el plazo', codigo === 0, String(codigo));
  }

  console.log('\n── doctor: el .env ──');
  const buena = `0x${'a'.repeat(64)}`;
  const entorno = revisarEntorno({ AGENT_PRIVATE_KEY: buena, LLM_API_KEY: 'x' });
  check('con clave, nada en contra', !informe(entorno).mal, informe(entorno).texto.trim());
  check('una clave mal formada es un fallo', informe(revisarEntorno({ AGENT_PRIVATE_KEY: '0x12' })).mal);
  check('sin clave del modelo, solo un aviso', revisarEntorno({ AGENT_PRIVATE_KEY: buena }).some((f) => f.estado === 'aviso' && f.que === 'Clave del modelo'));
  check('ollama no pide clave', !revisarEntorno({ AGENT_PRIVATE_KEY: buena, LLM_PROVIDER: 'ollama' }).some((f) => f.que === 'Clave del modelo'));
  check('HOST local sin TRAS_PROXY avisa', revisarEntorno({ AGENT_PRIVATE_KEY: buena, LLM_API_KEY: 'x', HOST: '127.0.0.1' }).some((f) => f.que === 'Proxy'));
  check('con TRAS_PROXY, no', !revisarEntorno({ AGENT_PRIVATE_KEY: buena, LLM_API_KEY: 'x', HOST: '127.0.0.1', TRAS_PROXY: '1' }).some((f) => f.que === 'Proxy'));

  console.log('\n── doctor: lo que ve el mundo ──');
  const yo = '0x1111111111111111111111111111111111111111';
  const permitidas = 'content-type, x-payment, x-payment-payer';
  const agente = (o: { agent?: string; cors?: string | null; cotiza?: number } = {}): RequestListener => (req, res) => {
    if (req.method === 'OPTIONS') {
      if (o.cors !== null) {
        res.setHeader('access-control-allow-origin', 'https://panal.lat');
        res.setHeader('access-control-allow-headers', o.cors ?? permitidas);
      }
      res.writeHead(204).end();
    } else if (req.url === '/agent.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ agent: o.agent ?? yo }));
    } else if (req.url === '/health') {
      res.end('{"ok":true}');
    } else res.writeHead(o.cotiza ?? 402).end('{}');
  };
  const estadoDe = (f: { estado: string; que: string }[], que: string) => f.find((x) => x.que === que)?.estado;

  const sano = await servidor(agente());
  const a = await revisarEndpoint(sano.base, yo, true);
  check('sin https es un fallo', estadoDe(a, 'Endpoint https') === 'fallo');
  check('la dirección coincide', estadoDe(a, 'Endpoint público') === 'ok');
  check('CORS bien', estadoDe(a, 'CORS para la web') === 'ok');
  check('cotiza', estadoDe(a, 'Cotización x402') === 'ok');
  check('el agente local responde', (await revisarLocal(Number(new URL(sano.base).port))).estado === 'ok');
  sano.server.close();

  const ajeno = await servidor(agente({ agent: '0x2222222222222222222222222222222222222222' }));
  check('otra dirección es un fallo', estadoDe(await revisarEndpoint(ajeno.base, yo, false), 'Endpoint público') === 'fallo');
  ajeno.server.close();

  // El fallo de LexPanal: el servidor responde, el MCP funciona y un navegador no puede pagar.
  const sinCabeceras = await servidor(agente({ cors: 'content-type, x-panal-address' }));
  check('sin las cabeceras de pago, CORS falla', estadoDe(await revisarEndpoint(sinCabeceras.base, yo, false), 'CORS para la web') === 'fallo');
  sinCabeceras.server.close();

  const noCotiza = await servidor(agente({ cotiza: 500 }));
  check('si no cotiza, se dice', estadoDe(await revisarEndpoint(noCotiza.base, yo, true), 'Cotización x402') === 'fallo');
  noCotiza.server.close();

  const caido = await revisarEndpoint('https://127.0.0.1:1', yo, true);
  check('un endpoint caído es un fallo, sin reventar', estadoDe(caido, 'Endpoint público') === 'fallo');
  check('el agente sin arrancar es un aviso, no un fallo: se puede pasar desde otra máquina', (await revisarLocal(1)).estado === 'aviso');

  console.log('');
  if (failures === 0) console.log('✅ Operación: plazos, apagado y doctor');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

void main();
