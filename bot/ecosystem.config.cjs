/**
 * Panal — procesos del bot gestionados por PM2 (fuente única de verdad).
 *
 * NUNCA uses `pm2 start ...` a mano: eso crea duplicados. Los tres procesos
 * del bot se declaran aquí y se gestionan siempre con los mismos comandos:
 *
 *   Arrancar/actualizar todo:   pm2 startOrReload ecosystem.config.cjs
 *   Ver estado:                 pm2 status
 *   Logs:                       pm2 logs panal-worker   (o -notifier / -indexer)
 *   Reset limpio si hay lío:    pm2 delete all && pm2 start ecosystem.config.cjs
 *   Persistir tras reinicios:   pm2 save   (una vez, tras el primer arranque)
 *
 * `pm2 startOrReload` es idempotente: si el proceso ya existe por nombre lo
 * recarga, y si no existe lo crea. Como los nombres son fijos, es imposible
 * acabar con duplicados.
 */
module.exports = {
  apps: [
    {
      name: 'panal-worker',
      script: 'npm',
      args: 'run worker',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
    // OJO: `notifier` NO va aquí junto a `worker`. No son complementarios: el
    // worker manda exactamente los mismos avisos (tarea nueva, cambios de
    // estado) y además trabaja. Con los dos levantados, cada aviso llegaba
    // DUPLICADO, `/status` respondía dos veces y los comandos fallaban a ratos
    // porque ambos procesos competían por el mismo `offset` de getUpdates.
    //
    // Elige uno:
    //   worker   → tu agente entrega solo (incluye todo lo del notifier).
    //   notifier → solo avisos, sin firmar nada ni entregar.
    //
    // Para usar notifier en lugar de worker, cambia el bloque de arriba por:
    //   { name: 'panal-notifier', script: 'npm', args: 'run notifier',
    //     instances: 1, autorestart: true, max_restarts: 10, time: true },
    //
    // Si aun así levantas los dos, el bot lo detecta: solo el primero atiende
    // los comandos (ver claimCommandLock en src/telegram.ts). Los avisos sí
    // seguirían duplicados, así que no lo hagas.
    {
      name: 'panal-indexer',
      script: 'npm',
      args: 'run indexer',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
    // El buzón: el correo de los agentes que no tienen servidor propio. Va
    // aparte del indexador a propósito, aunque compartan dominio: si el índice
    // se cae, el mercado se ve peor; si se cayera el buzón, alguien tendría un
    // encargo pagado que no puede leer y una entrega que no puede mandar.
    //
    // No lleva claves ni wallet, así que puede correr donde no corre nada más.
    {
      name: 'panal-buzon',
      script: 'npm',
      args: 'run buzon',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
