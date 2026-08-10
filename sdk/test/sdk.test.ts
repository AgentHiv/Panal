/**
 * Pruebas del SDK contra Monad mainnet — SOLO LECTURA.
 *
 *   npx tsx test/sdk.test.ts     (o: npm test)
 *
 * No firma nada, no gasta gas y no necesita claves. Toca la red a propósito:
 * es la única forma de detectar que una dirección o un ABI dejaron de cuadrar
 * con la realidad, que es justo el fallo que un SDK publicado no puede tener.
 *
 * Las aserciones son ESTRUCTURALES, nunca sobre agentes o tareas concretas: el
 * marketplace es un sistema vivo donde cualquiera se registra o se da de baja.
 * Fijar la dirección de un agente ya rompió el CI una vez, cuando se desactivó
 * LexPanal.
 */

import { isAddress } from 'viem';
import {
  createPanalClient,
  formatAgentMetadata,
  parseAgentMetadata,
  MAINNET_ADDRESSES,
  NATIVE_CURRENCY,
  TaskStatus,
} from '../src/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('── 1. Metadata: componer y volver a leer ──');

  const meta = {
    name: 'TraductorBot',
    description: 'Traducción técnica EN<->ES',
    skills: ['traducción', 'revisión'],
    botUrl: 'https://bot.ejemplo.com',
  };
  const encoded = formatAgentMetadata(meta);
  const decoded = parseAgentMetadata(encoded);
  check('ida y vuelta sin pérdida', JSON.stringify(decoded) === JSON.stringify(meta), encoded);

  // Un `·` en la descripción desplazaría las skills a otro segmento y dejaría
  // la ficha descuadrada sin ningún error visible.
  const sneaky = formatAgentMetadata({ ...meta, description: 'Traduce A · B · C' });
  check('el separador se neutraliza', parseAgentMetadata(sneaky).skills.join(',') === 'traducción,revisión', sneaky);

  check('un metadata vacío no revienta', parseAgentMetadata('').name === '');
  check('metadata a medias no desplaza campos', parseAgentMetadata('Solo el nombre').description === '');
  check(
    'el endpoint se reconoce en cualquier posición',
    parseAgentMetadata('bot:https://x.com · Nombre · Desc').botUrl === 'https://x.com',
  );
  check('un bot: que no es URL se trata como texto', parseAgentMetadata('bot:no-soy-url · N').botUrl === null);

  console.log('\n── 2. Lectura de Monad mainnet ──');

  const panal = createPanalClient();
  check('sin configuración apunta a mainnet', panal.network === 'mainnet');
  check('las direcciones son las desplegadas', panal.addresses.escrow === MAINNET_ADDRESSES.escrow);

  const agents = await panal.listAgents();
  check('el registry responde', agents.length > 0, `${agents.length} agentes`);
  check(
    'cada agente trae dirección, dueño y moneda válidas',
    agents.every((a) => isAddress(a.address) && isAddress(a.owner) && isAddress(a.currency)),
  );
  check(
    'la metadata se interpreta',
    agents.some((a) => a.metadata.name.length > 0),
    agents.map((a) => a.metadata.name || '(sin nombre)').join(', '),
  );

  const active = await panal.searchAgents();
  check('searchAgents sin texto filtra los inactivos', active.every((a) => a.active), `${active.length} activos`);
  check('los inactivos se pueden pedir', (await panal.searchAgents(undefined, { includeInactive: true })).length >= active.length);

  // La búsqueda se prueba con una skill que exista AHORA, no con una fija.
  const someSkill = agents.flatMap((a) => a.metadata.skills)[0];
  if (someSkill) {
    const found = await panal.searchAgents(someSkill, { includeInactive: true });
    check(`buscar por una skill real ("${someSkill}")`, found.length > 0, `${found.length} coincidencias`);
  } else {
    console.log('ℹ️  ningún agente publica skills ahora mismo: búsqueda por texto no comprobada');
  }
  check('una búsqueda imposible devuelve vacío', (await panal.searchAgents('zzz-no-existe-zzz')).length === 0);

  console.log('\n── 3. Escrow ──');

  const count = await panal.getTaskCount();
  check('getTaskCount responde', count > 0n, `${count} tareas`);

  const task = await panal.getTask(count - 1n);
  check('la última tarea se lee entera', isAddress(task.client) && isAddress(task.worker));
  check('el estado cae dentro del enum', task.status in TaskStatus, TaskStatus[task.status] ?? String(task.status));
  check('el hash del brief está presente', /^0x[0-9a-f]{64}$/i.test(task.taskHash));
  check('el importe es coherente', task.amount >= 0n, `${task.amount} wei`);

  const pending = await panal.getPendingWithdrawal(task.worker, NATIVE_CURRENCY);
  check('pendingWithdrawals responde', pending >= 0n, `${pending} wei`);

  console.log('\n── 4. Errores útiles antes de firmar ──');

  try {
    await panal.hire({ agent: MAINNET_ADDRESSES.escrow, brief: 'x' });
    check('contratar sin cuenta falla', false, 'no lanzó');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check('contratar sin cuenta explica qué falta', msg.includes('account'), msg);
  }

  try {
    createPanalClient({ network: 'testnet' });
    check('testnet sin desplegar avisa', false, 'no lanzó');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check('testnet sin desplegar avisa, en vez de mandar a la dirección cero', msg.includes('testnet'), msg);
  }

  console.log('');
  if (failures === 0) console.log('✅ El SDK cuadra con los contratos de mainnet');
  else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
