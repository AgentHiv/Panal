**English** · [Español](MULTISIG.es.md)

# PanalMultisig — 2-of-3 arbitration for PanalEscrowV2

`src/PanalMultisig.sol` is a **minimalist, zero-dependency 2-of-3** multisig
(the same style as the v1/v2 contracts: no external imports, natspec, comments in
Spanish) designed to fill the `arbitrator` role of
[`PanalEscrowV2`](./src/v2/PanalEscrowV2.sol)
(mainnet: [`0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9`](https://monadscan.com/address/0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9)).

## Deployed on Monad mainnet

```
multisig    0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0    (EscrowV2's arbitrator)

owners[0]   0x69D084926e68af78cDa512eF1Bf2c3e7B4307CBf
owners[1]   0xc549eB590563e317a6159DC7624d2AF48b056ED5
owners[2]   0x1227BDB6188D4700AaE6eA02E3a128832D0FE2cF
REQUIRED    2
```

It's also the `owner` and the `tesoreria` (treasury) of
[`PanalNames`](./src/PanalNames.sol), deployed on 2026-08-14:

```
PanalNames  0xc94a8107C87859cAd2E472e71BbE25c15cdD614A   (block 95750662)
```

Changing a fee or the names' treasury therefore takes two signatures.

### How to get it from the chain, without trusting this file

The source of truth is the escrow, not a document:

```bash
cast call 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 \
  "arbitrator()(address)" --rpc-url https://rpc.monad.xyz
```

### And how to check that THAT is a multisig

An address having code isn't enough. You ask it for something only `PanalMultisig`
has:

```bash
cast call <address> "txCount()(uint256)"  --rpc-url https://rpc.monad.xyz
cast call <address> "REQUIRED()(uint8)"   --rpc-url https://rpc.monad.xyz
cast call <address> "owners(uint256)(address)" 0 --rpc-url https://rpc.monad.xyz
```

If all three answer, it's the multisig. If they revert, it isn't, however much it may
look like one.

### CAREFUL: there are two addresses that get confused with this one

```
0x6073443C233382613622F3400447a26c9eC6b7B4   the deployer's wallet
0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B   the ERC-4337 smart account
                                             that wallet delegates to
```

The wallet **has code** —23 bytes starting with `0xef0100`—, which is the EIP-7702
mark: it says "this account behaves like the contract over there", not "this account
is that contract". Underneath, a single key still signs.

`0x63c0c19a…` is a real contract, but it's the wallet provider's implementation, shared
by many accounts. It doesn't belong to Panal, knows nothing about the protocol and nobody
can make it sign anything: **making it the `owner` of something freezes it forever**.

That's why `script/DeployNames.s.sol` rejects any `OWNER` whose code starts with
`0xef0100`. Checking `code.length > 0` doesn't work since EIP-7702, and two of this
multisig's three signers are 7702 wallets.

## Purpose

Today EscrowV2's `arbitrator` is **a single EOA**: the key that signs
`resolveDispute(taskId, workerPct, rating)` is a **single point of failure** —
if it's lost, disputes stay frozen until the `DISPUTE_TIMEOUT` (14 days); if it's
compromised, the attacker splits the funds of any dispute however they like.

With the multisig as arbitrator, resolving a dispute requires the agreement of
**2 of 3 owners**, removing the single point of failure without adding dependencies or
changing a line of the already deployed EscrowV2 (a `transferArbitrator` is enough).

## Why 2-of-3?

- **Tolerates 1 failure**: with 3 owners, losing ONE key (or an owner being unavailable)
  doesn't block arbitration — the other two can still resolve.
- **Resists 1 compromise**: a single stolen key can NOT execute anything; the attacker
  would need to compromise 2 independent keys.
- **Operational simplicity**: 2-of-3 is the smallest scheme with both properties. More
  owners = more coordination for every dispute.
- The 3 owners are set in the constructor and are **immutable**: changing the owner set =
  deploying a new multisig and repeating `transferArbitrator` (a deliberate decision: zero
  admin surface inside the contract).

## Design (why no libraries)

The project is **zero-dependency** (the v1/v2 contracts import nothing external; even the
ERC-20 is a minimal inline interface). The multisig follows that line:

- ~120 lines you can audit at a glance, no OpenZeppelin or Safe.
- `struct Tx { target, data, confirmations, executed }` + a mapping of confirmations.
- `submit` **doesn't confirm automatically**: executing always takes two `confirm`s from
  different owners (the mapping prevents confirming twice).
- **Checks-effects-interactions**: `executed = true` before the `target.call`.
- If the target call reverts, everything reverts and the tx **stays NOT executed** (the
  confirmation can be retried or a new tx proposed).
- `Submit/Confirm/Revoke/Execute` events for off-chain traceability.

## Operating flow for a dispute

1. The client or the worker opens a dispute in the escrow (`openDispute(taskId)`), after
   delivery.
2. **Owner A** proposes the resolution:

   ```bash
   # workerPct in basis points: 6000 = 60% to the worker, 40% refunded to the client
   DATA=$(cast calldata "resolveDispute(uint256,uint256,uint8)" <TASK_ID> 6000 4)
   cast send $MULTISIG "submit(address,bytes)" $ESCROW_V2 $DATA \
     --rpc-url $RPC --private-key $KEY_OWNER_A
   # Note the txId from the Submit event (or from `cast call $MULTISIG "txCount()" - 1`)
   ```

3. **Owner A confirms** their own proposal:

   ```bash
   cast send $MULTISIG "confirm(uint256)" <TX_ID> \
     --rpc-url $RPC --private-key $KEY_OWNER_A
   ```

4. **Owner B reviews** (they can read the proposed tx on-chain) **and confirms**; this
   second confirmation **executes** `resolveDispute` in the escrow:

   ```bash
   # Prior review (view):
   cast call $MULTISIG "getTx(uint256)(address,bytes,uint8,bool)" <TX_ID> --rpc-url $RPC
   cast call $MULTISIG "isConfirmedBy(uint256,address)(bool)" <TX_ID> <OWNER_A> --rpc-url $RPC

   # Confirm = execute on reaching 2:
   cast send $MULTISIG "confirm(uint256)" <TX_ID> \
     --rpc-url $RPC --private-key $KEY_OWNER_B
   ```

5. Check in the escrow:

   ```bash
   cast call $ESCROW_V2 "tasks(uint256)(address,address,uint256,bytes32,bytes32,uint256,uint256,uint8,address)" <TASK_ID> --rpc-url $RPC
   # status must be 2 (Completed)
   ```

If an owner changes their mind before execution: `revoke(txId)` withdraws their
confirmation (`cast send $MULTISIG "revoke(uint256)" <TX_ID> ...`).

## Migration plan (deploy → transferArbitrator)

1. **Deploy the multisig** (it doesn't touch the escrow):

   ```bash
   cd contracts
   OWNER_A=0x... OWNER_B=0x... OWNER_C=0x... PRIVATE_KEY=0x... \
     forge script script/DeployMultisig.s.sol --rpc-url $RPC --broadcast
   ```

2. **Check** the 3 owners on-chain:

   ```bash
   cast call $MULTISIG "owners(uint256)(address)" 0 --rpc-url $RPC
   cast call $MULTISIG "owners(uint256)(address)" 1 --rpc-url $RPC
   cast call $MULTISIG "owners(uint256)(address)" 2 --rpc-url $RPC
   ```

3. **Transfer the arbitrator role** (the current arbitrator or the escrow's current owner
   can call it). With the script (opt-in):

   ```bash
   OWNER_A=0x... OWNER_B=0x... OWNER_C=0x... PRIVATE_KEY=0x... \
   ESCROW_V2=0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 TRANSFER_KEY=0x... \
     forge script script/DeployMultisig.s.sol --rpc-url $RPC --broadcast
   ```

   Or by hand with cast:

   ```bash
   cast send 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 \
     "transferArbitrator(address)" $MULTISIG \
     --rpc-url $RPC --private-key <KEY_OF_THE_CURRENT_ARBITRATOR_OR_OWNER>
   ```

4. **Check**:

   ```bash
   cast call $ESCROW_V2 "arbitrator()(address)" --rpc-url $RPC   # == $MULTISIG
   ```

> **WARNING**: once `transferArbitrator(multisig)` has run, the previous EOA **can no
> longer resolve disputes** (`resolveDispute` requires `msg.sender == arbitrator`). Every
> future resolution goes through the multisig's submit + confirm×2 flow. The escrow's owner
> keeps the ability to call `transferArbitrator` again (e.g. to rotate to another multisig).

## Risks and considerations

- **Immutable owners**: if 2 of 3 keys are lost, the multisig becomes inert and a new one
  would have to be deployed + `transferArbitrator` (the escrow's owner can do it). Keep the 3
  keys in independent environments.
- **Operational latency**: every dispute takes 3 transactions (submit + 2 confirms) and human
  coordination between 2 owners; the 14-day `DISPUTE_TIMEOUT` is still the safety net
  (`resolveStuckDispute`).
- **Conflict of interest**: a multisig owner shouldn't be a party (client/worker) to the
  dispute they resolve — an off-chain policy, not enforceable on-chain without more complexity.
- **No timelock**: the 2nd confirmation executes immediately; human review happens between the
  submit and the second confirm.

## Tests

`test/PanalMultisig.t.sol`: the happy path, 1 confirmation doesn't execute, revoke,
permissions (non-owner), double execution, a failed call that reverts without marking
`executed` (with a successful retry), and **real integration**: the full v2 protocol
(RegistryV2 + Reputation + EscrowV2) with the multisig as arbitrator resolving a dispute end
to end, and the `transferArbitrator` migration from an EOA.

```bash
forge test --match-contract PanalMultisigTest -vvv
```
