# UX v2 — merge-readiness dossier

Prepared during iteration 7 for the SEPARATELY-AUTHORIZED merge review. Nothing in this document
authorizes a merge or deployment: main remains frozen at `d749309` (rc-qa-11) and both GitHub
workflows (CI, Pages) are main-only and have never been triggered by any UX-v2 branch.

## 1. Approved immutable baselines (chronological)

| Layer | Branch | Commit | Verdict scope |
|---|---|---|---|
| Engine (frozen) | `main` | `d749309` | rc-qa-11 QA sign-off (184 tests) |
| Benchmark registry | `ux/v2-benchmarks` | `4b2c848` | rounds 1–7 approved for Phase 1 |
| Headless Phase-1 (complete) | `ux/v2-phase1` | `e938c5d` | sweep + narrative + change-diff |
| Headless availability revision | `ux/v2-phase1` | `39a8a1a` | reviewer-authorized (UI HOLD-2 P1-UI-4) |
| Headless pricing qualification | `ux/v2-phase1` | `98c1fe0` | reviewer-authorized (iteration-3 P1-UI3-1) |
| Headless pricing integrity | `ux/v2-phase1` | **`faa9af7`** | reviewer-authorized (P1-PRICE-INT-1) — CURRENT headless pin |
| UI slice 1 | `ux/v2-ui` | `f02b51f` | journey · decision summary · trust · validation |
| UI iteration 2 | `ux/v2-ui-2` | `7fdee3d` | presets A · what-changed · alternatives |
| UI iteration 3 | `ux/v2-ui-3` | `63ebce6` | ops journey-state contract · profiles B · pricing qualification UI |
| UI iteration 4 | `ux/v2-ui-4` | `88d0dc7` | risks & exclusions · cost framing · deterministic export |
| UI iteration 5 | `ux/v2-ui-5` | `b04b717` | unknown & range handling · peak factor |
| UI iteration 6 | `ux/v2-ui-6` | **`6ab53fa`** | alternative selection · grouped audit — CURRENT UI pin |
| UI iteration 7 | `ux/v2-ui-7` | (this branch) | P2-ARCH-1 build-time verification · this dossier — in review |

Each UI branch is a child of the previous immutable pin; the headless revisions were each narrowly
authorized in a review verdict and the UI chain rebased onto them under the same verdict.

## 2. Verification matrix (as of iteration 7)

| Gate | State |
|---|---|
| Unit/contract/component suite | **489** tests (485 + 4 P2-ARCH-1) — engine 184 · registry 40 · recommendation 140 · advisor UI 121 · shim parity 4 |
| `tsc --noEmit` | clean |
| `build` / `build:static` | clean — now GATED by `prebuild`/`prebuild:static` artifact verification (P2-ARCH-1) |
| 375 × 812 mobile acceptance (`scripts/verify-advisor-mobile.mjs`) | PASS (no horizontal overflow, zero console errors) |
| Fresh-profile browser probes | zero console/page errors on every shipped iteration |
| CI / Pages | zero runs from any UX-v2 branch (both workflows main-only) |

## 3. Trust boundary (P2-ARCH-1 closure)

Pinned-artifact verification now runs at BUILD TIME: `prebuild`/`prebuild:static` execute
`scripts/verify-artifacts.ts`, which loads the pinned catalog through the registry's public index in
Node (real `node:crypto`), verifying every raw-snapshot checksum against `MANIFEST.json` fail-closed —
any tamper fails the build before a byte is emitted. The client-side pure-TS sha256 shim
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
2. Decide the landing shape: merge `ux/v2-ui-7` (fast-forward chain of the approved pins) vs a squash;
   the chain preserves the reviewed increments verbatim.
3. Decide `/advisor` exposure (linked from `/` vs unlisted) — currently unlisted.
4. CI/Pages will build the advisor on the next main push; `prebuild` artifact verification will run in
   CI for the first time (expected: pass — identical pinned artifacts).
5. Re-run the full gate set on the merge result before deploy (suite, typecheck, build:static, mobile
   acceptance, fresh-profile probe).
