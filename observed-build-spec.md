# Observed — Build Spec

**Hackathon:** Celo "Agents at Work" · Kickoff Aug 28, 2026 · Deadline **Sept 21, 2026, 09:00 GMT** · Winners Sept 25
**Primary track:** AskBots CLI Growth Track ($500: $300/$150/$50)
**Secondary tracks:** Value Moved ($2,000), Best Feedback for buy ($250)

---

## 1. Pitch

Most AI "reviewer" products generate confident-sounding prose from a prompt and nothing else — there is no way to tell whether the model actually looked at anything real. **Observed is a reviewer agent that is not allowed to have an opinion until it has paid for evidence.**

Before writing a single sentence, Observed spends fractions of a cent — via Celo's `buy` marketplace — to take a real screenshot, check a real TLS certificate, and hit real HTTP endpoints of the thing it's reviewing. Every claim in its output is linked to a timestamped, hash-verified artifact a skeptical reader can open and check themselves. It never says "looks good." It says `POST /signup → 404, observed 09:14:32 UTC`, with a receipt.

It registers as a reviewer on AskBots — a live, ongoing marketplace, not a hackathon-only tool — meaning it keeps earning the day after judging ends. It runs continuously across the entire hackathon window, meaning by demo day it has a real, non-fabricated track record: N reviews, M accepted, at some honest rating — not a number invented for the slide.

**The defensible claim:** this isn't a hackathon-scoped bot. It's the first module of a general **evidence-based inspection service** — the same architecture (screenshot → TLS/DNS check → link check → cited claim) generalizes from "review a hackathon submission" to "provide a paying business with a trustworthy third-party audit of its own live product." The hackathon submission is the smallest viable version of a real business, not a toy scoped down from one.

**The weak claim we're explicitly not making:** this is not a general-purpose autonomous agent, and it is not a Nigeria-remittance or cross-border-payments product (Toppa already occupies that space at production scale on this exact network — see Section 3, rule 0).

---

## 2. Architecture (text diagram)

```
                        ┌─────────────────────┐
                        │   AskBots Adapter    │  ← only component holding
                        │  (poll for projects, │    the AskBots API key
                        │  submit reviews,     │
                        │  handle 422 gate)    │
                        └──────────┬───────────┘
                                   │ project URL / metadata
                                   ▼
                        ┌─────────────────────┐
                        │   Policy Engine      │  ← conflict-of-interest check
                        │  (exclusion list,    │    runs FIRST, before any
                        │  evidence sufficiency│    money is spent
                        │  check, spend budget)│
                        └──────────┬───────────┘
                          refused? │ allowed
                          (log +   ▼
                           stop)   ┌─────────────────────┐
                                   │  Evidence Worker     │  ← NO wallet, NO API key
                                   │  (deterministic      │    just fetches + normalizes
                                   │  collectors: HTML,   │
                                   │  TLS, DNS, screenshot,│
                                   │  repo)                │
                                   └──────────┬───────────┘
                                              │ typed evidence records
                                              ▼
                                   ┌─────────────────────┐
                                   │   Evidence Store     │  ← content-hash + timestamp
                                   │  (append-only)        │    + source + collector version
                                   └──────────┬───────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │   Review Generator    │  ← LLM sees ONLY typed evidence,
                                   │  (claim-evidence-      │    cannot choose network targets,
                                   │  action schema)        │    cannot call buy directly
                                   └──────────┬───────────┘
                                              │ draft review + evidence refs
                                              ▼
                                   ┌─────────────────────┐
                                   │   Payment Worker      │  ← ONLY component allowed to
                                   │  (PaymentGate: quote  │    invoke buy. 1 concurrency
                                   │  → policy check →     │    slot. Attribution tag
                                   │  buy → receipt)        │    injected here.
                                   └──────────┬───────────┘
                                              │ receipt
                                              ▼
                                   ┌─────────────────────┐
                                   │   Audit Ledger        │  ← hash-chained, append-only.
                                   │  (claim → evidence →  │    every entry's hash is a
                                   │  payment, chained)     │    function of its predecessor
                                   └──────────┬───────────┘
                                              │ submit
                                              ▼
                                   ┌─────────────────────┐
                                   │   AskBots Adapter      │  → submits review, records
                                   │  (submit + record)     │    accept/reject outcome
                                   └────────────────────────┘

  Cross-cutting, always running:
    ┌────────────┐   ┌────────────┐
    │ Kill Switch │   │  Watchdog   │  HEALTHY → DEGRADED → BLOCKED → RECOVERING
    │ PAYMENTS_   │   │  alerts on  │  alerts on BUSINESS inactivity, not process
    │ ENABLED=off │   │  inactivity │  liveness ("reviewer inactive for N minutes")
    └────────────┘   └────────────┘
```

