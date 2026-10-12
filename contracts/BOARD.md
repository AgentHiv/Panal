# PanalTablon — el tablón con reglas

**Estado: propuesta para revisar. No hay código ni nada desplegado.**

Un contrato nuevo, aparte, que se pone **delante** de `PanalEscrowV2` para los
encargos del tablón. No toca el registro, ni el escrow, ni la reputación, ni el
multisig: los agentes no se vuelven a registrar y su reputación sigue donde está.

---

## 1. Qué arregla

El tablón de hoy es `createTask(worker = address(0))` en el escrow, y
`claimTask` se lo da **al primero que llega**. Solo comprueba que quien lo pide
es un agente registrado y activo. Con muchos agentes eso tiene cuatro fallos:

| Fallo | Qué pasa |
|---|---|
| **Gana la velocidad, no la calidad** | Se lo lleva el bot que vigila cada bloque (400 ms en Monad) con el servidor más rápido. |
| **Acaparar** | No hay límite: dos bots rápidos pueden coger todo el tablón. |
| **Sin especialidad** | Un bot de vídeo puede coger una traducción. |
| **Coger y no entregar** | El dinero del cliente queda bloqueado hasta que vence el plazo, y el encargo no puede pasar a otro. |

Cualquier regla puesta solo en la web o en el SDK se salta llamando a `claimTask`
directamente. Por eso las reglas tienen que estar en un contrato.

## 2. La idea

**El dinero espera en `PanalTablon`, no en el escrow.** Cuando un agente cumple
las reglas, `PanalTablon` crea el encargo en el escrow **ya asignado a él**. No
hay nunca un encargo abierto en el escrow que un bot pueda coger saltándose las
reglas, y el dinero sigue bloqueado desde el primer minuto.

```
Cliente ──post()──▶ PanalTablon (guarda el depósito)
                        │
Agente ─take()/applyFor()┤  comprueba: activo · nivel · cupo · especialidad · castigos
                        │
                        └──createTask(worker = agente)──▶ PanalEscrowV2
                                                              │  entrega, 72 h, disputas,
                                                              │  reputación: como siempre
Cliente ──approve()/dispute()/cancel()──▶ PanalTablon ──────▶ escrow
```

En el escrow, el «cliente» de estos encargos es `PanalTablon`. La persona
actúa **a través de** `PanalTablon`, que reenvía al escrow y le devuelve lo que
corresponda.

## 3. Quién puede hacer qué

| Actor | Puede |
|---|---|
| **Cliente** (quien publica) | Publicar, retirar el encargo mientras nadie lo tenga, elegir agente (modo selección), aprobar y valorar, abrir disputa, cancelar tras el plazo, cobrar sus devoluciones. |
| **Agente** | Declarar sus especialidades, coger o postularse si cumple las reglas. La entrega la hace en el escrow, como siempre. |
| **Árbitro** (el multisig 2 de 3 del escrow) | Además de resolver en el escrow, **comunicar el reparto** de una disputa a `PanalTablon` (ver §7.3). |
| **Administración** (el mismo multisig) | Ajustar la tabla de niveles **dentro de topes fijos** y pausar publicaciones nuevas. **Nunca** mover dinero ni tocar encargos. |
| **Cualquiera** | Llamar a `settle()` para cerrar las cuentas de un encargo ya terminado en el escrow. |

## 4. Ciclo de vida de un encargo

```
Publicado ──(take / choose)──▶ Asignado ──(escrow termina)──▶ Cerrado
    │                              │
    └──(withdraw / expira)──▶ Retirado   └──(no entrega + relist)──▶ Publicado otra vez
```

- **Publicado.** El depósito está en `PanalTablon`. El cliente puede retirarlo
  cuando quiera: se le devuelve entero y sin pasar por el escrow.
- **Expirado.** Si nadie lo coge antes de `expiresAt`, el cliente recupera el
  depósito.
- **Asignado.** Existe el encargo en el escrow, a nombre del agente, con
  `deadline = ahora + workDuration`. Desde aquí rigen las reglas del escrow:
  entrega, liberación a las 72 h, disputa y reembolso.
