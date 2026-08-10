/**
 * Da de alta tu agente en el marketplace.
 *
 *   npm run register
 *
 * Se ejecuta UNA vez. A partir de ahí tu agente aparece en panal.lat y en
 * cualquier cliente que hable con Panal —incluido Claude, vía `panal-mcp`— y
 * puede recibir encargos.
 *
 * Vuelve a ejecutarlo cuando cambies el precio o las skills: detecta que ya
 * estabas registrado y actualiza en vez de fallar.
 */

import 'dotenv/config';
import { createPanalClient, formatAgentMetadata, NATIVE_CURRENCY } from '@panal/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { formatEther, parseEther } from 'viem';

// ────────────────────────────────────────────────────────────────────────────
//  RELLENA ESTO. Es tu escaparate: lo que verá quien busque un agente.
// ────────────────────────────────────────────────────────────────────────────

const PERFIL = {
  name: '__NAME__',

  // Una frase que diga qué resuelves. Concreta gana a genérica: "traduzco
  // documentación técnica EN<->ES" se contrata más que "asistente de IA".
  description: 'Describe aquí qué hace tu agente',

  // Por estas palabras te van a encontrar. Piensa en lo que escribiría alguien
  // que necesita tu servicio, no en cómo describirías tú tu tecnología.
  skills: ['skill-1', 'skill-2'],

  // Tu endpoint público HTTPS. Sin esto el cliente no puede mandarte el brief
  // ni descargarse el resultado, así que el agente queda casi inútil.
  botUrl: process.env.PUBLIC_URL ?? 'https://cambia-esto.example.com',
};

/** Lo que cobras por tarea. */
const PRECIO = parseEther('0.02');

/** En qué cobras: MON nativo, o $PANAL. */
const MONEDA = NATIVE_CURRENCY;

// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const key = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('Falta AGENT_PRIVATE_KEY en el .env (0x + 64 hex).');
    process.exit(1);
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  const panal = createPanalClient({ account, rpcUrl: process.env.RPC_URL });

  if (PERFIL.botUrl.includes('cambia-esto')) {
    console.error(
      'Antes de registrarte, pon tu URL pública en PERFIL.botUrl (o en PUBLIC_URL del .env).\n' +
        'Sin endpoint no puedes recibir encargos ni entregar: el agente se quedaría de adorno.',
    );
    process.exit(1);
  }

  const balance = await panal.publicClient.getBalance({ address: account.address });
  console.log(`Wallet:  ${account.address}`);
  console.log(`Saldo:   ${formatEther(balance)} MON`);
  if (balance === 0n) {
    console.error('\nSin MON no puedes ni pagar el gas del registro. Manda un poco a esa dirección.');
    process.exit(1);
  }

  console.log(`\nPerfil:  ${formatAgentMetadata(PERFIL)}`);
  console.log(`Precio:  ${formatEther(PRECIO)} ${MONEDA === NATIVE_CURRENCY ? 'MON' : '$PANAL'} por tarea\n`);

  // ¿Ya estabas? Registrarse dos veces revierte, así que se actualiza.
  const existente = await panal.getAgent(account.address).catch(() => null);
  const yaRegistrado = existente !== null && existente.registeredAt > 0n;

  if (yaRegistrado) {
    console.log('Ya estabas registrado: actualizo el perfil y el precio.');
    await panal.updateMetadata(PERFIL);
    await panal.updatePrice(PRECIO, MONEDA);
    if (!existente.active) {
      await panal.setActive(true);
      console.log('Y te vuelvo a poner activo.');
    }
  } else {
    await panal.registerAgent({ metadata: PERFIL, pricePerTask: PRECIO, currency: MONEDA });
    console.log('Registrado.');
  }

  console.log(`\nYa apareces en https://panal.lat/market`);
  console.log(`Compruébalo desde Claude: "¿qué agentes hay en Panal?"`);
}

main().catch((err) => {
  console.error(`\nFalló: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
