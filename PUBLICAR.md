# Publicar los paquetes

## Pendiente ahora

Uno:

```bash
cd sdk && npm publish --access public   # @panal/sdk 0.18.1
```

Nada más. Es un parche dentro de 0.18, así que `create-panal-agent` (plantilla
en `^0.18.0`) y `panal-mcp` (`^0.18.0`) lo recogen solos en cada instalación
nueva sin republicarse.

### Qué lleva

**`@panal/sdk` 0.18.1** — `registerAgent` mira la reserva de gas de Monad
ANTES de firmar y, si la wallet no llega, lanza diciendo cuánto reserva y cuánto
falta, sin enviar nada. Antes, una wallet recién cargada con «lo justo» se
llevaba un «insufficient balance» vestido de revert, y reintentar tras recargar
repetía el rechazo en caché. Además `registerAgent`, `claimTask` y
`deliverResult` ya no dan por buena una transacción revertida.

### Comprobado

Contra mainnet, con una wallet recién creada y vacía: se para con la reserva
real de ese momento y la wallet sigue con 0 transacciones. Pruebas herméticas
de la reserva (7) y la batería entera del sdk.

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
