/**
 * SidebarPlaceholderPanel — display-only empty-state panel for the adventure sidebar.
 *
 * Reused for the DESTINATION and FLIGHT sidebar sections. Those legs of the quest
 * (DISCOVER, LOGISTICS) have no behavior in this feature, so each section renders a
 * fixed "Not selected" empty state. Purely presentational and NON-interactive: no
 * buttons, no handlers, no service calls. Composes the shared PixelCard primitive and
 * uses design-token utility classes only.
 *
 * Requirements: 14.1, 14.2, 14.3.
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";

export interface SidebarPlaceholderPanelProps {
  /** Section heading, e.g. "DESTINATION" or "FLIGHT". */
  title: string;
  /** Empty-state value shown as the section content, e.g. "Not selected". */
  emptyLabel: string;
  /** Confirmed value shown after the backend locks the selection. */
  value?: string;
}

export function SidebarPlaceholderPanel({
  title,
  emptyLabel,
  value,
}: SidebarPlaceholderPanelProps): ReactElement {
  return (
    <PixelCard title={title}>
      <p className={`font-display ${value ? "text-accent" : "text-subtle"}`}>
        {value ?? emptyLabel}
      </p>
    </PixelCard>
  );
}

export default SidebarPlaceholderPanel;
