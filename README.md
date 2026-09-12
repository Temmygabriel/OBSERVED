# Observed

**A reviewer agent that is not allowed to have an opinion until it has paid for evidence.**

Most AI "reviewer" products generate confident prose from a prompt and nothing else. There is no way to tell whether the model looked at anything real. Observed spends fractions of a cent — via Celo's `buy` marketplace — to take a real screenshot, check a real TLS certificate and hit real HTTP endpoints, then writes a review in which every sentence points back at a timestamped, hash-verified artifact you can open yourself.

It never says "looks good". It says `POST /signup → 404, observed 09:14:32 UTC`, with a receipt.

Built for the Celo **Agents at Work** hackathon, AskBots CLI Growth Track. Submission deadline **21 September 2026, 09:00 GMT**.

---

## What is actually built right now

This is a live repository, not a finished product. Here is the honest split.

| Area | State |
| --- | --- |
| Web app — all 8 screens | **Done** |
| Shared type contracts | **Done** |
| Evidence-backed copy rendering (Rule 10) | **Done** |
| SSRF guard (Rule 4) | **Done** |
| Exclusion list (Rule 5) | **Done** |
| Spend ledger + caps (Rule 9) | **Done** |
| Hash-chained audit ledger | **Done** |
| Watchdog state machine (Rules 7, 12) | **Done** |
| DNS collector | **Done** |
| HTML / TLS / screenshot / repo collectors | **Not written yet** |
| Review Generator (the model call) | **Not written yet** |
| Payment Worker (the `buy` call) | **Not written yet** |
| AskBots adapter (HTTP calls) | **Not written yet** |

Modules that are not written yet **throw a named error instead of returning something plausible**. A collector that has not been built does not produce an `unknown_*` evidence artifact, because `unknown_*` is a statement about the target — "we could not reach it" — and unfinished code of ours is not a fact about someone else's project. Those two things staying separate is most of what this codebase is about.

The same rule applies to the worker's HTTP surface: `/reviews` answers **503 with a reason**, not an empty list. An empty list would make the History screen say "no reviews yet", which is a claim about the world; `503` makes it say "this endpoint does not exist yet", which is true.

---

## Layout

```
observed/
├── apps/
│   ├── web/          Next.js 15 · all 8 screens · deploys to Vercel
│   └── worker/       Node service · owns the wallet and every paid call
├── packages/
│   └── shared-types/ the contracts both sides import
└── .github/workflows/ci.yml
```

`packages/shared-types` ships **TypeScript source**, not a build output, and the web app compiles it via `transpilePackages`. There is no separate build step and therefore no window where the frontend and the worker disagree about what a field is called.

## Running it

Requires Node 20+.

```bash
npm install
cp .env.example .env        # leave NEXT_PUBLIC_OBSERVED_API_URL empty to start
npm run dev:web             # http://localhost:3000
```

With no worker configured, the site runs in its honest empty state: it says nothing has been checked yet, and offers a review of `sample` that is **labelled as a sample** on every screen it appears on. It will not invent numbers to fill space.

Worker (once its modules are written):

```bash
npm start --workspace @observed/worker
```

### Checks

```bash
npm run typecheck     # both apps + shared types
npm run build         # production build of the web app
```

CI runs both on every push. It also runs a **secret-hygiene** job that fails the build if a real `.env` is ever committed, or if `.env.example` ever declares a non-empty secret value. Rule 11 is enforced by a machine rather than by good intentions.

---

## The twelve rules

The build spec's non-negotiables, and where each one actually lives in the code. A rule with no file next to it is a rule that is currently only a promise.

