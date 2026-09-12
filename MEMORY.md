# Observed — Memory

**Purpose:** durable notes so a future session does not have to re-derive
things or re-litigate settled decisions. `PROGRESS.md` says *what* is built.
This file says *why*, and records the environment facts that are easy to
forget.

**Last updated:** 2026-09-12 (session 3 — CI green; html collector written. See
decisions 14 and 15).

---

## Environment facts (verified 2026-09-12)

| Thing | State |
|---|---|
| OS | Windows 11 Pro, `win32` |
| Shell | PowerShell primary; Git Bash available |
| `git` | 2.53.0.windows.2 ✅ |
| `node` | v24.14.0 ✅ |
| `npm` | 11.9.0 ✅ |
| `gh` CLI | **not installed** |
| Git identity | `Temmygabriel` / `temmygabriel1@gmail.com` |
| Credential helper | `manager` (Git Credential Manager) |
| Repo | `https://github.com/Temmygabriel/OBSERVED` — public, existed empty, `git ls-remote` returned exit 0 with no refs |

### The machine is low-powered — this is a hard constraint

**Do not run `npm install`, `next build`, or any heavy npm task locally.** All
dependency installation and building happens in GitHub Actions and on Vercel.
Local work is limited to writing files and `git` operations. A green CI run is
the only signal that the code actually compiles.

Consequence: the first push may well fail CI, and that is the intended
workflow — CI is the compiler here.

### Reading CI output without a GitHub token

This matters more than it looks: CI *is* the compiler here, so a failure whose
output cannot be read is a failure that cannot be fixed. Verified 2026-09-12.

| Endpoint | Unauthenticated? |
|---|---|
| `GET /repos/{o}/{r}/actions/runs` and `/runs/{id}/jobs` — status, step names, timings | ✅ |
| `GET /repos/{o}/{r}/check-runs/{job_id}/annotations` | ✅ |
| `GET /repos/{o}/{r}/actions/jobs/{id}/logs` | ❌ 403 "Must have admin rights to Repository." |
| `GET /repos/{o}/{r}/actions/runs/{id}/logs` | ❌ same |
| `$GITHUB_STEP_SUMMARY` via `check-runs.output.summary` | ❌ returns `(none)` |

So annotations are the **only** readable channel. That is why the Typecheck step
pipes each workspace through `tee` and re-emits every `error TS...` line as an
`::error::` workflow command — plain stdout is not annotated, and a step that
redirects the compiler straight into a file reports nothing but
`Process completed with exit code 1.`

Two quirks worth remembering:

- The `/jobs` response returns `check_run_id: null`, but the job's own `id` **is**
  the check-run id. Use it directly.
- GitHub also auto-parses multi-line `tsc` output, so a single error can appear
  as several annotations (the `file(line,col): error TS...` header plus each
  "detail" line). De-duplicate when reading.

---

## Decisions that differ from the spec, and why

### 1. Plain CSS with custom properties, not Tailwind

The design spec's build notes suggest a Tailwind config. This was **not**
followed.

- The same document provides its tokens as a CSS custom property table
  (`--paper`, `--ink`, `--evidence-blue`, …). Using CSS variables directly maps
  1:1 to that table with no translation layer.
- Tailwind adds a dependency and a version-compatibility surface at exactly the
  moment we cannot afford a broken build (weak machine, 9-day deadline).
- The design is hand-crafted — hairline rules, no shadows, a fixed type scale,
  deliberate non-standard radii. There is very little utility-class reuse to
  gain.

If someone wants Tailwind later, the tokens are already named correctly and
could be lifted into a config verbatim.

### 2. Reveal animation is declarative, not JS-timed

`HeroSequence` gates revealed content with a `data-revealed` attribute instead
of mounting and unmounting it.

Three consequences, all intended:

1. No reflow — space is reserved, so the sentence does not jitter as words
   appear.
2. The full sentence is in the DOM from frame one, so screen readers and
   copy-paste get it immediately. We are pacing an appearance, not withholding
   information.
