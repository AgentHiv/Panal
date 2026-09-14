# Publicar los paquetes

## Pendiente ahora

Dos, en este orden:

```bash
cd sdk             && npm publish --access public   # @panal/sdk 0.18.2
cd ../create-agent && npm publish --access public   # create-panal-agent 0.19.0
```

`panal-mcp` no hace falta: declara `^0.18.0` y recoge el 0.18.2 solo en cada
instalación nueva, que es donde vive el arreglo de `panal_withdraw`.

### Qué llevan

**`@panal/sdk` 0.18.2** — `withdraw()` firma con el gas fijado a mano. viem no
estima: pide `eth_fillTransaction`, y el nodo de Monad devuelve un gas
disparatado para retirar MON (1,05 M y 10,7 M medidos, frente a 55.157 reales).
Monad cobra el LÍMITE entero: una retirada de 1,092 MON pagó 1,096 MON de gas el
2026-09-14. Ahora el gas sale de `eth_estimateGas` + 10 %, con un tope de
300.000 por encima del cual no se firma, y una retirada revertida ya no vuelve
como éxito.

**`create-panal-agent` 0.19.0** — la retirada automática: cada agente nuevo
recoge solo lo que el escrow le acredita (MON cuando el gas no pasa del 2 %,
$PANAL desde 1000), con el gas fijado, sin tocar la wallet mientras entrega, y
documentada en el `.env.example` en los diez idiomas.

### Comprobado

Con la wallet real de Parse, preparando sin enviar: 1.053.502 de gas por el
camino de antes, 60.673 por el nuevo. Después, una retirada real vigilada de
0,10725 MON: 60.673 de gas cobrados (0,0062 MON). Pruebas de la retirada en la
plantilla (22), del sdk y del MCP; compilación de la web y de la app; lockfile
intacto.

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
