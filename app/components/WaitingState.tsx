"use client";

/**
 * WaitingState — shown after the current user has submitted their response
 * for the current stage and is waiting for other members to catch up.
 *
 * Dark theme version — uses card background with subtle borders.
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
  submittedSelections: React.ReactNode;
  memberStatuses: MemberStatus[];
  onEditResponse?: () => void;
}

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
        backgroundColor: "var(--pt-bg-card)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        fontFamily: "var(--pt-font-body)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--pt-success)",
          }}
        >
          ✓ Response submitted
        </span>
        <span
          style={{
            fontSize: 11,
            color: allDone ? "var(--pt-success)" : "var(--pt-warn)",
            fontWeight: 500,
          }}
          aria-live="polite"
        >
          {submittedCount}/{totalCount} ready
        </span>
      </div>

      {/* User selections */}
      <section
        aria-label="Your submitted response"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--pt-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Your selections
        </div>
        <div style={{ color: "var(--pt-text-primary)" }}>
          {submittedSelections}
        </div>
      </section>

      {/* Member status */}
      <section
        aria-label="Member submission status"
        style={{
          padding: "12px 16px",
          borderBottom: onEditResponse ? "1px solid rgba(255,255,255,0.06)" : undefined,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--pt-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          {allDone ? "Everyone's ready!" : "Waiting for…"}
        </div>

        {memberStatuses.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--pt-text-muted)", margin: 0 }}>
            No members found.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {memberStatuses.map((member) => (
              <div key={member.userId} style={{ display: "flex", alignItems: "center" }}>
                <ReadyBadge submitted={member.submitted} displayName={member.displayName} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Edit button */}
      {onEditResponse && (
        <div style={{ padding: "10px 16px" }}>
          <button
            onClick={onEditResponse}
            aria-label="Edit my submitted response"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backgroundColor: "transparent",
              color: "var(--pt-text-muted)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6,
              padding: "6px 12px",
              fontFamily: "var(--pt-font-body)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              transition: "border-color 0.15s",
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
