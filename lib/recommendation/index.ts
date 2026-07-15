// ============================================================================
// recommendation — public API for the Phase-1 headless recommendation layer.
// EXPERIMENTAL, additive; composes the frozen rc-qa-11 engine + the approved
// benchmark registry (via its safe index only). See docs/ux-v2/phase1/DESIGN.md.
// ============================================================================
export * from "./schema";
// recommend(), narrate(), diffRecommendations() are added in subsequent Phase-1 slices.