3. `prefers-reduced-motion` is honoured by a **single CSS rule applied at first
   paint** — no flash of an empty sequence, and no dependence on a JS timer
   having run. A JS-only implementation cannot achieve this without a visible
   flash, because `matchMedia` is unavailable during server render.

### 3. `buildCitation` and the sentence renderer are pure functions in `lib/claims.ts`

Rule 10 says the review text is "rendered from this record, not generated
freely". `renderClaimSentence()` is the only place a `ReviewClaim` becomes
prose. Two properties fall out:

- A claim cannot be asserted without an observation, because the sentence is
  built *from* the observation.
- A claim with `confidence: 'unable_to_verify'` **cannot** be phrased as a
  finding — there is an explicit branch that refuses to.

If a language model is later used to phrase these more naturally, its output
must still be assembled here, so the evidence pointer cannot be dropped.

### 4. `RecordProvenance` is a required field, not a convention

`ReviewBundle.provenance` is `'live' | 'sample' | 'replay'`, and
`PROVENANCE_LABELS` gives a non-null label for everything except `live`.

The design spec requires a replay to be labelled. Making provenance mandatory
and non-optional means the label cannot be forgotten by accident — the type
forces the UI to render something. This is the mechanism that stops "show a
demo" from quietly becoming "show a fabrication".

### 5. No dark mode (spec-mandated, restated because it is tempting to add)

Design spec Section 2 rejects it outright: the paper/instrument aesthetic
depends on a light surface, and neon-on-black is the exact cliché this project
is trying to be distinguishable from. There is a comment in `globals.css`
saying so. **Do not add a `prefers-color-scheme` block.**

### 6. `Unable to verify` gets no accent colour

The token table names two meaningful accents (evidence-blue, detected-amber)
and the spec forbids introducing a fourth. Uncertainty is neither a
confirmation nor a detection, so `StatusBadge` renders it as ink-on-paper with
a hairline border. Using a colour would imply a verdict the evidence does not
support.

### 7. The worker typechecks but does not emit

`@observed/shared-types` ships TypeScript source; the web app consumes it via
`transpilePackages`, and the worker imports it through the workspace link. Both
run `tsc --noEmit`, so CI type-checks with the real compiler without a monorepo
build-ordering problem.

How the worker *runs* is a separate decision — see #9 below, which supersedes an
earlier plan to emit a `dist/` with `tsc`.

### 8. CI uses `npm install`, not `npm ci`

There is no `package-lock.json` yet, and generating one requires a local
`npm install` — the thing this machine must not do. The workflow checks for the
lockfile and prefers `npm ci` once it exists. Vercel will generate and commit
one on first deploy.

### 9. The worker runs through `tsx`, not a `tsc` build output

`tsconfig.base.json` sets `moduleResolution: "Bundler"`, which emits ESM with
extensionless relative imports. Node cannot run that output, so a `tsc` build
would produce a `dist/` that fails at runtime — and the failure would show up on
Railway, not here, because nothing is built locally.

`tsx` resolves TypeScript directly. It is in `dependencies` (not
`devDependencies`) because `npm start` uses it in production, and hosts that
prune dev dependencies would otherwise break the start command. The worker's
`typecheck` is still `tsc --noEmit`, so CI still type-checks the real compiler.

### 10. Unfinished modules throw a named error. They never return a plausible value

This is the single most important convention in `apps/worker`, and it is easy to
undo by accident.

A collector that is not written yet throws
`CollectorNotImplementedError`. It does **not** return an `unknown_timeout`
artifact. The reason is Rule 3's actual meaning: `unknown_*` is a statement
about the **target** — "we could not reach it". Our own unfinished code is not a
fact about someone else's project, and rendering it as one would put a
fabrication into someone's review with a timestamp and a hash attached, which is
worse than an obvious gap.

The same principle appears twice more:

- `/reviews` returns **503 with a reason**. An empty list would make the History
  screen say "no reviews yet" (a claim about the world); the 503 makes it say
  "this endpoint does not exist yet" (true). `lib/data.ts`'s `Loaded<T>` already
  keeps those two cases distinct.
