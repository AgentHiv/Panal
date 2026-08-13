# Publicar los paquetes

## Pendiente ahora

Los tres, y **en este orden**, porque el mcp depende del sdk:

```bash
cd sdk         && npm publish --access public   # @panal/sdk 0.8.0
cd ../mcp      && npm publish --access public   # panal-mcp 0.4.0
cd ../create-agent && npm publish --access public   # create-panal-agent 0.8.0
```

Si se publica el mcp antes que el sdk, su `^0.8.0` no resuelve y el
paquete no instala.

### Que llevan

**`@panal/sdk` 0.8.0** — las fichas de agente traen `verificado` (si su
dominio confirma esa direccion) y `nombre` (el de PanalNames, con como lo
consiguio). Solo `true` cuenta como verificado: un indexador viejo no
manda el campo, y tratar "no lo se" como "si" es al reves de lo que hay
que hacer con una insignia de confianza.

**`panal-mcp` 0.4.0** — cada ficha lleva una linea `Trust:` con eso
mismo. Importa mas aqui que en ningun sitio: quien lee esto elige agente
por su cuenta, y un suplantador con el nombre y la descripcion del
original cuesta una transaccion.

**`create-panal-agent` 0.8.0** — tres cosas que llevaban sin publicar:
la regla del idioma para alfabetos no latinos, el reclamo del nombre al
registrar el agente, y el `bin` sin `./`.

## LA REGLA, para no repetirlo

Antes de publicar, instalar el tarball de verdad:

```bash
cd <paquete> && npm pack
cd /tmp && npm init -y && npm install /ruta/<paquete>-<version>.tgz
```

Si eso falla, la publicacion tambien va a fallar — y una version rota en
npm no se puede borrar, solo deprecar. `npm publish` no comprueba que su
propio paquete sea instalable.

Comprobado para el sdk 0.8.0 y create-panal-agent 0.8.0: los dos
instalan, el sdk trae el campo nuevo y el binario se enlaza. El mcp no se
puede probar asi hasta que el sdk 0.8.0 este publicado.

## Las dependencias entre paquetes NO llevan `workspace:`

Van como rangos normales (`^0.8.0`). El `workspace:` es un protocolo de
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

`@panal/sdk` **0.7.0** · `panal-mcp` **0.3.2** · `create-panal-agent` **0.7.0**

Nota: se dijo que el `bin` con `./` dejaba `create-panal-agent` sin
binario. **No es cierto**: se instalo el 0.7.0 publicado y npm normaliza
el `./` al enlazar. Era un aviso, no una rotura. El arreglo sigue siendo
correcto, pero el paquete publicado funciona.
