/**
 * Los alias `@` y `~` para Node.
 *
 * Vite los resuelve al compilar; `node --experimental-strip-types` no sabe nada
 * de ellos. Con esto los tests pueden importar los mismos archivos que la app
 * en vez de una copia adaptada, que es justo lo que haría que el test dejara de
 * comprobar el código de verdad.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAICES = {
  '@/': path.resolve(aqui, '../../src/'),
  '~/': path.resolve(aqui, '../src/'),
};

registerHooks({
  resolve(especificador, contexto, siguiente) {
    for (const [prefijo, raiz] of Object.entries(RAICES)) {
      if (!especificador.startsWith(prefijo)) continue;
      const base = path.join(raiz, especificador.slice(prefijo.length));
      // Los imports van sin extensión, como en el código de la app.
      for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
        const url = pathToFileURL(base + ext).href;
        try {
          return siguiente(url, contexto);
        } catch {
          /* la siguiente extensión */
        }
      }
    }
    return siguiente(especificador, contexto);
  },
});
