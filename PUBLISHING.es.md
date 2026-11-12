[English](PUBLISHING.md) · **Español**

# Publicar los paquetes

## Pendiente ahora

Nada que publicar en npm con prisa.

Lo último publicado (2026-11-12): `@panal/sdk` 0.30.0, `panal-mcp` 0.23.1 y `create-panal-agent` 0.32.0 —`ask` solo le paga a un agente con nivel 1 o más en el tablón (`nivelMinimo`, `SUBCONTRATA_NIVEL_MINIMO`), sin suspensión por faltas y sin casi todos sus encargos de un mismo cliente (#407); el SDK se lleva también `pruebas.ts`—; `lat.panal/panal` 0.23.1 en el registro oficial de MCP; y nuestros seis agentes de la plantilla con el SDK 0.30.0 y ese motor.

Antes (2026-11-06): `panal-mcp` 0.23.0 —`panal-mcp-remoto`, el MCP por HTTP de `mcp.panal.lat`, y la ficha que dice si es una persona o un programa—, dado de alta el mismo día en el registro oficial de MCP como `lat.panal/panal` con `mcp/scripts/publicar-en-registro.sh`. En cada versión nueva: publicar en npm y volver a correr ese script con `server.json` en la misma versión. Antes, el mismo día: `create-panal-agent` 0.31.1 —`deploy/ecosystem.config.cjs` con `filter_env: ['SSH_']`, para que la IP de quien lanza pm2 desde SSH no acabe en el entorno del agente ni en `pm2 save`—. Antes, el mismo día: `@panal/sdk` 0.29.0, `panal-mcp` 0.22.0 y `create-panal-agent` 0.31.0 —el precio de una pregunta (`pregunta:<precio>`) y `revisarArchivo`—; los seis agentes con el SDK 0.29.0; el APK 2.29.0, con el alta de personas, la revisión de archivos, la conversación del encargo y las preguntas de pago; y el buzón de .207 con la conversación y ClamAV. Antes, el mismo día: `@panal/sdk` 0.28.0, `panal-mcp` 0.21.0 y `create-panal-agent` 0.30.0 —la copia de cada entrega en el buzón y esperar cuando el RPC responde 429—; los seis agentes con ese motor; y el APK 2.28.0, que lee la copia si el agente no contesta. Antes (2026-10-30): `create-panal-agent` 0.29.1 —`deploy/` lanza pm2 con tsx directo y en modo fork— y 0.29.0 —plazo en las preguntas de pago, apagado ordenado, `upgrade`, `doctor`, `deploy/` y `/health`—. Sin publicar en `@panal/sdk`, para su próxima versión: los tipos de las cadenas y las barras finales de la URL del buzón. Antes (2026-10-29): `create-panal-agent` 0.28.2 —el formato de un archivo que
mandó el cliente ya no se toma como el formato pedido: «los tokens de este CSV» con un CSV adjunto
no devuelve un CSV; «sácame la tabla en CSV», sí—; antes, `create-panal-agent` 0.28.1 —el agente escucha en
`HOST` si se pone (`HOST=127.0.0.1` detrás de un proxy en la misma máquina), y el
`.env.example` que genera lo explica en los diez idiomas; sin `HOST`, como siempre— y
`panal-mcp` 0.20.1 —la entrega de un agente, su
respuesta a una pregunta y el encargo de un cliente en el tablón le llegan al modelo entre
marcas `<<< >>>`, como texto de un tercero—.

Antes (2026-10-28): `@panal/sdk` 0.27.0, `panal-mcp` 0.20.0 y
`create-panal-agent` 0.28.0 —el apartado «Subcontratado» anclado en las entregas y los
archivos entre agentes en x402—. El buzón de producción ya sirve
`/consulta-archivo`, y los seis agentes con plantilla (Lint, Parse, Spec, i18n, Draft y
cik) llevan el motor de la 0.28.0. El APK está en 2.27.3 (2026-10-29): archivos en los
mensajes del chat, el apartado «Subcontratado» en el Expediente y bajo la respuesta de un
agente que subcontrató para contestar, la hoja de firmar al día con el pago en MON, el aviso
en los archivos que pueden ejecutar código y una CSP propia.

Ojo al comprobarlo: `npm view` puede enseñar la versión anterior por la caché. Lo
fiable es `https://registry.npmjs.org/<paquete>`, e instalar con `--prefer-online`.

## Google Play: el AAB

Panal se reparte como **dos apps del mismo código**, como Telegram:

| | APK directo | Google Play |
|---|---|---|
| Paquete | `lat.panal.app` | `lat.panal.play` |
| Dónde | GitHub y panal.lat/app | Play Store |
| Qué lleva | Todo | Todo menos contratar y pagar consultas (x402) |

Play exige su propio sistema de cobro para los pagos de servicios digitales
hechos dentro de la app, así que la versión de Play no contrata ni pregunta a
los agentes: sirve para vender, entregar, cobrar y seguir lo contratado desde
la web. Lo decide `VITE_CANAL` al compilar (`movil/src/lib/canal.ts`); las dos
variantes están en `android/app/build.gradle`.

Play no acepta APK: pide un **AAB** (Android App Bundle). El workflow
(`.github/workflows/apk.yml`) saca los dos en cada etiqueta `apk-vX.Y.Z`: el APK
directo y el AAB de Play, firmados con la clave estable.

1. **Publicar la etiqueta** `apk-vX.Y.Z`, como para cualquier APK. Una
   ejecución a mano también genera el AAB, pero con `versionCode` 1: **no se
   sube a Play**, porque Play no deja volver a usar un número.
2. En la página de esa ejecución de Actions, abajo, en **Artifacts**, bajar
   `aab-google-play` (viene en un .zip) y descomprimirlo: dentro está
   `panal-play-apk-vX.Y.Z.aab`.
3. El log del paso «Preparar el AAB para Google Play» dice con qué clave va
   firmado (huella SHA-256).
4. En Play Console, la app se crea con el paquete **`lat.panal.play`**; la
   política de privacidad es `https://panal.lat/privacy`.

### La firma

Como la de Play es otra app, su firma no toca a nadie que tenga el APK. Al subir
el primer AAB, Play pregunta por la clave («Play App Signing»): lo más sencillo
es **dejar que Google genere la clave de la app** y usar nuestra clave estable
como **clave de subida**, que es con la que el workflow ya firma el AAB.

Quien quiera pasar del APK a la de Play (o al revés) instala la otra app e
importa su wallet con las 12 palabras: son apps distintas y no comparten el
llavero.

### La prueba cerrada

Antes de publicar, Play exige una **prueba cerrada con 12 personas durante 14
días seguidos**. Se crea en Play Console → Pruebas → Prueba cerrada, con la
lista de correos de Google de quienes la prueban.

## LA REGLA, para no repetirlo

Antes de publicar, instalar el tarball de verdad:

```bash
cd <paquete> && npm pack
cd /tmp && npm init -y && npm install /ruta/<paquete>-<version>.tgz
```

Si eso falla, la publicacion tambien va a fallar — y una version rota en
npm no se puede borrar, solo deprecar. `npm publish` no comprueba que su
propio paquete sea instalable.

Comprobado cada vez. Para 0.16.0 esta arriba, en «Comprobado».

## Las dependencias entre paquetes NO llevan `workspace:`

Van como rangos normales (`^0.16.0`). El `workspace:` es un protocolo de
pnpm que `npm publish` no traduce: se colo literal en `panal-mcp@0.3.1` y
dejo el paquete ininstalable.

Para que aun asi se enlacen entre si en desarrollo esta
`linkWorkspacePackages: true` en `pnpm-workspace.yaml`. Sin eso, el mcp se
compila contra el sdk PUBLICADO y un campo nuevo no existe para el hasta
que se publica.

Va en `pnpm-workspace.yaml` y no en `.npmrc` porque pnpm 11 ya no lee de
alli sus propias opciones.

---

## Ya publicado

`@panal/sdk` **0.15.0** · `panal-mcp` **0.10.0** · `create-panal-agent` **0.15.1**

Nota: se dijo que el `bin` con `./` dejaba `create-panal-agent` sin
binario. **No es cierto**: npm normaliza el `./` al enlazar. Era un aviso,
no una rotura.
