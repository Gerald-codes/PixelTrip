"use client";

/**
 * useCharacterDraft — the character/preference questionnaire's single stateful hook.
 *
 * Owns the in-memory {@link CharacterDraft} via a pure {@link useReducer} plus an
 * in-memory `sessionCharacter`. Frontend-only and session-only: NO persistence
 * (no localStorage/sessionStorage/cookies/IndexedDB), no network/fetch, no
 * service import. `save()` is the single projection seam — it only sets
 * `sessionCharacter` in React state from the pure {@link toSessionCharacter}
 * projection. `canSave` / `toSessionCharacter` live in `../lib/draft`.
 */
import { useCallback, useMemo, useReducer, useState } from "react";

import { canSave as computeCanSave, toSessionCharacter } from "../lib/draft";
import type {
  BudgetTier,
  CharacterDraft,
  DateRange,
  GroupRole,
  SessionCharacter,
} from "../types";

/** The multi-select string-set fields driven by {@link toggle}. */
type ToggleField = "tripPriorities" | "destinations" | "activities";

/** An empty availability range; the draft always keeps at least one. */
const EMPTY_DATE_RANGE: DateRange = { start: "", end: "" };

/** The initial, empty draft rendered before any selection is made. */
const INITIAL_DRAFT: CharacterDraft = {
  budgetTier: null,
  groupRole: null,
  tripPriorities: [],
  destinations: [],
  activities: [],
  budgetText: "",
  availableDates: [EMPTY_DATE_RANGE],
};

/** Discriminated reducer actions over the {@link CharacterDraft}. */
type DraftAction =
  | { type: "setBudgetTier"; tier: BudgetTier }
  | { type: "setGroupRole"; role: GroupRole }
  | { type: "toggle"; field: ToggleField; id: string }
  | { type: "setBudgetText"; text: string }
  | { type: "setDateRange"; index: number; range: DateRange }
  | { type: "addDateRange" }
  | { type: "removeDateRange"; index: number };

/** Toggle membership of `id` within an immutable string set. */
function toggleStringSet(
  set: readonly string[],
  id: string,
): readonly string[] {
  return set.includes(id)
    ? set.filter((existing) => existing !== id)
    : [...set, id];
}

/** Pure reducer over the {@link CharacterDraft}. Never mutates its input. */
function draftReducer(
  state: CharacterDraft,
  action: DraftAction,
): CharacterDraft {
  switch (action.type) {
    case "setBudgetTier":
      return { ...state, budgetTier: action.tier };

    case "setGroupRole":
      return { ...state, groupRole: action.role };

    case "toggle":
      return {
        ...state,
        [action.field]: toggleStringSet(state[action.field], action.id),
      };

    case "setBudgetText":
      return { ...state, budgetText: action.text };

    case "setDateRange":
      return {
        ...state,
        availableDates: state.availableDates.map((range, i) =>
          i === action.index ? action.range : range,
        ),
      };

    case "addDateRange":
      return {
        ...state,
        availableDates: [...state.availableDates, { ...EMPTY_DATE_RANGE }],
      };

    case "removeDateRange":
      if (state.availableDates.length <= 1) {
        return state;
      }
      return {
        ...state,
        availableDates: state.availableDates.filter(
          (_, i) => i !== action.index,
        ),
      };

    default:
      return state;
  }
}

/** The public surface returned by {@link useCharacterDraft}. */
export interface UseCharacterDraft {
  draft: CharacterDraft;
  setBudgetTier: (tier: BudgetTier) => void;
  setGroupRole: (role: GroupRole) => void;
  toggle: (field: ToggleField, id: string) => void;
  setBudgetText: (text: string) => void;
  setDateRange: (index: number, range: DateRange) => void;
  addDateRange: () => void;
  removeDateRange: (index: number) => void;
  canSave: boolean;
  sessionCharacter: SessionCharacter | null;
  save: () => void;
}

/**
 * Manage the in-memory character draft and the session-only saved character.
 */
export function useCharacterDraft(initialDraft?: CharacterDraft): UseCharacterDraft {
  const [draft, dispatch] = useReducer(draftReducer, initialDraft ?? INITIAL_DRAFT);
  const [sessionCharacter, setSessionCharacter] =
    useState<SessionCharacter | null>(null);

  const setBudgetTier = useCallback((tier: BudgetTier) => {
    dispatch({ type: "setBudgetTier", tier });
  }, []);

  const setGroupRole = useCallback((role: GroupRole) => {
    dispatch({ type: "setGroupRole", role });
  }, []);

  const toggle = useCallback((field: ToggleField, id: string) => {
    dispatch({ type: "toggle", field, id });
  }, []);

  const setBudgetText = useCallback((text: string) => {
    dispatch({ type: "setBudgetText", text });
  }, []);

  const setDateRange = useCallback((index: number, range: DateRange) => {
    dispatch({ type: "setDateRange", index, range });
  }, []);

  const addDateRange = useCallback(() => {
    dispatch({ type: "addDateRange" });
  }, []);

  const removeDateRange = useCallback((index: number) => {
    dispatch({ type: "removeDateRange", index });
  }, []);

  const canSave = useMemo(() => computeCanSave(draft), [draft]);

  const save = useCallback(() => {
    // Session-only projection seam: state write ONLY, never persistence.
    const projected = toSessionCharacter(draft);
    if (projected !== null) {
      setSessionCharacter(projected);
    }
  }, [draft]);

  return {
    draft,
    setBudgetTier,
    setGroupRole,
    toggle,
    setBudgetText,
    setDateRange,
    addDateRange,
    removeDateRange,
    canSave,
    sessionCharacter,
    save,
  };
}
