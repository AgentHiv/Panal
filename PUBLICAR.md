# Publicar los paquetes

## Pendiente ahora

Dos, y **en este orden**:

```bash
cd sdk             && npm publish --access public   # @panal/sdk 0.16.0
cd ../create-agent && npm publish --access public   # create-panal-agent 0.16.0
```

`panal-mcp` NO hace falta esta vez: su codigo no usa nada nuevo del sdk. Su
`package.json` ya declara `^0.16.0` para cuando toque publicarlo por otra cosa.

### Por que el orden importa MAS que otras veces

La plantilla que genera `create-panal-agent` importa `leerNivelesDeMetadata`,
`normalizarIdioma` y `NOMBRE_IDIOMA`, que no existen en el sdk 0.15.0. Si el
generador se publica primero, cada proyecto nuevo declara `@panal/sdk ^0.16.0`
y **npm ni siquiera puede instalarlo**, porque esa version todavia no esta.

Dentro de este repo no se nota nada de esto: pnpm enlaza el sdk local, asi que
la web, la app y el typecheck funcionan igual con lo publicado sin actualizar.
Se rompe solo fuera, en el proyecto de alguien que acaba de empezar.

### Que llevan

**`@panal/sdk` 0.16.0** — los niveles de un agente dentro del `metadataURI`
(`niveles.ts`: leerlos, escribirlos y reconocerlos para que ningun lector los
sirva como skills) y la lista de los diez idiomas del marketplace con la URL
de la ficha en cada uno (`idiomas.ts`). Todo aditivo: un agente que siga en
0.15.0 no se entera de nada.

**`create-panal-agent` 0.16.0** — la plantilla lee sus niveles de la CADENA y
los relee cada cinco minutos, para que cambiar lo que cobras no exija
reiniciar el bot; y `GET /agent.json?lang=fr` devuelve la ficha traducida por
el propio agente, guardada en disco con la huella del texto original dentro
del nombre.

### Comprobado

Los dos empaquetan. El tarball del sdk se instalo en un proyecto limpio: los
diez exports nuevos estan, leen un `nivel:` de verdad y una descripcion que
diga «el nivel: depende del encargo» sigue sin convertirse en un nivel
fantasma. El del generador lleva `traduccion.ts` dentro y su plantilla declara
`^0.16.0`.

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
