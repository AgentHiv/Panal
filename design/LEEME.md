# El diseño de la app de Panal

Aquí está entero el diseño de la aplicación Android, en HTML. Es lo que hay que
mirar antes de escribir la primera línea de `movil/src`.

**La app no es un reflejo de la web.** `movil/` importa catorce módulos de `src/`
y todos son datos o lógica —ABIs, hooks, `lib/chat`, `lib/deepLinks`—, ni un solo
componente de `@/components`. La web de panal.lat se queda como está. Lo que se
comparte es de dónde sale el dinero, no cómo se ve.

## Cómo mirarlo

```bash
node visor.mjs                    # regenera visor/ y visor.html
xdg-open visor.html               # o abrirlo a mano en el navegador
```

`visor.html` es el lienzo entero: las 25 pantallas colocadas donde van, con las
16 notas amarillas al lado. Cada pantalla suelta está en `visor/<Nombre>.html` y
se abre por su cuenta, a tamaño real (390 × 844).

Las **barras grises** son datos que pone el código, no huecos del diseño. Lo que
hay que saber para escribirlos —de qué contrato sale, qué pasa si falta— está en
las notas. Ahí están también las cifras reales de la cadena.

`Main` es el recorrido pulsable y solo se recorre en el lienzo publicado; en
local sale aplanado, con sus pantallas apiladas.

## Qué es cada archivo

Los `.dc.html` son la fuente. No son HTML corriente: llevan `<sc-if>` para las
ramas, `<sc-for>` para las listas y `{{ variables }}` para los datos, y el
runtime que los interpreta vive en claude.ai. `visor.mjs` los aplana resolviendo
cada condicional por su hint de diseño; `visor/` es su salida y se puede borrar.

## Pantalla por pantalla

Once ya están escritas. Sirven de referencia de estilo: así se escribe el resto.

| Artboard | Código | |
|---|---|---|
| `Wallet` | `componentes/HojaWallet.tsx` | hecho |
| `Hilo` | `pantallas/Hilo.tsx` | hecho |
| `Firmar` | `componentes/HojaFirmar.tsx` | hecho |
| `Encargo` | `componentes/HojaEncargar.tsx` | hecho |
| `Revisar` · `Disputa` | `componentes/HojaRevisar.tsx` | hecho |
| `Mercado` | `pantallas/Mercado.tsx` | hecho |
| `Saldo` | `pantallas/Saldo.tsx` | hecho |
| `Arranque` | `pantallas/Arranque.tsx` | hecho |
| `Agente` | `pantallas/Agente.tsx` | hecho |
| `Avisos` | `lib/avisos.ts` · `lib/usarAvisos.ts` | hecho |

Doce faltan, en cuatro tandas. El orden importa: cada tanda se puede terminar y
probar sin esperar a la siguiente.

### Tanda 1 · El teléfono

| Artboard | Código a escribir |
|---|---|
| `Llavero` | `pantallas/Llavero.tsx` + `lib/llavero.ts` |
| `Archivo` | `pantallas/Archivo.tsx` |
| `Expediente` | `pantallas/Expediente.tsx` + `lib/expedientes.ts` |

No toca la cadena ni el indexer, así que nada la bloquea. La wallet se genera con
`generateMnemonic` de viem, la clave se cifra con AES-GCM y una PBKDF2 sacada del
PIN, y se guarda en Capacitor Preferences.

Va primera porque es la única que se verifica entera sin depender de nadie — y
porque es la que maneja una clave privada, que es donde más cuidado hace falta.

### Tanda 2 · El dueño de un agente

| Artboard | Código a escribir |
|---|---|
| `Entrar` | la entrada de `App.tsx` |
| `Panel` | `pantallas/Panel.tsx` |
| `Alta` | `pantallas/Alta.tsx` |
| `Guardia` · `AvisoDueno` | amplían `lib/avisos.ts` |

Esto se sostiene con los contratos de hoy **porque la wallet conectada es el
agente**: `registerAgent`, `updatePrice`, `setActive` y `updateMetadata` actúan
sobre `msg.sender`, que es justo lo que el dueño de un agente lleva en el móvil.
El hook `useMyTasks` con `role=worker` ya existe.

### Tanda 3 · Cuentas

| Artboard | Código a escribir |
|---|---|
| `Informe` | `pantallas/Informe.tsx` |
| `Recibo` | `componentes/Recibo.tsx` (A5 imprimible) |

Media bloqueada: **el indexer no sigue los `Transfer` de ERC-20**, así que el
dinero que entra por mensaje (x402) es invisible. El del escrow sí está. O el
informe dice en su cara que solo cuenta el escrow, o se arregla el indexer antes.

### Tanda 4 · Corporativo

| Artboard | Código a escribir |
|---|---|
| `Cartera` | `pantallas/Cartera.tsx` |
| `Equipo` | `pantallas/Equipo.tsx` |

**Bloqueada por los contratos.** El registry v2 no permite que una wallet
administre agentes que no sea ella misma; los nueve agentes registrados tienen
`owner == su propia dirección`. Hace falta lo que describe `Cambios`: dueño ≠
agente y destino de cobro configurable. Eso es registry nuevo y migración, no
trabajo de app.

`Cambios.dc.html` no es una pantalla: es esa especificación.

## Lo que no está en git

`panal-app-android.html` — la página del lienzo publicada, 2,5 MB de editor
minificado envolviendo estos mismos artboards. El diseño sí está versionado; lo
que queda fuera es el envoltorio. Se baja del artifact cuando haya que editar el
lienzo, y para leer el diseño no hace falta.
