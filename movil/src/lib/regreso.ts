/**
 * Panal — cómo se vuelve a la wallet para firmar.
 *
 * EL FALLO QUE ARREGLA, dicho entero porque no se ve mirando nuestro código.
 *
 * Conectar funcionaba: la hoja saca la URI `wc:` y Android abre la wallet. Lo
 * que no funcionaba era todo lo demás. Una vez conectados, cada firma —pagar
 * un mensaje, bloquear un encargo, aprobar un pago— viaja por el relé hasta la
 * wallet, que está EN SEGUNDO PLANO. Nadie la trae al frente, así que la
 * petición se queda ahí esperando y la persona ve una app parada: ni firma, ni
 * error, ni nada. Justo lo que se dijo: «la aplicación no envía la firma».
 *
 * Sí la envía. Lo que no hace es ir a buscar a la wallet.
 *
 * WalletConnect trae eso resuelto y aquí estaba desactivado sin saberlo. En
 * `@walletconnect/utils` la función que redirige empieza así:
 *
 *     async function Si({ id, topic, wcDeepLink }) {
 *       if (!wcDeepLink) return;                       // ← se sale por aquí
 *
 * y `wcDeepLink` sale de `localStorage['WALLETCONNECT_DEEPLINK_CHOICE']`, que
 * escribe el modal de Reown al elegir wallet. Nosotros quitamos ese modal a
 * propósito —viene en inglés, trae su estética y descarga su catálogo— así que
 * nadie escribía esa clave y la redirección se salía en la primera línea, en
 * silencio.
 *
 * Y aunque se escribiera, la librería redirige con `window.open`, que dentro
 * de un WebView de Capacitor abre una ventana del propio WebView en vez de
 * entregarle la URL a Android. Por eso esto no rellena aquella clave: hace la
 * redirección por su cuenta, con `location.href`, que es lo que sí pasa por
 * `shouldOverrideUrlLoading` y sale como intent (ver `lib/wallets.ts`).
 *
 * DE DÓNDE SALE EL ENLACE
 *
 * De la propia wallet: al conectar manda su `redirect` en los metadatos de la
 * sesión, que es exactamente «así se vuelve a mí». Si no lo manda —las hay—,
 * queda el enlace que se tocó al conectar. Y si tampoco, la pantalla enseña un
 * botón para ir a mano, porque una redirección puede fallar siempre y quedarse
 * sin saber que hay algo esperando es el fallo que estamos arreglando.
 */

export * from '@/lib/vueltaWallet';
