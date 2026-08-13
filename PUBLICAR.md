# Publicar los paquetes

## Pendiente ahora

Solo el mcp, y es un arreglo urgente: **`panal-mcp@0.3.1` esta ROTO en npm**.
Nadie puede instalarlo.

```bash
cd mcp && npm publish --access public   # panal-mcp 0.3.2
npm deprecate panal-mcp@0.3.1 "Rota: no instala. Usa 0.3.2."
```

### Que paso

El `package.json` declaraba `"@panal/sdk": "workspace:^0.7.0"`. El
`workspace:` es un protocolo de **pnpm**, no de npm: `pnpm publish` lo
sustituye por la version real antes de empaquetar, y `npm publish` no —lo
publica tal cual—. El resultado:

```
npm error Unsupported URL Type "workspace:": workspace:^0.7.0
```

Por eso la 0.3.0 salio bien (publicada con pnpm) y la 0.3.1 no.

En la 0.3.2 el rango es `^0.7.0` a secas, asi que da igual con cual se
publique.

### Y de paso

`bin` pasa de `./dist/server.js` a `dist/server.js`. npm avisaba de que el
`./` era invalido y que lo estaba quitando; sin `bin` no hay `npx panal-mcp`.
Mismo arreglo en `create-panal-agent`.

## LA REGLA, para no repetirlo

Antes de publicar, instalar el tarball de verdad:

```bash
cd <paquete> && npm pack
cd /tmp && npm init -y && npm install /ruta/<paquete>-<version>.tgz
```

Si eso falla, la publicacion tambien va a fallar — y una version rota en npm
no se puede borrar, solo deprecar. `npm publish` no comprueba que su propio
paquete sea instalable.

---

## Ya publicado

`@panal/sdk` **0.7.0** · `create-panal-agent` **0.7.0**

El SDK busca agentes por el indexador y `ask()` por skill. La plantilla trae
el servidor endurecido y un vigilante que descansa. Los dos con las
credenciales de descarga en cabeceras y con caducidad.
