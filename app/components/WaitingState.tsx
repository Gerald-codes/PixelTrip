"use client";

/**
 * WaitingState — shown after the current user has submitted their response
 * for the current stage and is waiting for other members to catch up.
 *
 * Layout:
 *   1. User's own submitted selections (passed as ReactNode)
 *   2. Member status list — one ReadyBadge per member
 *   3. Optional "← Edit my response" button (only when onEditResponse is defined)
 *
 * Visual rules (pixel-art):
 *   - Deep navy background (#1E3A5F)
 *   - Sand cream text (#FEF3C7)
 *   - Zero border-radius (no rounded corners)
 *   - 2px solid #FEF3C7 outer border
 *   - 4px 4px 0 #000 outer box-shadow
 *   - Monospace font throughout
 *   - No white backgrounds
 *
 * Accessibility:
 *   - Sectioned with <section> and descriptive aria-labels
 *   - Edit button has explicit aria-label
 *
 * Palette:
 *   Deep navy    #1E3A5F  — background
 *   Sand cream   #FEF3C7  — text, border
 *   Black        #000000  — box-shadow offset
 *   Grass green  #4ADE80  — submitted badge (via ReadyBadge)
 *   Sunset orange #FB923C — pending badge (via ReadyBadge)
 */

import React from "react";
import ReadyBadge from "./ReadyBadge";

// ─── Prop types ───────────────────────────────────────────────────────────────

interface MemberStatus {
  userId: string;
  displayName: string;
  submitted: boolean;
}

interface WaitingStateProps {
  /** The user's own confirmed choices rendered above the member list. */
  submittedSelections: React.ReactNode;
  /** Per-member submission status used to render ReadyBadge rows. */
  memberStatuses: MemberStatus[];
  /** When defined, renders the "← Edit my response" button. */
  onEditResponse?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const DEEP_NAVY_DARK = "#0F2240"; // slightly darker for inner section separators
const MONOSPACE = "'Courier New', Courier, monospace";

// ─── Component ───────────────────────────────────────────────────────────────

export default function WaitingState({
  submittedSelections,
  memberStatuses,
  onEditResponse,
}: WaitingStateProps) {
  const submittedCount = memberStatuses.filter((m) => m.submitted).length;
  const totalCount = memberStatuses.length;
  const allDone = submittedCount === totalCount && totalCount > 0;

  return (
    <div
      style={{
        backgroundColor: DEEP_NAVY,
        color: SAND_CREAM,
        border: `2px solid ${SAND_CREAM}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 #000`,
        fontFamily: MONOSPACE,
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          borderBottom: `2px solid ${SAND_CREAM}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          backgroundColor: DEEP_NAVY_DARK,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontFamily: MONOSPACE,
            color: SAND_CREAM,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          ✔ Response submitted
        </span>

        {/* Progress indicator */}
        <span
          style={{
            fontSize: 12,
            fontFamily: MONOSPACE,
            color: allDone ? "#4ADE80" : "#FB923C",
            fontWeight: 600,
          }}
          aria-live="polite"
          aria-label={`${submittedCount} of ${totalCount} members submitted`}
        >
          {submittedCount}/{totalCount} ready
        </span>
      </div>

      {/* ── User's submitted selections ────────────────────────────────── */}
      <section
        aria-label="Your submitted response"
        style={{
          padding: "14px 16px",
          borderBottom: `2px solid ${SAND_CREAM}`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: MONOSPACE,
            color: SAND_CREAM,
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          Your selections
        </div>

        <div style={{ color: SAND_CREAM, fontFamily: MONOSPACE }}>
          {submittedSelections}
        </div>
      </section>

      {/* ── Member status list ─────────────────────────────────────────── */}
      <section
        aria-label="Member submission status"
        style={{
          padding: "14px 16px",
          borderBottom: onEditResponse ? `2px solid ${SAND_CREAM}` : undefined,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: MONOSPACE,
            color: SAND_CREAM,
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          {allDone ? "Everyone's ready!" : "Waiting for…"}
        </div>

        {memberStatuses.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              fontFamily: MONOSPACE,
              color: SAND_CREAM,
              opacity: 0.6,
              margin: 0,
            }}
          >
            No members found.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {memberStatuses.map((member) => (
              <div
                key={member.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ReadyBadge
                  submitted={member.submitted}
                  displayName={member.displayName}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Edit response button (optional) ───────────────────────────── */}
      {onEditResponse && (
        <div
          style={{
            padding: "12px 16px",
          }}
        >
          <button
            onClick={onEditResponse}
            aria-label="Edit my submitted response"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backgroundColor: "transparent",
              color: SAND_CREAM,
              border: `2px solid ${SAND_CREAM}`,
              borderRadius: 0,
              boxShadow: `2px 2px 0 #000`,
              padding: "6px 14px",
              fontFamily: MONOSPACE,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "box-shadow 0.1s ease, transform 0.1s ease",
              outline: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0px 0px 0 #000";
              (e.currentTarget as HTMLButtonElement).style.transform = "translate(2px, 2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "2px 2px 0 #000";
              (e.currentTarget as HTMLButtonElement).style.transform = "translate(0, 0)";
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = "3px solid #A855F7";
              e.currentTarget.style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
            }}
          >
            <span aria-hidden="true">←</span>
            <span>Edit my response</span>
          </button>
        </div>
      )}
    </div>
  );
}
