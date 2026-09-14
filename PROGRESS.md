# Observed — Build Progress

**Last updated:** 2026-09-14 (session 5, continued)
**Deadline:** 2026-09-21, 09:00 GMT
**Days remaining at last update:** 7

> This file is the living state of the build. It is updated at the end of every
> working session. If you are picking this project up cold, read this file
> first, then `MEMORY.md` for the reasoning behind the decisions.

---

## The one thing to know

The build spec (`observed-build-spec.md`) lays out a **24-day** plan starting
Aug 28. The actual start was **Sept 12**, leaving **9 days**. The spec's
day-by-day plan does not fit. Scope is therefore chosen by "what makes the
demo real", not by "what the spec lists in order".

Operator confirmed the first push is **"Website + skeleton"**.

---

## Status

### Done

| Area | What exists |
|---|---|
| CI | `.github/workflows/ci.yml` — **GREEN as of `1af9502`**. Secret-hygiene job (Rule 11), typecheck of all three workspaces, and a real `next build` (19s). Compiler errors are re-emitted as annotations so a failure is readable without a token |
| Docs | `.env.example`, `README.md`, this file, `MEMORY.md` |
| Shared contracts | `packages/shared-types` — evidence, review, payment, policy, worker↔web API contract |
| Design system | `apps/web/app/globals.css` — every token from design spec Section 3, all component styles, `<details>` disclosure rules |
| Components | `Nav`, `Footer`, `StatusBadge`, `EvidenceRow`, `InspectionChecklistItem`, `ClaimCard`, `EvidenceArtifactPanel`, `HeroSequence`, `ProvenanceBanner`, `RelativeTime`, `ReviewList`, `EmptyState`, `TargetForm`, `ExcludedScreen`, `PausedScreen`, `HeldScreen`, tri-state `icons` |
| Web pages | **All 5 written** — `layout`, `page` (Landing), `review/[id]`, `history`, `status`, plus `not-found` and `icon.svg` |
| Web data layer | `lib/config.ts`, `lib/format.ts`, `lib/claims.ts`, `lib/sample.ts`, `lib/data.ts` (`Loaded<T>` model) |
| Claim rendering | `apps/web/lib/claims.ts` — Rule 10 made mechanical (see `MEMORY.md`) |
| Hero sequence | `HeroSequence` — FETCH/OBSERVE/COMPARE/WRITE reveal, declarative + reduced-motion correct |
| **Worker: SSRF guard** | `evidence-worker/ssrf-guard.ts` — Rule 4, **complete**. 15 blocked IPv4 ranges, IPv6 + IPv4-mapped, per-hop re-check, `pinResolvedAddress` |
| **Worker: exclusion list** | `policy-engine/exclusion.ts` — Rule 5, **complete**. All 5 identifier types, normalization, subdomain matching |
| **Worker: spend ledger** | `policy-engine/spend-ledger.ts` — Rule 9, **complete**. Caps, no-retry-after-ambiguous, concurrency=1, and the append-only log collapsed by `latestByPayment()` before anything is derived from it |
| **Worker: exact decimal** | `policy-engine/decimal.ts` — BigInt micro-units. No float ever compares against a cap |
| **Worker: audit ledger** | `audit-ledger/index.ts` — **complete**. Hash chain with canonical JSON, full re-walk verification |
| **Worker: watchdog** | `watchdog/index.ts` — Rules 7 + 12, **complete**. State machine + business-inactivity alert |
| **Worker: DNS collector** | `evidence-worker/collectors/dns.ts` — **complete** (the one collector needing no key and no HTTP client) |
| **Worker: pinned fetcher** | `evidence-worker/pinned-request.ts` — **complete**. Redirect-following HTTP that calls `assertRedirectHop` on every hop and connects to the validated IP, not the hostname. Bounded by a shared deadline, a 512 KiB body cap, and a hop limit. **Session 4 fixed a bug that made it send nothing at all** — see below |
| **Worker: HTML collector** | `evidence-worker/collectors/html.ts` — **complete**. Status, content type, redirect chain, served address, title, meta description, lang, viewport — each with an exact locator. Raw body goes to the store; only the hash and metadata leave |
| **Worker: TLS collector** | `evidence-worker/collectors/tls.ts` — **complete**. Real handshake against the pinned address with `servername` preserved, so SNI and certificate verification are untouched and DNS re-resolution is impossible. Records subject/issuer, validity window, sha256 fingerprint, protocol, cipher. `rejectUnauthorized` is never false |
| **Worker: link sweep** | `evidence-worker/collectors/html-links.ts` — **complete**. One artifact per link, each with its own tri-state, none folded into the page. Script/style/comment content is stripped first so a script string cannot become a fabricated broken link. Sequential, capped at 12, and the skips are counted rather than dropped |
| **Worker: policy gate** | `policy-engine/index.ts` — `evaluateProject`, exclusion before spend |
| **Worker: review validation** | `review-generator/index.ts` — `validateClaims` + `renderDraft` are **real**; only the model call is stubbed |
| **Worker: payment policy** | `payment-worker/payment-gate.ts` — provider allowlist, attribution refusal (Rule 8), `mayRetry` are **real**; only the `buy` call is stubbed |
| **Worker: 422 handling** | `askbots-adapter/index.ts` — response classification + `submitWithRewrites` are **real**; only the HTTP calls are stubbed |
| **Worker: evidence store** | `evidence-store/index.ts` — append-only, raw/record split, content-hash filenames |
| **Worker: HTTP surface** | `src/index.ts` — `/healthz`, `/readyz`, `/status` real; `/reviews` returns 503 **with a reason** |

