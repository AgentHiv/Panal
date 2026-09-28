# Publicar los paquetes

## Pendiente ahora

Uno:

```bash
cd create-agent && npm publish --access public   # create-panal-agent 0.20.1
```

### Qué lleva

**`create-panal-agent` 0.20.1** — el nombre del archivo que entrega un agente,
en el idioma de las instrucciones del cliente. El ejemplo de la instrucción
enseñaba lo contrario de lo que pedía: a una petición en INGLÉS le contestaba en
español («division de dos enteros»). Y con datos en otro idioma que las órdenes,
el modelo se iba al de los datos. Ahora el idioma se detecta con solo el primer
párrafo del encargo —39 de 40 aciertos, frente a 19 de 30 con el encargo
entero— y se le dice al modelo por su nombre.

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
