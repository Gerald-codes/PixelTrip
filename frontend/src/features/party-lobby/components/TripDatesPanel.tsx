"use client";

/**
 * TripDatesPanel — the adventure sidebar's TRIP DATES card.
 *
 * Shows the trip's own length and dates (not the party's availability) once a
 * destination is chosen. The guide's reason for the length stays on the
 * destination card; the sidebar keeps to the facts. Until a flight is locked the party leader gets a CHANGE
 * button that opens the {@link TripDatesDialog}; everyone else sees who can
 * change them.
 */
import { useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { PixelCard } from "@/components/PixelCard";
import type { TripDates } from "@/services/tripDates.contract";

import { formatTripDates } from "./DestinationMatchCard";
import { TripDatesDialog } from "./TripDatesDialog";

export interface TripDatesPanelProps {
  /** The trip's dates, or `null` when not known yet. */
  dates?: TripDates | null;
  roomId?: string;
  memberId?: string;
  /** Only the party leader may change the dates. */
  isOwner?: boolean;
}

export function TripDatesPanel({
  dates = null,
  roomId,
  memberId,
  isOwner = false,
}: TripDatesPanelProps): ReactElement {
  const [open, setOpen] = useState(false);

  if (!dates || dates.tripDays === null) {
    return (
      <PixelCard title="TRIP DATES">
        <p className="font-display text-subtle" data-testid="trip-dates-panel">
          Not set yet
        </p>
      </PixelCard>
    );
  }

  const range = formatTripDates(dates.tripStart, dates.tripEnd);
  const canEdit =
    dates.canChange && isOwner && roomId !== undefined && memberId !== undefined;

  return (
    <PixelCard title="TRIP DATES">
      <div className="font-body flex flex-col gap-8" data-testid="trip-dates-panel">
        <p>
          <strong className="font-display text-accent">
            {dates.tripDays} DAYS
          </strong>
          {range ? <span> · {range}</span> : null}
        </p>
        {canEdit ? (
          <PixelButton
            variant="secondary"
            label="CHANGE"
            ariaLabel="Change trip dates"
            onClick={() => setOpen(true)}
          />
        ) : dates.canChange ? (
          <p className="text-subtle">The party leader can change these.</p>
        ) : dates.lockedReason ? (
          <p className="text-subtle">{dates.lockedReason}</p>
        ) : null}
      </div>
      {open && canEdit ? (
        <TripDatesDialog
          roomId={roomId}
          memberId={memberId}
          dates={dates}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </PixelCard>
  );
}

export default TripDatesPanel;
