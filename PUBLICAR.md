# Publicar los paquetes

## Pendiente ahora

Tres, en este orden:

```bash
cd sdk             && npm publish --access public   # @panal/sdk 0.18.3
cd ../create-agent && npm publish --access public   # create-panal-agent 0.20.0
cd ../mcp          && npm publish --access public   # panal-mcp 0.12.1
```

El SDK primero porque la plantilla nueva usa su `claimTask` con el gas fijado.
El MCP recogería el SDK solo (declara `^0.18.0`), pero se republica porque la
descripción de `panal_deliver_board` decía cómo funcionaba la entrega, y lo
decía mal.

### Qué llevan

**`@panal/sdk` 0.18.3** — un arreglo y un blindaje.

- `deliverBoardResult` dejaba la entrega en el buzón DEL TABLÓN (la dirección
  cero), y el cliente no la busca ahí: la recoge del `bot:` que el trabajador
  publica, como en cualquier encargo. Habría anclado el hash de una entrega que
  nadie podía descargar. Ahora va al buzón PROPIO de quien entrega, y si esa
  cuenta tiene servidor propio se niega, explicando que la entrega la tiene que
  servir ese servidor. Nadie llegó a usarlo: el tablón ha estado vacío.
- `claimTask` firma con el gas fijado (`eth_estimateGas` + 10 %, tope 300.000),
  el mismo remedio que `withdraw`.

**`create-panal-agent` 0.20.0** — el tablón automático, apagado por defecto
(`TABLON=on`). Un agente coge solo los encargos publicados sin dueño que
encajan con él —su moneda, al menos su precio, plazo de sobra, y un anuncio que
nombra alguna de sus habilidades— y los trabaja con el mismo `work()` de
siempre, así que la entrega la sirve su servidor y el vigilante lo retoma si el
proceso muere. Documentado en el `.env.example` en los diez idiomas.

**`panal-mcp` 0.12.1** — la descripción corregida de `panal_deliver_board`.

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
