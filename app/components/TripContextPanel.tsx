"use client";

/**
 * TripContextPanel - sticky right-side trip context sidebar.
 *
 * Always shows the group's key trip decisions so members never lose track
 * of what has been decided. Displays member statuses, room code with
 * copy-to-clipboard, budget badge, and all trip decision fields.
 *
 * Layout:
 *   - Desktop (>= 1024px): sticky, right-hand column, min-height: 100vh
 *   - Mobile (< 1024px): visibility controlled by parent via `isOpen` prop;
 *     when closed uses `hidden lg:block` pattern
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius (no rounded corners)
 *   - 2px solid deep-navy border on cards/badges
 *   - 4px 4px 0 #1E3A5F box-shadow on interactive elements
 *   - Monospace font throughout
 *   - Background: deep navy (#1E3A5F)
 *   - Text: sand cream (#FEF3C7)
 *   - Ready state: grass green (#4ADE80)
 *   - Pending state: sunset orange (#FB923C)
 *
 * Accessibility:
 *   - Semantic <aside> element
 *   - focus-visible: outline 3px solid #A855F7, offset 2px
 *   - Copy button has aria-label describing action and state
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 12.5
 */

import React, { useState, useCallback } from "react";
import type {
  TripRoom,
  User,
  CharacterProfile,
  RoomStage,
  BudgetEstimate,
} from "@/lib/types";
import ReadyBadge from "./ReadyBadge";
import BudgetStatusBadge from "./BudgetStatusBadge";
import RunningBudgetBar from "./RunningBudgetBar";
import type { RunningBudgetEstimate } from "@/lib/budgetEstimate";
import PixelAvatar from "./PixelAvatar";

// --- Palette -----------------------------------------------------------------

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const NEON_PURPLE = "#A855F7";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";

// --- Stage label map ----------------------------------------------------------

const STAGE_LABELS: Record<RoomStage, string> = {
  LOBBY: "Character Creation",
  PERSONA: "Persona Selection",
  AVAILABILITY: "Dates & Vibes",
  GROUP_PROFILE: "Group Profile",
  DESTINATIONS: "Destination Suggestions",
  DESTINATION_VOTE: "Destination Vote",
  FLIGHTS: "Flight Options",
  FLIGHT_VOTE: "Flight Vote",
  ACTIVITIES: "Activities",
  ITINERARY: "Itinerary",
  FEEDBACK: "Feedback",
  NEGOTIATION: "Negotiation",
  FINAL: "Final Plan",
} as Record<RoomStage, string>;

// --- Flight option label map --------------------------------------------------

const FLIGHT_LABELS: Record<
  NonNullable<TripRoom["selectedFlightOption"]>,
  string
> = {
  budget: "Budget",
  best_value: "Best Value",
  comfort: "Comfort",
};

// --- Budget level label map ---------------------------------------------------

const BUDGET_LEVEL_LABELS: Record<string, string> = {
  low: "Low Budget",
  medium: "Medium Budget",
  high: "High Budget",
};

// --- Prop types ---------------------------------------------------------------

export interface TripContextPanelProps {
  /** The current trip room. */
  room: TripRoom;
  /** All members in the room. */
  members: User[];
  /** Character profiles for members who have completed character creation. */
  characterProfiles: CharacterProfile[];
  /** The current room stage (may differ from room.currentStage if transitioning). */
  currentStage: RoomStage;
  /** User IDs of members who have submitted the current stage. */
  submittedUserIds: string[];
  /** Computed budget estimate, or null when not available. */
  budgetEstimate: BudgetEstimate | null;
  /**
   * Progressive "money committed so far" running spend - starts at $0 and
   * fills up as flight, activities, and itinerary items add cost. Always
   * present (never null) so the bar is visible from the start of the trip.
   */
  runningSpend?: RunningBudgetEstimate | null;
  /**
   * Whether the panel is open on mobile.
   * When false (and screen < 1024px), the panel is hidden.
   * Controlled by the parent (RoomShell).
   */
  isOpen?: boolean;
  /**
   * Optional travel dates to display. Derived from overlapping availability
   * and passed down by the parent when available.
   */
  travelDates?: { startDate: string; endDate: string } | null;
  /**
   * Optional travel vibes selected by the current user.
   * Passed down by the parent when available.
   */
  travelVibes?: string[] | null;
  /**
   * Optional destination shortlist (chip names) selected by members.
   * Shown before a final destination is chosen.
   */
  destinationShortlist?: string[] | null;
}

