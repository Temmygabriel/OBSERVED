# Observed — Design Spec

## 1. Design concept and material reference

**Material reference: the inspection notebook.** Not a crypto dashboard, not a generic SaaS admin panel, not an AI chatbot. Think of a physical field-inspection report — a lab technician's bound notebook where a claim on the right-hand page always points back to a numbered exhibit on the left. Hairline rules. Real paper-white, not screen-white. Typewriter-precise data next to handwritten-weight prose.

The whole visual language exists to make one thing physically obvious without narration: **the evidence came first, the sentence came second.**

---

## 2. Design self-check — generic defaults explicitly rejected

- **Rounded SaaS cards with drop shadows** — rejected as the primary language. Use light containers, thin hairline borders, generous whitespace. No floating-card treatment on every element; shadows only ever appear as functional focus rings, never for depth.
- **Dark mode + neon purple/green/cyan** — rejected outright. This is the default "AI + crypto + agents" visual cliché; using it would make Observed indistinguishable from every other hackathon entry in this exact category. **No dark mode for v1** — the paper/instrument aesthetic depends on a light surface. If a dark variant is ever wanted post-hackathon, it should use muted graphite tones, not neon-on-black, but this is explicitly out of scope for the submission.
- **Cream/serif/terracotta editorial styling** — rejected. That combination reads as publishing/editorial (a magazine, a blog), and this product is computational and observational, not editorial.
- **Decorative monospace as an aesthetic element** — rejected as decoration, kept as function. Monospace is used only for things that are literally machine-observed data: URLs, HTTP status codes, timestamps, hashes, evidence IDs. Never for headings or brand voice.
- **ALL-CAPS eyebrow labels as the primary typographic device** — rejected as the primary device. Reserved only for genuine technical metadata (`HTTP 404`, `OBSERVED 09:14 UTC`). Section headers use sentence case.
- **Assay's rubber-stamp/hallmark motif** — explicitly avoided even though it worked well on a prior project. Reusing it here would blur two different projects' identities. Observed's hero moment (Section 5) is built around its own actual mechanism — evidence resolving into a claim — not a stamp metaphor borrowed from elsewhere.

---

## 3. Design tokens

### Color

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F7F5F0` | Page background — warm off-white, not pure white |
| `--ink` | `#141310` | Primary text — near-black, not pure black |
| `--ink-secondary` | `#5C594E` | Supporting text |
| `--ink-muted` | `#9B978A` | Placeholders, captions, disabled |
| `--rule` | `#DEDACD` | Hairline borders/dividers |
| `--rule-strong` | `#C8C2AF` | Emphasized dividers |
| `--evidence-blue` | `#1D5FD1` | The ONE accent. Used only for things Observed actually confirmed: checkmarks, evidence links, "Observed" state, active/in-progress indicators |
| `--evidence-blue-bg` | `#E7EEFB` | Pale wash behind evidence-blue elements |
| `--detected-amber` | `#C1441E` | A real finding/issue was detected — deliberately a burnt, printed-report red-orange, not a bright UI-error red |
| `--detected-amber-bg` | `#F7E9E2` | Pale wash behind detected-amber elements |
| `--confirmed-green` | `#3F7D3B` | Accepted/passing state only |
| `--confirmed-green-bg` | `#E8F0E5` | Pale wash |

Restraint rule: **evidence-blue and detected-amber are the only two colors that carry meaning.** Everything else is ink/paper/rule. If a screen has more than these two accent colors doing semantic work, something has gone wrong.

### Typography

