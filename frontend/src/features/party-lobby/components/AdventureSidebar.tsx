"use client";

/**
 * AdventureSidebar — the persistent "YOUR ADVENTURE" right-panel host.
 *
 * Composes the sidebar panels in order: party panel, then destination, trip dates
 * (the leader can change them until a flight is locked), flight and budget, each
 * of which appears only once it has something to show, and the six-stage quest
 * progress.
 * Presentational only: the view model arrives via `adventure` and the optional
 * `roomSession` prop supplies the live room code and planning stage. It performs
 * NO data fetching and imports NO concrete service — the room code is read solely
 * from the `roomSession` prop passed in; the party panel copies it (or an invite link).
 *
 * Responsive behaviour (Req 17.2, 17.4, 17.5):
 * - Desktop (>= `lg` breakpoint): a fixed right column whose content is always
 *   visible regardless of the mobile drawer state. It scrolls inside itself when
 *   its cards are taller than the window, so the lower cards stay reachable.
 * - Mobile (< `lg`): a collapsible drawer driven by `useAdventureDrawer`, toggled
 *   by a button that exposes `aria-expanded` and controls the content visibility.
 *
 * The column has no visible heading: the page title ("Adventure with …") names it,
 * and the region keeps its accessible name "Your adventure" (Req 1.4). Styling uses design-token utility classes
 * only — never raw hex or arbitrary values (Req 19.4).
 */
import type { ReactElement } from "react";

import type { RoomSession } from "@/types/room";
import type { SelectedDestination } from "@/services/destination.contract";

import type { AdventureView } from "../types";
import { useAdventureDrawer } from "../hooks/useAdventureDrawer";
import { buildStageSteps } from "../lib/stages";
import { SidebarPartyPanel } from "./SidebarPartyPanel";
import { SidebarPlaceholderPanel } from "./SidebarPlaceholderPanel";
import { BudgetPanel } from "./BudgetPanel";
import { useTripBudget } from "../hooks/useTripBudget";
import { useTripDates } from "../hooks/useTripDates";
import { TripDatesPanel } from "./TripDatesPanel";
import { TravellerCard } from "./TravellerCard";
import { useTravellerPreview } from "../hooks/useTravellerPreview";
import { AdventureProgress } from "./AdventureProgress";

/** A card stepping into the column when it first has something to show. */
const ARRIVE = "animate-pixel-pop motion-reduce:animate-none";

export interface AdventureSidebarProps {
  /** The derived adventure sidebar view model. */
  adventure: AdventureView;
  /** The active room session, or null when no session is available. */
  roomSession?: RoomSession | null;
  /** The destination locked by the resolved vote, when available. */
  selectedDestination?: SelectedDestination | null;
  /** The flight locked by the resolved vote, when available. */
  selectedFlight?: { id: string; title: string } | null;
  /** Leave the party; offered quietly at the foot of the party card. */
  onLeave?: () => void;
}

export function AdventureSidebar({
  adventure,
  roomSession,
  selectedDestination = null,
  selectedFlight = null,
  onLeave,
}: AdventureSidebarProps): ReactElement {
  const drawer = useAdventureDrawer();
  const budget = useTripBudget(roomSession?.room.id);
  const tripDates = useTripDates(roomSession?.room.id);
  const traveller = useTravellerPreview();

  const roomCode = roomSession?.room.roomCode ?? null;
  const stage = roomSession?.room.planningStage ?? "setup";
  const steps = buildStageSteps(stage);

  // The budget card has something to show once a member typed an amount or
  // picked a budget level.
  const hasBudget =
    budget !== null &&
    (budget.isHardLimit || (budget.level != null && budget.dailyRange != null));

  const contentId = "adventure-sidebar-content";

  return (
    <aside
      aria-label="Your adventure"
      className="flex flex-col gap-16 lg:sticky lg:top-16 lg:max-h-screen lg:self-start lg:overflow-y-auto lg:pb-32 lg:pr-8"
    >
      {/* The page title already names the adventure, so the column has no heading
          of its own: on mobile this row holds only the drawer toggle, and on
          desktop it is gone. */}
      <div className="flex justify-end lg:hidden">
        <button
          type="button"
          onClick={drawer.toggle}
          aria-expanded={drawer.isOpen}
          aria-controls={contentId}
          className="font-display border-2 border-ink px-16 py-8 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {drawer.isOpen ? "Hide party and trip" : "Show party and trip"}
        </button>
      </div>

      {/*
        Desktop (lg+): always shown. Mobile (< lg): visible only while the drawer
        is open. `lg:flex` re-shows the content on desktop regardless of drawer
        state, so the fixed column is always visible there.
      */}
      <div
        id={contentId}
        className={`flex-col gap-16 lg:flex ${drawer.isOpen ? "flex" : "hidden"}`}
      >
        {/* While the player is creating their traveller it stands here, in view
            the whole time the form scrolls. Once saved, their row in the party
            list below shows it instead. */}
        {traveller ? (
          <TravellerCard draft={traveller.draft} name={traveller.name} />
        ) : null}
        <SidebarPartyPanel
          members={adventure.members}
          roomCode={roomCode}
          onLeave={onLeave}
        />
        {/* A card joins the column only once it has something to say, stepping
            into place as it does, so the column starts short and grows with the
            plan. */}
        {selectedDestination ? (
          <div className={ARRIVE}>
            <SidebarPlaceholderPanel
              title="DESTINATION"
              emptyLabel="Not selected"
              value={selectedDestination.title}
            />
          </div>
        ) : null}
        {tripDates?.tripDays != null ? (
          <div className={ARRIVE}>
            <TripDatesPanel
              dates={tripDates}
              roomId={roomSession?.room.id}
              memberId={roomSession?.member.id}
              isOwner={roomSession?.member.role === "owner"}
            />
          </div>
        ) : null}
        {selectedFlight ? (
          <div className={ARRIVE}>
            <SidebarPlaceholderPanel
              title="FLIGHT"
              emptyLabel="Not selected"
              value={selectedFlight.title}
            />
          </div>
        ) : null}
        {hasBudget ? (
          <div className={ARRIVE}>
            <BudgetPanel budget={budget} />
          </div>
        ) : null}
        <AdventureProgress steps={steps} />
      </div>
    </aside>
  );
}

export default AdventureSidebar;
