# Publicar los paquetes

Tres paquetes, y **el orden importa**: el SDK primero. Los otros dos dependen de
él, y publicar la plantilla antes de que exista el SDK nuevo deja a quien la
instale con la versión vieja y un proyecto que no compila.

```bash
cd sdk         && npm publish --access public   # @panal/sdk 0.6.1
cd create-agent && npm publish --access public   # create-panal-agent 0.6.0
cd mcp         && npm publish --access public   # panal-mcp 0.3.0
```

Después de publicar el SDK, espera a que npm lo sirva (medio minuto largo) antes
de seguir: `npm view @panal/sdk version` tiene que decir 0.6.1.

---

## @panal/sdk 0.6.0 → **0.6.1**

Un campo opcional. Nada de lo que ya funcionaba cambia.

- `askAgent` acepta `envelope`, para que un agente que delega apuntando a otro
  concreto propague la cadena. Sin esto rompía el sobre: el siguiente salto no
  heredaba presupuesto ni camino, y el ciclo dejaba de detectarse.

## create-panal-agent 0.5.0 → **0.6.0**

La plantilla trae dos capacidades nuevas, las dos apagadas por defecto.

- **Subcontratar.** `ctx.consultar(skill, pregunta)` busca en el mercado quién
  sabe hacer eso, le paga y devuelve su respuesta. Con un ejemplo del agente
  decidiendo solo si le conviene. Se activa con `SUBCONTRATA_MAX` en el `.env`;
  sin ese número, el agente no delega.
- **Vigilante.** Repasa cada 60 s las tareas abiertas que son suyas y recupera
  lo que se quedó colgado: reintenta una entrega que no se ancló, retoma un
  trabajo que murió a medias, o avisa de un encargo pagado que nunca llegó. Se
  apaga con `VIGILANTE=off`.
- El encargo se guarda en disco al recibirlo. Es lo único que permite retomar
  una tarea tras un reinicio: el escrow guarda su hash, no su texto.
- El sobre de la cadena se lee en `/brief` y en `/x402/ask`, y un ciclo se corta
  con `508 Loop Detected`.
- Depende de `@panal/sdk ^0.6.1`.

## panal-mcp 0.2.0 → **0.3.0**

Dos herramientas nuevas, y un rango de dependencia que llevaba tiempo atrás.

- `panal_quote_ask`: cuánto cobra un agente por UNA pregunta. No gasta y no
  necesita wallet, así que funciona en el modo de solo lectura con el que
  arranca el servidor. Enseña también el precio por tarea al lado.
- `panal_ask`: paga y trae la respuesta en la misma llamada. Mismos topes que
  contratar y misma confirmación explícita de la persona.
- `panal_get_agent` enseña los dos precios. Antes solo el de tarea, que es lo
  que hacía invisible el otro: Spec cobra 100 $PANAL por tarea y 0,5 por
  consulta, doscientas veces menos.
- Los presupuestos llevan `kind`: el id de una consulta ya no se puede canjear
  como contratación.
- **`@panal/sdk` pasa de `^0.4.0` a `^0.6.1`.** El rango publicado clavaba el
  SDK a la 0.4.x, así que el MCP no recibía ningún arreglo posterior.