- `getPublicStatus()` never returns "unavailable". A status page that cannot
  report its own unavailability is useless, so it degrades to `BLOCKED` with an
  explicit reason.

### 11. Money is `BigInt` micro-units. A float never compares against a cap

`policy-engine/decimal.ts` converts amount strings to integer micro-units (1e-6)
before any arithmetic or comparison. `wouldExceedCap()` is the only place the
cap comparison is written, so the `>` can never accidentally become `>=`.

Even the "50% of daily cap" alert is `spent * 2 >= cap * 1` in BigInt rather
than `spent / cap >= 0.5` — dividing first would introduce a float at exactly
the point where being wrong matters, and 49.9999% rendering as "50% used" erodes
trust in the number.

### 12. The audit chain is verified by re-walking from genesis

`verifyChain()` checks three separate things per entry, because each catches a
different edit: sequence continuity (an entry was **deleted**), the `prev_hash`
link (an entry was **replaced or reordered**), and the entry's own hash (a
payload was **edited in place**). Checking only the last would miss a deletion.

Payloads are canonicalised (keys sorted, `undefined` dropped) before hashing.
Without that, re-serialising the same object with a different key order produces
a different hash, and the chain "breaks" for a reason that has nothing to do
with tampering.

### 13. Payment policy is separated from the payment call

