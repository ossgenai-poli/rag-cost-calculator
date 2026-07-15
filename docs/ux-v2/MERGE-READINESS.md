# UX v2 — merge-readiness dossier

Prepared during iteration 7 for the SEPARATELY-AUTHORIZED merge review. Nothing in this document
authorizes a merge or deployment: main remains frozen at `d749309` (rc-qa-11). No UX-v2 branch push
has ever triggered a workflow run — see §2 for the ACTUAL trigger conditions (CI is not "main-only";
its push trigger is main-filtered and no PR has been opened).

## 1. Approved verdict pins vs the landing ancestry (P1-MERGE-7-1)

Two different things must not be conflated:
- **Immutable verdict/audit pins** — the exact commits each APPROVE verdict was issued against. They
  are permanent audit references and their branches are never moved.
- **The landing ancestry** — the commits actually contained in the proposed landing head. Because two
  reviewer-authorized headless revisions required REBASING the UI chain (UI HOLD-2 → `39a8a1a`;
  iteration-3 P1-UI3-1 → `98c1fe0`/`faa9af7`), the earliest two UI verdict pins are NOT ancestors of
  the current head — the chain contains their REBASED EQUIVALENTS (same tree-level content replayed
  onto the revised headless base, re-verified by the full gate set after each rebase, not by commit
  identity).

| Layer | Verdict pin (immutable audit ref) | In landing ancestry? | Rebased equivalent in the chain |
|---|---|---|---|
| Engine (frozen) | `main @ d749309` (rc-qa-11) | **yes** | — |
| Benchmark registry | `ux/v2-benchmarks @ 4b2c848` | **yes** | — |
| Headless Phase-1 complete | `ux/v2-phase1 @ e938c5d` | **yes** | — |
| Headless availability revision | `ux/v2-phase1 @ 39a8a1a` | **yes** | — |
| Headless pricing qualification | `ux/v2-phase1 @ 98c1fe0` | **yes** | — |
| Headless pricing integrity (current pin) | `ux/v2-phase1 @ faa9af7` | **yes** | — |
| UI slice 1 | `ux/v2-ui @ f02b51f` | **no** | `eeb0717` (slice-1 rev-3, replayed onto the availability revision) |
| UI iteration 2 | `ux/v2-ui-2 @ 7fdee3d` | **no** | `2dfa181` (iteration-2 rev-3, replayed onto the pricing revisions) |
| UI iteration 3 | `ux/v2-ui-3 @ 63ebce6` | **yes** | — |
| UI iteration 4 | `ux/v2-ui-4 @ 88d0dc7` | **yes** | — |
| UI iteration 5 | `ux/v2-ui-5 @ b04b717` | **yes** | — |
| UI iteration 6 (current UI pin) | `ux/v2-ui-6 @ 6ab53fa` | **yes** | — |
| UI iteration 7 | `ux/v2-ui-7` (this branch) | head | in review |

Ancestry facts (verifiable with `git merge-base --is-ancestor`): `d749309` IS an ancestor of the
proposed head, so **main can fast-forward to it only while `d749309` remains main's tip** — but not
every historical approval pin is contained in that ancestry (`f02b51f` and `7fdee3d` are not).
**Tree-level re-verification after each rebase:** every authorized rebase was followed by the complete
gate set on the rebased head (full suite, typecheck, build:static, 375px acceptance, fresh-profile
probe) and a repin verdict — the rebased equivalents are verified by tests and review, not by commit
identity.

## 2. Verification matrix (as of iteration 7)

| Gate | State |
|---|---|
| Unit/contract/component suite | **489** tests (485 + 4 P2-ARCH-1) — engine 184 · registry 40 · recommendation 140 · advisor UI 121 · shim parity 4 |
| `tsc --noEmit` | clean |
| `build` / `build:static` | clean — now GATED by `prebuild`/`prebuild:static` artifact verification (P2-ARCH-1) |
| 375 × 812 mobile acceptance (`scripts/verify-advisor-mobile.mjs`) | PASS (no horizontal overflow, zero console errors) |
| Fresh-profile browser probes | zero console/page errors on every shipped iteration |
| CI / Pages | zero runs from any UX-v2 branch. ACTUAL triggers (P2-DOC-7-1): CI = `pull_request` + `push` filtered to `main`; Pages = `push` to `main` + `workflow_dispatch`. Branch pushes triggered nothing because the push filter excluded them and no PR was opened — opening the merge PR WILL run CI on ubuntu-latest. |

## 3. Trust boundary (P2-ARCH-1 closure)

Pinned-artifact verification now runs at BUILD TIME: `prebuild`/`prebuild:static` execute
`scripts/verify-artifacts.ts`, which loads the pinned catalog through the registry's public index in
Node (real `node:crypto`), verifying every raw-snapshot checksum against `MANIFEST.json` fail-closed —
any tamper fails the build BEFORE Next starts and before any NEW build output is emitted (previously
built `.next`/`out` artifacts from an earlier build may still exist on disk; the gate prevents a new
build, it does not delete prior output — P3-DOC-7-1). The client-side pure-TS sha256 shim
(byte-parity-tested against `node:crypto`, including the real manifest checksums) remains as runtime
defense-in-depth; it is no longer the only verification point.

## 4. What a merge would ship (and what it would NOT)

Ships: the `/advisor` route (journey, presets, operations contract, decision-first hierarchy with
availability/feasibility/evidence/pricing qualification semantics, risks & exclusions, range handling,
selection, deterministic export), the headless recommendation layer, the benchmark registry, the
browser crypto shim + build-time verification. The calculator at `/` and the frozen engine are
byte-untouched.

Does NOT ship (recorded deferrals, owner-accepted):
- **Compare action** (UI6-D1) — deferred until the real catalog yields ≥2 qualified alternatives.
- **Live pricing** (D5) — pinned reference price book retained, provenance-labeled everywhere.
- **Shared theme tokens** (D7) — the advisor pins its own light scheme.
- **Copy consolidation** (D3) — narrate()'s label map and the UI copy contract remain separate; a
  future headless-authorized pass may unify them.
- **Peak/uptime capacity semantics beyond planning inputs** — all disclosed in-product.

## 5. Merge preconditions (for the authorizing reviewer)

1. Explicit merge authorization (this dossier does not constitute one).
2. Decide the landing shape: main can FAST-FORWARD to the proposed head only while `d749309` remains
   main's tip. The landing ancestry contains the rebased EQUIVALENTS of the two earliest UI approvals
   (`eeb0717`, `2dfa181`) rather than the original verdict pins `f02b51f`/`7fdee3d` (§1) — each
   equivalence was re-verified by the full gate set and a repin verdict after the authorized rebase. A
   squash is the alternative if per-increment history is not wanted on main.
3. Decide `/advisor` exposure (linked from `/` vs unlisted) — currently unlisted.
4. Opening the merge PR triggers CI (`pull_request`, ubuntu-latest) — the first CI execution of this
   work, including the `prebuild` artifact verification (expected: pass — identical pinned artifacts;
   the acceptance test invokes the local tsx CLI shell-free, so it is platform-neutral). Pages runs on
   the main push after merge (or `workflow_dispatch`).
5. Re-run the full gate set on the merge result before deploy (suite, typecheck, build:static, mobile
   acceptance, fresh-profile probe).
