"use client";

/**
 * CharacterCreator — the RPG-style character/preference questionnaire (left panel).
 *
 * The user builds a travel PERSONALITY rather than a detailed avatar. A polished
 * 8-bit chibi sits at the top and reflects the chosen group-trip role; everything
 * below is a concise, pixel-styled questionnaire whose answers are stored as
 * structured trip-planning data (not encoded on the sprite).
 *
 * Steps: budget tier -> group role -> trip priorities -> destinations ->
 * activities -> adventure funds -> availability -> save. Origin is
 * always Singapore and is never requested. Owns {@link useCharacterDraft} for the
 * in-memory draft, and on save submits the preferences + character to the backend
 * via the preferences service (PUT .../preferences) through `getServices()`.
 */
import { useEffect, useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { getServices } from "@/services";
import { ApiError } from "@/lib/errors";
import type { RoomSession } from "@/types";

import { TravellerCard } from "./TravellerCard";
import { AvailabilityPicker } from "./AvailabilityPicker";
import { BudgetAmountField } from "./BudgetAmountField";
import { VibeCardGroup } from "./VibeCardGroup";
import { useCharacterDraft } from "../hooks/useCharacterDraft";
import { useSetTravellerPreview } from "../hooks/useTravellerPreview";
import {
  ACTIVITIES,
  BUDGET_TIERS,
  DESTINATIONS,
  GROUP_ROLES,
  TRIP_PRIORITIES,
} from "../lib/characterOptions";
import {
  FIXED_ORIGIN,
  type BudgetTier,
  type GroupRole,
} from "../types";
import { availabilityIssue, toSessionCharacter } from "../lib/draft";
import { QUESTION_HEADING } from "../lib/questionStyles";
import { demoDraft } from "../lib/demoScenario";

export interface CharacterCreatorProps {
  /** The active room session (supplies the room code + member id for saving). */
  session: RoomSession;
  /** Called after the character is successfully saved to the backend. */
  onSaved?: () => void;
}


export function CharacterCreator({
  session,
  onSaved,
}: CharacterCreatorProps): ReactElement {
  const viewerDisplayName = session.member.displayName;
  const {
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
  } = useCharacterDraft(demoDraft(session));
  const isDemo = session.room.demoScenario === "vietnam-five-days";

  // Submission state for the backend save (explicit loading + error handling).
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);

  const handleSave = async (): Promise<void> => {
    if (!canSave || submitting) {
      return;
    }
    // Keep the in-memory session character in sync for the preview/sidebar.
    save();

    const character = toSessionCharacter(draft);
    if (character === null) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await getServices().preferences.savePreferences({
        roomCode: session.room.roomCode,
        memberId: session.member.id,
        // Payload-shaped preferences. The group-trip role is carried in
        // `travelStyle` (what role you play in the group); tripPriorities map onto
        // the contract's `interests`; activities are sent as plain name tags;
        // origin is always Singapore and is never asked of the user.
        availableDates: character.availableDates,
        destinations: character.destinations,
        travelStyle: character.groupRole,
        budget: character.budget,
        interests: character.tripPriorities,
        activities: character.activities,
        hardConstraints: [],
        origin: FIXED_ORIGIN,
        character: {
          appearance: {
            role: character.groupRole,
            budgetTier: character.budgetTier,
            tripPriorities: character.tripPriorities,
          },
          spriteKey: character.character.spriteKey,
        },
      });
      setSavedOnce(true);
      onSaved?.();
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_BUDGET") {
        // Shown under the funds field, where the member can fix it.
        setBudgetError(error.message);
        return;
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not save your traveller. Please try again.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Publish the draft so the sidebar can show the traveller live; withdraw it when
  // the form goes away (saved, or the stage moved on).
  const setPreview = useSetTravellerPreview();
  useEffect(() => {
    setPreview({ draft, name: viewerDisplayName });
  }, [draft, viewerDisplayName, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  return (
    <section className="flex flex-col gap-24">
      <header className="flex flex-col gap-8">
        <h2 className="font-title text-pixel-md text-ink">
          CREATE YOUR TRAVELLER
        </h2>
        <p className="font-body text-subtle">
          Answer a few quests to shape your travel personality.
        </p>
      </header>

      {/* The traveller itself lives in the sticky sidebar, so it stays in view
          while this form scrolls. Where the sidebar folds away (small screens),
          a slim strip pinned above the questions takes its place. */}
      <div className="sticky top-0 z-10 lg:hidden">
        <TravellerCard draft={draft} name={viewerDisplayName} variant="strip" />
      </div>

      {/* 2. Budget tier (single-select). */}
      {isDemo ? <p className="font-body text-primary">Your demo traveller is ready. You can change your choices; the prepared destinations, flights and itinerary stay the same. Both users must save before voting.</p> : null}
      <div className="flex flex-col gap-24">
      <VibeCardGroup
        legend="Choose your budget"
        mode="single"
        options={BUDGET_TIERS}
        selectedIds={draft.budgetTier ? [draft.budgetTier] : []}
        onToggle={(id) => setBudgetTier(id as BudgetTier)}
      />

      {/* The optional exact amount belongs with the budget level, as its follow-up. */}
      <BudgetAmountField
        value={draft.budgetText}
        error={budgetError}
        onChange={(value) => {
          setBudgetError(null);
          setBudgetText(value);
        }}
      />

      {/* 3. Group role (single-select) — drives the character. */}
      <VibeCardGroup
        legend="What role do you play in a group trip?"
        mode="single"
        options={GROUP_ROLES}
        selectedIds={draft.groupRole ? [draft.groupRole] : []}
        onToggle={(id) => setGroupRole(id as GroupRole)}
      />

      {/* 4. Trip priorities (multi-select). */}
      <VibeCardGroup
        legend="What do you want most from this trip?"
        options={TRIP_PRIORITIES}
        selectedIds={draft.tripPriorities}
        onToggle={(id) => toggle("tripPriorities", id)}
      />

      {/* 5. Destination vibes (multi-select). */}
      <VibeCardGroup
        legend="Where do you feel like going?"
        options={DESTINATIONS}
        selectedIds={draft.destinations}
        onToggle={(id) => toggle("destinations", id)}
      />

      {/* 7. Activities (multi-select). */}
      <VibeCardGroup
        legend="What do you like to do?"
        options={ACTIVITIES}
        selectedIds={draft.activities}
        onToggle={(id) => toggle("activities", id)}
      />

      {/* 9. Availability dates. */}
      <fieldset className="flex flex-col gap-16">
        <legend className={`${QUESTION_HEADING} mb-8`}>When are you free?</legend>
        <AvailabilityPicker
          ranges={draft.availableDates}
          onChange={setDateRange}
          onAdd={addDateRange}
          onRemove={removeDateRange}
        />
      </fieldset>
      </div>

      {/* 10. Save. */}
      <div className="flex flex-col gap-8">
        {!canSave ? (
          <p className="font-body text-subtle">
            {/* Name the dates when they are the only thing left to fix. */}
            {draft.budgetTier !== null && draft.groupRole !== null
              ? availabilityIssue(draft)
              : "Fill in all the questions above to save your traveller."}
          </p>
        ) : null}
        <PixelButton
          variant="primary"
          type="button"
          label={submitting ? "SAVING…" : "SAVE CHARACTER"}
          disabled={!canSave || submitting}
          onClick={() => {
            void handleSave();
          }}
        />
        {submitError !== null ? (
          <p role="alert" className="font-body text-alert">
            {submitError}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="font-body text-subtle">
          {savedOnce && sessionCharacter !== null
            ? "Traveller saved and shared with your party."
            : ""}
        </p>
      </div>
    </section>
  );
}

export default CharacterCreator;
