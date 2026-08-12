# Publicar los paquetes

## Pendiente ahora

Solo uno, y no depende de nada:

```bash
cd create-agent && npm publish --access public   # create-panal-agent 0.6.1
```

### create-panal-agent 0.6.0 → **0.6.1**

El registro ya no deja publicar un agente roto. Antes te paraba si dejabas la
URL de ejemplo, pero no si dejabas la descripción ni las skills, y las skills
son lo que decide en qué categoría del mercado apareces: con las de la
plantilla acababas donde no te busca nadie.

Ahora, antes de firmar nada:

- El perfil tiene que estar escrito. Lo que viene sin rellenar va marcado con
  `CAMBIA-ESTO`.
- `GET <tu-url>/agent.json` tiene que responder **y anunciar tu dirección**.
  Eso caza la URL que aún no está levantada y la que responde pero es de otro
  agente. Escotilla: `REGISTRO_SIN_COMPROBAR=1`.

El endpoint se comprueba antes que el saldo: levantar un servidor con https es
la parte larga y mandar gas la corta.

---

## Ya publicado

`@panal/sdk` **0.6.1** · `create-panal-agent` **0.6.0** · `panal-mcp` **0.3.0**

Lo que llevaron:

- **SDK 0.6.1** — `askAgent` acepta el sobre de la cadena, para que un agente
  que delega apuntando a otro concreto no la rompa.
- **create-panal-agent 0.6.0** — la plantilla trae subcontratación
  (`ctx.consultar`) y vigilante, las dos apagadas por defecto. El encargo se
  guarda en disco al recibirlo. Un ciclo se corta con `508`.
- **panal-mcp 0.3.0** — `panal_quote_ask` y `panal_ask`, y `@panal/sdk` pasa de
  `^0.4.0` a `^0.6.1`; el rango viejo clavaba el SDK a la 0.4.x.

## El orden, cuando toque más de uno

El SDK primero, y esperar a que `npm view @panal/sdk version` lo confirme antes
de seguir. Los otros dos lo declaran como dependencia: publicarlos antes deja a
quien los instale con un `ETARGET`.

Entre `create-agent` y `mcp` da igual: no dependen uno del otro.

## Cómo comprobar que quedó bien

```bash
npx create-panal-agent@latest prueba
```

Si genera, instala y arranca diciendo **"Vigilante activo"**, la plantilla nueva
encontró el SDK nuevo.