| # | Rule | Where |
| --- | --- | --- |
| 1 | The reviewer pays before it opines | `worker/src/payment-worker/payment-gate.ts` |
| 2 | TLS/DNS/HTTP checks are deterministic code, never LLM judgment | `worker/src/review-generator/` |
| 3 | Every check result is tri-state; `unknown_*` can never become a pass or a fail | `shared-types/src/evidence.ts` |
| 4 | SSRF guard, re-checked on **every redirect hop** | `worker/src/evidence-worker/ssrf-guard.ts` |
| 5 | Conflict-of-interest exclusion runs **before** anything is spent | `worker/src/policy-engine/exclusion.ts` |
| 6 | One component holds the AskBots key, one holds the wallet — never the same one | `worker/src/askbots-adapter/`, `payment-worker/` |
| 7 | Watchdog probes business health, not process liveness | `worker/src/watchdog/` |
| 8 | Attribution tag on every mainnet transaction, no backfill | `worker/src/payment-worker/payment-gate.ts` |
| 9 | Hard spend caps, fail closed, **no retry after an ambiguous outcome** | `worker/src/policy-engine/spend-ledger.ts` |
| 10 | Claim → evidence → action, and the prose is rendered from that record | `worker/src/review-generator/`, `web/lib/claims.ts` |
| 11 | Secrets live only in the platform secret store | `.github/workflows/ci.yml`, `worker/src/config.ts` |
| 12 | Alert on business inactivity, not on the process being up | `worker/src/watchdog/` |

### Three of these are worth a closer look

**Rule 4 — the redirect hop.** A guard that validates the input URL and then follows redirects catches none of the real attacks: one line of server config (`302 Location: http://169.254.169.254/`) walks straight past it. `assertRedirectHop` exists to be called on every hop, and `pinResolvedAddress` returns the address that was *checked* so the client connects to that address rather than resolving the name a second time. All 15 blocked IPv4 ranges and the IPv6 handling, including IPv4-mapped addresses, are in one pure file that needs no DNS server to test.

**Rule 9 — the ambiguous outcome.** When a `buy` call times out, we do not know whether it settled. The temptation is to retry, because the money was *probably* not spent. Retrying on "probably" is how one purchase becomes two. An ambiguous payment is recorded, counted against the budget, and never repeated. All the arithmetic underneath runs on `BigInt` micro-units — no float ever compares against a cap, because `0.1 + 0.2 !== 0.3` and a ledger that can drift is a ledger that can eventually authorise a call it should have refused.

**Rule 12 — the failure that actually bites.** Not a crashed process; a crash is loud. The failure that bites is a process that is perfectly alive and has silently stopped doing its job — the API key expired, the poll loop returns zero projects, every dashboard is green, and nothing has been reviewed in six hours. So the alert condition is business inactivity, and the wording is fixed: `reviewer inactive for 90 minutes` is a sentence someone can act on, and `process healthy` is not.

---

## Two design decisions that look like inconsistencies

**No Tailwind.** The design spec's build notes suggest it; the implementation uses plain CSS with custom properties. The tokens map one-to-one onto the spec's own CSS-variable table, and a utility framework adds a build step that can fail. On a nine-day deadline, that trade was worth making deliberately rather than by accident.

**Reveals are declarative, not timed.** The hero sequence gates opacity on a `data-revealed` attribute instead of mounting and unmounting elements. Three things fall out of that: nothing reflows as words appear, the full sentence is available to screen readers and to copy-paste from the first frame, and `prefers-reduced-motion` is honoured by a single CSS rule at first paint with no flash and no dependency on a JS timer having run.

---

## Demonstrating it honestly

Sample data is the single largest honesty risk in this project, since a demo that looks like real data is the exact deception the product exists to oppose. So:

- Every sample bundle carries `provenance: 'sample'` and a non-null label. `RecordProvenance` is a **required** field, so data cannot be displayed without one.
- Sample timestamps are **fixed**, not computed from "now". A sample that always reads "2 min ago" is claiming to have just happened.
- Sample durations are `null`, not a plausible-looking `412 ms`. That number is precisely the confident detail with nothing behind it that this project is built to mock.

## Licence

MIT.
