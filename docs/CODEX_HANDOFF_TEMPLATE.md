# Codex handoff — standing instructions (append to every review request)

Paste the **round header** + the **standing block** below with each feedback. For most rounds you can
lean on `docs/QA_HANDOFF.md` (code) or `docs/ux-v2/REVIEW-INSTRUCTIONS.md` (design) and keep the message
short: *"Retest `rc-qa-N` (`<SHA>`) per QA_HANDOFF §X; here's what changed: …"*

---

## Round header (fill in)

```
Review: <rc-qa-N | ux/v2 Phase 0 revision>
Pinned commit: <SHA>   (= HEAD = origin/main, or branch ux/v2)
What changed this round: <1–5 bullets>
Follow QA_HANDOFF §<X>  (design rounds: docs/ux-v2/REVIEW-INSTRUCTIONS.md)
```

## Standing block (paste verbatim)

**Baseline:** test only the pinned commit. First run `git fetch --tags --force && git rev-parse <SHA>`
and confirm it equals HEAD and origin/main (or the named branch). If they differ, stop and report.
Don't re-test anything already signed off in an earlier RC.

**Isolation invariants — all must pass (any failure = P1):**
- `main` = the frozen baseline SHA; prior `rc-qa-*` tags unmoved.
- diff vs the previous commit touches ONLY the paths this round claims (no engine/component/workflow/
  config drift unless the round is about them).
- the push triggered NO unexpected CI/Pages run (`gh run list`; gh at
  `"/c/Program Files/GitHub CLI/gh.exe"` if not on PATH).
- preserve the untracked `.claude/` dir; restore any e2e-generated screenshots.

**Gates (report pass/fail each):** typecheck · `vitest run` (report N/N) · build:static · verify:basepath
· test:e2e (console errors?) · `verify:live <vercel-url>`.

**Fidelity cross-check (read-only, the only place you touch the engine):** reproduce the canonical case;
confirm every structural number in the UI/exports reconciles with the engine field it claims (fleet
equation, binding dim, capacity.source, P99, prefill/decode). A number that contradicts the engine = P1.
Never infer causation from before/after value deltas.

**Verdict + findings format:**
```
VERDICT: PASS | CONDITIONAL PASS | HOLD
Isolation: {per-invariant} · Gates: {per-gate} · Fidelity: {pass/fail}
P1 — blocks release / isolation breach / fidelity error
P2 — significant defect or inconsistency
P3 — polish
Confirmed improvements: {what landed}
Open-question positions: {answer or defer}
```
Give a concrete reproduction (exact inputs → observed vs expected) for every finding.

**Guardrails — do NOT:** tag/move RCs, push, deploy, change workflows/hosting, or touch `main` (I own
release). Don't ask for code deliberately deferred to a later phase. If blocked on access, say so —
source inspection alone is not a complete browser review.

---

## Design / Phase-0 variant

Replace the **Gates** and **Fidelity** lines with:

> This is a **design-artifact review, not a functional test** — no running app, recommendation engine,
> or narrative code is expected (deferred to Phase 1). Run the isolation invariants; open the
> **independently accessible wireframe** and confirm it renders (no external requests, Simple⇄Expert
> toggle + trust panel work, no console errors); verify every structural number in the docs/wireframe
> maps to a real frozen-engine **reference case**; check deliverable completeness + cross-document
> consistency; then facilitate the three-persona scoring (new SA / generalist SA / inference specialist).
