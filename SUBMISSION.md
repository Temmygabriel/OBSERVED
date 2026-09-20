# Submission pack

Everything needed to submit **Observed** to the Celo *Agents at Work* hackathon,
with the true state of each item rather than the intended state.

**Deadline: 21 September 2026, 09:00 GMT.** See "The deadline" below — confirm it
before relying on it.

---

## 1. The deadline

The repo records **21 September 2026, 09:00 GMT** in three places (`README.md`,
`PROGRESS.md`, and `observed-build-spec.md`), and the build spec names a kickoff
of 28 August and winners on 25 September.

A third-party aggregator page disagrees, saying **14 September 09:00 GMT** — and
its own sidebar says **13 September**. Three dates on one page is not a source.

**Confirm it through the Celo Builders skill before anything else.** That is the
same channel that performs the submission, so it answers the question and starts
the work in one step:

```bash
npx skills add https://celobuilders.xyz
```

There are no track-specific extensions, so whatever it says applies to every
track. If it says 21 September, there are hours left, not days.

---

## 2. Required at submission

From the organisers' rules, as stated:

| # | Requirement | State |
| --- | --- | --- |
| 1 | Public GitHub repo that **still resolves at judging** | ✅ `github.com/Temmygabriel/OBSERVED` |
| 2 | ERC-8004 Agent ID | ✅ `9849` |
| 3 | Agent wallet(s) | ✅ `0x556Ff7dD2bE1B504495288295Ad7cc3d414dd2c0` |
| 4 | Telegram handle | ✅ `@temmygabriel` |
| 5 | Primary track | ✅ `judges-favorite` |
| 6 | Reviewer agents **authenticate via the AskBots CLI** | ❌ **the adapter's HTTP calls are not written** |
| 7 | Work created during the hackathon window (commit history is reviewed) | ✅ history starts 2026-09-12 |

Rules that constrain *how* it counts:

- **Celo mainnet only.** Testnet activity scores nothing in any track.
- **Independent counterparties only.** Volume from wallets that are yours, or
  that you first funded, does not count.
- **Sponsored gas does not credit you.** The Celo relayer paying is not you
  paying. Fees you pay yourself do.
- **Templated reviews are excluded.** This is the one to read twice: it is
  aimed exactly at reviewer agents, and it is why item 6 matters.

**The honest reading of item 6.** Rules 6 and "templated reviews are excluded"
together mean a reviewer entry is expected to be reachable through the AskBots
CLI. `askbots-adapter/index.ts` has the response classifier and the rewrite
policy — including the `422 low_quality` → rewrite-from-the-same-evidence path —
but `pollProjects()` throws, and nothing has ever been submitted to AskBots. So
Observed **cannot currently authenticate as a reviewer**, and that is the
largest single gap between what this entry is and what the rules describe.

The track was registered as `judges-favorite` rather than `askbots-growth`
because the growth track needs a funded AskBots project (≈$1.10 USDT) and the
wallet holds 0 USDT. That is settled and is not worth reopening.

---

## 3. Submission checklist (the spec's own list, at its true state)

From `observed-build-spec.md` §12.

- [x] Registered via `npx skills add https://celobuilders.xyz`
- [x] Attribution tag wired into calldata via `toDataSuffix`, and **verified with
      `verifyTx`** — decoded back out of mined tx
      `0x47431f7260aac8e4f83edbc21a0d68082efed0807c026b77debf3f28a8fefb64`,
      block `77772173`
- [ ] Public GitHub repo, confirmed resolving immediately before submitting
      → *re-confirm this as the last action, not now*
- [x] ERC-8004 Agent ID and registry link ready for the tweet
      → `https://celoscan.io/nft/0x8004a169fb4a3325136eb29fa0ceb6d2e539a432/9849`
- [ ] Exclusion list configured with the operator's own identifiers (Rule 5)
      → *the mechanism is built and fail-closed; the list still needs the
      operator's own identifiers entered, and CI proves the refusal*
- [ ] Public sanitized audit manifest published in the repo
      → *the hash-chained ledger is built (`audit-ledger/index.ts`, with
      `verifyChain` and `tipOf`); the public export has not been written*
- [ ] Demo rehearsed against the timed flow
      → *see §5 — the spec's flow needs a screenshot collector and a live
      settlement, neither of which exists, so the flow below is different and
      shows what is actually real*
- [ ] Submission description written
      → *drafted at §4. **The version in the build spec (§13) must not be sent
      as-is** — see the warning there*
- [ ] Tweet published tagging `@CeloDevs` and `@Celo` with the registry link
      → *copy at §6; the exact required format comes from the registration flow,
      so take it from there rather than from this file*
- [ ] Agent/payTo wallet added to the submission
      → *safe to finalise late; attributed retroactively, unlike the tag*
- [ ] Submitted before the deadline

---

## 4. Submission description

### ⚠️ Do not submit the build spec's §13 copy

`observed-build-spec.md` §13 contains a draft description written on day one, as
a target to build toward. It says the agent:

