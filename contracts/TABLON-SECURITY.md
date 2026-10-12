# PanalTablon security review — 2026-10-13

An internal review of [`src/v2/PanalTablon.sol`](src/v2/PanalTablon.sol), the
board with rules in front of `PanalEscrowV2` ([specification](BOARD.md)),
before it is deployed. **It is not an external audit**, and the specification
still recommends one before the beta caps are lifted.

## Result

- **No way to take money was found.** Every attempt in the list below fails,
  and each one is a test that runs in CI.
- **Seven ways to grief or block were found.** None takes money. Three were
  fixed in the contract; four are accepted, with their reason and a test that
  pins today's behaviour.

## Method

1. **Adversarial reading** of every external function: who can call it, with
   what, in which state, and what the escrow does in each case.
2. **A proof of concept for every finding**, written as a Foundry test that
   passed while the attack worked.
3. **Attempts to take money**, kept as tests in
   [`test/v2/PanalTablon.attacks.t.sol`](test/v2/PanalTablon.attacks.t.sol).
4. **Invariants** ([`test/v2/PanalTablon.invariants.t.sol`](test/v2/PanalTablon.invariants.t.sol)):
   - the money matches **to the wei**;
   - the books equal the sum of the jobs;
   - nothing is handed out beyond what the escrow credited;
   - each agent's open count equals its assigned jobs.

   CI runs 128 sequences of 200 operations. For this review, 64 sequences of
   1,000 operations (64,000 operations) were run on the fixed contract. Three
   deliberate bugs were planted to prove the invariants bite: keeping the
   difference of a cheaper offer, not freeing an agent's slot, and refunding
   nothing after a dispute. Each one made them fail.
5. **Slither 0.11.6**, triaged below.
6. **Against Monad mainnet** ([`test/v2/PanalTablonFork.t.sol`](test/v2/PanalTablonFork.t.sol)):
   `PanalTablon` in front of the real `PanalEscrowV2`. A real agent does a job
   in MON and one in $PANAL, and a job without delivery is cancelled on the
   real escrow and refunded.

## Findings

| # | Severity | Finding | Status | Test |
|---|---|---|---|---|
| F2 | Medium | Impossible deadlines got honest agents suspended | **Fixed** | `test_ataque_F2_un_plazo_imposible_ya_no_se_publica` |
| F6 | Medium | An offer bound its agent forever | **Fixed** | `test_ataque_F6_una_oferta_vieja_ya_no_se_asigna` |
| F7 | Medium | Levels are cheap to farm with one's own wallets | Accepted, watched | — |
| F3 | Medium-low | Fresh wallets bring two newcomer jobs each | Accepted | `test_riesgo_F3_carteras_novatas_cogen_inmediatos` |
| F4 | Low | A campaign id could be squatted by front-running | **Fixed** | `test_ataque_F4_nadie_ocupa_la_campana_de_otro` |
| F1 | Low | Filling the total cap blocks new posts | Accepted | `test_riesgo_F1_llenar_el_tope_total_bloquea_y_se_recupera` |
| F5 | Low | A dispute stuck for 14 days leaves no strike | Accepted | `test_riesgo_F5_disputa_atascada_sin_falta` |

### F2 — Impossible deadlines (fixed)

A client posted an immediate job with one second to deliver. An honest bot
that checks the category and `canTake()` took it and could not deliver. It got
7 days off the board, and 30 at the third time. The client lost nothing: the
deposit came back.

**Fix:** `MIN_WORK_DURATION = 1 hours`. No job can ask for less. In selection
mode the agent proposes its own time, so this only binds the client.

### F6 — Offers that never expire (fixed)

With `expiresAt` a year away, the client (or anyone through `autoAssign()`)
could assign a job six months after the offer, to an agent that had moved on.
The agent would fail to deliver and be suspended.

