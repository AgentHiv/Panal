import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Panal para Android.
 *
 * LA APP ES `movil/`, NO LA WEB. No es un envoltorio alrededor de panal.lat ni
 * la web empaquetada: es otra aplicación, con tres pestañas en vez de nueve
 * rutas, sin portada, sin enjambre 3D y sin nada de la interfaz del sitio.
 * Comparte con la web la capa que toca el dinero y nada más.
 *
 * Se nota en el tamaño: la web compila 3,7 MB de JavaScript; esto, 583 KB.
 *
 * Por qué el hostname es el dominio de verdad y no `localhost`
 * ------------------------------------------------------------
 * Una app de Capacitor con los archivos dentro se sirve por defecto desde
 * `https://localhost`, y ese es un ORIGEN DISTINTO. Medido contra producción:
 *
 *   api.panal.lat  →  access-control-allow-origin: https://panal.lat
 *   los agentes    →  access-control-allow-origin: https://panal.lat
 *
 * Los dos aceptan ese origen y ninguno más. Desde `https://localhost` la app se
 * quedaría sin mercado, sin estadísticas y sin poder mandarle un encargo a
 * nadie —todo fallaría por CORS, en silencio—, y WalletConnect anunciaría
 * `https://localhost` en la pantalla de aprobación de la wallet.
 *
 * `server.hostname` cambia el nombre del servidor local del WebView. Con
 * `panal.lat`, el documento se sirve desde `https://panal.lat` y toda petición
 * que sale lleva `Origin: https://panal.lat`, que producción ya permite: no hay
 * que tocar el CORS del indexador, ni el de los cuatro agentes, ni el de la
 * plantilla, ni el de los agentes de terceros —que es lo que de verdad no
 * podíamos cambiar—.
 *
 * Y no secuestra la red: el servidor local solo intercepta las URLs de las
 * «authorities» que registra, comparadas con `equals()` exacto
 * (UriMatcher.java:153). `api.panal.lat` NO es `panal.lat`, así que sale por el
 * stack de red normal. Por eso mismo `api.panal.lat` no debe ir NUNCA en
 * `allowNavigation`: lo que se pone ahí se convierte en authority y se lo
 * tragaría el bundle.
 *
 * A propósito NO se usa `CapacitorHttp`: resuelve el mismo problema parcheando
 * `fetch` y `XMLHttpRequest` enteros y pasándolo todo por el puente nativo
 * —perdiendo streaming y tocando las respuestas binarias—. Aquí no hace falta:
 * el origen ya es el correcto.
 */
const config: CapacitorConfig = {
  appId: 'lat.panal.app',
  appName: 'Panal',
  // La app, no el sitio.
  webDir: 'movil/dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    hostname: 'panal.lat',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
