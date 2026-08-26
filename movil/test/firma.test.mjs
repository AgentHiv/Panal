/**
 * La hoja de firmar se va al FIRMAR, no al contestar el agente.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * `payAndAsk` hace dos cosas seguidas en una sola llamada: firma el permiso
 * —instantáneo con la wallet del teléfono— y después manda la petición al
 * agente, que cobra, trabaja y contesta. Eso segundo tarda de segundos a un
 * minuto largo, y la hoja se quedaba puesta y bloqueada durante las dos: tras
 * firmar seguías mirando un botón que decía «Esperando…», sin el hilo detrás y
 * sin el mensaje que acababas de pagar a la vista.
 *
 * Lo que se comprueba aquí es la frontera: que el aviso salga entre las dos
 * cosas y no antes ni después, y que rechazar la firma no lo dispare — si no
 * se firmó, no se mandó nada y la hoja se tiene que quedar donde está.
 * ───────────────────────────────────────────────────────────────────────────
 */
const { avisandoAlFirmar } = await import('../src/lib/firma.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una wallet de mentira que apunta lo que le piden, como haría viem. */
function walletDeMentira({ tardaEnFirmar = 0, rechaza = false } = {}) {
  const pedido = [];
  return {
    pedido,
    account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    chain: { id: 143 },
    async signTypedData(args) {
      pedido.push(['signTypedData', args]);
      await esperar(tardaEnFirmar);
      if (rechaza) throw new Error('User rejected the request');
      return '0xfirma';
    },
    async signMessage(args) {
      pedido.push(['signMessage', args]);
      return '0xotra';
    },
  };
}

console.log('\nlo que pasa alrededor de la firma');
{
  const w = walletDeMentira();
  const orden = [];
  const envuelta = avisandoAlFirmar(w, () => orden.push('aviso'));

  orden.push('antes');
  const firma = await envuelta.signTypedData({ primaryType: 'Permit' });
  orden.push('despues');

  dice('la firma se devuelve tal cual', firma === '0xfirma');
  dice('el aviso sale una sola vez', orden.filter((x) => x === 'aviso').length === 1);
  dice('y sale DESPUÉS de firmar', orden.join('|') === 'antes|aviso|despues');
  dice('a la wallet le llegó lo mismo', w.pedido[0][1].primaryType === 'Permit');
}

console.log('\nel aviso espera a que la firma termine de verdad');
{
  // Es lo que separa «la hoja se va cuando has firmado» de «la hoja se va
  // cuando has pulsado»: con la wallet del teléfono el PBKDF2 ya pasó, pero
  // firmar sigue sin ser instantáneo.
  const w = walletDeMentira({ tardaEnFirmar: 60 });
  let avisado = false;
  const envuelta = avisandoAlFirmar(w, () => { avisado = true; });

  const enMarcha = envuelta.signTypedData({});
  await esperar(20);
  dice('a mitad de firmar todavía no ha avisado', avisado === false);
  await enMarcha;
  dice('y al terminar, sí', avisado === true);
}

console.log('\nrechazar la firma no avisa de nada');
{
  const w = walletDeMentira({ rechaza: true });
  let avisos = 0;
  const envuelta = avisandoAlFirmar(w, () => avisos++);

  let reventado = false;
  try {
    await envuelta.signTypedData({});
  } catch {
    reventado = true;
  }
  dice('el fallo llega a quien llamó', reventado);
  // Si avisara, la hoja se cerraría y el hilo enseñaría un mensaje esperando
  // respuesta que no se ha mandado nunca.
  dice('y no se avisa: no se firmó, no se mandó', avisos === 0);
}

console.log('\ntodo lo demás pasa sin tocarse');
{
  const w = walletDeMentira();
  let avisos = 0;
  const envuelta = avisandoAlFirmar(w, () => avisos++);

  dice('la cuenta es la misma', envuelta.account.address === w.account.address);
  dice('la red también', envuelta.chain.id === 143);
  dice('firmar un mensaje suelto sigue yendo', (await envuelta.signMessage({})) === '0xotra');
  dice('y eso NO avisa: no es el permiso', avisos === 0);
  dice('lo que no existe sigue sin existir', envuelta.noExiste === undefined);
}

/* ── contra el SDK de verdad ─────────────────────────────────────────────── */

/**
 * Lo de arriba comprueba el proxy; esto comprueba la SUPOSICIÓN en la que se
 * apoya: que `payAndAsk` firma una vez y manda después. Si algún día el SDK
 * firmara al final, o dos veces, el arreglo dejaría de servir sin que nada se
 * rompiera a la vista — la hoja se cerraría en el momento equivocado y solo se
 * notaría usando la app.
 */
const { createServer } = await import('node:http');
const { payAndAsk } = await import('@panal/sdk');

const TOKEN = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';
const COBRA = '0x1111111111111111111111111111111111111111';

const sucesos = [];
const servidor = createServer((req, res) => {
  sucesos.push('llega la peticion');
  // El agente cobra en la cadena y se lo piensa: eso es lo que tarda, y es lo
  // que la hoja se quedaba esperando encima del hilo.
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answer: 'ya está', payment: { txHash: '0xabc' } }));
  }, 150);
  req.resume();
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const puerto = servidor.address().port;

const cotizacion = {
  scheme: 'panal-permit-v1',
  chainId: 143,
  asset: TOKEN,
  amount: '500000000000000000',
  payTo: COBRA,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  payerNonce: '0',
  domain: { name: 'PANAL', version: '1', chainId: 143, verifyingContract: TOKEN },
};

const wallet = {
  account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
  async signTypedData() {
    sucesos.push('se firma');
    return `0x${'11'.repeat(65)}`;
  },
};

console.log('\nel SDK firma primero y manda después');
const envuelta = avisandoAlFirmar(wallet, () => sucesos.push('SE CIERRA LA HOJA'));
const res = await payAndAsk(
  envuelta,
  wallet.account,
  `http://127.0.0.1:${puerto}/ask`,
  'hola',
  {
    maxSpend: BigInt(cotizacion.amount),
    chainId: 143,
    asset: TOKEN,
    expectedPayee: COBRA,
    quote: cotizacion,
    allowInsecure: true,
  },
);
servidor.close();

dice('la respuesta del agente llega entera', res.answer === 'ya está');
dice(
  'y el orden es: firmar → cerrar la hoja → mandar',
  sucesos.join(' | ') === 'se firma | SE CIERRA LA HOJA | llega la peticion',
);
dice('se firma UNA vez', sucesos.filter((x) => x === 'se firma').length === 1);
// El fallo que se está arreglando, dicho como condición: la hoja no puede
// seguir puesta cuando la petición ya salió.
dice(
  'la hoja se cierra ANTES de que salga la petición',
  sucesos.indexOf('SE CIERRA LA HOJA') < sucesos.indexOf('llega la peticion'),
);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
