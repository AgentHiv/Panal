/**
 * Cómo se vuelve a la wallet a firmar.
 *
 * Esto arregla el fallo de «la app no manda la firma». Sí la manda: lo que no
 * hacía era traer a la wallet al frente, porque la redirección de
 * WalletConnect se sale en su primera línea cuando no está la clave que
 * escribe el modal que quitamos. Lo que se comprueba aquí es que el enlace se
 * arma bien en los cuatro casos que hay, y que una lectura corriente NUNCA
 * saca a nadie de la app.
 */
const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};

const r = await import('../src/lib/regreso.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

console.log('\nde dónde sale el enlace');
dice(
  'lo que dice la wallet manda',
  r.enlaceDeVuelta({ native: 'metamask://', universal: 'https://metamask.app.link' }, null) === 'metamask://',
);
dice(
  'el esquema propio antes que el universal: la wallet ya está instalada',
  r.enlaceDeVuelta({ native: 'rainbow://', universal: 'https://rnbwapp.com' }, null) === 'rainbow://',
);
dice(
  'si solo manda el universal, ese',
  r.enlaceDeVuelta({ universal: 'https://rnbwapp.com' }, null) === 'https://rnbwapp.com',
);
dice(
  'si la wallet no dice nada, el que se tocó al conectar',
  r.enlaceDeVuelta(undefined, 'https://link.trustwallet.com') === 'https://link.trustwallet.com',
);
dice('y si no hay ni eso, null', r.enlaceDeVuelta(undefined, null) === null);
dice('un redirect vacío no cuela como enlace', r.enlaceDeVuelta({ native: '   ' }, null) === null);

console.log('\ncon la petición, el formato de WalletConnect');
dice(
  'un esquema propio no acaba con tres barras',
  r.enlaceDeVuelta({ native: 'metamask://' }, null, { id: 7, topic: 'abc' }) ===
    'metamask://wc?requestId=7&sessionTopic=abc',
);
dice(
  'y un universal tampoco duplica la barra',
  r.enlaceDeVuelta({ universal: 'https://rnbwapp.com/' }, null, { id: 7, topic: 'abc' }) ===
    'https://rnbwapp.com/wc?requestId=7&sessionTopic=abc',
);

console.log('\nqué saca a la persona de la app');
dice('firmar una transacción, sí', r.PIDE_FIRMA.has('eth_sendTransaction'));
dice('firmar un permit de x402, sí', r.PIDE_FIRMA.has('eth_signTypedData_v4'));
dice('firmar un mensaje para traer la entrega, sí', r.PIDE_FIRMA.has('personal_sign'));
dice('cambiar de red, sí', r.PIDE_FIRMA.has('wallet_switchEthereumChain'));
// Lo importante de la lista es lo que NO está: wagmi pide esto a cada rato.
dice('preguntar la red, NO', !r.PIDE_FIRMA.has('eth_chainId'));
dice('preguntar la cuenta, NO', !r.PIDE_FIRMA.has('eth_accounts'));
dice('leer un contrato, NO', !r.PIDE_FIRMA.has('eth_call'));
dice('leer el saldo, NO', !r.PIDE_FIRMA.has('eth_getBalance'));
dice('esperar un recibo, NO', !r.PIDE_FIRMA.has('eth_getTransactionReceipt'));

console.log('\nlo que se apunta al conectar');
r.recordarWallet('https://metamask.app.link');
dice('se guarda', r.walletRecordada() === 'https://metamask.app.link');
r.olvidarWallet();
dice('y al desconectar se olvida', r.walletRecordada() === null);
r.recordarWallet(null);
dice('guardar null no deja basura', r.walletRecordada() === null);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
