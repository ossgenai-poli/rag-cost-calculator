# UX v2 — Phase 0 review instructions (for the test engineer)

**Read this first.** Phase 0 is a **design deliverable, not a code change.** There is **no runnable
product to functional-test**, no engine change, and nothing deployed. Your job is a **design-artifact
review** plus a set of **isolation / safety / fidelity checks** you *can* run mechanically.

Do **not** re-test the calculator engine — that is signed off at `rc-qa-11` and frozen for Phase 0.
Do **not** ask for code, a recommendation engine, or a narrative generator; those are Phase 1 and were
deliberately not built.

- **Baseline (frozen):** `rc-qa-11` = `d749309ab68730b113868152a7d66b464cf74cec`
- **Under review:** branch `ux/v2`, artifacts under `docs/ux-v2/` (14 deliverables + `wireframes.html`)
- **Visual artifact (private):** the published claude.ai wireframe link in the handoff message
- **Verdict options:** `APPROVE FOR PHASE 1` · `APPROVE WITH REVISIONS` · `HOLD`

---

## 0. Access

```bash
git fetch origin
git checkout ux/v2           # or: git worktree add ../uxv2 ux/v2
# artifacts:
ls docs/ux-v2/
# open the wireframe locally in a browser:
#   docs/ux-v2/wireframes.html   (self-contained; no server, no network)
```

Start at `docs/ux-v2/README.md`, then the wireframe, then the decision log.

---

## 1. Isolation & safety invariants  *(mechanical — must ALL pass)*

These prove Phase 0 touched nothing it shouldn't. Any failure is a **P1 (isolation breach)**.

```bash
# 1a. main is still exactly rc-qa-11
git rev-parse main            # expect d749309ab68730b113868152a7d66b464cf74cec
git rev-parse rc-qa-11        # same

# 1b. ux/v2 changes ONLY docs/ux-v2/ vs the baseline
git diff --stat rc-qa-11 ux/v2
#   expect: only paths under docs/ux-v2/ ; 0 files elsewhere

# 1c. NO engine / component / workflow / config file changed
git diff --name-only rc-qa-11 ux/v2 | grep -vE '^docs/ux-v2/' || echo "CLEAN: nothing outside docs/ux-v2/"
#   expect: CLEAN

# 1d. fleet-explain.ts (and all of lib/, components/, .github/) are byte-identical to rc-qa-11
git diff --stat rc-qa-11 ux/v2 -- lib components .github next.config.mjs package.json
#   expect: no output (no changes)

# 1e. the branch push triggered NO CI / Pages run
gh run list --limit 5        # newest runs must still be the rc-qa-11 (INF-007) runs; none for ux/v2
```

**Pass criteria:** 1a–1e all as expected. If any engine/workflow file differs, or a workflow ran, stop
and file it as P1.

---

## 2. Wireframe fidelity & hygiene  *(mechanical + visual)*

The wireframe must not **misrepresent** the frozen engine.

- **2a. Self-contained:** open `wireframes.html`; DevTools → Network shows **no external requests**
  (no font/CDN/image/fetch). Console shows **no errors**.
- **2b. Interactive:** the **Simple ⇄ Expert** toggle switches the mock; keyboard-focusable; the
  "Where did this come from?" panel expands.
- **2c. Structural numbers are REAL rc-qa-11 output.** The wireframe's fleet block claims the canonical
  reproduction. Verify it against the frozen engine (see §3). It must show: **87 instances (86
  throughput + 1 N+1)**, **prefill-bound**, equation **221,461 input tok/s ÷ (3,715 × 70% = 2,600) →
  86**, confidence **Measured·scaled**, topology **"8 GPUs handle prefill and decode (aggregated)"**,
  **P99** TTFT wording.
- **2d. Dollar figures are real reference-case values (updated).** As of the revision the rail's $ values
  are the **frozen-engine reference case R1** — API **$6.49M**, self-host **$7.18M**, break-even
  **≈221M/mo** — labelled "reference case R1 (rc-qa-11) … planning figures from the committed price book,
  not a quote." (They are no longer the earlier illustrative placeholders.) Verify they match
  [18-reference-cases.md](18-reference-cases.md) R1. *Do* file it if any structural or $ value is presented
  as real/computed but does **not** reconcile with a documented reference case.

---

## 3. Engine-fidelity cross-check  *(the one place you touch the engine — read-only)*

Confirm the wireframe/docs describe what the frozen engine actually produces. Reproduce on `rc-qa-11`
(or `ux/v2`, identical engine):

**Canonical reproduction:** DeepSeek-V4-Pro · p6-b200.48xlarge · INT4 (weight bits 4) · 200M
queries/mo · default 2,910 input / 500 output · concurrency 32 · utilization 70% · HA on · peak 1.

Expected engine output (already asserted by `lib/rc-qa10.test.ts`):
- `bindingDim = "prefill"`, `requiredInstances = 87`, `throughputInstances = 86`, `haReplicasAdded = 1`
- fleet equation reconciles: `221,461 ÷ (3,715 × 0.70 = 2,600) → 86`
- `capacity.source = "extrapolated"`, `prefillEstimated = false`, `prefillIslScale ≈ 2.84`
  → confidence ladder = **Measured·scaled**
- `ttftPercentile = "p99"`; topology string contains "GPUs handle prefill and decode (aggregated)"

**Pass criteria:** every structural claim in the wireframe and in `09-trust-provenance.md` /
`10-result-hierarchy.md` maps to one of these real fields. Any structural number that contradicts the
engine is a **P1 (fidelity)**. (Field names cited in the docs — `verdict`, `capacity.source`,
`prefillIslScale`, `bindingDim`, `breakEvenTokens`, etc. — must exist in the rc-qa-11 types.)

---