In `payment-gate.ts`, everything that decides *whether* to pay is real:
`resolveProvider()` (the allowlist), `attributionTagOrRefuse()` (Rule 8's "no
backfill, so refuse rather than spend"), and `mayRetry()`. Only
`executePayment()` is a stub.

This matters because it means the safety properties are reviewable now, without
a wallet. A missing attribution tag refuses before the transaction rather than
being patched in afterwards — which is the only correct behaviour, since a
settled transaction cannot be retroactively tagged.

### 14. The spend ledger is collapsed before it is read, never trusted in log order

`spend-ledger.ts` appends two entries per paid call: a `quoted` attempt before
the call, and the outcome after it. The file is append-only and nothing is ever
updated.

That is the right storage shape — a crash mid-call leaves the attempt on disk,
which is exactly when you most need it — but it means **the raw log is not a
usable view of spend.** Read naively, one settled payment looks like two events:
one outstanding, one spent. `isInFlight` matched the stale `quoted` attempt
forever, so the concurrency gate (Rule 9, limit 1) saw one call permanently in
flight and refused every paid call after the first. The budget double-counted
the same way.

`latestByPayment()` collapses the log to the last entry per `payment_id`, and
every consumer — `computeSpendState`, `authorizeSpend`, `paidCallsForProvider`,
`spendForReview` — reads the collapsed view. Each collapses internally rather
than trusting a caller to have done it, so each is correct whatever it is
handed. A payment is outstanding exactly when its most recent entry is still
`quoted`.

**A related trap that caused this bug:** `PaymentStatus` and `ReviewStatus` are
different unions that share no members. `PaymentStatus` is
`quoted | settled | failed | ambiguous_no_retry` (build spec line 177);
`'submitted'` and `'accepted'` are `ReviewStatus` values. Writing a
`ReviewStatus` member into a `PaymentStatus` set produces
`TS2769: No overload matches this call.` — which points at the `new Set<...>(`
call, not at the offending string, so the error text does not name the bad
value. Read the union, not the error.

**How this was found:** CI, not local reading. Fixing the type error is what
exposed the logic bug sitting underneath it.

### 15. The fetcher, not the guard, is what makes Rule 4 real

`ssrf-guard.ts` is only half of Rule 4. A guard that is not called on the path a
request actually takes is decoration, so `pinned-request.ts` is written such that
the two standard bypasses cannot be expressed at all:

- **No `fetch`, and no `redirect: 'follow'`.** Both resolve the next hop inside
  the client, where the guard cannot see it. The check would silently cover only
  the first URL, and a one-line `302 Location: http://169.254.169.254/` would
  walk straight through a guard that passes any review of the input validation.
  So the redirect loop is explicit and calls `assertRedirectHop` on every hop.
- **`host` is an IP literal.** Node skips DNS entirely when `host` is an IP, so
  there is no second resolution between the address that was checked and the
  address that was connected to. That gap *is* the DNS-rebinding window.
  `servername` still carries the real hostname, so TLS SNI and certificate
  verification are unaffected — pinning costs nothing in correctness.

`fetch` therefore cannot be used here at all, for the second reason: it offers no
way to pin the connect address.

Every bound is explicit, and each one is load-bearing: a single deadline shared
across ALL hops (per-hop timeouts multiply), a 512 KiB body cap with the socket
destroyed on breach, and a hop limit. An unbounded read from a hostile host is a
memory exhaustion primitive, not a page fetch.

**A Rule 3 corollary that surfaced while writing it:** `ResolutionFailedError` is
now split out of `BlockedTargetError`, because "we refused this target" is
`invalid` — a citable finding about the submission — while "our resolver did not
answer" is `unknown_*`, which says nothing about the target. They were one error
class, which would have reported every DNS outage as a broken submission: the
exact inversion Rule 3 exists to prevent. It extends `BlockedTargetError`, so any
caller that only asks "was this refused?" keeps working unchanged.

Related: the header set handed to the model is an **allowlist**, not a denylist.
A denylist of credential-shaped names fails open the first time a server invents
a header nobody anticipated; an allowlist fails closed (Rule 11).

---

## Rules that are easy to violate by accident

| Rule | Where it is enforced |
|---|---|
| 3 — tri-state evidence | `shared-types/src/evidence.ts` (`isConclusive()` is the only gate for a claim); `review-generator/validateClaims()` downgrades any claim asserting against an `unknown_*` artifact |
| 4 — SSRF guard | `worker/src/evidence-worker/ssrf-guard.ts` for the rules, `pinned-request.ts` for the fetcher that actually obeys them. **Both complete.** Re-check on **every redirect hop** via `assertRedirectHop`; connect to `pinResolvedAddress()`, never re-resolve. No `fetch`, no `redirect: 'follow'` — see decision 15 |
| 5 — exclusion before spend | `worker/src/policy-engine/exclusion.ts` + `evaluateProject()`. The branch order in `evaluateProject` IS the policy: exclusion is checked before a budget is ever consulted |
| 8 — attribution tag | `payment-gate.ts` `attributionTagOrRefuse()`. **No backfill** — refuse rather than spend untagged |
| 9 — spend caps | `policy-engine/spend-ledger.ts` + `decimal.ts`. `ambiguous_no_retry` is counted **against** the budget and never retried; the append-only log is collapsed through `latestByPayment()` before any figure is derived from it |
| 10 — claim → evidence → action | `review-generator/validateClaims()` on the worker; `web/lib/claims.ts` `renderClaimSentence()` is the only place a claim becomes prose |
| 11 — secrets | CI `secret-hygiene` job; `config.ts` never logs a key (presence checks only); `EvidenceArtifactPanel` denylists credential-shaped metadata keys |
| 12 — watchdog | `worker/src/watchdog/index.ts`. Alerts on **business** inactivity; `minutes_since_last_review === null` reads as the worst case, not as unknown |

---

## Open questions, unresolved

1. **AskBots daily limit.** The hackathon page says limits scale 2→5→15→50
   with account age; askbots.ai/docs found no daily cap and
   one-review-per-project. Build spec Section 8 says resolve this with a live
   `curl` against `https://www.askbots.ai/api` on day 1 — **not yet done**.
   Currently stubbed as `ASKBOTS_DAILY_LIMIT_UNRESOLVED` in `lib/config.ts`.
2. **Celo x402 `/settle` health.** `/verify` and `/supported` can report
   healthy while `/settle` fails (needs an API key). The Watchdog probe must
   target `/settle`-adjacent health specifically.
3. **Which demo mode on the day.** `replay` vs `live` — decide after a dry run
   on the morning of judging, not on stage.