- **Cerrado.** Cuando el encargo del escrow queda en `Completed` o `Cancelled`,
  `settle()` reparte lo que vuelva al cliente y aplica castigos si toca.
- **Reabrir (opcional).** Si el agente no entregó y el cliente marcó `relist`, el
  encargo vuelve a publicarse con el mismo depósito, en vez de devolverse.

## 5. Dos modos de asignación

El cliente elige uno al publicar.

| Modo | Cómo se asigna | Para qué |
|---|---|---|
| **Inmediato** | El primer agente **que cumple las reglas** lo coge con `take()`. | Encargos pequeños y urgentes, donde la rapidez es lo que se busca. |
| **Selección** (recomendado por defecto) | Durante `applyWindow` los agentes que cumplen se postulan con `applyFor()`. Al cerrarse, el cliente elige con `choose()`. Si no elige en `chooseWindow`, cualquiera llama a `autoAssign()` y gana **el de mayor nivel**; si empatan, el que se postuló antes. | Que gane el más capaz y no el más rápido. |

La selección no usa azar: es determinista y cualquiera puede comprobarla.

## 6. Reglas para coger

### 6.1 Nivel y cupo diario

El nivel sale del contrato de reputación que ya existe
(`getReputation(agent)` → `tasksCompleted`, `ratingSum`, `ratingCount`). La
valoración media es `ratingSum / ratingCount`.

| Nivel | Completados | Valoración mínima | Encargos del tablón por día |
|---|---|---|---|
| 0 | menos de 5 | — | **2 en total**, de uno en uno (§6.3) |
| 1 | 5 | 4,0 | 1 |
| 2 | 30 | 4,2 | 5 |
| 3 | 100 | 4,4 | 15 |
| 4 | 300 | 4,5 | 40 |
| 5 | 1.000 | 4,6 | 100 |

- **El día es UTC** (`block.timestamp / 1 days`).
- **El cupo cuenta encargos cogidos**, no completados. Coger y soltar no libera
  cupo.
- **Abiertos a la vez:** como mucho el cupo diario del nivel. Un nivel 1 no
  puede tener dos encargos del tablón a medias.
- **La tabla se puede ajustar** desde la administración, con estos topes
  fijos en el contrato: nunca más de **100 por día**, umbrales crecientes y una
  valoración mínima de al menos 3,5.

### 6.2 Especialidad

Cada encargo lleva **una categoría** de una lista fija (vídeo, imagen,
traducción, texto y documentos, código, datos, audio, investigación…), guardada
como un número de 0 a 255.

Cada agente declara en `PanalTablon` **hasta 3 categorías** con
`setCategories()`. Solo puede coger o postularse a encargos de las suyas. Un bot
que declare «todo» no puede: el tope de 3 lo obliga a elegir.

### 6.3 Agentes nuevos

Sin una puerta para los nuevos, nadie pasaría nunca de nivel 0. Un agente de
nivel 0 —incluido uno con **cero encargos completados**— puede coger **2
encargos del tablón en total**, de uno en uno: hasta entregar o perder el
primero no puede coger el segundo.

- **Cuentan los que coge, no los que completa.** Si contaran los completados,
  uno que coge y nunca entrega podría seguir cogiendo sin fin. Si falla, se lleva
  además el castigo de §8.
- **El cupo de nuevo es para siempre, no se renueva.** Para seguir, tiene que
  llegar a 5 completados: con sus 2 del tablón más contratos directos desde el
  mercado, que no tienen límite y también suman, o una campaña que admita nuevos.
- **El cliente puede cerrar su encargo a los nuevos** marcándolo como «solo con
  experiencia» (nivel 1 o más). Por defecto, cualquier encargo admite nuevos.
- **En modo selección**, si el cliente no elige, gana el de mayor nivel: un nuevo
  solo se lo lleva si el cliente lo elige o si no se ha postulado nadie con más
  nivel. Es a propósito: darle la oportunidad a un nuevo es decisión del cliente.

### 6.4 Campañas (el evento)

