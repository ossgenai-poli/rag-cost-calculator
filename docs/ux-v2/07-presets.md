# 9. Preset interaction design

Presets populate assumptions fast but are **never silent black boxes**. Applying one always shows a
**preview of exactly which fields change**, flags **conflicts** with fields the SA already edited,
**preserves edited fields by default**, requires an explicit **Apply**, and supports **Undo**.

---

## Two preset families

### A. Response-experience presets *(Stage C — drive the SLA)*
| Preset | Streaming speed | Wait to first word (P99) | Use for |
|---|---|---|---|
| **Conversational** | high (snappy) | ~1 s | chat, support agents |
| **Interactive RAG** | medium | ~2 s | knowledge assistants (default) |
| **Analyst / research** | lower | ~5 s | long, thorough answers |
| **Batch** | throughput-first | relaxed | offline extraction/summarization |

### B. Operational profiles *(Stage A/C — drive availability, utilization, purchasing)*
| Profile | Utilization | N+1 | Uptime | Purchasing |
|---|---|---|---|---|
| **Prototype** | aggressive 85% | off | business hours | on-demand |
| **Production — balanced** | balanced 70% | on | 24×7 | on-demand |
| **Latency-sensitive production** | conservative 50% | on | 24×7 | on-demand |
| **Cost-optimized production** | aggressive 85% | on | 24×7 | indicative RI/Savings |
| **Business-hours deployment** | balanced 70% | on | business hours | on-demand |
| **24×7 regulated** | conservative 50% | on | 24×7 | on-demand |

*(Workload presets — support-RAG, internal-KB, analyst, summarization, batch, agentic — additionally
seed corpus/traffic/sources defaults; same apply/preview/undo rules.)*

---

## Apply flow

```
[ Apply "Production — balanced" ]
        │
        ▼
┌───────────────────────────────────────────────┐
│ This preset will change 4 fields:              │
│                                                │
│  Utilization target   70%  →  70%   (no change)│
│  Spare replica (N+1)  off  →  on               │
│  Operating hours      business → 24×7          │
│  Purchasing           on-demand → on-demand    │
│                                                │
│  ⚠ 1 conflict with your edits:                 │
│  Utilization target — you set 60%.             │
│     ◉ Keep my 60%   ○ Use preset 70%           │
│                                                │
│        [ Cancel ]   [ Apply all ]              │
└───────────────────────────────────────────────┘
```

- **Preview**: every field the preset would touch, old → new, "no change" rows greyed.
- **Conflict**: any field the SA has edited is flagged; default is **keep the SA's value**; they can
  opt into the preset value per-field.
- **Apply all**: explicit; nothing changes until pressed.
- **Undo**: a single undo restores the pre-apply state (and shows a toast "Reverted 'Production —
  balanced'").

---

## Rules

- **No silent overwrite.** Edited fields are preserved unless the SA explicitly chooses the preset value.
- **Presets are transparent.** After apply, a chip "Production — balanced (2 fields kept)" shows the
  preset is active and how many fields were preserved.
- **Presets set inputs, not outputs.** They seed SLA/availability/utilization inputs; the engine still
  derives GPU/fleet/confidence from them — a preset never hardcodes a fleet count.
- **Stackable, order-explicit.** Applying a second preset re-previews against the current state; the
  active-preset chip updates.

## Design constraints

- Presets are declarative input bundles (Phase 1 config); Phase 0 defines the bundles and the
  interaction, not the code.
- The preview diff is computed from the current inputs vs the bundle — a pure input comparison, not an
  engine re-run inference.
