import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * La app de Android. NO es la web.
 *
 * Comparte con la web la capa que toca el dinero —`lib/`, `hooks/`,
 * `contracts/` y `@panal/sdk`— y NADA de su interfaz. Son ~5.100 líneas
 * compartidas contra ~22.800 de UI que no se comparten: la web tiene portada,
 * enjambre 3D y nueve rutas; esto tiene tres pestañas.
 *
 * Por qué el alias `@` apunta a `../src` y no a una carpeta propia: para no
 * tocar la web. Los archivos compartidos se importan entre sí con `@/...`, así
 * que si `@` apunta al `src` de la web funcionan tal cual están, sin mover ni
 * un archivo ni reescribir un import. La app usa `~` para lo suyo.
 *
 * Es un atajo, y se dice: lo limpio sería sacar esa capa a un paquete del
 * workspace. Eso exige cambiar los imports de la web, que es justo lo que no se
 * quiere hacer ahora. El día que se haga, aquí solo cambia esta línea.
 */
export default defineConfig({
  base: '/',

  /**
   * HASTA QUÉ MÓVIL LLEGA EL APK. Escrito aquí porque si no, lo decide Vite.
   *
   * Sin esta línea el objetivo es el que traiga Vite por defecto, y ese cambia
   * al actualizar Vite: la 5 compilaba para `chrome87` y la 7 para
   * `baseline-widely-available`, que es `chrome107` —octubre de 2022—. O sea
   * que una subida de versión de una herramienta deja fuera móviles que
   * funcionaban, sin tocar una línea de la app y sin que nada avise.
   *
   * `minSdkVersion` es 24 (Android 7), pero eso solo dice dónde se INSTALA. Lo
   * que ejecuta el código es el WebView del sistema, que se actualiza por Play
   * Store aparte de la versión de Android: un Android 7 al día llega a Chrome
   * 119, y uno que no se actualiza desde hace años se queda mucho más atrás.
   * Ese es el aparato que se queda en blanco.
   *
   * 87 es lo que este proyecto ya compilaba antes de la subida a Vite 7, así
   * que no regala compatibilidad: la devuelve. Cuesta 11 kB sin comprimir y 3
   * con gzip, medidos.
   */
  build: { target: ['chrome87'] },

  plugins: [react()],
  server: { port: 3100 },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      '~': path.resolve(__dirname, './src'),
    },
  },
});
