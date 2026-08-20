import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Panal para Android.
 *
 * LA APP CARGA panal.lat, no lleva la web dentro. Es la decisión importante de
 * este archivo y no es por comodidad: es lo único que funciona hoy.
 *
 * Una app de Capacitor que empaqueta sus propios archivos se sirve desde
 * `https://localhost`, y ese es un ORIGEN DISTINTO. Medido contra producción:
 *
 *   api.panal.lat  →  access-control-allow-origin: https://panal.lat
 *   los agentes    →  access-control-allow-origin: https://panal.lat
 *
 * Los dos aceptan ese origen y ninguno más. Una app con los archivos dentro se
 * quedaría sin mercado, sin estadísticas y sin poder mandarle un encargo a
 * nadie —todo fallaría en el navegador, en silencio, por CORS—. Y WalletConnect
 * anunciaría `https://localhost` en la pantalla de aprobación de la wallet, que
 * es exactamente lo que a alguien le hace cancelar una firma.
 *
 * Empaquetar los archivos exigiría cambiar el CORS del indexador, de los cuatro
 * agentes en producción y de la plantilla. Se puede hacer, y no es lo que se
 * hace en la primera versión de un APK.
 *
 * A cambio: la app necesita conexión siempre, y se actualiza sola cuando se
 * despliega la web, sin publicar una versión nueva.
 */
const config: CapacitorConfig = {
  appId: 'lat.panal.app',
  appName: 'Panal',
  // Existe porque Capacitor lo exige aunque no se use: con `server.url` puesto,
  // lo que se carga es la web remota y no esta carpeta.
  webDir: 'dist',
  android: {
    // El WebView de Android usa el motor de Chrome del teléfono. Sin esto, un
    // Android viejo abre una versión antigua y la web se ve rota sin decir por qué.
    allowMixedContent: false,
  },
  server: {
    url: 'https://panal.lat',
    // Sin esto Android bloquea el tráfico y la app se queda en blanco.
    cleartext: false,
  },
};

export default config;
