/**
 * Panal — procesos del bot gestionados por PM2 (fuente única de verdad).
 *
 * NUNCA uses `pm2 start ...` a mano: eso crea duplicados. Los procesos del bot
 * se declaran aquí y se gestionan siempre con los mismos comandos:
 *
 *   Arrancar/actualizar todo:   pm2 startOrReload ecosystem.config.cjs --update-env
 *   Ver estado:                 pm2 status
 *   Logs:                       pm2 logs panal-buzon   (o -worker / -indexer)
 *   Persistir tras reinicios:   pm2 save   (una vez, tras el primer arranque)
 *
 * `pm2 startOrReload` es idempotente: si el proceso ya existe por nombre lo
 * recarga, y si no existe lo crea. Como los nombres son fijos, es imposible
 * acabar con duplicados.
 *
 * DIRECTO A TSX Y EN MODO FORK, no `npm run …`. Con npm de por medio y
 * `instances: 1`, pm2 elegía el modo cluster y vigilaba a npm, no al bot: la
 * salida del bot (sh → tsx → node) heredaba la del demonio y acababa en
 * ~/.pm2/pm2.log, sin fecha y mezclada con todo, mientras `pm2 logs panal-buzon`
 * solo enseñaba el «> buzon» de npm. Y al recargar, la copia nueva chocaba con
 * la vieja por el puerto (EADDRINUSE) porque pm2 no paraba al proceso que lo
 * tenía abierto. Así estuvo de agosto a noviembre de 2026.
 *
 * Pasar un proceso que ya existe de cluster a fork NO se hace con
 * `startOrReload`, que conserva el modo: hay que borrarlo por su nombre y
 * volver a crearlo, de uno en uno, y después `pm2 save`:
 *
 *   pm2 delete panal-buzon && pm2 start ecosystem.config.cjs --only panal-buzon
 *
 * Nunca `pm2 delete all`: en la máquina puede haber otros procesos.
 */
module.exports = {
  apps: [
    {
      name: 'panal-worker',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none',
      exec_mode: 'fork',
      // Sin las variables SSH_* de quien lanza pm2: con `--update-env` desde una
      // conexión SSH, SSH_CLIENT y SSH_CONNECTION —su IP— acababan en el entorno
      // del proceso y en ~/.pm2/dump.pm2. Ojo: un reinicio MEZCLA el entorno
      // nuevo con el viejo, así que esto no quita las que ya tenga un proceso;
      // para eso hay que borrarlo y crearlo de nuevo.
      filter_env: ['SSH_'],
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      // El apagado espera 1,5 s a que termine la vuelta en curso; el margen por
      // defecto de pm2 (1,6 s) lo dejaba justo.
      kill_timeout: 5000,
      // El modo va aquí y no en `.env`: dotenv no pisa lo que ya trae el entorno.
      env: { BOT_MODE: 'worker', HOST: '127.0.0.1' }, // solo Caddy llega hasta aquí (ver config.ts)
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
    //   { name: 'panal-notifier', cwd: __dirname, script: 'node_modules/.bin/tsx',
    //     args: 'src/index.ts', interpreter: 'none', exec_mode: 'fork', instances: 1,
    //     autorestart: true, max_restarts: 10, time: true, kill_timeout: 5000,
    //     filter_env: ['SSH_'],
    //     env: { BOT_MODE: 'notifier' } },
    //
    // Si aun así levantas los dos, el bot lo detecta: solo el primero atiende
    // los comandos (ver claimCommandLock en src/telegram.ts). Los avisos sí
    // seguirían duplicados, así que no lo hagas.
    {
      name: 'panal-indexer',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none',
      exec_mode: 'fork',
      filter_env: ['SSH_'], // ver panal-worker
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      kill_timeout: 5000,
      env: { BOT_MODE: 'indexer', HOST: '127.0.0.1' },
    },
    // El buzón: el correo de los agentes que no tienen servidor propio. Va
    // aparte del indexador a propósito, aunque compartan dominio: si el índice
    // se cae, el mercado se ve peor; si se cayera el buzón, alguien tendría un
    // encargo pagado que no puede leer y una entrega que no puede mandar.
    //
    // No lleva claves ni wallet, así que puede correr donde no corre nada más.
    {
      name: 'panal-buzon',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none',
      exec_mode: 'fork',
      filter_env: ['SSH_'], // ver panal-worker
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      kill_timeout: 5000,
      env: { BOT_MODE: 'buzon', HOST: '127.0.0.1' },
    },
    // El MCP remoto (https://mcp.panal.lat/mcp): Panal para los asistentes que
    // no instalan nada —claude.ai, la app de Claude, ChatGPT—. SOLO LECTURA:
    // busca, enseña fichas y prepara contrataciones como un enlace que la
    // persona firma en la web con su wallet. No lleva claves y se niega a
    // arrancar si encuentra MCP_PRIVATE_KEY. No es del bot: vive en ../mcp y
    // necesita el SDK compilado (`pnpm --filter @panal/sdk build`).
    {
      name: 'panal-mcp-remoto',
      cwd: `${__dirname}/../mcp`,
      // Node con el cargador de tsx, en UN proceso. El ejecutable `tsx` arranca
      // el programa en un proceso hijo, y pm2 mide la memoria del que lanza él:
      // vería los 54 MB del padre y nunca los del hijo, que es donde crecen los
      // borradores, y `max_memory_restart` no saltaría jamás.
      script: 'src/remoto.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      exec_mode: 'fork',
      filter_env: ['SSH_'], // ver panal-worker
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      kill_timeout: 5000,
      // Si pasa de esto, pm2 lo reinicia. Comparte máquina con el buzón y el
      // indexador, y un proceso que crece sin freno se los llevaría por
      // delante. Con 2.000 borradores llenos ocupa unos 150 MB; 300 deja sitio
      // y corta una fuga antes de que moleste. Reiniciar borra los borradores:
      // quien tenga un enlace a medias le pide otro a su asistente.
      max_memory_restart: '300M',
      env: { PORT: '8790', HOST: '127.0.0.1', TRAS_PROXY: '1' },
    },
  ],
};
