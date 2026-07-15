// ============================================================================
// recommendation — public API for the Phase-1 headless recommendation layer.
// EXPERIMENTAL, additive; composes the frozen rc-qa-11 engine + the approved
// benchmark registry (via its safe index only). See docs/ux-v2/phase1/DESIGN.md.
// ============================================================================
export * from "./schema";
export { recommend } from "./recommend";
export { narrate } from "./narrate";
// diffRecommendations() is added in a subsequent Phase-1 slice.
