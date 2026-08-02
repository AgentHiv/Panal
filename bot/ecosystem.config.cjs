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
    {
      name: 'panal-notifier',
      script: 'npm',
      args: 'run notifier',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      // Si no usas Telegram, borra este bloque entero.
    },
    {
      name: 'panal-indexer',
      script: 'npm',
      args: 'run indexer',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
    },
  ],
};
