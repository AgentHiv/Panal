**English** · [Español](README.es.md)

# The design of the Panal app

The whole design of the Android app lives here, in HTML. It's what you look at
before writing the first line of `movil/src`.

**The app is not a mirror of the website.** `movil/` imports fourteen modules
from `src/` and all of them are data or logic —ABIs, hooks, `lib/chat`,
`lib/deepLinks`—, not a single component from `@/components`. The panal.lat
website stays as it is. What's shared is where the money comes from, not how it
looks.

## How to view it

```bash
node visor.mjs                    # regenerates visor/ and visor.html
xdg-open visor.html               # or open it by hand in the browser
```

`visor.html` is the whole canvas: the 25 screens placed where they belong, with
the 16 yellow notes beside them. Each screen on its own is in
`visor/<Name>.html` and opens by itself, at real size (390 × 844).

The **grey bars** are data the code fills in, not gaps in the design. What you
need to know to write them —which contract it comes from, what happens if it's
missing— is in the notes. The real figures from the chain are there too.

`Main` is the clickable walkthrough and only works on the published canvas;
locally it comes out flattened, with its screens stacked.

## What each file is

The `.dc.html` files are the source. They aren't plain HTML: they use `<sc-if>`
for branches, `<sc-for>` for lists and `{{ variables }}` for data, and the
runtime that interprets them lives on claude.ai. `visor.mjs` flattens them by
resolving each conditional with its design hint; `visor/` is its output and can
be deleted.

## Screen by screen

Eleven are already written. They serve as the style reference: this is how the
rest gets written.

| Artboard | Code | |
|---|---|---|
| `Wallet` | `componentes/HojaWallet.tsx` | done |
| `Hilo` | `pantallas/Hilo.tsx` | done |
| `Firmar` | `componentes/HojaFirmar.tsx` | done |
| `Encargo` | `componentes/HojaEncargar.tsx` | done |
| `Revisar` · `Disputa` | `componentes/HojaRevisar.tsx` | done |
| `Mercado` | `pantallas/Mercado.tsx` | done |
| `Saldo` | `pantallas/Saldo.tsx` | done |
| `Arranque` | `pantallas/Arranque.tsx` | done |
| `Agente` | `pantallas/Agente.tsx` | done |
| `Avisos` | `lib/avisos.ts` · `lib/usarAvisos.ts` | done |

Twelve are missing, in four batches. The order matters: each batch can be
finished and tested without waiting for the next one.

### Batch 1 · The phone

| Artboard | Code to write |
|---|---|
| `Llavero` | `pantallas/Llavero.tsx` + `lib/llavero.ts` |
| `Archivo` | `pantallas/Archivo.tsx` |
| `Expediente` | `pantallas/Expediente.tsx` + `lib/expedientes.ts` |

It doesn't touch the chain or the indexer, so nothing blocks it. The wallet is
generated with viem's `generateMnemonic`, the key is encrypted with AES-GCM and
a PBKDF2 derived from the PIN, and it's stored in Capacitor Preferences.

It goes first because it's the only one that can be verified end to end without
depending on anyone — and because it's the one handling a private key, which is
where the most care is needed.

### Batch 2 · An agent's owner

| Artboard | Code to write |
|---|---|
| `Entrar` | the entry point in `App.tsx` |
| `Panel` | `pantallas/Panel.tsx` |
| `Alta` | `pantallas/Alta.tsx` |
| `Guardia` · `AvisoDueno` | extend `lib/avisos.ts` |

This holds up with today's contracts **because the connected wallet is the
agent**: `registerAgent`, `updatePrice`, `setActive` and `updateMetadata` act on
`msg.sender`, which is exactly what an agent's owner carries on their phone. The
`useMyTasks` hook with `role=worker` already exists.

### Batch 3 · Accounts

| Artboard | Code to write |
|---|---|
| `Informe` | `pantallas/Informe.tsx` |
| `Recibo` | `componentes/Recibo.tsx` (printable A5) |

Half blocked: **the indexer doesn't follow ERC-20 `Transfer`s**, so money that
comes in per message (x402) is invisible. Escrow money is there. Either the
report says up front that it only counts the escrow, or the indexer gets fixed
first.

### Batch 4 · Corporate

| Artboard | Code to write |
|---|---|
| `Cartera` | `pantallas/Cartera.tsx` |
| `Equipo` | `pantallas/Equipo.tsx` |

**Blocked by the contracts.** Registry v2 doesn't let a wallet manage agents
other than itself; the nine registered agents all have `owner == their own
address`. It needs what `Cambios` describes: owner ≠ agent and a configurable
payout destination. That's a new registry and a migration, not app work.

`Cambios.dc.html` is not a screen: it's that specification.

## What isn't in git

`panal-app-android.html` — the published canvas page, 2.5 MB of minified editor
wrapping these same artboards. The design itself is versioned; what's left out
is the wrapper. Download it from the artifact when the canvas needs editing; you
don't need it to read the design.
