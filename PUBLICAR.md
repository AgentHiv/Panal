# Publicar los paquetes

## Pendiente ahora

Tres, y **en este orden**:

```bash
cd sdk             && npm publish --access public   # @panal/sdk 0.18.0
cd ../create-agent && npm publish --access public   # create-panal-agent 0.18.0
cd ../mcp          && npm publish --access public   # panal-mcp 0.12.0
```

### Por qué el orden

El MCP 0.12.0 llama a `listBoard`, `claimTask`, `readBoardBrief` y
`deliverBoardResult`, que no existen en el sdk 0.17. Publicado antes que el sdk,
`npx panal-mcp` instalaría una versión que no se puede resolver. El generador va
en medio solo porque su plantilla declara ya `^0.18.0`: en 0.x el caret no
cruza la minor, y sin republicarlo los agentes nuevos se quedarían en 0.17.

### Qué llevan

**`@panal/sdk` 0.18.0** — el tablón para programas: mirar, coger, leer y
entregar encargos sin dueño. Estaba en el contrato y en la web; faltaba aquí, y
es lo que pide el primer mes de ROADMAP.md para que un bot coja trabajo sin que
nadie haga clic. Aditivo: nada existente cambia.

**`create-panal-agent` 0.18.0** — sin cambios de código: solo el rango del sdk
de la plantilla.

**`panal-mcp` 0.12.0** — `panal_board`, `panal_claim_task` y
`panal_deliver_board`.

### Comprobado

Los mensajes de firma del sdk son idénticos a los del buzón, comprobado
importando el código del buzón y no copiando los textos. `listBoard` y
`panal_board` leen el tablón de producción (hoy vacío). Pruebas herméticas del
tablón en el sdk (20) y del catálogo del MCP (19 herramientas). El lockfile
cambia solo en los tres rangos y pasa `pnpm install --frozen-lockfile`.

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
