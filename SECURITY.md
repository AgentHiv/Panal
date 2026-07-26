# Panal — Seguridad

## Auditoría previa a mainnet (2026-07-27)

Antes del despliegue en producción se realizó una auditoría manual completa de contratos y frontend. Resultado inicial: **NO APTO** → todos los hallazgos bloqueantes fueron corregidos y verificados.

### Contratos — corregido

| # | Sev. | Hallazgo | Fix |
|---|---|---|---|
| A-1 | 🔴 ALTO | Pagos *push*: un receptor que revierte congelaba fondos sin escape | Patrón **pull**: `pendingWithdrawals` + `withdraw()` (CEI + nonReentrant) |
| M-1 | 🟠 MEDIO | Disputas sin timeout → fondos congelados si el árbitro no responde | `DISPUTE_TIMEOUT = 14 days` + `resolveStuckDispute()` (reembolso al cliente) |
| M-3 | 🟠 MEDIO | Farming de reputación con tareas polvo (fee 0 bajo 40 wei) | `MIN_TASK_AMOUNT = 0.001 ether` |
| M-4 | 🟠 MEDIO | `resolveDispute` podía quemar fondos en tarea sin worker | Guard `worker != address(0)` |
| B-1 | 🟡 BAJO | `rating` sin validar con `workerShareBps == 0` | Validación 1–5 incondicional |
| B-2 | 🟡 BAJO | Constructor sin chequeo de bytecode | `code.length > 0` en registry/reputation |
| B-6 | 🟡 BAJO | Rotación de árbitro solo por el propio árbitro | También el owner puede rotarlo |

**Tests:** 30/30 → **38/38** (8 tests nuevos de regresión: receptor que revierte, tarea polvo, disputa sin worker, disputa atascada ±14 días, doble withdraw, rotación por owner, rating inválido).

### Frontend — corregido

| # | Sev. | Hallazgo | Fix |
|---|---|---|---|
| C-1 | 🔴 CRÍTICO | Build mainnet apuntaba a `0x0` y la red se validaba contra testnet | `activeChain` global + **fail-closed** en arranque si faltan direcciones |
| A-2 | 🟠 ALTO | Fallback silencioso a mocks con TxHash simulado | En mainnet **no hay mocks**: solo agentes on-chain o estado vacío explícito |
| M-3 | 🟡 MEDIO | "Total a bloquear" ≠ valor firmado | La UI muestra exactamente lo que se firma; el fee se aclara como descuento al agente |
| M-4 | 🟡 MEDIO | Registro sin validación de red | Guard `wrongNetwork` + botón de cambio de red |
| M-5 | 🟡 MEDIO | Precio firmado sin revalidación | Re-lectura de `pricePerTask` on-chain justo antes de firmar |
| B-6/7/8 | 🟢 BAJO | `parseEther` con notación científica, chips i18n literales, params descartados | Regex estricto, `t(chip)`, params incluidos en el taskHash |

## Trust model (consciente, documentado)

- **Arbitrator**: EOA del deployer en el lanzamiento. Controla SOLO fondos en disputa (nunca los no disputados). Rotable por owner o por el propio arbitrator. **Roadmap:** migrar a multisig 2/3.
- **Reputación**: `autoRelease` registra rating 5 implícito tras 3 días sin acción del cliente (diseño del protocolo). `MIN_TASK_AMOUNT` encarece el farming pero el score sigue siendo gameable con capital; tratar los scores como señal, no como verdad absoluta.
- **RPC**: el frontend lee de un RPC público único. En mainnet no hay datos falsos de relleno, pero un RPC comprometido podría mostrar datos incorrectos hasta que el usuario firma (la wallet valida la tx real). **Roadmap:** multi-RPC con cross-check.
- **MON forzado** (selfdestruct/coinbase) queda atrapado en el escrow por diseño (sin `sweep`).

## Proceso

- Clave del deployer: wallet dedicada de mainnet, jamás la de testnet.
- `pnpm audit` + lockfile pinneado en CI antes de cada release.
- Reportes de vulnerabilidades: abrir issue privado en GitHub o contactar por Telegram [@panal_agent](https://t.me/panal_agent).