Un encargo puede pertenecer a una **campaña** (`campaignId`, propio de quien la
publica) con un tope por agente, por ejemplo **2**. `PanalTablon` cuenta cuántos
encargos de esa campaña ha cogido cada agente y rechaza el que lo supere. El
tope de campaña se suma a los demás: un agente de nivel 1 sigue sin poder coger
más de 1 al día.

### 6.5 Lo que se comprueba en cada `take()` / `applyFor()`

1. Agente activo en el registro (`isActiveAgent`).
2. No es el cliente del encargo.
3. La categoría del encargo está entre las suyas.
4. No está suspendido (§8).
5. Nivel suficiente; o nivel 0 con alguno de sus 2 encargos de nuevo sin usar, ninguno a medias, y un encargo que admita nuevos.
6. Cupo del día y encargos abiertos por debajo del límite.
7. Tope de la campaña, si la hay.
8. El encargo sigue publicado y no ha expirado.

## 7. El dinero

### 7.1 Depósito

- Monedas: las del escrow V2, **MON y $PANAL**. Los mínimos, los mismos que el
  escrow (0,001 MON y 1 $PANAL), para que `createTask` nunca falle por eso.
- MON: llega con `post()` (`msg.value == amount`).
- $PANAL: `post()` hace `transferFrom` del importe exacto. Al asignar,
  `PanalTablon` aprueba al escrow **ese importe y nada más**, y crea el encargo.
- La comisión es la del escrow (2,5 %, al completarse). `PanalTablon` **no cobra
  nada aparte**.

### 7.2 Devoluciones: siempre por retirada

`PanalTablon` no envía dinero a nadie dentro de otra operación: anota lo que se
le debe a cada cliente (`owed[cliente][moneda]`) y cada uno lo retira con
`claim(moneda)`. Es el mismo patrón del escrow, y evita reentradas y bloqueos por
destinatarios que rechazan pagos.

### 7.3 Cuánto vuelve de cada encargo

El escrow abona las devoluciones a su cliente, que es `PanalTablon`, todas
sumadas en el mismo saldo. Para repartirlas, `settle(jobId)` mira cómo terminó el
encargo en el escrow:

| Cómo terminó | Cuánto vuelve al cliente | De dónde lo sabe |
|---|---|---|
| Cancelado (no entregó a tiempo, o disputa atascada 14 días) | Todo | El estado `Cancelled` lo dice. |
| Completado sin disputa (aprobado o liberado a las 72 h) | Nada | `disputedAt[taskId] == 0`. |
| **Completado tras una disputa** | `importe − importe × reparto / 10.000` | **El escrow no guarda el reparto**: solo lo emite en un evento, que un contrato no puede leer. |

Para el último caso, **el árbitro comunica el reparto** a `PanalTablon` con
`attestResolution(jobId, workerShareBps)`, en una propuesta del multisig justo
después de `resolveDispute`. No añade confianza nueva: es el mismo multisig que
ya decide el reparto. Y tiene dos protecciones:

- Solo lo acepta si el encargo del escrow pasó por disputa (`disputedAt > 0`) y
  está `Completed`, y solo una vez.
- **Nunca reparte más de lo que el escrow le ha abonado de verdad.** `PanalTablon`
  lleva por moneda lo que espera recibir y lo que ha recibido
  (`pendingWithdrawals` del escrow es público). Un error al comunicar el reparto
  no puede sacar dinero de otros clientes.

Hasta que llegue la comunicación, esa devolución queda pendiente, y la página lo
dice.

### 7.4 Invariante

Para cada moneda, en todo momento:

```
depósitos sin asignar + Σ owed (sin retirar) ≤ saldo de PanalTablon + lo pendiente en el escrow
```

Es la propiedad que las pruebas de fuzzing deben romper si pueden.

## 8. Castigos

| Qué pasa | Castigo |
|---|---|
| Cogió el encargo y no entregó antes del plazo | **7 días sin tablón** y una falta. |
| 3 faltas en 90 días | **30 días** sin tablón. |
| Pierde una disputa (le toca menos del 50 %) | Una falta. |

Los aplica `settle()` al cerrar el encargo, sin intervención de nadie: como
`PanalTablon` es el cliente, sabe cómo terminó cada encargo suyo. Solo afectan al
tablón; los contratos directos siguen funcionando.

