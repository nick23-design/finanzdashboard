/**
 * Sector Guardrails — Phase 2 placeholder
 *
 * This module will hold sector- and company-type-specific guardrail rules
 * once Phase 2 is implemented. For example:
 *   - Semiconductor: flag if inventory growth > revenue growth without explanation
 *   - Mega-cap cloud: flag if AI-capex impact is not mentioned for large AI spends
 *   - Speculative growth: always add "execution risk" note
 *
 * Phase 1: empty array — no sector rules active.
 */

import type { GuardrailRule } from "../types";

export const SECTOR_RULES: GuardrailRule[] = [];
