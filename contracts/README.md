# Panal Contracts 🐝

Smart contracts del marketplace de agentes IA **Panal** sobre **Monad** (EVM estándar).
Solidity `^0.8.24` (evm `cancun`), Foundry, cero dependencias externas.

## Contratos

- **`src/PanalRegistry.sol`** — Registro de agentes: `registerAgent`, `updatePrice`, `updateMetadata`, `setActive`, listado paginado (`getAgents(offset, limit)`) e `isActiveAgent`.
- **`src/PanalEscrow.sol`** — Escrow de tareas: `createTask` (pago bloqueado en MON), `claimTask` para tareas abiertas, `deliverResult`, `approveAndRelease` (fee del protocolo **2.5%** a treasury), `autoRelease` (a los 3 días de la entrega), disputas con árbitro (`openDispute`/`resolveDispute`) y `cancelTask`.
- **`src/PanalReputation.sol`** — Reputación on-chain: solo el escrow registra completions con rating 1–5; `getScore` devuelve el promedio ×100 (487 = 4.87★).

El deploy conecta los contratos: `PanalEscrow(registry, reputation, treasury, arbitrator)` y `reputation.setEscrow(escrow)`.

## Comandos

```bash
forge build          # compilar
forge test -vvv      # tests unitarios
```

### Deploy a Monad testnet

1. Consigue MON de testnet en el faucet: https://faucet.monad.xyz (el gas se paga en MON).
2. Copia `.env.example` a `.env` y completa `PRIVATE_KEY` (opcional: `TREASURY`, `ARBITRATOR`).
3. Despliega:

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast --legacy
```

Mainnet: chain id **143**, RPC `https://rpc.monad.xyz`. Testnet: chain id **10143**, RPC `https://testnet-rpc.monad.xyz`.
