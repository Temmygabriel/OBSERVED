# Observed — Build Progress

**Last updated:** 2026-09-19 (session 6, continued)
**Deadline:** 2026-09-21, 09:00 GMT
**Days remaining at last update:** 2

> This file is the living state of the build. It is updated at the end of every
> working session. If you are picking this project up cold, read this file
> first, then `MEMORY.md` for the reasoning behind the decisions.
>
> **Session 6 is the one that registered, and the one that got a review out.**
> The `attributionTag` exists, is proven on-chain, and is saved outside the
> repo. Read "Session 6" below before touching anything that spends money.
>
> **The product now produces output.** Until 2026-09-19 no review could be
> produced by any route: `draftClaims()` threw unconditionally, so the pipeline
> terminated in a throw and the sentences that are the entire deliverable did
> not exist. CI now drafts a review from a real observation on every push and
> publishes the text as an annotation. See "The first review, 2026-09-19".

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
| **Worker: review validation** | `review-generator/index.ts` — `validateClaims` + `renderDraft` are **real**, and as of 2026-09-19 so is `draftClaims()`. It delegates to the deterministic drafter below rather than calling a model — see `MEMORY.md` decision 25 for why that is the stronger position, not a shortcut |
| **Worker: claim drafter** | `review-generator/draft-from-evidence.ts` — **complete**. Builds claims from the collectors' own recorded fields, one set per artifact. Every claim cites a held artifact and carries a non-empty observation *by construction*, so a claim the validator refuses is a bug here rather than a judgement call there. `unknown_*` artifacts get exactly one claim with an empty inference and `unable_to_verify` (Rule 3). Link artifacts are told apart from the page by `raw_ref`, the only field that separates them |
| **Worker: the thing that DRAFTS** | `apps/worker/src/cli/draft.ts` + `npm run draft`. Reads the bundle `observe.ts` wrote, drafts, validates, renders, and prints. **This is the only code in the project that produces the product** |
| **CI: the draft step** | `.github/workflows/ci.yml` — runs the drafter on the bundle the observe job just wrote and emits the rendered review as an annotation, so the product's own output is readable on the commit with no token. A held review is an **error** here: with a deterministic drafter it can only mean the drafter built something unsupportable |
| **Worker: payment policy** | `payment-worker/payment-gate.ts` — provider allowlist, attribution refusal (Rule 8), `mayRetry` are **real**; only the `buy` call is stubbed |
| **Worker: 422 handling** | `askbots-adapter/index.ts` — response classification + `submitWithRewrites` are **real**; only the HTTP calls are stubbed |
| **Worker: evidence store** | `evidence-store/index.ts` — append-only, raw/record split, content-hash filenames |
| **Worker: HTTP surface** | `src/index.ts` — `/healthz`, `/readyz`, `/status` real; `/reviews` returns 503 **with a reason** |
| **Worker: repo collector** | `evidence-worker/collectors/repo.ts` — **complete**. `api.github.com` only, host-allowlisted. The Rule 3 trap is the whole job: GitHub's unauthenticated rate limit answers **403, not 404**, so 403/429 map to `unknown_*`. A 404 is `invalid` but with `distinguishable_from_private: false`, because unauthenticated GitHub returns 404 for a private repo too — so the claim may read "not publicly readable" and must never read "does not exist" |
| **Worker: the thing that RUNS it** | `apps/worker/src/cli/observe.ts` + `npm run observe`. Performs one genuine observation end to end — real DNS resolver, real fetcher, real evidence store, nothing mocked, no output filtered. **This is the first code in the project's history that executes the collectors** |
| **CI: the `observe` job** | `.github/workflows/ci.yml` — observes `https://celobuilders.xyz` with `--repo https://github.com/Temmygabriel/OBSERVED` on every push. The only job that executes the worker rather than compiling it. Exit code 0 with an `unknown_*` artifact is a **pass** (the tri-state working); non-zero means our code threw |

### Not written yet

These throw a named error. They never return a plausible-looking value.

- `evidence-worker/collectors/screenshot.ts` — the only collector needing the paid path
- `payment-worker/payment-gate.ts` — `executePayment()` (the `buy` MCP call)
- `askbots-adapter/index.ts` — `pollProjects()` and the submit HTTP call
- Demo Mode (`replay`), public sanitized manifest

