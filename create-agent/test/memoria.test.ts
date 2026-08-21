/**
 * La memoria de las conversaciones del agente.
 *
 *     npx tsx test/memoria.test.ts     (o: npm test)
 *
 * Hermético: escribe en un directorio temporal y no toca la red ni la cadena.
 *
 * Lo que importa aquí es el AISLAMIENTO y los TOPES. El aislamiento porque la
 * conversación se guarda por la dirección del pagador, y una fuga entre dos
 * clientes sería enseñarle a alguien lo que preguntó otro. Los topes porque el
 * historial entra en el prompt, que lo paga el agente mientras el cliente paga
 * un precio fijo: sin ellos, una conversación larga se vuelve un agujero.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'panal-memoria-'));
process.env.MEMORIA_TURNOS = '3';
process.env.MEMORIA_CHARS = '200';

const { leerConversacion, recordarTurno, historialParaElModelo, historialComoTexto } = await import(
  '../template/src/memoria.js'
);

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const ANA = '0x69D084926e68af78cDa512eF1Bf2c3e7B4307CBf';
const BEA = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C';
const turno = (p: string, r: string) => ({ pregunta: p, respuesta: r, cuando: Date.now() });

console.log('\n── Recordar ──\n');

check('una conversación nueva está vacía', leerConversacion(dir, ANA).length === 0);
recordarTurno(dir, ANA, turno('¿qué es una reentrada?', 'Llamar de vuelta antes de actualizar el saldo.'));
check('se guarda el turno', leerConversacion(dir, ANA).length === 1);
check('con sus dos mitades', leerConversacion(dir, ANA)[0]!.respuesta.startsWith('Llamar de vuelta'));

console.log('\n── Cada cliente, su conversación ──\n');

recordarTurno(dir, BEA, turno('tradúceme esto', 'Hecho.'));
check('no se mezclan', leerConversacion(dir, ANA).length === 1 && leerConversacion(dir, BEA).length === 1);
check(
  'y la dirección en otro checksum es la misma persona',
  leerConversacion(dir, ANA.toLowerCase()).length === 1,
);

console.log('\n── Los topes, que son lo que acota el coste ──\n');

for (let i = 0; i < 6; i++) recordarTurno(dir, ANA, turno(`pregunta ${i}`, `respuesta ${i}`));
const paraElModelo = historialParaElModelo(dir, ANA);
check('no se mandan más turnos de los configurados', paraElModelo.length <= 3, String(paraElModelo.length));
check(
  'y los que se mandan son los ÚLTIMOS',
  paraElModelo[paraElModelo.length - 1]!.pregunta === 'pregunta 5',
  paraElModelo[paraElModelo.length - 1]!.pregunta,
);

// El tope de turnos por sí solo no acota nada: tres turnos pueden ser tres
// líneas o tres pantallas de código pegado.
recordarTurno(dir, BEA, turno('x'.repeat(300), 'y'.repeat(300)));
const gordo = historialParaElModelo(dir, BEA);
const chars = gordo.reduce((n, t) => n + t.pregunta.length + t.respuesta.length, 0);
check('el tope de caracteres se respeta', chars <= 200, `${chars} caracteres`);

console.log('\n── Apagada y rota ──\n');

process.env.MEMORIA_TURNOS = '0';
const apagada = await import(`../template/src/memoria.js?apagada=${Date.now()}`);
check('con MEMORIA_TURNOS=0 no se recuerda nada', apagada.historialParaElModelo(dir, ANA).length === 0);

mkdirSync(join(dir, 'chats'), { recursive: true });
writeFileSync(join(dir, 'chats', '0xroto.json'), '{esto no es json', 'utf8');
check('un archivo ilegible se trata como vacío', leerConversacion(dir, '0xroto').length === 0);

console.log('\n── Cómo se le cuenta al modelo ──\n');

const texto = historialComoTexto([turno('¿y si llama dos veces?', 'No encuentra nada que sacar.')]);
check('lleva quién dijo qué', texto.includes('Cliente:') && texto.includes('Tú:'), texto);
check('y sin turnos no dice nada', historialComoTexto([]) === '');

rmSync(dir, { recursive: true, force: true });

console.log(
  fallos === 0
    ? '\n✅ El agente recuerda a cada cliente por separado y sin que el coste se dispare\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