### Not written yet

These throw a named error. They never return a plausible-looking value.

- `evidence-worker/collectors/` — `screenshot.ts`, `repo.ts`
- `review-generator/index.ts` — `draftClaims()` (the model call itself)
- `payment-worker/payment-gate.ts` — `executePayment()` (the `buy` MCP call)
- `askbots-adapter/index.ts` — `pollProjects()` and the submit HTTP call
- Demo Mode (`replay`), public sanitized manifest

### Session 4 — the bug worth knowing about

`requestOnce` in `pinned-request.ts` never called `request.end()`. Node's
`http.request()` only *queues* a request; nothing is written to the socket until
`end()` is called. Without it the request was never sent, and the only thing that
could settle the promise was the timeout.

The consequence was bigger than one missing line. `fetchPinned` is the only
fetcher in the project, so the **HTML collector could never have observed
anything** — every run would have produced a confident, hash-stamped, entirely
empty observation reporting `unknown_timeout`. That is precisely the failure this
product exists to be the opposite of.

It survived because nothing on this machine executes code: CI typechecks and
builds, and there are no tests. It was found by reading the fetcher to add POST
support, not by any tool. **Assume more of these exist** — the type checker has
now caught three real errors across two sessions, and every one of them was
hiding something.

> **Why this split, not "stub everything":** the safety core (Rules 3, 4, 5, 8,
> 9, 10, 12) is pure logic with no keys and no network, so it can be **genuinely
> correct** right now rather than merely present. What is stubbed is exactly
> what needs a wallet, an API key, or an LLM. A collector we have not written
> does not emit an `unknown_*` artifact, because `unknown_*` is a claim about
> the target — our unfinished code is not a fact about someone else's project.

---

## Blockers — waiting on the operator

These cannot be worked around in code. Everything else is unblocked.

**Corrected 2026-09-14 (session 5)** against the live `celobuilders.xyz`
hackathon object and `askbots.ai/skill.md`. Three things previously written here
were wrong and are corrected below — see "What the recon changed".

The chain has a strict order, because each item needs the one above it:

**Cleared 2026-09-14 (session 5).** Items 1–3 are done:

- Wallet `0x556Ff7dD2bE1B504495288295Ad7cc3d414dd2c0`, key at
  `~/.observed-secrets/wallet.json` — **outside the repo**, so `git add .`
  cannot reach it.
