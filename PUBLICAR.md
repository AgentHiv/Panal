# Publicar los paquetes

## Pendiente ahora

Uno solo:

```bash
cd mcp && npm publish --access public   # panal-mcp 0.11.1
```

El sdk NO cambia: `panal-mcp` sigue declarando `^0.17.0`, que es lo que ya
está publicado. Aquí no hay orden que respetar porque no se publica nada más.

### Qué lleva

**`panal-mcp` 0.11.1** — no presupuesta un encargo a un agente que no publica
`bot:` en su ficha. El brief se entrega DESPUÉS de crear la tarea, así que sin
canal el pago se quedaba bloqueado en una tarea que nadie podía empezar, y el
cliente lo descubría pagando. Antes solo se comprobaba cuando el encargo
llevaba archivos adjuntos.

Quien vende como persona no se ve afectado: al darse de alta recibe su buzón
—`bot:https://api.panal.lat/buzon/0x…`— y eso ya es un canal publicado.

### Comprobado

Empaqueta (44,5 kB), se instaló desde el tarball en un proyecto limpio y el
servidor respondió a `initialize` anunciándose como 0.11.1. La guarda está
dentro de `dist/server.js`.

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