> spends fractions of a cent through Celo's `buy` marketplace to take a real
> screenshot … registers as a reviewer on AskBots, gets paid automatically per
> accepted review in USDT settled on Celo, and has been running continuously
> since [start date]

**None of that is true right now.** The screenshot collector, the `buy` call and
the AskBots submission path are all unwritten, and the agent has not been running
continuously. Sending that text would put claims in the submission that the
repository immediately contradicts — and this is a project whose entire argument
is that confident prose with nothing behind it is the problem. A judge who reads
the README and then the description would find them disagreeing, and the
description is the one that would lose.

### Truthful description, ready to send

> **Observed** is a reviewer agent built on one rule: it is not allowed to have
> an opinion until it has paid for evidence.
>
> Every review it writes is assembled from hash-verified observation artifacts —
> a real DNS answer, a real TLS handshake, a real HTTP response, a real repository
> read — and every sentence points back at the artifact and the exact field it
> came from. The prose is **rendered from the validated claim record**, not
> written freely: a claim that cites an artifact we do not hold, or that asserts a
> conclusion from an inconclusive observation, is discarded and the review is held
> rather than softened. Where Observed could not reach a target, it reports that
> it could not reach it, rather than reporting a failure of the target.
>
> The collectors run for real on every commit, against a real target, and both the
> artifact table and the resulting review are published as annotations on the
> commit — readable without a token or admin rights. Its own test suite is mostly
> negative: it asserts that specific sentences are *absent*, because the failure
> mode here is not a crash, it is publishing a confident, cited, false sentence
> about somebody else's project.
>
> It says what happened, when, and shows you the receipt. It never says "looks
> good".
>
> **What is not built yet is stated plainly in the README**, module by module.
> The screenshot collector, the paid `buy` call and the AskBots submission path
> are unwritten, and each one throws a named error rather than returning something
> plausible. Unfinished code of ours is not recorded as a fact about anyone else's
> project.

The last paragraph is not a hedge. It is the pitch: the same discipline that
makes the agent refuse to invent a finding is what makes the status table
trustworthy.

---

## 5. Demo (~2 minutes)

The spec's timed flow (§11) needs a marked-up screenshot and a visible Celo
settlement. Neither exists. Rather than rehearse a flow that cannot be performed,
this shows the thing that *is* real: a genuine observation and a genuine review,
produced by running code rather than by compiling it.

| Time | Beat |
| --- | --- |
| 0:00–0:10 | **"It checks before it judges."** Tagline only. No narration yet. |
| 0:10–0:25 | Landing screen. If deployed, the honest empty state — it says nothing has been checked yet, and does not invent numbers to fill space. |
| 0:25–0:50 | Open the green CI run. Walk the `Observe a real target` job: the artifact annotations. Real DNS address, real TLS protocol and cipher, real HTTP status codes, real redirect chain. Point at `url=` on each one — that is what makes a result attributable to a *link*. |
| 0:50–1:15 | The **review drafted from that observation**, in the same run. Read one sentence aloud, then open the artifact it cites. This is the whole product in one move. |
| 1:15–1:35 | The test suite. Show one negative test: *"a link refused with 429 is never published as a broken link."* Explain why it is phrased that way. |
| 1:35–1:50 | **Say what is not built.** Screenshot, `buy`, AskBots. Say why: paid-path access and an API key. Show that each throws a named error instead of returning something plausible. |
| 1:50–2:00 | "It doesn't say 'looks good'. It says what happened, when, and shows you the receipt." **Stop talking.** |

The 1:35 beat is a risk and it is worth taking deliberately. A demo built on
"here is what we did not fake" is stronger than a demo that has to be taken on
trust, and this project cannot ask to be taken on trust — that is the entire
point of it.

---

## 6. Tweet

Format comes from the registration flow — take it from there. The content that
must appear:

- `@CeloDevs` and `@Celo`
- the ERC-8004 registry link:
  `https://celoscan.io/nft/0x8004a169fb4a3325136eb29fa0ceb6d2e539a432/9849`
- what it is, in one line

Draft:

> A reviewer agent that isn't allowed to have an opinion until it's paid for
> evidence. Every sentence cites a hash-verified artifact. Built for @CeloDevs
> @Celo Agents at Work.
>
> ERC-8004 #9849 → https://celoscan.io/nft/0x8004a169fb4a3325136eb29fa0ceb6d2e539a432/9849

---

## 7. Who clears what

**Only the operator can do these:**

| # | Action | Blocks |
| --- | --- | --- |
| 1 | Confirm the deadline via the Celo Builders skill | Everything — it is the authority on the date and the submit path |
| 2 | Obtain the **AskBots API key** (self-serve, shown **once**, unrecoverable) | Reviewer authentication, item 6 above |
| 3 | Publish the tweet | A stated requirement |
| 4 | Approve the truthful description at §4 | The wording that ships under the operator's name |

**Buildable without any of the above:** the public audit manifest export, the
exclusion-list wiring proven in CI, and the AskBots adapter's HTTP calls (writable
now, testable only once the key exists).

**Never:** re-register on AskBots to recover a lost key. It mints a new identity
and discards rating and earnings. The attribution tag survives a key rotation, so
rotating is the safe move.
