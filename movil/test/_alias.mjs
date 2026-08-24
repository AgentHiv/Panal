/**
 * Los alias `@` y `~` para Node, y `import.meta.env`.
 *
 * Vite resuelve los dos al compilar; `node --experimental-strip-types` no sabe
 * nada de ninguno. Con esto los tests pueden importar los mismos archivos que
 * la app en vez de una copia adaptada, que es justo lo que haría que el test
 * dejara de comprobar el código de verdad.
 *
 * Lo de `import.meta.env` es lo que faltaba para poder probar cualquier cosa
 * que toque la capa compartida: `src/contracts/config.ts` lee ahí la red y el
 * RPC, y en Node esa propiedad no existe, así que el módulo reventaba al
 * cargarse y con él todo lo que lo importara. Se sustituye por un objeto que
 * el test rellena en `globalThis.__VITE_ENV__` antes de importar nada.
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
  load(url, contexto, siguiente) {
    const r = siguiente(url, contexto);
    if (r.source && /\.tsx?$/.test(url)) {
      const fuente = r.source.toString();
      if (fuente.includes('import.meta.env'))
        r.source = fuente.replaceAll('import.meta.env', '(globalThis.__VITE_ENV__ ?? {})');
    }
    return r;
  },

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
