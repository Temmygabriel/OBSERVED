# Observed — Build Progress

**Last updated:** 2026-09-12 (session 2)
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
| CI | `.github/workflows/ci.yml` — secret-hygiene job (enforces Rule 11), typecheck + build job |
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
| **Worker: spend ledger** | `policy-engine/spend-ledger.ts` — Rule 9, **complete**. Caps, no-retry-after-ambiguous, concurrency=1 |
| **Worker: exact decimal** | `policy-engine/decimal.ts` — BigInt micro-units. No float ever compares against a cap |
| **Worker: audit ledger** | `audit-ledger/index.ts` — **complete**. Hash chain with canonical JSON, full re-walk verification |
| **Worker: watchdog** | `watchdog/index.ts` — Rules 7 + 12, **complete**. State machine + business-inactivity alert |
| **Worker: DNS collector** | `evidence-worker/collectors/dns.ts` — **complete** (the one collector needing no key and no HTTP client) |
| **Worker: policy gate** | `policy-engine/index.ts` — `evaluateProject`, exclusion before spend |
| **Worker: review validation** | `review-generator/index.ts` — `validateClaims` + `renderDraft` are **real**; only the model call is stubbed |
| **Worker: payment policy** | `payment-worker/payment-gate.ts` — provider allowlist, attribution refusal (Rule 8), `mayRetry` are **real**; only the `buy` call is stubbed |
| **Worker: 422 handling** | `askbots-adapter/index.ts` — response classification + `submitWithRewrites` are **real**; only the HTTP calls are stubbed |
| **Worker: evidence store** | `evidence-store/index.ts` — append-only, raw/record split, content-hash filenames |
| **Worker: HTTP surface** | `src/index.ts` — `/healthz`, `/readyz`, `/status` real; `/reviews` returns 503 **with a reason** |

### Not written yet

These throw a named error. They never return a plausible-looking value.

- `evidence-worker/collectors/` — `html.ts`, `tls.ts`, `screenshot.ts`, `repo.ts`
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

1. **Commit and push; confirm CI goes green on GitHub.** All building happens in
   the cloud — this machine must not run `npm install` or `next build`.
2. Fix whatever CI reports. First run is expected to surface something.
3. Operator connects the repo to Vercel; set `NEXT_PUBLIC_OBSERVED_API_URL`
   later, once a worker exists.
4. Write the `html` collector next — it is the demo's centrepiece and needs no
   key. Build it on `assertPublicTarget` / `assertRedirectHop`, which are
   already written.
5. Then `tls` (simplest remaining), then `repo`, then `screenshot` (needs the
   paid path).
6. Registration day: get the agent ID, wallet, and attribution tag; send a tiny
   test transaction and verify the tag with `verifyTx` **before** any second
   transaction.
7. AskBots adapter last — the only piece that needs a live key, plus the day-one
   `curl` that resolves the daily-limit contradiction in spec Section 8.

---

## Honest status of the pitch

The submission's central claim is that every assertion is traceable to a
hash-verified artifact. **The project still cannot make that claim about
itself** — no real evidence artifact exists yet, because no collector that
touches the network has been written.

What has changed this session: the machinery that *enforces* the claim is now
real. The SSRF guard, the exclusion check, the spend caps, the claim validator
and the hash chain are written and will refuse to operate incorrectly — they are
not stubs that pretend. So the gap is now narrow and specific: **four collectors
and two API calls**, not "the whole worker".

The frontend continues to ship with an explicit `RecordProvenance` type and a
visible label on every non-live record. Nothing in the UI is presented as a real
observation when it is not. This is deliberate: the honest empty state is
available from day one, and the real numbers replace it as they arrive. It must
never be the other way round.
