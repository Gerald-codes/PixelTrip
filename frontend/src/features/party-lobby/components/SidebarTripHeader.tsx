"use client";

/**
 * SidebarTripHeader — trip name + travel dates for the adventure sidebar.
 *
 * Presentational only: data in via props, no data fetching and no service
 * calls. Renders the trip name prominently in the display font and the travel
 * date range as readable body text (e.g. "JAPAN ADVENTURE" / "12 Dec → 20 Dec").
 * Styling uses design-token utility classes only. (Requirements 12.1, 12.2.)
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";

export interface SidebarTripHeaderProps {
  /** The adventure's trip name, e.g. "JAPAN ADVENTURE". */
  tripName: string;
  /** Readable travel date range label, e.g. "12 Dec → 20 Dec". */
  dateRangeLabel: string;
}

export function SidebarTripHeader({
  tripName,
  dateRangeLabel,
}: SidebarTripHeaderProps): ReactElement {
  return (
    <PixelCard>
      <div className="flex flex-col gap-8" data-testid="sidebar-trip-header">
        <h2 className="font-display text-accent">{tripName}</h2>
        <p className="font-body text-subtle">{dateRangeLabel}</p>
      </div>
    </PixelCard>
  );
}

export default SidebarTripHeader;