- Funded with 0.51 CELO mainnet.
- **ERC-8004 identity minted: `agentId` 9849**, tx
  `0x742fe0003e7b95e0d5c86e4cf1fabf6381aaffdf615df75cb81dd46f4c7f150a`,
  block 77509666, cost **0.04067577 CELO**. `ownerOf(9849)` and
  `tokenURI(9849)` were both read back from the contract, not inferred from the
  event log, and both match.

| # | Needed | Blocks | Where it comes from |
|---|---|---|---|
| ~~1~~ | ~~Celo mainnet wallet~~ | — | **Done.** Address above |
| ~~2~~ | ~~Real CELO on mainnet~~ | — | **Done.** 0.51 CELO |
| ~~3~~ | ~~ERC-8004 Agent ID~~ | — | **Done.** `agentId` 9849 on Celo mainnet |
| 4 | **Personal Telegram @handle** | Registration — `telegram` is `requiredAt: registration` | Yours |
| 5 | **Celo Builders registration + `attributionTag`** | Rule 8, and the whole submission | `PUT /submissions/me` with the registration-stage fields. Tag is `celo_` + 12 hex, derived from the repo slug, **locked at first save** |
| 6 | **AskBots API key** | AskBots Adapter, any real review submission | `POST askbots.ai/api/auth/openclaw`. Self-serve, returned **once**, unrecoverable — re-registering mints a *new identity* and discards rating and earnings |
| 7 | **An AskBots PROJECT url for Observed** | The AskBots CLI Growth Track submission field `askbotsProjectUrl` | Observed must also exist on AskBots **as a project** (`askbots.ai/p/<id>`), not just as a reviewer |
| 8 | **`buy` closed-beta opt-in** | Payment Worker, every real evidence purchase | `cpayBetaOptIn` at registration. `buy` is closed beta — this has lead time |
| 9 | **Vercel account** | Public URL for the frontend | Operator chose Vercel |
| — | ~~Chainstack Growth plan~~ | Nothing | **Optional.** `forno.celo.org` is free and explicitly fine. The coupon path normally means entering payment details first — do not do this |
| — | `gh` CLI not installed | Convenience only — plain `git` push works | |

### The unattributed first transaction — Rule 8, and what it actually cost

**The mint at `0x742fe000…` carries no attribution tag.** It was sent before the
tag existed, and the live skill doc is explicit that this is not recoverable:
*"There is no way to tag a transaction after the fact and no way to backfill."*
One transaction will not be credited on the leaderboard.

The rule, from the live doc: *"Your assigned tag must be in every transaction."*
It names no exception for any transaction type or network, and *"Leaderboards
only credit the `attributionTag` returned at registration."*

**This was flagged late, and the flag belonged before the send.** The tag was
recorded as a Rule 8 concern in the blocker chain, but it was not connected to
the specific fact that the identity mint would itself be the first mainnet
transaction. That connection was ours to make before broadcasting, not after.

**It was also unsatisfiable as written.** The tag is *returned by registration* —
it is derived from the `owner/repo` slug and locked at the first save, so it
cannot be computed in advance. Registration is documented as wanting the
ERC-8004 ID. The ERC-8004 ID comes from the mint. So the identity mint
necessarily precedes the tag for every team in the event, and the blanket rule
cannot be met by the one transaction that creates the identity.

**What this does not affect.** The identity is real and correct: `agentId` 9849
is owned by the agent wallet and its `tokenURI` resolves. No funds were
misdirected and no claim in the submission depends on that transaction being
credited.

**What it changes.** The tag moves to the top of the critical path. Every further
mainnet transaction sent before registration is uncredited, so registration is
now urgent rather than merely next. `tools/sign-tx.mjs` must also learn to append
the ERC-8021 suffix (`toDataSuffix(['observed', '<tag>'])`) to calldata before it
sends anything else, and the first tagged transaction must be decoded with
`verifyTx` — the doc's own words: *"Checking once, early, is the difference
between a wiring mistake costing one transaction and costing the whole event."*

### What the recon changed

- **The ERC-8004 Agent ID is an input, not an output.** The build spec's day-1–2
  plan reads as though registration *issues* the agent ID and wallets. The live
  field list makes `erc8004Url` and `agentWalletAddress` `requiredAt:
  registration`, and the attribution block says registration needs "your
  ERC-8004 Agent ID URL and your agentWalletAddress". So the identity must be
  minted on Celo mainnet **before** registering. This reorders everything and
  adds a real-money step ahead of registration day.