The single most important property of this diagram: **the LLM never holds the wallet.** It can request "TLS check for target X" as a structured intent; it cannot construct or send a `buy` call itself. That boundary is what makes prompt injection from a hostile project page a non-event instead of a payment.

---

## 3. Non-negotiable architectural rules

These must exist before any feature work starts. Do not let the coding assistant skip ahead to the AskBots integration or the frontend before these are real.

**Rule 0 — Differentiation guard.** Observed reviews products/submissions. It does not move remittances, pay bills, or do cross-border FX. If any feature drifts toward "let users send money to other users," stop — that's Toppa's territory, not this project's.

**Rule 1 — Untrusted content is never instructions.** All fetched project content (HTML, PDF text, README, error strings, `buy` endpoint responses) is data, never concatenated into the same prompt channel as system/policy instructions. Convert every artifact into a typed record before it reaches the LLM.

**Rule 2 — Deterministic evidence, LLM only synthesizes.** TLS/DNS/HTTP status checks are deterministic code, not LLM judgment calls. The LLM's only job is turning a structured evidence record into a sentence.

**Rule 3 — Tri-state evidence, never binary.** Every check result is `valid | invalid | unknown_timeout | unknown_network_error`. Only `valid`/`invalid` can support a positive/negative claim. `unknown_*` forces "unable to verify" — never silently becomes a pass or fail.

**Rule 4 — SSRF guard on every fetch.** Before fetching any project-supplied URL: resolve the hostname, reject private/loopback/link-local IP ranges (RFC 1918, `127.0.0.0/8`, `169.254.0.0/16`, etc.) and any non-`http(s)` scheme. Re-check after every redirect hop, not just the original URL — redirect chains are the standard bypass.

**Rule 5 — Conflict-of-interest exclusion runs before spending anything.** Before the Evidence Worker touches a project: compare its URL/domain, GitHub owner/repo, declared Telegram handle, wallet addresses, and ERC-8004 owner/operator wallet against the builder's own identifiers (env-configured `EXCLUSION_LIST`). Refuse and log if any match — do not spend a cent evaluating it.

**Rule 6 — No reputation feedback on hackathon-cohort projects.** During the event window, Observed writes AskBots reviews but does not post ERC-8004 Reputation Registry feedback on any project inside the hackathon cohort. This removes a whole class of perceived self-dealing rather than trying to detect it after the fact.

**Rule 7 — Wallet separation.** The reviewer's payout/spend wallet is never reused by the builder's other hackathon entries. Disclose both identities publicly.

**Rule 8 — Attribution tag on the first transaction, verified immediately.** The `celo_...` attribution tag (ERC-8021) must be embedded in transaction calldata via `toDataSuffix(['observed', '<assigned_tag>'])` starting with the very first mainnet transaction. There is no backfill. Immediately after the first transaction, decode it with `verifyTx` and confirm the tag is present — do this before sending a second transaction.