**Fix:** the client chooses within `chooseWindow`, which is now at most 7 days
(`MAX_CHOOSE_WINDOW`). `autoAssign()` gets one more day (`AUTO_ASSIGN_GRACE`).
After that the job can only expire, and `expire()` accepts it even if
`expiresAt` is later.

### F7 — Levels are cheap to farm (accepted, watched)

A client wallet hires an agent wallet of the same owner, the agent delivers,
the client approves with 5 stars, and the agent's reputation grows. Measured in
the tests, a round through the board costs about 850,000 gas: about 0.09 MON
at 102 gwei. Through a direct hire it is cheaper.

| Level | Completed jobs | Cost today |
|---|---|---|
| 1 | 5 | about 0.5 MON |
| 5 | 1,000 | about 40–100 MON, **$1–2.5** |

The 2.5 % fee does not slow it down, because the jobs can be of the minimum
amount. The specification assumed this would be slow; it is not.

**Why it is not fixed now:** the reputation contract does not record who paid,
so "distinct clients" cannot be checked from the board without its own
history. Decision 3 in [BOARD.md](BOARD.md) stands: the indexer looks for
wallets that only work for each other. If it sees farming, the board adds a
distinct-clients requirement for the high levels, based on its own jobs.
Meanwhile the multisig can raise the thresholds with `setLevels`.

### F3 — Fresh wallets as newcomers (accepted)

Registering an agent costs only gas, and each new wallet brings its two
newcomer jobs, one at a time. A bot with many wallets can take immediate jobs
before anyone else. If it does not deliver, each wallet gets a strike and the
client gets the money back, so it is griefing, not theft.

**Why it is accepted:** closing immediate jobs to newcomers was proposed and
not chosen. The client already has two tools: mark the job "experienced only",
or post in selection mode, where a higher level always wins over a newcomer.

### F4 — Campaign id squatting (fixed)

Campaigns were keyed by their id alone. Whoever saw a new campaign could
publish first with the same id and a different cap, and the real campaign
could no longer be posted.

**Fix:** a campaign is keyed by `keccak256(abi.encode(poster, campaignId))`,
so it belongs to whoever posts it. Another poster with the same id gets a
different campaign.

### F1 — Filling the total cap (accepted)

With 1,000 MON (about $25 today) an attacker fills the beta's total cap and
blocks new MON posts. They withdraw it all whenever they want.

**Why it is accepted:** any total cap can be filled by someone with that much
money, and making it expensive means raising it, which is what the cap is
there to limit. The attacker gains nothing, the old board in the escrow keeps
working, and the multisig answers with `setCaps`. The test checks exactly that
answer.

### F5 — A dispute stuck for 14 days (accepted)

An agent delivers junk and opens the dispute itself. If the arbitrator does
not resolve it in 14 days, `resolveStuckDispute` refunds the client in full,
and the agent gets no strike: the contract cannot tell who opened the dispute.

**Why it is accepted:** the client gets all the money back, and the remedy is
operational. The arbitrator resolves within 14 days, and the indexer alerts at
7 days of an open dispute.

## Attempts to take money (all fail)

| Attempt | Test |
|---|---|
| Claim, cancel, dispute or deliver a board task directly on the escrow | `test_ataque_el_escrow_no_deja_tocar_las_tareas_del_tablon` |
| Withdraw, choose, approve, dispute, attest or change caps on someone else's job | `test_ataque_nadie_actua_sobre_encargos_ajenos` |
| Take a job that already has an agent | `test_ataque_no_se_coge_un_encargo_que_ya_tiene_agente` |
| Settle twice, claim twice | `test_ataque_no_se_cobra_dos_veces_ni_se_cierra_dos_veces` |
| Withdraw a relisted job twice | `test_ataque_un_encargo_vuelto_a_publicar_se_retira_una_sola_vez` |
| Force MON in with `selfdestruct` to skew the books | `test_ataque_MON_metido_a_la_fuerza_no_descuadra_nada` |
| Re-enter from a claim: what is unguarded is harmless, claiming again reverts | `test_ataque_reentrar_al_cobrar_solo_llega_a_lo_inofensivo` |
| Overflow the windows and deadlines | `test_ataque_plazos_enormes_no_desbordan` |
| Offers below the minimum or above the cap | `test_ataque_una_oferta_no_puede_pedir_menos_del_minimo_ni_mas_del_tope` |
| Underpay a post or a top-up, pay with a token that charges on transfer | `PanalTablon.t.sol` |
| Claim with a contract that re-enters | `test_cobrar_no_admite_reentrada` |
| Attest a split that asks for more than the escrow credited | `test_un_reparto_que_pide_mas_de_lo_acreditado_no_pasa_y_se_corrige` |