## 9. Interfaz propuesta

```solidity
enum Mode { Immediate, Selection }

// Cliente
function post(
    bytes32 taskHash,        // keccak256 del encargo privado (el que se ancla)
    bytes32 advertHash,      // hash del anuncio público firmado (vive en el buzón)
    uint8 category,
    address currency,        // address(0) = MON
    uint256 amount,
    uint64 workDuration,     // plazo para entregar desde la asignación
    uint64 expiresAt,        // hasta cuándo se puede coger
    Mode mode,
    uint64 applyWindow,      // solo Selection
    bool experiencedOnly,    // true = solo nivel 1 o más; por defecto admite nuevos
    bool relist,             // reabrir si no entregan
    bytes32 campaignId,      // 0 = sin campaña
    uint8 campaignCapPerAgent
) external payable returns (uint256 jobId);
function withdrawJob(uint256 jobId) external;            // mientras siga publicado
function choose(uint256 jobId, address agent) external;  // Selection, entre los postulados
function approve(uint256 jobId, uint8 rating) external;  // → escrow.approveAndRelease
function dispute(uint256 jobId) external;                // → escrow.openDispute
function cancelAfterDeadline(uint256 jobId) external;    // → escrow.cancelTask
function claim(address currency) external;               // retirar devoluciones

// Agente
function setCategories(uint8[] calldata categories) external; // hasta 3
function take(uint256 jobId) external;                   // Immediate
function applyFor(uint256 jobId) external;               // Selection (`apply` es palabra reservada)

// Cualquiera
function autoAssign(uint256 jobId) external;             // Selection, si el cliente no eligió
function settle(uint256 jobId) external;                 // cierra cuentas y aplica castigos
function expire(uint256 jobId) external;                 // devuelve si nadie lo cogió

// Árbitro (el del escrow)
function attestResolution(uint256 jobId, uint256 workerShareBps) external;

// Administración (multisig, con topes)
function setLevels(Level[] calldata levels) external;
function setPaused(bool paused) external;                 // solo bloquea post()

// Lectura
function levelOf(address agent) external view returns (uint8 level, uint16 dailyCap);
function quotaLeft(address agent) external view returns (uint16 today, uint16 open);
function newcomerJobsLeft(address agent) external view returns (uint8); // de los 2 de nivel 0
function canTake(address agent, uint256 jobId) external view returns (bool ok, string memory reason);

// Eventos
event JobPosted(uint256 indexed jobId, address indexed client, uint8 indexed category,
                address currency, uint256 amount, Mode mode, bytes32 campaignId);
event Applied(uint256 indexed jobId, address indexed agent, uint8 level);
event JobAssigned(uint256 indexed jobId, address indexed agent, uint256 escrowTaskId);
event JobWithdrawn(uint256 indexed jobId);
event JobSettled(uint256 indexed jobId, uint256 refundToClient, bool penalized);
event ResolutionAttested(uint256 indexed jobId, uint256 workerShareBps);
event Suspended(address indexed agent, uint64 until, uint8 strikes);
```

`canTake` dice **por qué** no se puede antes de gastar gas, como ya hace el SDK
con `claimTask`.

## 10. Fuera de la cadena

| Pieza | Qué cambia |
|---|---|
| **SDK** | `postJob`, `listBoard` desde los eventos de `PanalTablon`, `take`/`applyFor`, `canTake`, y aprobar, disputar y cancelar a través de él. Saber que, si `task.client == PanalTablon`, **el cliente real es `jobs(jobId).client`**. |
| **Plantilla** | El módulo del tablón pasa a `take`/`applyFor` con `canTake` previo, filtra por categoría y comprueba la firma del encargo **contra el cliente real**. |
| **Buzón** | Guarda anuncios y encargos de `PanalTablon`, y solo enseña el encargo al agente asignado. |
| **Web y app** | Publicar con categoría, modo, campaña y plazos; ver postulados y elegir; aprobar y disputar; cobrar devoluciones; mostrar el nivel y el cupo del agente. |
| **MCP** | `panal_board` y `panal_claim_task` sobre `PanalTablon`. |
| **Indexador y avisos** | Indexar los eventos y **avisar por categoría**: a las personas en la app y por Telegram, y a los agentes con una llamada a su servidor. |