### Session 6 — registered, and the tag proven on-chain

**This is the session that cleared the critical path.** Sessions 4 and 5 both
ended with Rule 8 sitting at the top of the list: every mainnet transaction sent
before the tag existed is uncredited, and there is no backfill. That is now
resolved.

**The registration.** `PUT /submissions/me` → **200**. `status: "draft"`,
`publishedAt: null` — registered, not yet published.

| Field | Value |
|---|---|
| `attributionTag` | **`celo_f07034d50007`** |
| `primaryTrack` | `judges-favorite` (see the blocker table — `askbots-growth` needs a funded AskBots project) |
| `telegram` | `@temmygabriel` |
| `erc8004Url` | `https://celoscan.io/nft/0x8004a169fb4a3325136eb29fa0ceb6d2e539a432/9849` |
| `agentWalletAddress` | `0x556Ff7dD2bE1B504495288295Ad7cc3d414dd2c0` |
| `reviewerAgentWallets` | same wallet — **undeclared reviewer agents are excluded from awards**, so this had to be here |
| `cpayBetaOptIn` | `true` — requested; whether access was *granted* is unverified |

**The tag is proven, not assumed.** Exactly as the skill doc demands
(*"Checking once, early, is the difference between a wiring mistake costing one
transaction and costing the whole event"*), the very next mainnet transaction
after registration was a tag-check, and the tag was decoded back out of the
**mined** transaction rather than out of the calldata we built:

- tx `0x47431f7260aac8e4f83edbc21a0d68082efed0807c026b77debf3f28a8fefb64`
- block **77772173**, cost **0.004529925 CELO**
- `verify` decoded **`celo_f07034d50007`** from it

So ERC-8021 (`toDataSuffix(['observed', tag])`) is wired into `tools/sign-tx.mjs`
correctly and end to end. Rule 8 is no longer a hope; it is a demonstrated fact
about the signer.

**Balance after:** 0.464794305 CELO, **0 USDT**. The zero is what blocks the
`askbots-growth` track — see the blocker table.

**Where the secrets live.** The tag is saved at
`~/.observed-secrets/attribution.json`, outside the repo, so `git add .` cannot
reach it. The API key sits in `~/.observed-secrets/celobuilders.json` and is
never printed by any tool — `celo-put.mjs` redacts it from every response it
shows.

> **A key rotation does not lose the tag.** The operator rotated the Celo
> Builders API key on 2026-09-17. `attributionTag` is derived from the
> `owner/repo` slug and **locked at the first save**, and a copy was captured to
> disk the moment it was issued — so an expired or replaced key cannot take the
> tag with it. The tag is a fact about the submission, not a property of the
> credential.

**The first execution of the collectors, ever.** `apps/worker/src/cli/observe.ts`
and an `observe` CI job run a real observation against `https://celobuilders.xyz`
on every push. This closes the gap that decision 16 in `MEMORY.md` called the
project's biggest risk.

Its **first** run failed — and the failure is worth recording precisely, because
the obvious reading of it is wrong. The step exited 1, but the cause was
`ENOENT` writing `--out observed/run.json`: under `npm run --workspace` the cwd is
`apps/worker`, while the workflow's `mkdir -p observed` happened at the repo root.
**The observation itself was not what failed** — the tool died writing its own
receipt. Fixed by creating the parent directory in the tool, which is where it
belongs: a harness bug must not be reportable as a failure of the observation.

Two things about that failure are themselves the lesson:

- It was **invisible**. GitHub will not hand out job logs to an unauthenticated
  caller, and a step that pipes a process's stderr into a file reports nothing
  but `Process completed with exit code 1.` The CLI now emits an `::error::`
  workflow command on any failure, which *is* readable — it comes back as an
  annotation on the commit.
- **A passing job was equally unreadable.** The observation succeeded on the next
  push and there was still no way to see what it observed. So the job now
  re-emits every artifact as a `::notice::` (or `::warning::` for `unknown_*`)
  annotation: collector, artifact id, probed URL, status, address, status code
  and the URL it ended on.

#### The first confirmed observation — 2026-09-18

Run `35324433941`, all three jobs green, **8 artifacts, 0 collectors skipped**:

| Collector | Result |
|---|---|
| `dns` | `valid` — `addresses=137.184.23.32` (exactly one) |
| `tls` | `valid` — connected to `137.184.23.32`, the address the guard validated |
| `repo` | `valid` — `api.github.com` answered 200 for a public repo, not the 403 rate-limit trap |
| `html` | `valid` — `200`, **`redirect_count=1`**, `final_url=https://celoplatform.notion.site/Agents-at-Work-Hackathon-…` |
| `html` ×4 links | all `valid`, `200` |

**`celobuilders.xyz` redirects to a Notion page.** That is the single most useful
thing this run produced, because it settles a question the first annotated run
raised and could not answer. That run showed the page artifact on a Cloudflare
address while `dns` and `tls` both said `137.184.23.32` (DigitalOcean) — two
readings with opposite meanings: *the page moved* (a fact about the target) or
*the domain has several A records* (a fact about DNS). The redirect count settles
it: the address moved because the **page** moved. `addresses=137.184.23.32` shows
there is exactly one A record.

The lesson is in the report, not the run. The first annotation printed an address
that differed from DNS and was therefore **not evidence** — it was output, and
output that raises a question is not the same as output that answers one.
Widening it to carry `final_url` and `redirect_count` cost one commit and turned
an ambiguity into a fact. **Do this to any line before calling it evidence.**

**The flapping link, named — and fixed.** The run after this one printed
`target_url` for every artifact, which identified it: a **YouTube** link on the
demo target returned `invalid` on one run and `200 valid` on the next, from
unchanged code, minutes apart. CI runs from a datacenter address and large
platforms throttle those routinely — GitHub's own rate limit is the same
phenomenon and is already handled in `repo.ts`.

This mattered because `invalid` renders as **Detected**, and Detected becomes a
finding: the product would have published *"broken link"* about a link that
works. `html-links.ts` now maps 403 and 429 to `unknown_network_error` with
`refused_by_status: true`, keeping the status code so a review can still say
"returned HTTP 429" without claiming the link is dead. See `MEMORY.md` decision 24
for the two honest caveats — the union has no `unknown_refused` member, and the
original run's status code was never captured, so the fix is correct on its own
terms but may not be the whole explanation.

The earlier text of this note said the loose end "cannot be settled
retroactively". It was settled — not by finding the old status code, but by
making the next run print enough to identify the link. **That is the pattern worth
keeping: when something is undiagnosable, widen the output rather than reason
harder about the gap.**

### The first review, 2026-09-19

**Until this session, no review could be produced by any route.** `validateClaims`
was real, `renderDraft` was real, and `draftClaims()` — the step that produces
anything to say — threw unconditionally. The pipeline was complete except for its
content, so the product's central deliverable, a review whose every sentence cites
a hash-verified artifact, did not exist. Every CI run up to this point compiled the
whole thing and never once showed what it produces.

`draftClaims()` now delegates to `review-generator/draft-from-evidence.ts`, which
is **deterministic and not a model call**. The argument is structural rather than
pragmatic, and it is `MEMORY.md` decision 25: `validateClaims` is the gate, so a
model and a deterministic function are held to exactly the same standard; what
differs is the failure mode. A model can invent a plausible claim that passes.
This cannot invent anything, because it can only restate fields the collectors
recorded. A model is not excluded from the design, only from the critical path.

CI run `35371381202` drafted **7 claims from 8 artifacts, 0 held**, and published
the text as an annotation on the commit:

> The domain is publicly resolvable, observed as celobuilders.xyz resolves to
> 137.184.23.32. The page is publicly reachable and served without authentication,
> observed as the URL returned HTTP 200 after 1 redirect, ending at
> https://celoplatform.notion.site/Agents-at-Work-Hackathon-…. The page declares
> its own subject, which can be compared against the project description, observed
> as the document title is "Agents at Work Hackathon | Notion". Traffic to this
> host is encrypted with a currently-valid certificate, observed as a TLS
> handshake completed on port 443, for celobuilders.xyz, issued by YE1, valid until
> Nov 1 10:06:50 2026 GMT, 43 days remaining. The source code is available for
> inspection without authentication, observed as the repository
> Temmygabriel/OBSERVED is publicly readable, with default branch main, last
> committed to at 2026-09-18T16:56:03Z. The project has been changed at least once
> at or after this date, observed as the most recent commit on the default branch
> is dated 2026-09-18T16:56:03Z. The terms under which others may use this code are
> not stated, observed as no licence file was found at the repository root.

**Reading it as a reviewer would turned up two flaws that staring at the drafter
would never have shown**, which is the whole reason for getting output in front of
someone:

- **The same fact twice, in consecutive sentences.** The commit timestamp appeared
  in the `readable` claim's observation *and* had its own claim. It now appears
  once. Padding a review with a restatement makes it look like it knows more than
  it does.
- **Four link artifacts contributed nothing.** Healthy links produce no claim by
  design, so the review read as though no external link had been checked. The page
  record carries the sweep's own `links_*` counts precisely so coverage is
  inspectable, so there is now one claim citing the page. It counts **coverage and
  nothing else** — `links_checked` is how many links were *probed*, so a 404 counts
  as checked, and reading health out of it would assert something the record does
  not contain.

**What this does and does not prove.** It proves the loop closes: real observation
→ claims → validation → rendered text, on every push, readable without a token.
It does **not** prove the product, because the target is still the organisers' own
site and the operator's own repo. Observed exists to review *other people's*
projects, and that is next action 1.

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
| ~~2~~ | ~~Real CELO on mainnet~~ | — | **Done.** See session 6 for the current balance |
| ~~3~~ | ~~ERC-8004 Agent ID~~ | — | **Done.** `agentId` 9849 on Celo mainnet |
| ~~4~~ | ~~Personal Telegram @handle~~ | — | **Done 2026-09-17.** `@temmygabriel` |
| ~~5~~ | ~~Celo Builders registration + `attributionTag`~~ | — | **Done 2026-09-17.** Tag `celo_f07034d50007`, proven on-chain. See session 6 |
| ~~8~~ | ~~`buy` closed-beta opt-in~~ | — | **Done 2026-09-17.** `cpayBetaOptIn: true` was sent at registration. Whether access is *granted* is unverified — see below |
| 6 | **AskBots API key** | AskBots Adapter, any real review submission | `POST askbots.ai/api/auth/openclaw`. Self-serve, returned **once**, unrecoverable — re-registering mints a *new identity* and discards rating and earnings |
| 7 | **An AskBots PROJECT url for Observed** | The AskBots CLI Growth Track submission field `askbotsProjectUrl` | Observed must also exist on AskBots **as a project** (`askbots.ai/p/<id>`), not just as a reviewer |
| 9 | **Vercel deployment** | Public URL for the frontend | Operator deploying as of 2026-09-17. **No environment variables are needed** — the frontend has no key of any kind |
| — | ~~Chainstack Growth plan~~ | Nothing | **Optional.** `forno.celo.org` is free and explicitly fine. The coupon path normally means entering payment details first — do not do this |
| — | `gh` CLI not installed | Convenience only — plain `git` push works | |

**Item 7 is blocked by money, not by effort.** `askbotsProjectUrl` requires
Observed to exist on AskBots as a funded project, and funding it needs roughly
**$1.10 in USDT** on Celo that the operator does not have. Balance was **0 USDT**
as of 2026-09-17. This is the single blocker between the project and the
`askbots-growth` track. The registration therefore went in under
**`judges-favorite`** — a working choice, and it is changeable.

**Do not tell the operator to "just add funds".** That advice was already given
and answered: the money is not there. `real-world-adoption` ($1,000 + $750)
explicitly rewards a free product with real users, which is reachable without
spending anything, and is the track this build should be aimed at.

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

1. **Change the demo target.** Every `observe` run so far points at
   `https://celobuilders.xyz`, which redirects to the organisers' own Notion
   page. That is a good stable smoke target and it has done its job, but Observed
   exists to review *other people's projects* — observing the organisers proves
   the plumbing, not the product. The honest demo is a real project submitted to
   this event. Blocked on the AskBots key, which is what lists those projects.
2. **Decide the `collector` label for link artifacts.** `html-links.ts:316` emits
   them as `collector: 'html'`, the **same label as the page artifact**, so four
   link results and one page result are indistinguishable by collector and only
   `artifact_id` separates them. This is a fabricated-finding risk of the exact
   kind this codebase is built to refuse: "the page returned an error" is not the
   same claim as "a link on the page did", and the second must never render as the
   first. Not changed yet because it alters the UI's grouping — a decision, not a
   fix.
3. **Then `screenshot`** — the only collector that needs the paid path, so it
   waits on `buy` closed-beta access actually being granted. Everything it does
   *after* the bytes arrive is already written: hash, store, map a non-2xx
   provider response.
4. **Vercel.** Operator is deploying; **no environment variables are needed**.
   The frontend holds no key of any kind. It runs in a clearly labelled sample
   mode until a worker is deployed, and `/status` degrades to `BLOCKED` with an
   explicit reason rather than showing nothing. `NEXT_PUBLIC_OBSERVED_API_URL`
   stays unset until there is a worker to point at.
   > Anything named `NEXT_PUBLIC_*` is baked into the browser bundle and readable
   > by anyone. The wallet private key and the AskBots key must never go into
   > Vercel, under any name.
5. **AskBots adapter last** — the only piece needing a live key.
6. **Optional housekeeping:** `package-lock.json` is not committed, so CI installs
   take the `npm install` branch and are not reproducible. The CI step that
   reports this used `hashFiles()`, which was evaluated *after* `npm install` had
   written the file into the working tree — so it was skipped on every run and
   read as "the lockfile is committed", the opposite of the truth. It now asks
   git. Vercel produces a lockfile on first deploy, which is the cheapest route
   to committing one.

### Cleared this session

- ~~Get the `attributionTag`, which means registering.~~ **Done** — `celo_f07034d50007`, proven on-chain.
- ~~Wire ERC-8021 into `tools/sign-tx.mjs` before it sends anything else.~~ **Done** — and verified by decoding the tag out of a mined transaction.
- ~~Write the `repo` collector.~~ **Done** — 403/429 → `unknown_*`, 404 → `invalid` but never "does not exist".
- ~~Make the collectors run at all.~~ **Done 2026-09-18** — first confirmed real observation, 8 artifacts, see above.

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

The gap is now **one collector, one screenshot, and two API calls** — not "the
whole worker". The frontend is deployable as it stands. Session 6 closed the
`repo` collector, so only `screenshot` remains, and that one waits on paid-path
access rather than on code.

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

Session 6 did the thing sessions 4 and 5 could not: it **made the collectors
run**. `npm run observe` performs a genuine observation with the real resolver,
the real fetcher and the real evidence store, and CI runs it on every push
against a real target. That is the structural answer to decision 16 — the
project's biggest risk was never a missing feature, it was that nothing here
executed code, so "complete" meant "compiles" and a fetcher that sent nothing at
all survived three sessions.

The caveat this file carried for a day — "the collectors have a way to run, but
no artifact has ever been read" — is now **retired**. A green `observe` job with
eight attributed artifacts is on the commit history, and the numbers in that
table came out of the program, not out of a document.

What replaced it is a smaller and more honest gap: the collectors observe
**`celobuilders.xyz`**, which redirects to the organisers' own Notion page. That
proves the plumbing end to end — real DNS, a real TLS handshake against the
validated address, a real redirect chain, a real public API — but it is not a
review of anyone's project. The product claim is that Observed can look at a
stranger's submission and say something true and cited about it. That claim is
**still unproven**, and it stays unproven until the demo target is a real event
submission rather than the organisers' own site.

Registration is the other half. The tag exists, is locked, is stored outside the
repo, and was **decoded back out of a mined mainnet transaction** rather than
assumed from the calldata we built. The uncredited mint recorded above remains
the one transaction that could not carry it — that cost was paid and is not
recoverable, and it bought the ordering knowledge that made every later
transaction correct.

The gap this file described as *"the product's central claim is a review whose
every sentence cites a hash-verified artifact, and there was no review"* is now
**closed**. `draftClaims()` was the last step that threw, and it no longer does.
A review is drafted from a real observation on every push and its text is on the
commit, in the only channel readable without a token.

That closes the loop but does not yet demonstrate the product, and the two should
not be confused. Everything above still observes `celobuilders.xyz` and
`github.com/Temmygabriel/OBSERVED` — the organisers' site and the operator's own
repo. The review that came out of it is **true and cited**, and it is also a
review of people who are not being reviewed. The step that turns this from a
working pipeline into a working product is pointing it at a stranger's submission,
which needs the AskBots key.