## 4. Deliverable completeness  *(checklist — each must be present and cover its sub-points)*

| # | File | Must contain |
|---|---|---|
| 1 | 01-journey-map.md | 8 stages: decision → facts → experience → recommend → review/override → explain → compare → export |
| 2 | 02-field-inventory.md | every current field classified fact/derived/recommended/expert, with proposed label, meaning, why, recommended behavior, effect, mode |
| 3 | 03-gpu-comprehension-matrix.md | all 15 GPU concepts × {new-SA sees / expert inspects / app recommends} |
| 4 | 04-guessing-points.md | guessing points with the 5 types (customer-unknown / junior-guess / authoritative-default / surprising-auto-change / needs-provenance) + severity |
| 5 | 05-copy-deck.md | labels/helper/tooltips/warnings/confidence/auto-size/recommendation copy; every advanced field answers the 4 questions |
| 6–7 | wireframes.html | Simple-mode flow + Expert per-section Tune drawers |
| 8 | 06-recommendation-presentation.md | balanced / lowest-cost / highest-confidence / rejected-with-reasons + the layered ranking |
| 9 | 07-presets.md | experience + operational presets, preview, conflict, preserve-edits, explicit apply, undo |
| 10 | 08-unknown-range-handling.md | "I don't know" + low/base/high + the two confidence channels |
| 11 | 09-trust-provenance.md | confidence ladder beside the fleet + "where did this come from?" mapping to engine fields |
| 12 | 10-result-hierarchy.md | the fixed 7-level order |
| 13 | 11-meeting-scripts.md | junior before/after + specialist challenge |
| 14 | 12-decision-log.md | decisions, alternatives, open questions, risks, deferred |

Any missing deliverable or sub-point → **P2 (incomplete)** (P1 if it's a required deliverable entirely absent).

---

## 5. Constraint conformance  *(the design must honor these — read the docs, confirm each)*

| Constraint | Where to check | Fail = |
|---|---|---|
| Every customer explanation maps to a **structured engine field / reason code** (never inferred from before/after values) | 05, 09, 10, decision-log D10/R3 | P1 |
| **Auto-sized fleet = derived; manual fleet = explicit expert override** | 02, 03, wireframe | P1 |
| **Simple & Expert use the same engine** | 03, README, decision-log D3 | P1 |
| **No automatic change is silent** (change notices name the driving input) | 05 (change notices), 04 (G14) | P2 |
| N+1 is stated as **serving redundancy only, not HA/DR** | 03, 05, 09, 10 | P2 |
| Recommendations captioned **"among modeled AWS configs"** | 06, wireframe | P2 |
| Confidence sits **next to the fleet**, not only in a lower card | 09, wireframe | P2 |

---

## 6. Internal consistency  *(cross-document)*

- Field names, taxonomy classes, and the canonical numbers (87, the equation, the confidence label)
  are **identical** across `02`, `03`, `wireframes.html`, `09`, `10`, `11`. Any drift → **P2**.
- The taxonomy chip a field gets in `02` matches how the wireframe renders it.
- Confidence terms are used consistently (measured / measured·scaled / extrapolated / proxy / heuristic).

---

## 7. Persona review  *(you facilitate + record; the 3 reviewers judge)*

This is the heart of a UX audit and needs the three humans. Use the audit's methods:

- **Cognitive walkthrough** — for each persona, narrate each Simple-mode field: *What do I think this
  means? Would I ask the customer this? Would they know? Fact or assumption? Do I know the default? Can I
  explain the result without source code?* Record hesitations, skips, misreads, premature technicality.
- **Customer-meeting simulation** — run the `11-meeting-scripts.md` "after" flow as a live 30–45 min
  session (customer / SA / silent observer). Record where the SA guesses, accepts a default blindly, or
  can't defend the output.
- **Expert challenge** — the inference specialist fires the challenge questions (why this GPU/precision/
  concurrency/replicas; binding constraint; benchmark; replica-failure; TTFT statistic; prefill-wrong).
  Every answer must trace to the trust panel or an engine field.

**Score each field/journey 1–5** on: Comprehension · Answerability · Guidance · Consequence ·
Transparency · Confidence · Recoverability · Customer-readiness. Anything **< 3** is a finding
(redesign / default / derive / move-to-expert).

---

## 8. Definition of done (Phase 0)

Approve for Phase 1 when:
- §1 isolation invariants all pass; §2–§3 fidelity clean (no P1).
- All 14 deliverables present and complete (§4).
- No P1 constraint violation (§5); internal consistency holds (§6).
- The three personas complete §7 and agree the design meets their row in the README table.
- The 7 open questions in `12-decision-log.md` are answered or consciously deferred.

---

## 9. Findings & verdict format

Mirror the calculator QA style:

```
Phase 0 design review — VERDICT: {APPROVE FOR PHASE 1 | APPROVE WITH REVISIONS | HOLD}

Isolation (§1): {pass/fail per 1a–1e}
Fidelity (§2–3): {pass/fail}
Completeness (§4): {n/14}
Constraints (§5) / consistency (§6): {pass/fail}
Persona scores (§7): {matrix, <3 items listed}

Findings:
  P1 — {blocks Phase 1 / isolation breach / fidelity error}
  P2 — {significant design gap or inconsistency}
  P3 — {polish}

Open-question positions: Q1..Q7 {answer or defer}
```

## Explicitly out of scope

- Re-testing engine math (done at rc-qa-11).
- Expecting a running app, recommendation engine, or narrative code (Phase 1).
- The **exact** dollar magnitudes as a precision concern — they are rounded reference-case R1 planning
  figures (not quotes). *In scope:* that every visible number **reconciles** with a documented reference
  case ([18-reference-cases.md](18-reference-cases.md)).
- Any request to deploy, change workflows, or touch `main`.
