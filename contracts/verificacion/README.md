# Verifying the Panal contracts on monadvision

Four contracts, two files each: a `standard-input.json` (the sources plus the
compiler settings) and a `constructor-args.txt`.

## Settings — the same for all four

| field | value |
|---|---|
| Compiler | `v0.8.24` |
| Verification method | Solidity (Standard-JSON-Input) |
| Optimization | **enabled**, 200 runs |
| EVM version | `cancun` |
| License | MIT |

The optimizer and EVM version are already inside the JSON. Those values are for
the cases where the form asks for them separately.

## The contracts

| contract | address | name to declare | block |
|---|---|---|---|
| PanalMultisig | `0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0` | `src/PanalMultisig.sol:PanalMultisig` | 94812475 |
| PanalRegistryV2 | `0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51` | `src/v2/PanalRegistryV2.sol:PanalRegistryV2` | 91168712 |
| PanalEscrowV2 | `0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9` | `src/v2/PanalEscrowV2.sol:PanalEscrowV2` | 91168726 |
| PanalNames | `0xc94a8107C87859cAd2E472e71BbE25c15cdD614A` | `src/PanalNames.sol:PanalNames` | 95750662 |

Start with **PanalMultisig**: it is the only one with no `immutable` variables,
which makes it the simplest case.

## Constructor arguments

Most forms want them without the leading `0x`. If the explorer offers to detect
them automatically, let it — it reads them from the creation transaction.

One thing worth knowing before you paste anything: the `arbitrator` that
**PanalEscrowV2** was deployed with is `0x6073…b7B4`, the deployer wallet — *not*
the multisig. The multisig took the role later, through `transferArbitrator`.
Using the current value fails verification for no visible reason. That is why
these arguments were taken from the creation transaction rather than from the
getters.

## Where these files come from

Generated with `forge verify-contract --show-standard-json-input` over the
sources in `contracts/src`, then checked one by one: each JSON was compiled with
solc 0.8.24 and the resulting creation bytecode was confirmed to be an exact
prefix of the creation transaction's input on mainnet. All four match — which is
also the proof that the code in this repository is exactly what runs on Monad.

If verification fails, the problem is in the form, not in these files.

To regenerate:

    cd contracts
    forge verify-contract --show-standard-json-input \
      0x0000000000000000000000000000000000000000 \
      src/PanalMultisig.sol:PanalMultisig > verificacion/PanalMultisig.standard-input.json

Finding those creation transactions needed a block-by-block bisection against an
**archive** RPC: the official one (`rpc.monad.xyz`) rejects any query against old
state. `https://rpc-mainnet.monadinfra.com` does serve it.