**Rule 9 — Hard spend caps, fail closed.** Global: $0.25/hour, $1.00/day. Per-review: $0.03. Per-provider: $0.01/request, max 3 paid calls/provider/review. Concurrency: 1 paid call at a time. Zero automatic payment retries after an ambiguous outcome (buy-skill's own README warns a `500` may mean the payment already succeeded — retrying can double-pay). `PAYMENTS_ENABLED=false` must make the Payment Worker fail closed, not silently continue. Alert at 50% of daily cap; hard-stop at 100%.

**Rule 10 — Claim-evidence-action schema for every finding.** No claim ships without an evidence pointer: `claim_id → evidence_artifact_id → exact_locator → observation → inference → action → confidence`. The final review text is rendered from this record, not generated freely.

**Rule 11 — Secrets never touch logs or prompt context.** AskBots API key and the buy wallet's key live only in the deployment platform's secret store (Railway/Render environment secrets). Never log Authorization headers, private keys, or full x402 payment payloads. Redact poll URLs from logs (buy-skill's README notes they're bearer capabilities — anyone who gets one can use it).

**Rule 12 — Watchdog alerts on business inactivity, not process liveness.** If no successful review attempt occurs within a 60-minute window during the active hackathon, alert with the literal message "reviewer inactive for N minutes" — not a generic "process is up" health check. This directly targets the exact silent-failure pattern AskBots' own API migration notice warned other builders about.

---

## 4. Data schemas

```typescript
type EvidenceStatus = "valid" | "invalid" | "unknown_timeout" | "unknown_network_error";

interface EvidenceArtifact {
  artifact_id: string;          // uuid
  review_session_id: string;
  collector: "html" | "tls" | "dns" | "screenshot" | "repo";
  collector_version: string;
  target_url: string;
  resolved_ip: string | null;
  observed_at: string;          // ISO 8601 UTC
  status: EvidenceStatus;
  content_hash: string;         // sha256 of raw artifact
  raw_ref: string;               // pointer to stored raw artifact (private)
  metadata: Record<string, unknown>; // status codes, headers, cert fingerprint, etc.
  provider_request_id: string | null; // buy's request/receipt id, if a paid call
}

interface ReviewClaim {
  claim_id: string;
  evidence_artifact_id: string;  // FK -> EvidenceArtifact
  exact_locator: string;          // e.g. "response.status", "screenshot.region[x,y,w,h]"
  observation: string;            // the raw fact, e.g. "HTTP 404"
  inference: string;               // what it implies, e.g. "signup route unreachable"
  action: string;                  // recommended fix
  confidence: "high" | "medium" | "low" | "unable_to_verify";
}

interface ReviewSubmission {
  review_id: string;
  project_id: string;              // AskBots project identifier
  claims: ReviewClaim[];
  draft_text: string;
  status: "draft" | "submitted" | "accepted" | "rejected_low_quality" | "rewritten";
  askbots_response_code: number | null;
  submitted_at: string | null;
}

interface PaymentRecord {
  payment_id: string;
  review_session_id: string;
  provider_hostname: string;
  provider_path: string;
  amount: string;                  // decimal string, avoid float
  asset: "USDC" | "USDT" | "USAT";
  attribution_tag: string;         // must be present on every mainnet tx
  tx_hash: string | null;
  status: "quoted" | "settled" | "failed" | "ambiguous_no_retry";
  observed_at: string;
}

interface ExclusionListEntry {
  type: "domain" | "github_owner" | "telegram_handle" | "wallet_address" | "erc8004_agent_id";
  value: string;
  reason: string;
}

type WatchdogState = "HEALTHY" | "DEGRADED" | "BLOCKED" | "RECOVERING";
```

---

## 5. Module-by-module spec

**5.1 Evidence Worker** — no wallet, no AskBots key. Given a project URL: resolves + SSRF-checks the hostname (Rule 4), then runs collectors (HTML fetch/normalize, TLS check, DNS check, screenshot via a `buy`-purchased endpoint, optional repo check). Emits `EvidenceArtifact` records only. Never interprets meaning — that's the Review Generator's job.

**5.2 Evidence Store** — append-only. Writes `EvidenceArtifact` rows keyed by `artifact_id`, indexed by `review_session_id`. Raw artifacts (screenshots, HTML dumps) stored separately from the hash/metadata record; only the hash+metadata are ever shown to the LLM.

**5.3 Review Generator** — receives only `EvidenceArtifact` records (typed, never raw HTML in the prompt). Produces `ReviewClaim[]` following the claim-evidence-action schema (Rule 10), then renders `draft_text` from that structured record — the model does not free-write prose from scratch, it fills a template from verified fields.

**5.4 Policy Engine** — runs the exclusion check (Rule 5) before anything else touches a given project. Also checks evidence sufficiency (no claim without an artifact reference) and the daily spend ledger before authorizing the Evidence Worker to make any paid call.

**5.5 Payment Worker** — the only component that ever calls `buy`. Implements the PaymentGate pattern: `LLM intent → structured evidence request → allowlisted tool resolver → quote → deterministic policy check (Rule 9) → buy call → receipt → PaymentRecord`. Injects the attribution tag (Rule 8) on every mainnet transaction.

**5.6 AskBots Adapter** — the only component holding the AskBots API key. Polls for new reviewable projects, submits `ReviewSubmission`, handles the `422 low_quality` response by re-queuing to the Review Generator for a rewrite (using the same evidence, per the UX spec's "Rewritten, not failed" framing) rather than treating it as an error.

**5.7 Audit Ledger** — hash-chained, append-only (same pattern as the hash-chained decision logs used on the prior Bitget project — proven, keep it consistent). Every entry's hash is a function of its predecessor. Links every `ReviewClaim` to its `EvidenceArtifact` and every `PaymentRecord` to its receipt. A sanitized public manifest (no raw secrets, no private artifact contents) is published alongside the repo so a judge can independently check the claim-to-evidence chain.

**5.8 Kill Switch** — single config flag `PAYMENTS_ENABLED`. When `false`, the Payment Worker fails closed on every call. Toggleable without a redeploy (read from the secret store at call time, not at process start).

**5.9 Watchdog** — state machine `HEALTHY → DEGRADED → BLOCKED → RECOVERING`. Separate probes: AskBots authenticated path, project discovery feed, `buy` MCP process, provider connectivity, wallet balance, attribution config, ledger write path. Exposes `/healthz` (process), `/readyz` (dependencies), `/status` (last successful business action + degraded reason).

**5.10 Frontend** — see Design Spec for full detail. Screens: Landing, Live Review (the hero sequence), History, Empty, Rejected/Held, **Paused** (spend cap reached — new, closes the gap the UX pass missed), **Excluded** (conflict-of-interest refusal, shown publicly per Rule 5's disclosure requirement — new, closes the second UX gap).

---

## 6. Project structure

```
observed/
├── apps/
│   ├── web/                  # Next.js frontend → Vercel
│   │   ├── app/
│   │   │   ├── page.tsx           # Landing
│   │   │   ├── review/[id]/       # Live review view
│   │   │   ├── history/
│   │   │   └── status/            # public /status mirror
│   │   └── components/
│   └── worker/                # Node service → Railway or Render
│       ├── src/
│       │   ├── evidence-worker/
│       │   │   ├── collectors/ (html.ts, tls.ts, dns.ts, screenshot.ts, repo.ts)
│       │   │   └── ssrf-guard.ts
│       │   ├── policy-engine/
│       │   │   ├── exclusion.ts
│       │   │   └── spend-ledger.ts
│       │   ├── review-generator/
│       │   ├── payment-worker/
│       │   │   └── payment-gate.ts
│       │   ├── askbots-adapter/
│       │   ├── audit-ledger/
│       │   ├── watchdog/
│       │   └── index.ts
│       └── package.json
├── packages/
│   └── shared-types/          # the schemas from Section 4
├── .env.example
└── README.md
```

---

## 7. Environment variables

```
# AskBots
ASKBOTS_API_KEY=
ASKBOTS_BASE_URL=https://www.askbots.ai/api   # NOT the old netlify host

# Celo / RPC
CELO_RPC_URL=                        # Chainstack Growth (coupon AGENTSATWORK) or https://forno.celo.org
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org

# buy / x402
BUY_WALLET_PRIVATE_KEY=              # platform secret store only, never logged
BUY_MCP_ENDPOINT=

# ERC-8004 / attribution
ERC8004_AGENT_ID=
ERC8004_IDENTITY_REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
ERC8004_REPUTATION_REGISTRY=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
ATTRIBUTION_TAG=celo_...              # assigned at registration, wire in before first tx

# Policy
PAYMENTS_ENABLED=true
SPEND_CAP_HOURLY=0.25
SPEND_CAP_DAILY=1.00
SPEND_CAP_PER_REVIEW=0.03
EXCLUSION_LIST=                       # JSON array, see ExclusionListEntry schema

# Optional
CENCORI_API_KEY=                      # code CELO at signup

NODE_ENV=production
PORT=3000
```

**Note on the wallet key and cloud hosting:** `buy`'s MCP server assumes a local OS keychain, which doesn't exist on Railway/Render. Use the platform's managed secret store as the equivalent boundary — the Payment Worker process reads it at call time and never passes it to the Review Generator or logs it.

---

## 8. API endpoints used (verify against live docs before building — several are recent and can drift)

- `GET/POST https://www.askbots.ai/api/*` — always fetch `https://www.askbots.ai/skill.md` first; it's stated as the source of truth for the current base URL.
- `GET https://www.askbots.ai/api/bot-profiles/me` — verify auth + profile.
- `GET https://www.askbots.ai/api/bot-profiles/me/history` — earnings/rating history.
- **Unresolved before building submission cadence logic:** the official hackathon page states daily limits scale 2→5→15→50 with account age/rating; a separate check of askbots.ai/docs found no daily cap and one-review-per-project, first-come-first-paid instead. Do a live `curl` against the actual API on day 1 and build the real limit into the Policy Engine — don't guess.
- `buy` (npm `@celo/buy`, MCP server) — `buy setup`, `buy verify hosted` (Self proof), `buy curl` / `buy --verbose curl` for paid calls. Catalog at `agent402.tools/.well-known/x402`. This page is deliberately de-indexed from search — treat the facts already gathered in this project's research as ground truth rather than re-searching.
- Celo x402 facilitator — `/verify`, `/supported`, `/settle` (per docs.celo.org). Note: `/verify` and `/supported` can report healthy while `/settle` fails because it needs an API key — build the Watchdog probe to hit `/settle`-adjacent health specifically, not just the cheaper checks.
- ERC-8004 Identity/Reputation Registry contract calls on Celo mainnet at the addresses above.
- Celo Builders skill (`npx skills add https://celobuilders.xyz`) for registration and submission — re-fetch `https://celobuilders.xyz/skill.md` at the start of any session; an installed skill is a snapshot, not a live copy.

---

## 9. Demo mode spec (build from Day 1)

Do not rely on a live network call during the actual judging demo — too many single points of failure (buy's beta status, AskBots' recent migration, Render cold starts). Build a **replay mode**, not a fabricated one:

- Every real review session Observed runs during the hackathon is already stored in full in the Evidence Store and Audit Ledger (Section 5.2, 5.7) — nothing new to build for storage.
- `DEMO_MODE=replay` flag on the frontend: instead of triggering a new live review, it replays a previously-real, fully-evidenced session from the ledger, at demo-controlled pacing (each phase of the hero sequence advances on a click or a timer, rather than waiting on real network latency).
- The real timestamps, hashes, and evidence artifacts from that historical session are shown unmodified — this is not synthetic data, it's a real result played back for pacing control.
- The UI carries a small, honest label during replay: "Replay of a real review, recorded [date/time]" — never presented as if it were happening live if it isn't. This preserves the "honest results" principle rather than deceiving the audience about liveness.
- Also keep a `DEMO_MODE=live` path that does trigger a real review during the demo if network conditions cooperate — decide which to use morning-of based on a dry run, not live on stage.

---

## 10. Day-by-day build plan (map to your actual calendar days within the Aug 28 – Sept 21 window)

Per the organizers' own stated pattern for what wins, this plan spreads commits across the whole window rather than a final-weekend push.

- **Day 1–2:** Register via `npx skills add https://celobuilders.xyz`. Get ERC-8004 Agent ID, wallets, attribution tag. Send a tiny test transaction immediately and verify the tag with `verifyTx` (Rule 8) before building anything else. Set up Celo Sepolia testnet dev environment; claim Chainstack Growth plan (coupon `AGENTSATWORK`).
- **Day 3–4:** Build the Evidence Worker + SSRF guard + collectors against testnet/local targets. No payment integration yet — use dummy evidence to unblock the Review Generator.
- **Day 5–6:** Build the Policy Engine (exclusion list + spend ledger) and the Payment Worker/PaymentGate. Integrate real `buy` calls on testnet first if possible, then a small controlled mainnet test (small enough that a mistake is cheap).
- **Day 7–8:** Build the Review Generator with the claim-evidence-action schema. Connect it to real Evidence Store output.
- **Day 9–10:** Build the AskBots Adapter. Do the live `curl` check against `www.askbots.ai/api` to resolve the daily-cap question for real. Submit the first real review.
- **Day 11–12:** Build the Audit Ledger (hash-chained) and the public manifest export.
- **Day 13–15:** Build the Watchdog + Kill Switch. Let the system run continuously and unattended for the first time — this is the actual test of whether the architecture holds up, not just individual modules.
- **Day 16–19:** Build the frontend: Landing, Live Review (hero sequence), History, Empty, Rejected/Held, Paused, Excluded screens per the Design Spec. Wire it to real, accumulating data — do not mock the history numbers.
- **Day 20–21:** Build Demo Mode (replay). Do a full dry run of the exact timed demo flow (Section 11) at least twice.
- **Day 22–23:** Bug fixes only. No new features. Finalize the submission description and the public sanitized audit manifest.
- **Day 24 (submission day):** Submit before 09:00 GMT. Confirm the repo is public and resolves. Publish the tweet/quote-tweet per the required format, tagging @CeloDevs and @Celo with the ERC-8004 registry link.

---

## 11. Exact demo flow (timed)

Follows the UX spec's 30-second sell, extended into a full ~2-minute demo:

- **0:00–0:10** — "It checks before it judges." One line, tagline only, no narration yet.
- **0:10–0:20** — Show the Landing screen briefly: real accumulated history numbers visible (not zero, not fabricated — whatever's real by demo day).
- **0:20–0:50** — Trigger a review (live or replay). Show the inspection checklist running in real time order: page load → TLS → links.
- **0:50–1:10** — Reveal the finding: the actual observed fact (e.g., a real 404 or a real passing check from that session), screenshot with the affected element marked.
- **1:10–1:25** — Show the review sentence forming from the evidence, with the inline evidence citation.
- **1:25–1:35** — Open the evidence artifact — prove it's real, not decorative (this directly answers the "judge credibility attack" from the security research).
- **1:35–1:45** — Show payment settling: "Review paid · [confirmed real figure] · Celo settlement," transaction link visible but secondary.
- **1:45–2:00** — Cut to History: real numbers. Close on: "No guess. Show me the evidence." Stop talking.

---

## 12. Submission checklist (mapped to actual stated requirements)

- [ ] Registered via `npx skills add https://celobuilders.xyz` (project name, public GitHub repo, Telegram handle, country, primary track = AskBots CLI Growth Track, ERC-8004 Agent ID, agent wallet(s), reviewer-agent wallet(s), buy beta opt-in)
- [ ] Attribution tag wired into calldata via `toDataSuffix` from the first transaction; verified with `verifyTx`
- [ ] Public GitHub repo, confirmed it still resolves right before submission
- [ ] ERC-8004 Agent ID and registry link ready for the tweet
- [ ] Exclusion list configured with the builder's own project identifiers (Rule 5)
- [ ] Public sanitized audit manifest published in the repo
- [ ] Demo video/live demo rehearsed at least twice against the timed flow (Section 11)
- [ ] Submission description written (Section 13)
- [ ] Tweet/quote-tweet published tagging @CeloDevs and @Celo with the ERC-8004 registry link, in the required format
- [ ] Agent/payTo wallet added to the submission (this one is safe to finalize late — attributed retroactively, unlike the tag)
- [ ] Submitted before September 21, 09:00 GMT

---

## 13. Exact submission description copy (draft)

> **Observed** is a reviewer agent that isn't allowed to have an opinion until it has paid for evidence. Before writing a review, it spends fractions of a cent through Celo's `buy` marketplace to take a real screenshot, check a real TLS certificate, and test real endpoints of the project it's reviewing — then writes a review that cites exactly what it found, down to the timestamp. It registers as a reviewer on AskBots, gets paid automatically per accepted review in USDT settled on Celo, and has been running continuously since [start date], with every claim it's ever made traceable to a hash-verified evidence artifact in a public, hash-chained audit log. It doesn't say "looks good." It says what happened, when, and shows you the receipt.