// --- Copy button --------------------------------------------------------------

function CopyRoomCodeButton({ roomCode }: { roomCode: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const inviteUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/room/${roomCode}`
          : `/room/${roomCode}`;
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments where clipboard API is unavailable
      console.warn("[TripContextPanel] Clipboard write failed");
    }
  }, [roomCode]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={
        copied
          ? "Invite link copied to clipboard"
          : `Copy invite link for room ${roomCode}`
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: copied ? GRASS_GREEN : SUNSET_ORANGE,
        border: `2px solid ${SAND_CREAM}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 ${SAND_CREAM}`,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 11,
        fontWeight: 700,
        color: DEEP_NAVY,
        cursor: "pointer",
        transition: "background-color 0.15s",
        outline: "none",
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline = `3px solid ${NEON_PURPLE}`;
        (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline = "none";
      }}
    >
      <span aria-hidden="true">{copied ? "✔" : "📋"}</span>
      <span>{copied ? "Copied!" : "Copy invite"}</span>
    </button>
  );
}

// --- Section label ------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 10,
        fontWeight: 700,
        color: SAND_CREAM,
        opacity: 0.6,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
      }}
    >
      {children}
    </p>
  );
}

// --- Field value -------------------------------------------------------------

function FieldValue({
  value,
  notSet = false,
}: {
  value: string;
  notSet?: boolean;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 13,
        fontWeight: notSet ? 400 : 600,
        color: notSet ? `${SAND_CREAM}80` : SAND_CREAM,
        wordBreak: "break-word",
        overflowWrap: "break-word",
        minWidth: 0,
      }}
    >
      {value}
    </p>
  );
}

// --- Info row -----------------------------------------------------------------

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const isNotSet = !value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <SectionLabel>{label}</SectionLabel>
      <FieldValue value={isNotSet ? "Not set" : value!} notSet={isNotSet} />
    </div>
  );
}

// --- Divider -----------------------------------------------------------------

function Divider() {
  return (
    <hr
      style={{
        border: "none",
        borderTop: `1px solid ${SAND_CREAM}`,
        opacity: 0.2,
        margin: 0,
      }}
    />
  );
}

// --- Main component -----------------------------------------------------------

export default function TripContextPanel({
  room,
  members,
  characterProfiles,
  currentStage,
  submittedUserIds,
  budgetEstimate,
  runningSpend = null,
  isOpen = false,
  travelDates = null,
  travelVibes = null,
  destinationShortlist = null,
}: TripContextPanelProps) {
  // Build a fast lookup from userId → CharacterProfile
  const profileByUserId = React.useMemo(() => {
    const map = new Map<string, CharacterProfile>();
    for (const cp of characterProfiles) {
      map.set(cp.userId, cp);
    }
    return map;
  }, [characterProfiles]);

  // Derive the dominant budget level from character profiles (most conservative = lowest)
  // Falls back to a label derived from the selected flight option when profiles are absent.
  const dominantBudgetLevel = React.useMemo(() => {
    if (characterProfiles.length > 0) {
      const ORDER = ["low", "medium", "high"];
      const levels = characterProfiles.map((cp) => cp.budgetLevel as string);
      const minIdx = Math.min(...levels.map((l) => ORDER.indexOf(l)).filter((i) => i >= 0));
      return minIdx >= 0 ? ORDER[minIdx] : levels[0];
    }
    // Derive a rough budget level from the selected flight option as a fallback.
    if (room.selectedFlightOption === "budget") return "low";
    if (room.selectedFlightOption === "comfort") return "high";
    if (room.selectedFlightOption === "best_value") return "medium";
    return null;
  }, [characterProfiles, room.selectedFlightOption]);

  // Format travel dates
  const travelDatesValue = React.useMemo(() => {
    if (!travelDates) return null;
    return `${travelDates.startDate} - ${travelDates.endDate}`;
  }, [travelDates]);

  // Format travel vibes - strip any remaining vibe: prefix, capitalise
  const travelVibesValue = React.useMemo(() => {
    if (!travelVibes || travelVibes.length === 0) return null;
    const labels = travelVibes.map((v) =>
      v.replace(/^vibe:/, "").replace(/_/g, " "),
    );
    return labels.join(", ");
  }, [travelVibes]);

  // Determine destination display value
  const destinationValue = React.useMemo(() => {
    if (room.selectedDestination) return room.selectedDestination;
    if (destinationShortlist && destinationShortlist.length > 0) {
      return destinationShortlist.join(", ");
    }
    return null;
  }, [room.selectedDestination, destinationShortlist]);

  // Stage label
  const stageLabel = STAGE_LABELS[currentStage] ?? currentStage;

  // Flight option label
  const flightLabel = room.selectedFlightOption
    ? FLIGHT_LABELS[room.selectedFlightOption] ?? room.selectedFlightOption
    : null;

  // Budget level label
  const budgetLabel = dominantBudgetLevel
    ? (BUDGET_LEVEL_LABELS[dominantBudgetLevel] ?? dominantBudgetLevel)
    : null;

  // Mobile visibility: hidden when not open (on screens < 1024px)
  // On desktop (>= 1024px) always visible via CSS
  const mobileHiddenClass = isOpen ? "" : "hidden lg:block";

  return (
    <aside
      aria-label="Trip context - decisions and member status"
      className={mobileHiddenClass}
      style={{
        width: "100%",
        backgroundColor: DEEP_NAVY,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        fontFamily: "'Courier New', Courier, monospace",
      }}
    >
      {/* -- Top section: stage label + room code -- */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: `2px solid ${SAND_CREAM}20`,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Stage label badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "inline-block",
              paddingTop: 3,
              paddingBottom: 3,
              paddingLeft: 8,
              paddingRight: 8,
              backgroundColor: NEON_PURPLE,
              border: `2px solid ${SAND_CREAM}`,
              borderRadius: 0,
              boxShadow: `3px 3px 0 ${SAND_CREAM}40`,
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 10,
              fontWeight: 700,
              color: SAND_CREAM,
              textTransform: "uppercase" as const,
              letterSpacing: "0.08em",
              wordBreak: "break-word",
              overflowWrap: "break-word",
            }}
            aria-label={`Current planning stage: ${stageLabel}`}
          >
            ▶ {stageLabel}
          </div>
        </div>

        {/* Room code + copy button */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>Room code</SectionLabel>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}
          >
            <span
              style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 20,
                fontWeight: 700,
                color: SAND_CREAM,
                letterSpacing: "0.2em",
              }}
              aria-label={`Room code: ${room.roomCode}`}
            >
              {room.roomCode}
            </span>
            <CopyRoomCodeButton roomCode={room.roomCode} />
          </div>
        </div>
      </div>

      {/* -- Members section -- */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `2px solid ${SAND_CREAM}20`,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <SectionLabel>Members ({members.length})</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((member) => {
            const profile = profileByUserId.get(member.id);
            const submitted = submittedUserIds.includes(member.id);
            const isHost = member.id === room.hostUserId;

            return (
              <div
                key={member.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap" as const,
                }}
              >
                {/* Avatar */}
                {profile ? (
                  <div
                    aria-hidden="true"
                    style={{ flexShrink: 0, imageRendering: "pixelated" }}
                  >
                    <PixelAvatar avatarConfig={profile.avatarConfig} size="sm" />
                  </div>
                ) : (
                  /* Placeholder silhouette for members without a profile */
                  <div
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 48,
                      flexShrink: 0,
                      backgroundColor: `${SAND_CREAM}30`,
                      border: `2px solid ${SAND_CREAM}40`,
                      borderRadius: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    👤
                  </div>
                )}

                {/* Name + host badge + ready badge */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      style={{
                        fontFamily: "'Courier New', Courier, monospace",
                        fontSize: 12,
                        fontWeight: 700,
                        color: SAND_CREAM,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap" as const,
                        maxWidth: 100,
                      }}
                      title={member.displayName}
                    >
                      {member.displayName}
                    </span>
                    {isHost && (
                      <span
                        aria-label="Host"
                        title="Host"
                        style={{
                          fontSize: 11,
                          lineHeight: 1,
                        }}
                      >
                        👑
                      </span>
                    )}
                  </div>
                  <ReadyBadge
                    submitted={submitted}
                    displayName={member.displayName}
                  />
                </div>
              </div>
            );
          })}

          {members.length === 0 && (
            <p
              style={{
                margin: 0,
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 12,
                color: `${SAND_CREAM}60`,
              }}
            >
              No members yet
            </p>
          )}
        </div>
      </div>

      {/* -- Running budget bar (progressive: fills as flight/activities/itinerary costs are added) -- */}
      {runningSpend !== null && (
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `2px solid ${SAND_CREAM}20`,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <SectionLabel>Estimated Trip Cost</SectionLabel>
          <p
            style={{
              margin: "0 0 4px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 10,
              color: `${SAND_CREAM}70`,
              lineHeight: 1.5,
            }}
          >
            Based on destination, trip length, flight style, and planned activities.
          </p>
          <RunningBudgetBar estimate={runningSpend} />
        </div>
      )}

      {/* -- Budget status badge (always shown; "missing data" when not available) -- */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `2px solid ${SAND_CREAM}20`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <SectionLabel>Budget forecast</SectionLabel>
        {budgetEstimate !== null ? (
          <BudgetStatusBadge estimate={budgetEstimate} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p
              style={{
                margin: 0,
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 11,
                color: `${SAND_CREAM}70`,
                lineHeight: 1.5,
              }}
            >
              Available after destination + flight are chosen.
            </p>
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 14px",
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 11,
                color: `${SAND_CREAM}55`,
                lineHeight: 1.6,
              }}
            >
              <li>Vote on a destination</li>
              <li>Complete the flight vote</li>
            </ul>
          </div>
        )}
      </div>

      {/* -- Trip decisions summary -- */}
      <div
        style={{
          padding: "12px 16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: 10,
            fontWeight: 700,
            color: SAND_CREAM,
            opacity: 0.5,
            textTransform: "uppercase" as const,
            letterSpacing: "0.12em",
          }}
        >
          Trip Decisions
        </p>

        {/* Budget level */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Budget level</SectionLabel>
          <FieldValue
            value={budgetLabel ?? "Set in character creation"}
            notSet={!budgetLabel}
          />
        </div>

        <Divider />

        {/* Travel dates */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Travel dates</SectionLabel>
          <FieldValue
            value={travelDatesValue ?? "Submit availability to set"}
            notSet={!travelDatesValue}
          />
        </div>

        <Divider />

        {/* Travel vibes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Travel vibes</SectionLabel>
          <FieldValue
            value={travelVibesValue ?? "Pick vibes in availability step"}
            notSet={!travelVibesValue}
          />
        </div>

        <Divider />

        {/* Destination */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>
            {room.selectedDestination ? "Chosen destination" : "Destination shortlist"}
          </SectionLabel>
          <FieldValue
            value={destinationValue ?? "Vote on a destination first"}
            notSet={destinationValue === null}
          />
        </div>

        <Divider />

        {/* Flight option */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Flight style</SectionLabel>
          <FieldValue
            value={flightLabel ?? "Vote on a flight style to set"}
            notSet={!flightLabel}
          />
        </div>
      </div>
    </aside>
  );
}