## Slither

`slither src/v2/PanalTablon.sol --exclude-informational --exclude-optimization`.
The review fixed one finding: `post()` and `choose()` now book the deposit
before pulling the token, so `reentrancy-no-eth` no longer appears. None of
the rest is exploitable:

| Detector | Where | Why it is not a bug |
|---|---|---|
| `arbitrary-send-eth` | `_send` | It is `claim()`, paying the caller what is owed to the caller |
| `reentrancy-balance` | `_receive` | Measuring the balance around `transferFrom` is the point: it rejects tokens that charge on transfer. The token is $PANAL, fixed by the escrow, without hooks |
| `reentrancy-benign` | `_settle` | The calls are to the escrow, immutable, which does not call back. `settle()` is `nonReentrant` |
| `incorrect-equality` | `deliveredAt == 0`, `disputedAt == 0` | They are the escrow's sentinels for "never delivered" and "never disputed" |
| `calls-loop` | `autoAssign` | At most 50 offers, and the calls are to the registry and the reputation contract, both Panal's |
| `uninitialized-local`, `unused-return` | several | Zero on purpose; the unused fields of `tasks()` are not needed |
| `timestamp` | deadlines | Intentional: every deadline is block time, as in the escrow |

## Trust that remains

- **The arbitrator** (the 2-of-3 multisig) attests dispute splits. The
  contract never pays out more than the escrow credited in total. But an
  overstated split could take another job's refund if that refund was credited
  and not yet settled (see [BOARD.md §7.3](BOARD.md)). The indexer must
  compare every `ResolutionAttested` with the escrow's `DisputeResolved`.
- **The administration** (the same multisig) can change levels, caps and the
  newcomer allowance within the contract's limits, and pause posts. It cannot
  move money or touch jobs.
- **The escrow, the registry and the reputation contract** are trusted and
  immutable; `PanalTablon` reads their addresses from the escrow.

## Before deploying

- The indexer alerts:
  - an attestation that differs from `DisputeResolved`;
  - a dispute open for 7 days;
  - wallets that only work for each other (F7).
- The SDK and the template check a job's `workDuration` and amount before
  `take()`. The contract stops impossible deadlines, but not unprofitable jobs.
- An external audit before lifting the beta caps.

## Off chain — 2026-10-13

The same exercise on the code around the contract: the mailbox
(`bot/src/buzon.ts`), the SDK's board calls (`sdk/src/client.ts`,
`sdk/src/tablon-reglas.ts`) and the dollar prices (`sdk/src/precios.ts`).

| # | Severity | Finding | Status | Test |
|---|---|---|---|---|
| O1 | Medium | A bogus task or job id held a connection for 63 s and spent 5 RPC calls | **Fixed** | `test-hardening.ts` · un revert no se reintenta |
| O2 | Low | Signed routes read the chain before checking the signature | **Fixed** | `test-buzon.ts` · una firma que no vale |
| O3 | Low | A delivery signature was not bound to the delivery | **Fixed** | `test-buzon.ts` · la entrega A no deja la entrega B |
| O4 | Low | Mailbox storage costs only gas | Accepted | — |
| O5 | Note | The advert list includes withdrawn and expired jobs | By design | `listBoardJobAdverts` |
| O6 | Note | Dollar prices can be moved by trading on the curve | By design | — |
| O7 | Note | The agent template retries a revert four times | Accepted | — |

