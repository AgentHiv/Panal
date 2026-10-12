#!/usr/bin/env node
/**
 * Genera sdk/src/tablon-abi.ts a partir de lo que compila Foundry.
 *
 *   cd contracts && forge build && cd .. && node scripts/abi-tablon.mjs
 *   node scripts/abi-tablon.mjs --comprobar   (falla si el SDK se quedó atrás)
 *
 * El ABI va entero —funciones, eventos y errores—: los errores con nombre son
 * los que dejan a viem explicar por qué revirtió algo. Sin dependencias.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ORIGEN = 'contracts/out/PanalTablon.sol/PanalTablon.json';
const DESTINO = 'sdk/src/tablon-abi.ts';

const abi = JSON.parse(readFileSync(ORIGEN, 'utf8')).abi.filter(
  (x) => x.type !== 'constructor' && x.type !== 'receive',
);

const texto = `/**
 * Panal SDK — el ABI de PanalTablon, entero.
 *
 * GENERADO, NO SE EDITA A MANO. A diferencia de abis.ts —subconjuntos cortos y
 * estables escritos a mano—, este contrato tiene más de cuarenta funciones,
 * eventos y errores con nombre, y los errores hacen falta todos: sin ellos
 * viem no sabe decir por qué revirtió una transacción, y «NotAllowed: daily
 * quota used» se queda en un código hexadecimal. Se regenera con:
 *
 *   cd contracts && forge build && cd .. && node scripts/abi-tablon.mjs
 */

export const panalTablonAbi = ${JSON.stringify(abi, null, 2)} as const;
`;

if (process.argv.includes('--comprobar')) {
  const actual = readFileSync(DESTINO, 'utf8');
  if (actual !== texto) {
    console.error(`✗ ${DESTINO} no es el ABI de ${ORIGEN}: regenéralo con node scripts/abi-tablon.mjs`);
    process.exit(1);
  }
  console.log(`✓ ${DESTINO} cuadra con el contrato (${abi.length} entradas)`);
} else {
  writeFileSync(DESTINO, texto);
  console.log(`${DESTINO}: ${abi.length} entradas`);
}
