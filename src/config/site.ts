/**
 * Static, non-secret application metadata.
 *
 * Anything that varies per deployment belongs in `@/config/env`, not here.
 */
export const siteConfig = {
  name: "Vyom",
  title: "Vyom — Nutrition Practice Platform",
  description:
    "A practice platform for Indian dietitians and nutritionists: client management, India-specific nutrition targets, meal plans, and progress tracking.",
  /**
   * Current development phase. Update this as phases are completed.
   * See CLAUDE.md for the phase-gating rule.
   */
  phase: "Phase 8A — Nutrition Data Foundation",
} as const;

export type SiteConfig = typeof siteConfig;
