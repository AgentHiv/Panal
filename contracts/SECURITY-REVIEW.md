**English** · [Español](SECURITY-REVIEW.es.md)

# Security review of the v2 escrow — 2026-10-08

A review done with `PanalEscrowV2` already deployed on mainnet
(`0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9`). It doesn't change the contract: it checks
the one that's there. The v1 escrow passed an external audit; v2 inherits its fixes
(`test/v2/AuditFixesV2.t.sol`).

## Invariants (Foundry)

`test/v2/PanalEscrowV2.invariants.t.sol`. A `Handler` performs valid operations in any
order —create in MON and in $PANAL, take from the board, deliver, approve, release by time,
dispute, resolve, resolve stuck ones, cancel, withdraw and let time pass— and after each one
it requires:

1. **MON adds up:** `balance(escrow) == locked in live tasks + credited to everyone`.
2. **$PANAL adds up:** the same with `balanceOf(escrow)`.
3. **What was delivered leaves a trace:** every delivered or disputed task has `resultHash != 0`.

Result: **all three hold**. Locally it ran with 256 sequences of 500 operations; in CI it's 128
of 200 so as not to make it longer. The whole suite: 265 tests, 0 failures.

## Slither

`slither src/v2/PanalEscrowV2.sol --exclude-informational --exclude-optimization`
gives 7 kinds of warning. None is exploitable:

| Detector | Where | Why it's not a bug |
|---|---|---|
| `reentrancy-no-eth` | `resolveDispute` | The external call is to `reputation`, immutable and deployed by Panal, which doesn't call back. And the function is `nonReentrant` |
| `reentrancy-benign`, `reentrancy-balance` | `createTask` | The `transferFrom` is to the $PANAL token, set in the constructor and with no transfer hooks. `createTask` and every function that moves funds share the same `nonReentrant` lock |
| `divide-before-multiply` | `resolveDispute` | A 1 wei rounding in a dispute's split. `clientRefund = amount - workerGross`, so nothing is lost: the invariants confirm it |
| `timestamp` | deadlines | Intentional: the escrow's deadlines are measured in block time |
| `uninitialized-local` | `workerPaid` | It's 0 on purpose when the arbitrator gives the worker nothing |
| `incorrect-equality` | `registeredAt == 0` | It's the registry's "not registered" sentinel |

For a v3 it would be cleaner to apply checks-effects-interactions in `resolveDispute`: credit the
client before calling the reputation. It changes nothing today, but it removes the warning without
relying on the lock.

How to repeat it: Slither can't find `forge` inside its Docker image, so it's run on a copy of
`src/` without `foundry.toml`:

```bash
cp -r contracts/src /tmp/slither/ && cd /tmp/slither
docker run --rm -v "$PWD":/src -w /src ghcr.io/crytic/slither:latest sh -c \
  "solc-select install 0.8.24; solc-select use 0.8.24; \
   slither src/v2/PanalEscrowV2.sol --exclude-informational --exclude-optimization"
```
