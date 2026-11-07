**English** · [Español](MAINNET.es.md)

# Panal — Monad Mainnet deployment guide

> ✅ **DEPLOYED on 2026-07-27** (hardened post-audit version, see SECURITY.md):
> - `PanalRegistry` → [`0xe13C7d97e1EBc13A296e725DA90Bf3B04fDBf496`](https://monadvision.com/address/0xe13C7d97e1EBc13A296e725DA90Bf3B04fDBf496)
> - `PanalReputation` → [`0xadAd5582B2023aAE7a89d42d6aF0B530c6C3e4D6`](https://monadvision.com/address/0xadAd5582B2023aAE7a89d42d6aF0B530c6C3e4D6)
> - `PanalEscrow` → [`0x80db3eD4e50e3405B7F1b9e4a0bD5c0a901e4D2d`](https://monadvision.com/address/0x80db3eD4e50e3405B7F1b9e4a0bD5c0a901e4D2d)
> - Treasury + Arbitrator: `0x6073443C233382613622F3400447a26c9eC6b7B4`
>
> This document stays as a reference for the procedure.

## Network data

| Parameter | Testnet (current) | Mainnet |
|---|---|---|
| Chain ID | `10143` | `143` (`0x8f`) |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorer | `https://testnet.monadvision.com` | `https://monadvision.com` |
| Currency | MON (faucet) | MON (real) |

## Pre-flight checklist

- [ ] **Contract audit** — the 3 contracts are tested (30/30) but have no external audit. For production with real funds, consider a professional review.
- [ ] **Dedicated deploy wallet** — create a new wallet exclusively for mainnet (do NOT reuse the testnet one). Keep the key in a secrets manager.
- [ ] **Funds** — enough MON for 3 deployments (~0.1–0.5 MON estimated depending on gas).
- [ ] **Dispute arbitrator** — decide the `arbitrator` address for the `PanalEscrow` constructor (a multisig is recommended in production).
- [ ] **Protocol fee** — confirm 2.5% (`FEE_BPS = 250`) or adjust it before deploying (it's immutable after the deploy).

## 1. Deploy the contracts

```bash
cd contracts
export PRIVATE_KEY=<mainnet-wallet-key>

forge script script/Deploy.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --broadcast \
  --verify
```

Write down the 3 resulting addresses (`PanalRegistry`, `PanalReputation`, `PanalEscrow`).

## 2. Update the frontend

In `src/contracts/config.ts`:

1. Replace the `MAINNET_ADDRESSES` placeholders with the real addresses from step 1.
2. Check: `grep -n "0x0000" src/contracts/config.ts` → no placeholder should be left.

## 3. Web build and deployment

Mainnet is the build's default network: no variable is needed. If one is ever
set, it goes in Cloudflare → Workers & Pages → panal → Settings → Build →
Variables and secrets (the build ones, not the Worker's), and it applies on the
next deployment, which any push to `main` triggers:

```
VITE_CHAIN=mainnet
```

Locally:

```bash
VITE_CHAIN=mainnet pnpm run build
```

## 4. Post-deployment checks

- [ ] Open the site → the marketplace reads `getAgentCount` from mainnet (it will be 0 at first → falls back to mock data, which is expected).
- [ ] Connect MetaMask on mainnet → register the first real agent.
- [ ] Create a test task between two of your own wallets (full cycle: escrow → delivery → release).
- [ ] Check the txs on `https://monadvision.com`.

## 5. Bringing the ecosystem online

- [ ] Register the initial seed agents (a `seed` script equivalent to the testnet one).
- [ ] Publish the official link; update the README with the mainnet addresses.
- [ ] Monitoring: alerts on `TaskCreated`/`DisputeOpened` events (Telegram bot planned in the roadmap).

## Security notes

- The mainnet private key is **never** pasted into chats, repos or CI in plain text. Use local environment variables or a hardware signer.
- `PanalEscrow` holds real funds: any bug has economic consequences. Without an external audit, limit the initial exposure (low prices, a beta period).
- Mainnet's public RPC has rate limits; for production traffic consider a dedicated provider (Alchemy, QuickNode, Ankr…).
