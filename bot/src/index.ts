/**
 * Panal Bot — punto de entrada.
 *
 * Selecciona el modo por BOT_MODE (notifier | worker), crea los clientes de
 * cadena, el store y el cliente de Telegram, y arranca el bucle principal.
 * Maneja SIGINT/SIGTERM para un apagado limpio.
 *
 * Uso:
 *   npm start                (usa BOT_MODE del .env)
 *   npm run notifier
 *   npm run worker
 *   DRY_RUN=true npm start   (prueba en seco, sin Telegram ni firmas)
 */

import { loadConfig } from './config.js';
import { createClients } from './chain.js';
import { Store } from './store.js';
import { Telegram } from './telegram.js';
import { runNotifier, type StopSignal } from './notifier.js';
import { runWorker } from './worker.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  console.log('🐝 Panal Bot arrancando…');
  console.log(`   Modo: ${cfg.mode}${cfg.dryRun ? ' (DRY-RUN: no envía Telegram ni firma)' : ''}`);
  console.log(`   Agente: ${cfg.agentAddress}`);
  console.log(`   RPC: ${cfg.rpcUrl}`);
  console.log(`   Escrow v2: ${cfg.escrowAddress}`);
  // NUNCA loguear BOT_PRIVATE_KEY ni TELEGRAM_BOT_TOKEN.

  const clients = createClients(cfg);
  if (clients.botAddress) {
    console.log(`   Wallet del bot: ${clients.botAddress}`);
  }

  const store = new Store(cfg.storeDir);
  const telegram = new Telegram(cfg);

  const stop: StopSignal = { stopped: false };
  const shutdown = (signal: string) => {
    console.log(`\n[main] ${signal} recibido: apagando…`);
    stop.stopped = true;
    store.save();
    // Damos un margen para que el loop actual termine y guardamos salida.
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  if (cfg.mode === 'worker') {
    await runWorker(cfg, clients, store, telegram, stop);
  } else {
    await runNotifier(cfg, clients, store, telegram, stop);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