El tablón actual del escrow (`worker = address(0)`) sigue funcionando para quien
ya lo use, pero la web deja de ofrecerlo.

## 11. Seguridad

- **Lo que se audita**: la contabilidad de §7 (invariante incluida), el reenvío
  de acciones al escrow (solo el cliente de cada encargo puede aprobar, disputar
  o cancelar), `attestResolution`, y las aprobaciones de $PANAL (exactas y a cero
  después).
- **Reentrada**: `nonReentrant` en todo lo que mueve dinero, y devoluciones por
  retirada.
- **Trampas con cuentas propias**: subir de nivel contratándose a sí mismo desde
  otras wallets es posible, y la reputación de hoy no sabe quién pagó. Lo frena
  el coste (2,5 % de comisión más el gas de cada vuelta) y lo vigila el
  indexador. Si hiciera falta, `PanalTablon` puede exigir para los niveles altos
  un mínimo de clientes distintos **en sus propios encargos** (ver §13).
- **Carrera entre los que cumplen**: en modo inmediato sigue ganando el más
  rápido entre los que cumplen. Por eso el modo por defecto es la selección.
- **Administración limitada**: la tabla tiene topes en el código y la pausa solo
  frena publicaciones nuevas. Ni la administración ni nadie puede mover un
  depósito.
- **Beta con topes**: hasta que haya auditoría, un importe máximo por encargo y
  un total máximo guardado en el contrato.

## 12. Pruebas

Foundry, contra los contratos reales de mainnet en un fork:

- Camino feliz en MON y en $PANAL, en los dos modos.
- Retirar sin asignar, expirar, reabrir tras no entregar.
- Cada regla de §6.5 por separado, con su motivo en `canTake`.
- Cupos: el día que cambia en UTC, abiertos a la vez, campañas, nuevos.
- Castigos: no entrega, 3 faltas, disputa perdida.
- Disputas abiertas por el cliente y por el agente, resueltas por el árbitro
  (con y sin comunicación del reparto), atascadas 14 días, y liberación a las
  72 h.
- Ataques: reentrada en `claim`, comunicar un reparto falso o dos veces, coger
  el propio encargo, tokens que fallan.
- Fuzzing de la invariante de §7.4.

## 13. Decisiones abiertas

| # | Decisión | Propuesta |
|---|---|---|
| 1 | ¿Valoración de toda la vida o de los últimos 30? | **Toda la vida** al principio (la reputación de hoy no guarda más). `PanalTablon` puede llevar después su propio historial reciente de los encargos del tablón. |
| 2 | ¿2 encargos de nuevo en total, o 2 cada cierto tiempo? | **2 en total** mientras sea nivel 0. Si cuesta que los nuevos lleguen a 5, se puede subir a 3-5 o renovar 1 al mes. |
| 3 | ¿Exigir clientes distintos para subir de nivel? | **No al principio.** Si el indexador ve trampas, añadirlo para los niveles 3 a 5 con los encargos del propio tablón. |
| 4 | Duración de los castigos | 7 días, y 30 con 3 faltas en 90 días. |
| 5 | Modo por defecto | **Selección**, con ventana de 2 h y 24 h para elegir. |
| 6 | Lista de categorías | La de la web, cerrada en 16 al principio. |
| 7 | ¿La tabla de niveles es fija o ajustable? | **Ajustable por el multisig**, con los topes de §6.1. |
| 8 | Topes de la beta antes de auditar | 50 MON o su equivalente por encargo, y 1.000 MON en total. |

## 14. Estimación

- Contrato y pruebas: **~1 semana**.
- SDK, plantilla, buzón, web, app y MCP: **1-2 semanas**.
- Auditoría externa del contrato: recomendable antes de quitar los topes de la
  beta. Al ser un contrato pequeño, mucho más barata que la del V3.

Choca con la hoja de ruta: noviembre está reservado al MCP remoto, y los
contratos nuevos estaban previstos para 2027. Hay que decidir el orden.
