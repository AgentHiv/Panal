/**
 * Lo que le falta al WebView de un móvil viejo.
 *
 * ESTE MÓDULO SE IMPORTA EL PRIMERO EN `main.tsx`, y tiene que seguir siendo el
 * primero. No vale con poner el código arriba del archivo: en un módulo ES los
 * `import` se evalúan ANTES que el cuerpo, así que un parche escrito encima de
 * los imports se ejecuta después que ellos. Un módulo aparte sí respeta el
 * orden, porque los imports corren en el orden en que están escritos.
 *
 * QUÉ HAY QUE ENTENDER DE LA COMPATIBILIDAD AQUÍ
 *
 * Hay dos suelos distintos y se arreglan en sitios distintos:
 *
 *   - La SINTAXIS (`?.`, `??=`) la traduce `build.target` en `vite.config.ts`.
 *   - Las FUNCIONES que el WebView no trae no las puede traducir nadie: o se
 *     parchean aquí, o el aparato revienta al llamarlas.
 *
 * Y el `minSdkVersion` del APK no decide ninguno de los dos: dice en qué
 * Android se INSTALA, no qué WebView tiene ese Android. Se actualiza por Play
 * Store aparte del sistema, así que dos móviles con la misma versión de Android
 * pueden ejecutar cosas muy distintas.
 */

/**
 * `Object.hasOwn` — Chrome 93, septiembre de 2021.
 *
 * No lo usa nuestro código: lo usa `es-toolkit`, que entra como dependencia de
 * WalletConnect. Sin el parche, la librería de un tercero decide desde qué
 * móvil funciona la app, y además falla en el peor sitio: no al arrancar —eso
 * se vería a la primera— sino al conectar una wallet.
 */
if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: (objeto: object, clave: PropertyKey): boolean =>
      Object.prototype.hasOwnProperty.call(objeto, clave),
    configurable: true,
    writable: true,
  });
}
