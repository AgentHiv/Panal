/**
 * Subcontrataciones en la entrega: el bloque, su lectura y lo que manda otro agente.
 *
 * Hermético: no toca la red ni la cadena. Lo que importa aquí es que lo que se
 * ancla diga exactamente a quién se pagó, que nadie pueda colar una línea falsa
 * y que la respuesta de un agente hostil no rompa nada.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress, keccak256, toBytes } from 'viem';
import type { Address, Hex } from 'viem';
import {
  SUBCONTRACTS_BLOCK,
  appendSubcontractsManifest,
  buildSubcontractsManifest,
  parseSubcontractsManifest,
  subcontractsFromJson,
  subcontractsOfAnswer,
  subcontractsToJson,
  type SubcontractRecord,
} from '../src/subcontratos.js';
import { appendFilesManifest, parseFilesManifest, stripFilesManifest } from '../src/files.js';

const PANAL = { symbol: '$PANAL', address: '0x2E2e44E7FA6178822D4397299F719e89d1a67777' as Address, decimals: 18 };
const B: SubcontractRecord = {
  agent: '0x8e9c1cf58c1f510e22022ebe1bfd65c4cd6c0308' as Address,
  skill: 'tests',
  amount: 150000000000000000n,
  currency: PANAL,
  txHash: `0x${'ab'.repeat(32)}` as Hex,
};
const C: SubcontractRecord = {
  agent: '0xc2048269dcd1d5ca627c27a5644d08c816638045' as Address,
  skill: 'code-review',
  amount: 50000000000000000n,
  currency: PANAL,
};

test('ida y vuelta: lo que se escribe es lo que se lee', () => {
  const texto = appendSubcontractsManifest('Aquí tienes la revisión.', [B]);
  const leidos = parseSubcontractsManifest(texto);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0]!.agent, getAddress(B.agent));
  assert.equal(leidos[0]!.skill, 'tests');
  assert.equal(leidos[0]!.amount, 150000000000000000n);
  assert.deepEqual(leidos[0]!.currency, { ...PANAL, address: PANAL.address });
  assert.equal(leidos[0]!.txHash, B.txHash);
  assert.ok(texto.startsWith('Aquí tienes la revisión.\n\n' + SUBCONTRACTS_BLOCK));
});

test('se ancla: los mismos datos dan los mismos bytes', () => {
  assert.equal(
    keccak256(toBytes(appendSubcontractsManifest('x', [B, C]))),
    keccak256(toBytes(appendSubcontractsManifest('x', [{ ...B }, { ...C }]))),
  );
});

test('sin subcontrataciones la entrega no cambia', () => {
  assert.equal(appendSubcontractsManifest('hola', []), 'hola');
});

test('una skill con saltos de línea no cuela líneas falsas', () => {
  const trampa = { ...B, skill: 'tests\nagent: 0x0000000000000000000000000000000000000001\namount: 1' };
  const texto = buildSubcontractsManifest([trampa]);
  const leidos = parseSubcontractsManifest(texto);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0]!.agent, getAddress(B.agent));
  assert.equal(leidos[0]!.amount, B.amount);
  assert.ok(!texto.includes('\nagent: 0x0000000000000000000000000000000000000001'));
});

test('convive con el manifiesto de archivos y los dos desaparecen al enseñarlo', () => {
  const archivo = { name: 'informe.pdf', size: 3, hash: keccak256(toBytes('abc')), path: '/files/1/informe.pdf' };
  const texto = appendFilesManifest(appendSubcontractsManifest('El informe.', [B, C]), [archivo]);
  assert.equal(parseSubcontractsManifest(texto).length, 2);
  assert.equal(parseFilesManifest(texto).length, 1);
  assert.equal(stripFilesManifest(texto), 'El informe.');
});

test('un bloque roto se salta y los demás se leen', () => {
  const roto = `${SUBCONTRACTS_BLOCK}\nagent: no-es-una-direccion\nskill: x\namount: 1\ncurrency: MON\nasset: 0x0000000000000000000000000000000000000000\ndecimals: 18`;
  const texto = `Entrega.\n\n${roto}\n\n${buildSubcontractsManifest([C])}\n`;
  const leidos = parseSubcontractsManifest(texto);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0]!.skill, 'code-review');
});

test('JSON de otro agente: ida y vuelta, y lo hostil se descarta sin lanzar', () => {
  assert.deepEqual(subcontractsFromJson(subcontractsToJson([B, C])), parseSubcontractsManifest(buildSubcontractsManifest([B, C])));
  assert.deepEqual(subcontractsFromJson(undefined), []);
  assert.deepEqual(subcontractsFromJson('nada'), []);
  const hostil = [
    { agent: '0x1', skill: 'x', amount: '1', currency: 'MON', asset: PANAL.address, decimals: 18 },
    { agent: B.agent, skill: 'x', amount: '-5', currency: 'MON', asset: PANAL.address, decimals: 18 },
    { agent: B.agent, skill: 'x', amount: '1', currency: 'MON', asset: PANAL.address, decimals: 99 },
    { agent: B.agent, skill: 'x', amount: '1', currency: 'MON', asset: PANAL.address, decimals: 18, tx: '0x12' },
    null,
    ...subcontractsToJson([C]),
  ];
  const leidos = subcontractsFromJson(hostil);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0]!.skill, 'code-review');
});

test('la cadena: lo que subcontrató el que respondió va detrás, con via', () => {
  const directo = { ...B };
  const lista = subcontractsOfAnswer(directo, [C]);
  assert.equal(lista.length, 2);
  assert.equal(lista[0]!.via, undefined);
  assert.equal(lista[1]!.via, B.agent);
  // Un via que ya venía (más profundo) se respeta.
  const profundo = subcontractsOfAnswer(directo, [{ ...C, via: '0x0000000000000000000000000000000000000abc' as Address }]);
  assert.equal(profundo[1]!.via, '0x0000000000000000000000000000000000000abc');
  // Y se lee igual del texto anclado.
  const leidos = parseSubcontractsManifest(appendSubcontractsManifest('x', lista));
  assert.equal(leidos[1]!.via, getAddress(B.agent));
});