- **Headings and review prose:** `Source Serif 4` (Google Fonts) — gives the review sentence and section headers real weight and credibility, distinct from generic UI sans.
- **UI chrome (buttons, labels, nav, body copy that isn't a review):** `Inter`.
- **Evidence data only (URLs, status codes, timestamps, hashes, evidence IDs):** `IBM Plex Mono`.

Type scale:
- Hero review sentence: 26px / Source Serif 4 / regular, line-height 1.5
- Section heading: 18px / Source Serif 4 / regular
- Body (Inter): 15px / regular, line-height 1.6
- Secondary/meta (Inter): 13px
- Evidence data (IBM Plex Mono): 13px

### Spacing & shape

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px
- Border radius: 4px on controls and small elements, 6px max on containers — deliberately tighter than a typical rounded-SaaS 12–16px, to keep the "instrument," not "app," feel
- Borders: 1px hairline (`--rule`) as the default; never a drop shadow for elevation

---

## 4. Hero moment specification

**Concept: Claim → Proof.** Not a stamp, not a badge, not a checkmark animation. The hero moment is the product's literal mechanism, given a full screen and real time to unfold.

**What's seen, in order:**
1. The target being reviewed, shown plainly (URL in mono, project name in serif).
2. A live inspection sequence: `FETCH → OBSERVE → COMPARE → WRITE`, each stage appearing only once the previous is genuinely complete — never all four flashing in at once.
3. The raw observed fact, shown before any interpretation: e.g. `POST /signup → 404`, in mono, with a timestamp.
4. Only after the fact is visible does the review sentence render, word by word, visibly built from the fact just shown — not appearing as a separate, disconnected block of AI prose.
5. The sentence links directly back to an "Evidence 01" reference the viewer can open.

**Why it earns the hero position:** it's the only moment in the product that visually proves the central claim — that this system doesn't have an opinion before it has a fact. A generic trust badge would assert that; this moment demonstrates it.

**Animation spec:** Each of the four stages (`FETCH → OBSERVE → COMPARE → WRITE`) takes 400–700ms to transition, with a brief (150ms) hold on the raw fact before the sentence begins rendering — that pause is deliberate; it's the beat where the viewer registers "that's real" before the AI's prose appears.

**Reduced motion spec:** Respect `prefers-reduced-motion`. Skip the staged reveal; show all four stages already resolved, in their final state, with only the review-sentence appearance kept as a single simple fade (no word-by-word animation). Never disable the sequence's informational order — evidence still visually precedes the sentence, just without the timed build-up.

---

## 5. Screen-by-screen wireframes (text)

### Screen 1 — Landing
```
┌──────────────────────────────────────────────┐
│ Observed                              ● Live  │
│                                                │
│ It checks before it judges.                    │
│                                                │
│ [ https://example-project.xyz         ▶ ]      │
│                                                │
│ Checks:  ●Live page  ●TLS  ●Broken links  ○Repo│
│                                                │
│           [ Start review ]                     │
│ ─────────────────────────────────────────────  │
│ /signup → 404                       2 min ago  │
└──────────────────────────────────────────────┘
```
Real accumulated numbers only — never a placeholder count once real data exists.

### Screen 2 — Live review (the hero, three phases)
Phase 1 — inspection running (checklist, real elapsed times, screenshot panel loading).
Phase 2 — findings revealed (raw fact in mono, timestamp, affected element marked on screenshot).
Phase 3 — review sentence rendered from the fact, "Evidence 01" reference exposed.
(Full detail already specified in Section 4.)

### Screen 3 — History
```
Reviews: 12   Accepted: 11   Useful rating: 4.6/5

/signup → 404                          [Accepted]
TLS could not be verified              [Rewritten]
```
"Rewritten" uses evidence-blue, never detected-amber or a danger color — self-correction is not failure.

### Screen 4 — Empty state
```
Nothing has been checked yet.
Observed inspects the live product first, then writes
only what its evidence supports.

        [ Run a sample review ]

First check: website → TLS → links → evidence → review
```

### Screen 5 — Rejected / Held
```
Review held

We found evidence, but the draft wasn't specific enough.

✕ "The website could improve usability and security."
Why: no claim was tied to a specific observed artifact.

Evidence available: ✓ Screenshot  ✓ TLS result  ✓ HTTP response

     [ Rewrite from evidence ]
```
Followed by the rewritten version once generated, shown in the normal review format.

### Screen 6 — Paused (spend cap reached) — new, closes a gap between the security and UX passes
```
Paused

Daily review budget reached. Resuming at 00:00 UTC.

Reviews today: 34     Spend today: $1.00 of $1.00
```
Same calm, non-alarmist voice as the rest of the product — this is the system working as designed (Rule 9), not an error.

### Screen 7 — Excluded (conflict-of-interest refusal) — new, closes the second gap
```
This project can't be reviewed

Observed's operator is also an entrant in this hackathon.
To avoid any conflict of interest, Observed refuses to
review any project connected to its operator — checked
automatically before any evidence is gathered.

[ Why this rule exists → ]
```
This makes Rule 5's exclusion policy visible and provable in the product itself, not just claimed in a README.

---

## 6. Component specifications

- **EvidenceRow** — icon (check/cross/dot per tri-state) + label (Inter, 15px) + optional mono timestamp/status right-aligned. Used in the inspection checklist and findings list.
- **ClaimCard** — serif review sentence + mono inline citation (`/signup · 404 · 09:14 UTC`) + "Evidence 0N" button. One card per claim.
- **StatusBadge** — pill, 12px Inter, background/text pair strictly from the token table: `Accepted` = confirmed-green pair, `Rewritten`/`Observed`/`Live` = evidence-blue pair, `Detected`/held/error states = detected-amber pair. Never mix pairs.
- **EvidenceChip button** — small outline button, opens the evidence artifact detail (hash, raw response, screenshot, timestamp) in an in-flow panel, never a modal that requires `position: fixed`.
- **InspectionChecklistItem** — three visual states only: done (evidence-blue check), active (evidence-blue pulse-free dot — no spinner animation, just a filled dot, to keep with the flat/instrument aesthetic), pending (muted empty circle).

---

## 7. Navigation structure

Single-page app for the hackathon submission scope: top-level switch between **Review** (Landing + Live Review, the default) and **History**. No deep nav tree — this is intentionally small in scope, matching "one narrow concrete job" rather than a sprawling dashboard.

---

## 8. Copy guidelines

- "Observed" over "Verified" — accurately describes a timestamped observation, not a claim of universal truth.
- "What we found" over "AI insight."
- "Review" over "AI verdict" — verdict implies more authority than the system should claim.
- Uncertainty has exactly three states in copy: **Observed**, **Detected**, **Unable to verify**. Never collapse a timeout into a pass or fail.
- Empty state: "Nothing has been checked yet." — an invitation, not an apology.
- Rejection: "Review held" — not "Review failed" or "Error." Rejection is the system refusing to ship a hollow claim, which is a trust signal, not a bug.
- Pause (new): "Paused — daily review budget reached. Resuming at 00:00 UTC." Calm, factual, no alarm styling.
- Exclusion (new): "This project can't be reviewed" followed by a plain-language explanation of the conflict-of-interest rule — never hidden behind a generic "not available."
- Payment: primary copy states the real settled amount and asset once confirmed (e.g. "Review paid · [amount] [asset]"); the transaction/chain detail stays secondary, never the headline.
- Sentence case throughout. No exclamation points on system copy. No "AI-powered," no "leverage," no "seamless."

---

## 9. Responsive behavior

Single-column stack below 720px — the inspection checklist, screenshot panel, findings, and review sentence stack vertically in the same top-to-bottom evidence-then-claim order as desktop; nothing reorders on mobile, since the ordering itself is the point. History rows collapse the stat row to two columns on narrow screens rather than three.

---

## 10. Build notes for coding assistant

- **Font imports (Google Fonts):**
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500&family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  ```
- **Tailwind config additions:**
  ```js
  // tailwind.config.js
  module.exports = {
    theme: {
      extend: {
        colors: {
          paper: '#F7F5F0',
          ink: { DEFAULT: '#141310', secondary: '#5C594E', muted: '#9B978A' },
          rule: { DEFAULT: '#DEDACD', strong: '#C8C2AF' },
          evidence: { DEFAULT: '#1D5FD1', bg: '#E7EEFB' },
          detected: { DEFAULT: '#C1441E', bg: '#F7E9E2' },
          confirmed: { DEFAULT: '#3F7D3B', bg: '#E8F0E5' },
        },
        fontFamily: {
          serif: ['"Source Serif 4"', 'serif'],
          sans: ['Inter', 'sans-serif'],
          mono: ['"IBM Plex Mono"', 'monospace'],
        },
        borderRadius: { sm: '4px', DEFAULT: '4px', md: '6px' },
      },
    },
  };
  ```
- **Implementation decisions the coding assistant must follow, not improvise:**
  - No dark mode for v1 (Section 2).
  - No drop shadows anywhere except a functional focus ring on inputs.
  - Monospace font is applied only to the specific data types listed in Section 3 — never to headings, buttons, or body prose.
  - History numbers are always pulled from real accumulated data once any exists — never hardcode example numbers like "47 reviews" past the initial empty-state mockup stage.
  - `StatusBadge` color pairing is fixed per state (Section 6) — don't introduce a fourth color or reuse detected-amber for "Rewritten."
  - Build the Paused and Excluded screens (Section 5, screens 6–7) as real states wired to the Policy Engine and Payment Worker from the backend — not static mockups left unconnected.