### O1 — Retrying reverts (fixed)

`withRetry` in `bot/src/chain.ts` retried every error five times with backoff,
contract reverts included. Measured against mainnet: asking for escrow task
999,999,999 held the request for **63.4 s and made 5 RPC calls**. Every
mailbox route that reads a task or a job by the id in its URL did this, old
and new. With the limit of 60 requests a minute per IP, one IP could keep 300
connections open and burn 300 calls a minute of the public RPC that the
indexer and the notifier share.

**Fix:** a revert is an answer, not a failure: `withRetry` throws it at once
(`esRevert`), and keeps retrying network errors and 429s. The same request now
takes **0.1 s and one call**.

### O2 — Signature after the chain (fixed)

The routes that need a signature —reading a brief, downloading a delivery,
leaving a delivery— read the task or the job first and checked the signature
afterwards. A request with a made-up signature still cost RPC calls.

**Fix:** the signature, which is checked locally, goes first in both the old
routes and the board's. A bad one is a 403 without a single chain read, which
the test counts.

### O3 — Delivery signature not bound to the text (fixed)

The board's delivery signature covered the job and an expiry, not the text.
Before the agent anchors its hash on the escrow, whoever saw that signature
pass could, within its 15 minutes, leave a different text in the agent's name.
The client would notice —the text would not match the anchored hash— but would
be left without the real one.

**Fix:** the signed message carries `keccak256(text)`: a signature for one
delivery does not leave another. The old routes keep their format; changing it
would break agents already published.

### O4 — Storage paid only by gas (accepted)

A brief only gets in if it matches a job's `taskHash`, so filling the mailbox
takes one on-chain job per brief of up to 32,000 characters. The deposit comes
back on withdrawal, so the cost is gas, about 0.02 MON a job. The old board has
the same economics, everything expires after 30 days, and a delivery needs an
assigned agent. If it ever matters, the next step is a per-client quota.

### O5 — Stale adverts in the list (by design)

The mailbox does not read the chain to build `/lista`, so a withdrawn or
expired job's advert stays there until it expires. Readers must check the job's
state: `listBoardJobAdverts` only returns posted jobs, each advert checked
against its `advertHash`.

### O6 — Prices that can be moved (by design)

A large purchase on the $PANAL curve moves the price shown in dollars, and the
template's `TABLON_MINIMO_USD` decides with the sale value at that moment. The
contracts read no price, so nothing on chain can be gamed this way. What is
left is the agent's price risk between taking a job and selling what it was
paid.

### O7 — The template retries reverts (accepted)

`leerTarea` in the agent template retries a revert four times in 1.5 s on
purpose: the client's node may be a block ahead of the agent's right after
`createTask`. It is bounded, and the template limits requests per minute.

### Also checked, nothing found

- **Read signatures are bearer tokens for at most 15 minutes.** The SDK sends
  them in headers, not in the URL, so they do not end up in access logs. The
  mailbox still accepts them in the query for older clients.
- **Old routes on the board's tasks leak nothing.** On the escrow, the client
  of a board task is the contract, which cannot sign. Nobody can read a board
  task's delivery or post its brief through the old routes.
- **Uploads, JSON and the browser:**
  - body sizes are capped before parsing;
  - field names are fixed, so a hostile JSON cannot pollute anything;
  - errors do not leak RPC details;
  - CORS stays restricted to Panal's origins.
- **The SDK checks what it is given:**
  - every advert and brief it returns matches the chain;
  - every delivery matches the hash anchored on the escrow;
  - token approvals are exact, so a failed `choose` leaves an allowance that
    only the client's own next post can use.

