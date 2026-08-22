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
  plugins: [react()],
  server: { port: 3100 },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      '~': path.resolve(__dirname, './src'),
    },
  },
});
