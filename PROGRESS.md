# Observed — Build Progress

**Last updated:** 2026-09-12 (session 3)
**Deadline:** 2026-09-21, 09:00 GMT
**Days remaining at last update:** 9

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
| **Worker: pinned fetcher** | `evidence-worker/pinned-request.ts` — **complete**. Redirect-following HTTP that calls `assertRedirectHop` on every hop and connects to the validated IP, not the hostname. Bounded by a shared deadline, a 512 KiB body cap, and a hop limit |
| **Worker: HTML collector** | `evidence-worker/collectors/html.ts` — **complete**. Status, content type, redirect chain, served address, title, meta description, lang, viewport — each with an exact locator. Raw body goes to the store; only the hash and metadata leave |
| **Worker: policy gate** | `policy-engine/index.ts` — `evaluateProject`, exclusion before spend |
| **Worker: review validation** | `review-generator/index.ts` — `validateClaims` + `renderDraft` are **real**; only the model call is stubbed |
| **Worker: payment policy** | `payment-worker/payment-gate.ts` — provider allowlist, attribution refusal (Rule 8), `mayRetry` are **real**; only the `buy` call is stubbed |
| **Worker: 422 handling** | `askbots-adapter/index.ts` — response classification + `submitWithRewrites` are **real**; only the HTTP calls are stubbed |
| **Worker: evidence store** | `evidence-store/index.ts` — append-only, raw/record split, content-hash filenames |
| **Worker: HTTP surface** | `src/index.ts` — `/healthz`, `/readyz`, `/status` real; `/reviews` returns 503 **with a reason** |

### Not written yet

These throw a named error. They never return a plausible-looking value.

- `evidence-worker/collectors/` — `tls.ts`, `screenshot.ts`, `repo.ts`
- The `html` link sweep — a deliberately separate pass over the parsed body, so
  that per-link results never fold into the page's own status
- `review-generator/index.ts` — `draftClaims()` (the model call itself)
- `payment-worker/payment-gate.ts` — `executePayment()` (the `buy` MCP call)
- `askbots-adapter/index.ts` — `pollProjects()` and the submit HTTP call
- Demo Mode (`replay`), public sanitized manifest

> **Why this split, not "stub everything":** the safety core (Rules 3, 4, 5, 8,
> 9, 10, 12) is pure logic with no keys and no network, so it can be **genuinely
> correct** right now rather than merely present. What is stubbed is exactly
> what needs a wallet, an API key, or an LLM. A collector we have not written
> does not emit an `unknown_*` artifact, because `unknown_*` is a claim about
> the target — our unfinished code is not a fact about someone else's project.

---

## Blockers — waiting on the operator

These cannot be worked around in code. Everything else is unblocked.

| Blocker | Blocks | Notes |
|---|---|---|
| No Celo Builders registration | Rules 8, 7, and the whole submission checklist | `npx skills add https://celobuilders.xyz` |
| No ERC-8004 Agent ID | Identity, reputation registry work | Issued at registration |
| No attribution tag (`celo_...`) | **Every mainnet transaction.** Rule 8 has no backfill | Must be wired in before the first tx, not after |
| No `buy` wallet + funding | Payment Worker, any real evidence purchase | |
| No AskBots API key | AskBots Adapter, any real review submission | |
| No Vercel account | Public URL for the frontend | Operator chose Vercel |
| `gh` CLI not installed | Convenience only — plain `git` push works | |

**Nothing above blocks the frontend.** It runs in a clearly labelled sample mode
until a worker exists, and `/status` degrades to `BLOCKED` with an explicit
reason rather than showing nothing.

---

## Next actions, in order

1. **Write the `tls` collector.** The simplest one left, and it shares the
   pieces already written: `assertPublicTarget` for the guard, and a socket
   whose SNI and certificate verification are already correct. It needs the
   peer certificate off the connection, not a new fetcher.
2. Then the `html` link sweep — the second pass over the parsed body. Report
   per-link results, never one folded status, and leave an unreachable link as
   `unknown_*`.
3. Then `repo` (public API, no key), then `screenshot` (the only one that needs
   the paid path, so it waits for a wallet).
4. Operator connects the repo to Vercel. The app already builds in CI, so this is
   a configuration step, not a code step. `NEXT_PUBLIC_OBSERVED_API_URL` stays
   unset until a worker is deployed.
5. Registration day: get the agent ID, wallet, and attribution tag; send one tiny
   test transaction and verify the tag with `verifyTx` **before** any second
   transaction. Rule 8 has no backfill.
6. AskBots adapter last — the only piece needing a live key, plus the day-one
   `curl` that resolves the daily-limit contradiction in spec Section 8.
7. Optional housekeeping: `package-lock.json` is generated inside CI on every run
   but never committed, so installs are not yet reproducible and CI still takes
   the `npm install` branch rather than `npm ci`. Committing one needs either a
   local `npm install` (forbidden on this machine) or a CI job with
   `contents: write` that commits it back. Vercel will produce one on first
   deploy, which is the cheapest route.

---

## Honest status of the pitch

The submission's central claim is that every assertion is traceable to a
hash-verified artifact. **The project still cannot make that claim about
itself** — no real evidence artifact exists yet, because no collector that
touches the network has been written.

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

The same session wrote the **HTML collector and the pinned fetcher beneath it**,
so the project's arc from "no observation ever made" to "a real observation with
a timestamp and a hash" is now one authorised call away. What is still missing
before that call can happen is the wallet, not the code.

The gap is now narrow and specific: **three collectors, the link sweep, and two
API calls** — not "the whole worker". The frontend is deployable as it stands.

The frontend continues to ship with an explicit `RecordProvenance` type and a
visible label on every non-live record. Nothing in the UI is presented as a real
observation when it is not. This is deliberate: the honest empty state is
available from day one, and the real numbers replace it as they arrive. It must
never be the other way round.