- **The daily-limit contradiction is resolved.** Build spec Section 8 says the
  official page claims limits scaling 2→5→15→50 while the docs claim none, and
  asks for a day-one `curl`. The live `askbots.ai/skill.md` answers it directly:
  *"There is no daily cap, no per-agent quota and no `429`."* What exists instead
  is one response per agent per project (`409` on a second submission) and
  first-come-first-served paid slots. The spec's "run a live curl on day 1" is
  still cheap insurance, but it is no longer an open question.
- **The AskBots track scores a project, not a reviewer.** `askbotsProjectUrl` is
  required when `primaryTrack` is `askbots-growth`, must be an
  `askbots.ai/p/<id>` link ("a bare homepage link, or an `/agent/` link — that is
  a reviewer agent, not a project — cannot be scored"), and "your funding wallet
  must match your registered agent wallet". Observed is a reviewer agent, so it
  needs to be listed on AskBots as a **project** as well.
- **`buy` is closed beta**, and the opt-in is a registration field. That is a
  lead-time blocker sitting behind registration.
- **`reviewerAgentWallets` asks you to declare reviewer agents at registration.**
  Undeclared reviewer agents are excluded from awards — so Observed must be
  declared there.
- **Mainnet only.** `celoNetwork` offers only `celo-mainnet`, and "testnet
  activity counts for nothing in every track". The spec's "set up Celo Sepolia
  testnet dev environment" is fine for local work but earns nothing.

**Nothing above blocks the frontend.** It runs in a clearly labelled sample mode
until a worker exists, and `/status` degrades to `BLOCKED` with an explicit
reason rather than showing nothing.

---

## Next actions, in order

1. **Get the `attributionTag`, which means registering.** It is now the top of the
   critical path, because every mainnet transaction sent before it exists is
   uncredited. Blocked on the operator's Telegram handle (item 4).
2. **Then wire ERC-8021 into `tools/sign-tx.mjs`** before it sends anything else:
   `toDataSuffix(['observed', '<tag>'])` appended to calldata, then decode the
   first tagged transaction to confirm the tag is present. Rule 8 has no backfill,
   and the mint already spent the one transaction that could not carry it.
3. **Write the `repo` collector** — the next one, and it needs neither a key nor
   a wallet, because `api.github.com` is a public API. The Rule 3 trap is
   already documented in the stub and is the whole job: GitHub's unauthenticated
   rate limit answers **403, not 404**, and reporting a rate limit as "this
   repository does not exist" would be a fabricated finding about someone's
   project. 403/429 must map to `unknown_*`. A missing repo URL must produce NO
   artifact at all — "you did not give us a repo" is not a finding.
4. Then `screenshot` — the only collector that needs the paid path, so it waits
   for `buy` closed-beta access. Everything it does *after* the bytes arrive is
   already written and testable: hash, store, map a non-2xx provider response.
5. Operator connects the repo to Vercel. The app already builds in CI, so this is
   a configuration step, not a code step. `NEXT_PUBLIC_OBSERVED_API_URL` stays
   unset until a worker is deployed.
6. AskBots adapter last — the only piece needing a live key.
7. Optional housekeeping: `package-lock.json` is generated inside CI on every run
   but never committed, so installs are not yet reproducible and CI still takes
   the `npm install` branch rather than `npm ci`. Committing one needs either a
   local `npm install` (forbidden on this machine) or a CI job with
   `contents: write` that commits it back. Vercel will produce one on first
   deploy, which is the cheapest route.

### Tools built this session

Three files, all with self-tests that run before they touch anything:

| File | What it does | How it is proven |
|---|---|---|
| `tools/keccak256.mjs` | keccak-256, EVM selectors, EIP-55 addresses | Published vectors incl. a full key→address pipeline |
| `tools/abi.mjs` | Builds and decodes calldata for the calls used here | Structural checks on `register(string)` |
| `tools/sign-tx.mjs` | Builds, signs, verifies, broadcasts, and reads back transactions | Byte-for-byte reproduction of the EIP-155 published signature |

`make-wallet.mjs` generates a wallet and prints only the address. `celo-rpc.mjs`
estimates cost and reads balances with no key at all.

**Two silent bugs were caught by these tests, both of which would have shipped
without them:**

- Node's `crypto.sign(null, digest, key)` hashes the digest a *second* time, so
  the signature covers the wrong message and recovers to the wrong address. The
  self-test failed loudly instead of producing a plausible, worthless signature.
- `Buffer.from('0x…', 'hex')` returns **zero bytes** rather than throwing. The
  first mint attempt therefore called `register(string)` with no argument and was
  reverted by the chain — correct string, silently emptied on conversion.
  Calldata is now built in exactly one place, which returns a `Buffer` so the
  prefix can only be stripped once.

---

## Honest status of the pitch

The submission's central claim is that every assertion is traceable to a
hash-verified artifact. **The project still cannot make that claim about
itself** — and session 4 sharpened exactly why. Three collectors that touch the
network now exist and compile, but **not one of them has ever been executed**.
Nothing on this machine runs the worker, CI only typechecks and builds, and there
are no tests. So "it compiles" is the strongest thing anyone can currently say
about the code that does the observing.

Session 2 made the machinery that *enforces* the claim real. The SSRF guard, the
exclusion check, the spend caps, the claim validator and the hash chain are
written and will refuse to operate incorrectly; they are not stubs that pretend.

Session 3 made the build **verified**, and then used it. CI is green: all three
workspaces typecheck under the real compiler and `next build` produces a
production build. Until now "it compiles" was an assumption, because this machine
cannot run a build — it is now a fact GitHub asserts on every push, and it will
stay asserted on every future push. Two compiler errors surfaced and were fixed;
one of them was hiding a genuine logic bug (a permanently-wedged spend gate) that
reading the file locally had not caught. See `MEMORY.md` decision 14.

Session 4 finished the **TLS collector** and the **link sweep**, and fixed the
fetcher bug described above. Two more things came out of reviewing the
interrupted session's work, both in the same direction — the tool now claims
*less*:

- A TLS failure meaning "something is on port 443 but is not speaking TLS" was
  being recorded as `invalid`, which the UI renders as **Detected** and the
  review turns into a finding. It would have published an ordinary http-only
  project as having a bad certificate — for a certificate that does not exist.
  It now reports "unable to verify", matching the identical case where nothing
  is listening on 443 at all.

- The form-POST question was raised and **deferred by the operator**, who did not
  want to authorise an outward-facing side effect before understanding it. So
  `SEND_FORM_POST` is `false`: every form is probed with GET, the artifact says
  `declared_method: "POST"` with `method_downgraded: true`, and the review can
  say "probed with GET" rather than implying a submission happened. Flipping it
  is one line, and the fence around it is already built.

**If `SEND_FORM_POST` is ever flipped on, `apps/web/lib/sample.ts` must flip with
it** — its headline claim reads `HTTP 404 on POST /signup`, which is the spec's
example and the behaviour with POST enabled.

The gap is now narrow and specific: **one collector (`repo`), one screenshot,
and two API calls** — not "the whole worker". The frontend is deployable as it
stands.

Session 5 minted the identity — `agentId` 9849 on Celo mainnet, owned by the
agent wallet, `tokenURI` read back from the contract — and built the signer that
did it, proven against the EIP-155 published vector rather than merely exercised.
It also cost one transaction's worth of attribution, for the reason recorded
above. The honest reading is that the tooling is now trustworthy in a way it was
not: two bugs that would have shipped silently were caught by tests written
specifically to catch them, and the cost of the third mistake was one
uncredited transaction rather than a lost submission.

The frontend continues to ship with an explicit `RecordProvenance` type and a
visible label on every non-live record. Nothing in the UI is presented as a real
observation when it is not. This is deliberate: the honest empty state is
available from day one, and the real numbers replace it as they arrive. It must
never be the other way round.
