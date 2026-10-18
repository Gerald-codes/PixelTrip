/**
 * Pure budget-derivation logic for the adventure sidebar's budget panel.
 *
 * This module is frontend-only and session-only: it performs no I/O, no
 * persistence, and no network access. {@link deriveBudgetView} is a pure,
 * deterministic projection from a spend limit and an estimated spend into the
 * feature-local {@link BudgetView} readout consumed by `BudgetPanel`.
 */
import type { BudgetView } from "@/features/party-lobby/types";

/**
 * Derive the budget readout from a limit and an estimated spend.
 *
 * @param limit - The party's budget ceiling.
 * @param estimated - The current estimated spend.
 * @returns A {@link BudgetView} where `remaining` is `limit - estimated` (may be
 *   negative), `isOverBudget` is `estimated > limit`, and `overageAmount` is the
 *   non-negative overage `max(0, estimated - limit)`.
 */
export function deriveBudgetView(limit: number, estimated: number): BudgetView {
  return {
    limit,
    estimated,
    remaining: limit - estimated,
    isOverBudget: estimated > limit,
    overageAmount: Math.max(0, estimated - limit),
  };
}
