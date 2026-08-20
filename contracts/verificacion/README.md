# Verifying the Panal contracts

All four contracts are verified, with an **exact match** on both creation and
runtime bytecode:

| contract | address |
|---|---|
| PanalMultisig | [`0xc384…1Fe0`](https://monadscan.com/address/0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0) |
| PanalRegistryV2 | [`0x89a8…Ac51`](https://monadscan.com/address/0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51) |
| PanalEscrowV2 | [`0xe138…bCe9`](https://monadscan.com/address/0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9) |
| PanalNames | [`0xc94a…614A`](https://monadscan.com/address/0xc94a8107C87859cAd2E472e71BbE25c15cdD614A) |

Source is also served by Sourcify, e.g.
`https://sourcify.dev/server/v2/contract/143/<address>?fields=sources`.

## How they were verified

Through Sourcify's API, which forwards to Etherscan — and Etherscan is what
backs monadscan.com. One POST per contract, under a second each:

    POST https://sourcify.dev/server/v2/verify/143/<address>
    {
      "stdJsonInput":            <contents of X.standard-input.json>,
      "compilerVersion":         "0.8.24+commit.e11b9ed9",
      "contractIdentifier":      "src/X.sol:X",
      "creationTransactionHash": "0x…"
    }

Poll `GET /v2/verify/{verificationId}` until `isJobCompleted`.

Passing `creationTransactionHash` is what upgrades the result from a runtime
match to a creation match, so it is worth including.

**monadvision.com is a different database.** Verifying through Sourcify does not
make a contract appear as verified there; its own form is the only way, and it
asks for `metadata.json` plus the `.sol` sources rather than the standard input.
The files here cover both shapes.

## The files

- `X.standard-input.json` — the standard JSON input. This is what the Sourcify
  API and `forge verify-contract` want.
- `X.metadata.json` — solc's metadata output, which monadvision's form asks for.
  Its IPFS hash is the one baked into the deployed bytecode, so it is the same
  file byte for byte. **Do not reformat it**: re-serialising changes the hash.
- `X.constructor-args.txt` — ABI-encoded constructor arguments.
- `PanalEscrowV2.flat.sol` — flattened source, for single-file verification.
  The other three contracts have no imports and can be uploaded as they are.

## Settings

| field | value |
|---|---|
| Compiler | `v0.8.24+commit.e11b9ed9` |
| Optimization | enabled, 200 runs |
| EVM version | `cancun` |
| License | MIT |

## Constructor arguments

They were taken from the **creation transaction**, not from the getters. The
difference is not theoretical: PanalEscrowV2 was deployed with
`arbitrator = 0x6073…b7B4`, the deployer wallet, and the multisig took the role
later through `transferArbitrator`. Using the current value fails verification
for no visible reason.

Finding those creation transactions needed a block bisection against an
**archive** RPC — the official `rpc.monad.xyz` rejects any query against old
state, while `https://rpc-mainnet.monadinfra.com` serves it.

## Reproducing

    cd contracts
    forge verify-contract --show-standard-json-input \
      0x0000000000000000000000000000000000000000 \
      src/PanalMultisig.sol:PanalMultisig > verificacion/PanalMultisig.standard-input.json

Every bundle here was checked before use: each standard JSON was compiled with
solc 0.8.24 and its creation bytecode confirmed to be an exact prefix of the
creation transaction's input on mainnet, and each `metadata.json` was checked by
computing its UnixFS CID against the hash embedded in the deployed bytecode.
