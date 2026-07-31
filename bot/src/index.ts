/**
 * Panal Bot — punto de entrada.
 *
 * Selecciona el modo por BOT_MODE (notifier | worker | indexer), crea los
 * clientes de cadena, el store y el cliente de Telegram, y arranca el bucle
 * principal. Maneja SIGINT/SIGTERM para un apagado limpio.
 *
 * Uso:
 *   npm start                (usa BOT_MODE del .env)
 *   npm run notifier
 *   npm run worker
 *   npm run indexer
 *   DRY_RUN=true npm start   (prueba en seco, sin Telegram ni firmas)
 */

import { loadConfig } from './config.js';
import { createClients } from './chain.js';
import { Store } from './store.js';
import { Telegram } from './telegram.js';
import { runNotifier, type StopSignal } from './notifier.js';
import { runWorker } from './worker.js';
import { startResultServer } from './http.js';
import { IndexStore } from './indexer-store.js';
import { runIndexer } from './indexer.js';
import { startIndexServer } from './indexer-http.js';
import type { Server } from 'node:http';

async function main(): Promise<void> {
  const cfg = loadConfig();

  console.log('🐝 Panal Bot arrancando…');
  console.log(`   Modo: ${cfg.mode}${cfg.dryRun ? ' (DRY-RUN: no envía Telegram ni firma)' : ''}`);
  console.log(`   Agente: ${cfg.agentAddress}`);
  console.log(`   RPC: ${cfg.rpcUrl}`);
  console.log(`   Escrow v2: ${cfg.escrowAddress}`);
  if (cfg.mode === 'indexer') {
    console.log(`   Registry v2: ${cfg.registryAddress}`);
  }
  // NUNCA loguear BOT_PRIVATE_KEY ni TELEGRAM_BOT_TOKEN.

  const clients = createClients(cfg);
  if (clients.botAddress) {
    console.log(`   Wallet del bot: ${clients.botAddress}`);
  }

  // Modo indexer: proceso hermano, solo lectura. No usa Store/Telegram del
  // bot (tiene su propio IndexStore en INDEX_DIR y su propia API HTTP).
  if (cfg.mode === 'indexer') {
    const indexStore = new IndexStore(cfg.indexDir, cfg.panalTokenAddress);
    let indexServer: Server | undefined;
    if (cfg.indexHttpPort > 0) {
      indexServer = startIndexServer(cfg, indexStore);
    }
    const indexStop: StopSignal = { stopped: false };
    const indexShutdown = (signal: string) => {
      console.log(`\n[main] ${signal} recibido: apagando…`);
      indexStop.stopped = true;
      indexServer?.close();
      indexStore.saveState();
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', () => indexShutdown('SIGINT'));
    process.on('SIGTERM', () => indexShutdown('SIGTERM'));
    await runIndexer(cfg, clients, indexStore, indexStop);
    return;
  }

  const store = new Store(cfg.storeDir);
  const telegram = new Telegram(cfg);

  // Servidor HTTP de entrega de resultados al cliente (firma EIP-191).
  // Arranca junto al worker cuando BOT_HTTP_PORT > 0 (default 8787).
  let resultServer: Server | undefined;
  if (cfg.mode === 'worker' && cfg.httpPort > 0) {
    resultServer = startResultServer(cfg, clients, store);
  }

  const stop: StopSignal = { stopped: false };
  const shutdown = (signal: string) => {
    console.log(`\n[main] ${signal} recibido: apagando…`);
    stop.stopped = true;
    resultServer?.close();
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
