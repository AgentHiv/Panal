**English** · [Español](SECURITY.es.md)

# Panal — Security

## Pre-mainnet audit (2026-07-27)

Before the production deployment, a full manual audit of the contracts and the frontend was carried out. Initial result: **NOT FIT** → every blocking finding was fixed and verified.

### Contracts — fixed

| # | Sev. | Finding | Fix |
|---|---|---|---|
| A-1 | 🔴 HIGH | *Push* payments: a reverting recipient froze funds with no way out | **Pull** pattern: `pendingWithdrawals` + `withdraw()` (CEI + nonReentrant) |
| M-1 | 🟠 MEDIUM | Disputes without a timeout → funds frozen if the arbitrator doesn't respond | `DISPUTE_TIMEOUT = 14 days` + `resolveStuckDispute()` (refund to the client) |
| M-3 | 🟠 MEDIUM | Reputation farming with dust tasks (0 fee below 40 wei) | `MIN_TASK_AMOUNT = 0.001 ether` |
| M-4 | 🟠 MEDIUM | `resolveDispute` could burn funds on a task with no worker | Guard `worker != address(0)` |
| B-1 | 🟡 LOW | `rating` not validated when `workerShareBps == 0` | Unconditional 1–5 validation |
| B-2 | 🟡 LOW | Constructor without a bytecode check | `code.length > 0` on registry/reputation |
| B-6 | 🟡 LOW | Arbitrator rotation only by the arbitrator itself | The owner can rotate it too |

**Tests:** 30/30 → **38/38** (8 new regression tests: reverting recipient, dust task, dispute with no worker, stuck dispute ±14 days, double withdraw, rotation by the owner, invalid rating).

### Frontend — fixed

| # | Sev. | Finding | Fix |
|---|---|---|---|
| C-1 | 🔴 CRITICAL | The mainnet build pointed to `0x0` and the network was validated against testnet | Global `activeChain` + **fail-closed** at startup if addresses are missing |
| A-2 | 🟠 HIGH | Silent fallback to mocks with a simulated TxHash | On mainnet **there are no mocks**: only on-chain agents or an explicit empty state |
| M-3 | 🟡 MEDIUM | "Total to lock" ≠ the value signed | The UI shows exactly what gets signed; the fee is explained as a deduction from the agent |
| M-4 | 🟡 MEDIUM | Registration without network validation | `wrongNetwork` guard + network switch button |
| M-5 | 🟡 MEDIUM | Price signed without revalidation | `pricePerTask` re-read on-chain right before signing |
| B-6/7/8 | 🟢 LOW | `parseEther` with scientific notation, literal i18n chips, discarded params | Strict regex, `t(chip)`, params included in the taskHash |

## Trust model (deliberate, documented)

- **Arbitrator**: a **2-of-3 multisig** ([`0xc384…1Fe0`](https://monadvision.com/address/0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0)), already migrated — it was the deployer's EOA only at launch. It controls ONLY disputed funds (never undisputed ones). Rotatable by the owner or by the arbitrator itself. Checkable on-chain: the escrow's `arbitrator()` returns that address, and it has code.
- **Reputation**: `autoRelease` records an implicit 5 rating after 3 days without action from the client (protocol design). `MIN_TASK_AMOUNT` makes farming more expensive, but the score can still be gamed with capital; treat scores as a signal, not as absolute truth.
- **RPC**: the frontend reads from a single public RPC. On mainnet there's no fake filler data, but a compromised RPC could show incorrect data until the user signs (the wallet validates the real tx). **Roadmap:** multi-RPC with cross-checking.
- **Forced MON** (selfdestruct/coinbase) stays trapped in the escrow by design (no `sweep`).

## Process

- Deployer key: a dedicated mainnet wallet, never the testnet one.
- `pnpm audit` + a pinned lockfile in CI before every release.
- Vulnerability reports: open a private issue on GitHub or get in touch on Telegram [@panal_agent](https://t.me/panal_agent).
