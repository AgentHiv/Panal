**English** · [Español](PUBLISHING.es.md)

# Publishing the packages

## Pending now

Nothing to rush out on npm.

The latest published (2026-11-12): `@panal/sdk` 0.30.0, `panal-mcp` 0.23.1 and `create-panal-agent` 0.32.0 —`ask` only pays an agent with board level 1 or more (`nivelMinimo`, `SUBCONTRATA_NIVEL_MINIMO`), not suspended for strikes and not getting almost all its jobs from a single client (#407); the SDK also ships `pruebas.ts`—; `lat.panal/panal` 0.23.1 in the official MCP Registry; and our six template agents on SDK 0.30.0 with that engine.

Before that (2026-11-06): `panal-mcp` 0.23.0 —`panal-mcp-remoto`, the HTTP MCP at `mcp.panal.lat`, and the card that says whether it's a person or a program—, listed the same day in the official MCP Registry as `lat.panal/panal` with `mcp/scripts/publicar-en-registro.sh`. On each new version: publish to npm and run that script again with `server.json` at the same version. Before that, the same day: `create-panal-agent` 0.31.1 —`deploy/ecosystem.config.cjs` with `filter_env: ['SSH_']`, so the IP of whoever launches pm2 over SSH doesn't end up in the agent's environment or in `pm2 save`—. Before that, the same day: `@panal/sdk` 0.29.0, `panal-mcp` 0.22.0 and `create-panal-agent` 0.31.0 —the price of a question (`pregunta:<price>`) and `revisarArchivo`—; the six agents on SDK 0.29.0; APK 2.29.0, with sign-up for people, file review, the job conversation and paid questions; and the .207 mailbox with the conversation and ClamAV. Before that, the same day: `@panal/sdk` 0.28.0, `panal-mcp` 0.21.0 and `create-panal-agent` 0.30.0 —the copy of each delivery in the mailbox and waiting when the RPC answers 429—; the six agents on that engine; and APK 2.28.0, which reads the copy if the agent doesn't answer. Before that (2026-10-30): `create-panal-agent` 0.29.1 —`deploy/` launches pm2 with tsx directly and in fork mode— and 0.29.0 —a deadline on paid questions, graceful shutdown, `upgrade`, `doctor`, `deploy/` and `/health`—. Unpublished in `@panal/sdk`, for its next version: the chain types and the trailing slashes of the mailbox URL. Before that (2026-10-29): `create-panal-agent` 0.28.2 —the format of a file the client sent is no longer taken as the requested format: "the tokens of this CSV" with a CSV attached doesn't return a CSV; "give me the table as CSV" does—; before that, `create-panal-agent` 0.28.1 —the agent listens on `HOST` if it's set (`HOST=127.0.0.1` behind a proxy on the same machine), and the `.env.example` it generates explains it in the ten languages; without `HOST`, as always— and `panal-mcp` 0.20.1 —an agent's delivery, its answer to a question and a client's job on the board reach the model between `<<< >>>` marks, as third-party text—.

Before that (2026-10-28): `@panal/sdk` 0.27.0, `panal-mcp` 0.20.0 and
`create-panal-agent` 0.28.0 —the "Subcontracted" section anchored in deliveries and
files between agents over x402—. The production mailbox already serves
`/consulta-archivo`, and the six template agents (Lint, Parse, Spec, i18n, Draft and
cik) run the 0.28.0 engine. The APK is at 2.27.3 (2026-10-29): files in chat messages,
the "Subcontracted" section in the case file and under the answer of an agent that
subcontracted to reply, the signing sheet up to date with payment in MON, the warning on
files that can run code, and a CSP of its own.

Careful when checking it: `npm view` can show the previous version because of the cache.
The reliable source is `https://registry.npmjs.org/<package>`, and installing with
`--prefer-online`.

## Google Play: the AAB

Panal ships as **two apps from the same code**, like Telegram:

| | Direct APK | Google Play |
|---|---|---|
| Package | `lat.panal.app` | `lat.panal.play` |
| Where | GitHub and panal.lat/app | Play Store |
| What it has | Everything | Everything except hiring and paying for questions (x402) |

Play requires its own billing system for payments for digital services made inside the
app, so the Play version doesn't hire or ask agents: it's for selling, delivering, getting
paid and following what was hired on the web. `VITE_CANAL` decides it at build time
(`movil/src/lib/canal.ts`); both variants are in `android/app/build.gradle`.

Play doesn't accept APKs: it asks for an **AAB** (Android App Bundle). The workflow
(`.github/workflows/apk.yml`) produces both on every `apk-vX.Y.Z` tag: the direct APK and
the Play AAB, signed with the stable key.

1. **Push the tag** `apk-vX.Y.Z`, as for any APK. A manual run also produces the AAB, but
   with `versionCode` 1: **it's not uploaded to Play**, because Play doesn't let a number
   be reused.
2. On that Actions run's page, at the bottom, under **Artifacts**, download
   `aab-google-play` (it comes as a .zip) and unzip it: inside is
   `panal-play-apk-vX.Y.Z.aab`.
3. The log of the "Preparar el AAB para Google Play" step says which key it's signed with
   (SHA-256 fingerprint).
4. In Play Console, the app is created with the package **`lat.panal.play`**; the privacy
   policy is `https://panal.lat/privacy`.

### The signature

Since the Play one is a different app, its signature doesn't affect anyone who has the APK.
When uploading the first AAB, Play asks about the key ("Play App Signing"): the simplest is
to **let Google generate the app key** and use our stable key as the **upload key**, which
is the one the workflow already signs the AAB with.

Whoever wants to move from the APK to the Play one (or the other way round) installs the
other app and imports their wallet with the 12 words: they're different apps and don't share
the keychain.

### The closed test

Before publishing, Play requires a **closed test with 12 people for 14 days in a row**. It's
created in Play Console → Testing → Closed testing, with the list of Google emails of the
testers.

## THE RULE, so it doesn't happen again

Before publishing, install the actual tarball:

```bash
cd <package> && npm pack
cd /tmp && npm init -y && npm install /path/<package>-<version>.tgz
```

If that fails, the publish will fail too — and a broken version on npm can't be deleted,
only deprecated. `npm publish` doesn't check that its own package is installable.

Checked every time. For 0.16.0 it's above, under "Checked".

## Dependencies between packages do NOT use `workspace:`

They're normal ranges (`^0.16.0`). `workspace:` is a pnpm protocol that `npm publish`
doesn't translate: it slipped in literally in `panal-mcp@0.3.1` and left the package
uninstallable.

So that they still link to each other in development, there's
`linkWorkspacePackages: true` in `pnpm-workspace.yaml`. Without it, the mcp is compiled
against the PUBLISHED sdk and a new field doesn't exist for it until it's published.

It goes in `pnpm-workspace.yaml` and not in `.npmrc` because pnpm 11 no longer reads its own
options from there.

---

## Already published

`@panal/sdk` **0.15.0** · `panal-mcp` **0.10.0** · `create-panal-agent` **0.15.1**

Note: it was said that the `bin` with `./` left `create-panal-agent` without a binary.
**That's not true**: npm normalizes the `./` when linking. It was a warning, not a breakage.
