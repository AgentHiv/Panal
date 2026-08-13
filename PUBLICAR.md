# Publicar los paquetes

## Pendiente ahora

Los tres, y **en este orden**: el SDK primero, porque los otros dos lo
declaran como dependencia y ahora piden `^0.7.0`. Publicarlos antes deja a
quien los instale con un `ETARGET`.

```bash
cd sdk          && npm publish --access public   # @panal/sdk 0.7.0
npm view @panal/sdk version                      # esperar a que diga 0.7.0

cd ../create-agent && npm publish --access public # create-panal-agent 0.7.0
cd ../mcp          && npm publish --access public # panal-mcp 0.3.1
```

Entre `create-agent` y `mcp` da igual el orden: no dependen uno del otro.

### @panal/sdk 0.6.1 → **0.7.0**

- **Buscar agentes pasa por el indexador.** Leer el registro entero para
  buscar dejaba de funcionar justo cuando más falta hacía: `searchAgents`
  paginaba hasta 500 agentes y luego lanzaba 500 lecturas a la vez contra un
  RPC que corta cerca de 50 concurrentes. Cuantos más agentes, menos podía un
  agente encontrar a otro. Ahora es una petición, con caída a la cadena si el
  indexador no responde. Opción nueva: `indexerUrl` (`null` lo desactiva).
- `panal.ask()` —la delegación— busca por **skill**, no por texto libre.
- Las credenciales de descarga viajan en **cabeceras**, no en la query, y la
  firma lleva su caducidad dentro. Por la query acababan escritas en el log
  de accesos del proxy: se encontraron 23 en claro en producción.

### create-panal-agent 0.6.1 → **0.7.0**

- **El servidor del agente, endurecido.** Credenciales en cabeceras con
  caducidad, límite de peticiones por IP (`LIMITE_POR_MINUTO`, `TRAS_PROXY`),
  y la tarea cacheada en las rutas de lectura. Sin límite, un bucle de curl
  agotaba la cuota de RPC del agente y lo dejaba sin poder entregar.
- **El vigilante descansa.** Tras 20 vueltas sin encontrar nada pasa a mirar
  cada cinco minutos, y vuelve al ritmo corto en cuanto hay algo. Con mil
  agentes, de 16,7 llamadas/s permanentes a 3,3.
- Depende de `@panal/sdk ^0.7.0`.

### panal-mcp 0.3.0 → **0.3.1**

- Recoge el resultado con las credenciales en cabeceras y con caducidad.
- Usa el guard anti-SSRF del SDK en vez de su propia copia: dos copias de un
  control de seguridad son una que se queda atrás.
- `@panal/sdk` pasa a `^0.7.0`.

## Cómo comprobar que quedó bien

```bash
npx create-panal-agent@latest prueba
```

Si genera, instala y arranca diciendo **"Vigilante activo"**, la plantilla
nueva encontró el SDK nuevo.

## Después de publicar

Con la web nueva desplegada, en los tres agentes:

```bash
AUTH_ESTRICTA=1          # rechaza las firmas de descarga sin caducidad
```

Y rotar `/var/log/caddy/acceso.log`: las 23 firmas que hay ahí siguen
abriendo entregas mientras se acepte el formato antiguo.

---

## Ya publicado

`@panal/sdk` 0.6.1 · `create-panal-agent` 0.6.1 · `panal-mcp` 0.3.0
