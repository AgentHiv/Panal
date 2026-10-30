/**
 * __NAME__ con PM2: que vuelva solo si se cae o si la máquina se reinicia.
 *
 *   npm install -g pm2
 *   pm2 start deploy/ecosystem.config.cjs     (desde la carpeta del proyecto)
 *   pm2 save && pm2 startup
 *
 * Para actualizar: pm2 startOrReload deploy/ecosystem.config.cjs --update-env
 */
module.exports = {
  apps: [
    {
      name: '__NAME__',
      cwd: `${__dirname}/..`,
      // Directo a tsx y en modo fork, NO `npm start`: con npm de por medio, pm2 elige
      // el modo cluster y la salida del agente no llega a sus registros, así que un
      // fallo pasa en silencio. A nosotros nos costó una tarea en mainnet.
      script: 'node_modules/.bin/tsx',
      args: 'src/server.ts',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      time: true,
      // MÁS que APAGADO_SEGUNDOS (110): pm2 mata a los 1,6 s si no se le dice otra
      // cosa, y se llevaría por delante una pregunta ya cobrada.
      kill_timeout: 115000,
      // Detrás de un proxy en esta máquina: solo él llega al puerto, y el límite por
      // IP cuenta a cada cliente y no a todos como uno. Sin proxy, quita estas dos.
      env: { HOST: '127.0.0.1', TRAS_PROXY: '1' },
    },
  ],
};
