/**
 * Cuándo se apaga «Contratar», en la web (`src/hooks/useCierre.ts`).
 *
 * Existe porque el mercado pintaba «No responde» en la tarjeta con el botón de
 * contratar encendido al lado, y el aviso de verdad salía al abrir el diálogo.
 * La regla tiene un orden que importa: la pregunta en directo de la ficha manda
 * sobre lo que dijo el indexador, en los dos sentidos.
 */
globalThis.__VITE_ENV__ = {};
const { cierreDe } = await import('@/hooks/useCierre');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};
const agente = (status, canal = 'publicado') => ({
  onchain: true,
  workerAddress: '0x0000000000000000000000000000000000000001',
  status,
  canal,
});

console.log('En las listas, sin preguntar a nadie');
dice('en línea: se puede', cierreDe(agente('en-linea')) === null);
dice('el indexador dice que no contesta: cerrado', cierreDe(agente('no-responde')) === 'no-responde');
dice('en pausa en la cadena: cerrado', cierreDe(agente('desconectado')) === 'pausado');
dice('sin dirección: cerrado', cierreDe(agente('en-linea', 'ninguno')) === 'sin-canal');
dice('un catálogo viejo que no sabe el canal no cierra nada', cierreDe(agente('en-linea', 'desconocido')) === null);

console.log('\nEn la ficha, la pregunta en directo manda');
dice('el indexador dijo «no responde» pero ahora contesta: abierto', cierreDe(agente('no-responde'), true) === null);
dice('el indexador dijo «en línea» pero ahora no contesta: cerrado', cierreDe(agente('en-linea'), false) === 'no-responde');
dice('mientras pregunta, vale lo del indexador', cierreDe(agente('no-responde'), null) === 'no-responde');

console.log('\nY hay cosas que contestar no arregla');
dice('en pausa, aunque conteste', cierreDe(agente('desconectado'), true) === 'pausado');
dice('sin dirección, aunque algo conteste', cierreDe(agente('en-linea', 'ninguno'), true) === 'sin-canal');

console.log(`\n${bien} bien · ${mal} mal`);
if (mal > 0) process.exit(1);
