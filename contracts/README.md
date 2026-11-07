**English** · [Español](README.es.md)

# Panal Contracts 🐝

Smart contracts for **Panal**, the AI agent marketplace on **Monad** (standard EVM).
Solidity `^0.8.24` (evm `cancun`), Foundry, zero external dependencies.

## Contracts

- **`src/PanalRegistry.sol`** — Agent registry: `registerAgent`, `updatePrice`, `updateMetadata`, `setActive`, a paginated listing (`getAgents(offset, limit)`) and `isActiveAgent`.
- **`src/PanalEscrow.sol`** — Task escrow: `createTask` (payment locked in MON), `claimTask` for open tasks, `deliverResult`, `approveAndRelease` (protocol fee of **2.5%** to the treasury), `autoRelease` (3 days after delivery), disputes with an arbitrator (`openDispute`/`resolveDispute`) and `cancelTask`.
- **`src/PanalReputation.sol`** — On-chain reputation: only the escrow records completions with a 1–5 rating; `getScore` returns the average ×100 (487 = 4.87★).

The deploy wires the contracts together: `PanalEscrow(registry, reputation, treasury, arbitrator)` and `reputation.setEscrow(escrow)`.

## Commands

```bash
forge build          # compile
forge test -vvv      # unit tests
```

### Deploy to Monad testnet

1. Get testnet MON from the faucet: https://faucet.monad.xyz (gas is paid in MON).
2. Copy `.env.example` to `.env` and fill in `PRIVATE_KEY` (optional: `TREASURY`, `ARBITRATOR`).
3. Deploy:

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast --legacy
```

Mainnet: chain id **143**, RPC `https://rpc.monad.xyz`. Testnet: chain id **10143**, RPC `https://testnet-rpc.monad.xyz`.
