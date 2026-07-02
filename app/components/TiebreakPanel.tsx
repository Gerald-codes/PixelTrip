"use client";

/**
 * TiebreakPanel — reusable tie-resolution UI.
 *
 * Used in VotingStage (destination + flight vote stages) and
 * TripAgentChat (flight tie inline panel).
 *
 * Flow:
 *   1. Mount → immediately calls /api/agents/tiebreak (auto, no button click).
 *   2. While generating → spinner with context-aware message.
 *   3. Agent returns → show conflict summary + resolution cards.
 *   4. Any member can select a card; host presses "Apply resolution".
 *   5. Resolved → show confirmation strip: decision + reason + accepted trade-off.
 *   6. Host override always visible as a secondary, clearly-labelled action.
 *
 * Props
 *   roomId        — needed to call /api/agents/tiebreak
 *   voteType      — "destination" | "flight" | "conflict_resolution"
 *   tiedOptions   — string[] of the tied option values
 *   tally         — Record<string, number> of vote counts
 *   isHost        — whether current viewer is the host
 *   onApply(resolvedValue: string) — called when host commits to a winner
 *   optionLabel(value: string) → string — human-readable label for an option value
 */

import React, { useEffect, useRef, useState } from "react";

// ─── Palette ──────────────────────────────────────────────────────────────────

const NAVY = "#1E3A5F";
const CREAM = "#FEF3C7";
const ORANGE = "#FB923C";
const GREEN = "#4ADE80";
const PURPLE = "#A855F7";
const SKY = "#38BDF8";
const RED = "#EF4444";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TieOption {
  id: string;
  description: string;
  tradeoffs: string;
}

type Phase = "generating" | "voting" | "applying" | "resolved" | "error";

interface ResolvedInfo {
  value: string;
  optionDescription: string;
  tradeoff: string;
  wasOverride: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TiebreakPanelProps {
  roomId: string;
  voteType: "destination" | "flight" | "conflict_resolution";
  tiedOptions: string[];
  tally: Record<string, number>;
  isHost: boolean;
  onApply: (resolvedValue: string) => Promise<void>;
  /** Convert an internal option value to a display label. */
  optionLabel?: (value: string) => string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultLabel(value: string): string {
  const MAP: Record<string, string> = {
    budget: "Budget Flights",
    best_value: "Best Value",
    comfort: "Comfort",
  };
  return MAP[value] ?? value;
}

/**
 * Derive which original tied value a resolution option id maps to.
 * e.g. "pick_budget" → "budget", "go_with_comfort" → "comfort"
 * Falls back to the first tied option if no match found.
 */
function resolveValue(optionId: string, tiedOptions: string[]): string {
  const clean = optionId.toLowerCase().replace(/[^a-z_]/g, "");
  const match = tiedOptions.find((o) =>
    clean.includes(o.toLowerCase().replace(/[^a-z]/g, "")),
  );
  return match ?? tiedOptions[0];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 6px 0",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: NAVY,
        opacity: 0.55,
        fontFamily: "monospace",
      }}
    >
      {children}
    </p>
  );
}

function VoteCountChip({ label, count }: { label: string; count: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `2px solid ${NAVY}`,
        backgroundColor: CREAM,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "monospace",
        color: NAVY,
        boxShadow: `2px 2px 0 ${NAVY}`,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          backgroundColor: ORANGE,
          border: `1px solid ${NAVY}`,
          padding: "0 5px",
          fontSize: 11,
        }}
      >
        {count} vote{count !== 1 ? "s" : ""}
      </span>
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TiebreakPanel({
  roomId,
  voteType,
  tiedOptions,
  tally,
  isHost,
  onApply,
  optionLabel = defaultLabel,
}: TiebreakPanelProps) {
  const [phase, setPhase] = useState<Phase>("generating");
  const [conflictSummary, setConflictSummary] = useState<string>("");
  const [tieOptions, setTieOptions] = useState<TieOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedInfo | null>(null);

  // Fire the agent automatically on mount — one attempt only.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void generateOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateOptions() {
    setPhase("generating");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/agents/tiebreak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, voteType, tiedOptions, tally }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        conflictSummary: string;
        proposedOptions: TieOption[];
      };
      setConflictSummary(data.conflictSummary);
      setTieOptions(data.proposedOptions);
      setPhase("voting");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load resolution options.");
      setPhase("error");
    }
  }

  async function applyResolution(optionId: string, isOverride = false) {
    if (applying) return;
    const opt = tieOptions.find((o) => o.id === optionId);
    const resolvedValue = resolveValue(optionId, tiedOptions);
    setApplying(true);
    setPhase("applying");
    try {
      await onApply(resolvedValue);
      setResolved({
        value: resolvedValue,
        optionDescription: opt?.description ?? optionLabel(resolvedValue),
        tradeoff: opt?.tradeoffs ?? "",
        wasOverride: isOverride,
      });
      setPhase("resolved");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to apply resolution.");
      setPhase("voting"); // let them retry
    } finally {
      setApplying(false);
    }
  }

  async function applyOverride(value: string) {
    if (applying) return;
    setApplying(true);
    setPhase("applying");
    try {
      await onApply(value);
      setResolved({
        value,
        optionDescription: optionLabel(value),
        tradeoff: "",
        wasOverride: true,
      });
      setPhase("resolved");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to apply override.");
      setPhase("voting");
    } finally {
      setApplying(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        border: `4px solid ${ORANGE}`,
        backgroundColor: "#FFFBEB",
        boxShadow: `4px 4px 0 ${NAVY}`,
        fontFamily: "monospace",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          backgroundColor: ORANGE,
          borderBottom: `4px solid ${NAVY}`,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>⚖️</span>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>
            Decision tie
          </p>
          <p style={{ margin: 0, fontSize: 11, color: NAVY, opacity: 0.75 }}>
            Your group is equally split. Let the AI analyze the options — the host will break the tie.
          </p>
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Tie breakdown: show who voted for what ── */}
        <div>
          <SectionLabel>Current votes</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tiedOptions.map((opt) => (
              <VoteCountChip
                key={opt}
                label={optionLabel(opt)}
                count={tally[opt] ?? 0}
              />
            ))}
          </div>
        </div>

        {/* ── Phase: generating ── */}
        {phase === "generating" && (
          <div
            style={{
              border: `2px solid ${SKY}`,
              backgroundColor: "#EFF6FF",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>🔄</span>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY }}>
                The AI is reviewing your group&apos;s situation…
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 11, color: NAVY, opacity: 0.65 }}>
                It will explain the trade-offs and suggest a fair path forward.
              </p>
            </div>
          </div>
        )}

        {/* ── Phase: applying ── */}
        {phase === "applying" && (
          <p style={{ margin: 0, fontSize: 13, color: NAVY, fontWeight: 600 }}>
            ⏳ Applying resolution…
          </p>
        )}

        {/* ── Phase: error ── */}
        {phase === "error" && (
          <div
            style={{
              border: `2px solid ${RED}`,
              backgroundColor: "#FEF2F2",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: RED }}>
              ⚠ Couldn&apos;t load AI recommendations
            </p>
            <p style={{ margin: 0, fontSize: 12, color: NAVY }}>{errorMsg}</p>
            {isHost && (
              <button
                type="button"
                onClick={() => {
                  firedRef.current = false;
                  void generateOptions();
                }}
                style={{
                  alignSelf: "flex-start",
                  border: `2px solid ${NAVY}`,
                  backgroundColor: SKY,
                  color: NAVY,
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: `2px 2px 0 ${NAVY}`,
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* ── Phase: voting — show AI summary + resolution cards ── */}
        {(phase === "voting" || phase === "applying") && tieOptions.length > 0 && (
          <>
            {/* AI conflict summary */}
            <div
              style={{
                border: `2px solid ${PURPLE}`,
                backgroundColor: "#FAF5FF",
                padding: "10px 14px",
              }}
            >
              <SectionLabel>AI analysis</SectionLabel>
              <p style={{ margin: 0, fontSize: 13, color: NAVY, lineHeight: 1.55 }}>
                {conflictSummary}
              </p>
            </div>

            {/* Resolution option cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SectionLabel>
                {isHost ? "Resolution options — pick one to apply" : "Resolution options — waiting for host to decide"}
              </SectionLabel>
              {tieOptions.map((opt) => {
                const isSel = selected === opt.id;
                // Members see read-only cards; only the host can select
                if (!isHost) {
                  return (
                    <div
                      key={opt.id}
                      style={{
                        border: `3px solid ${NAVY}`,
                        backgroundColor: CREAM,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        boxShadow: `2px 2px 0 ${NAVY}`,
                        opacity: 0.85,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                        {opt.description}
                      </span>
                      {opt.tradeoffs && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: 11,
                            color: NAVY,
                            opacity: 0.65,
                            lineHeight: 1.45,
                          }}
                        >
                          Trade-off: {opt.tradeoffs}
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelected(isSel ? null : opt.id)}
                    disabled={phase === "applying"}
                    aria-pressed={isSel}
                    style={{
                      border: `3px solid ${isSel ? GREEN : NAVY}`,
                      backgroundColor: isSel ? "#F0FDF4" : CREAM,
                      padding: "12px 14px",
                      textAlign: "left",
                      cursor: phase === "applying" ? "not-allowed" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      boxShadow: isSel ? `0 0 0 2px ${GREEN}` : `2px 2px 0 ${NAVY}`,
                      transition: "border-color 0.1s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {isSel && (
                        <span style={{ color: GREEN, fontWeight: 700, fontSize: 14 }}>✓</span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                        {opt.description}
                      </span>
                    </div>
                    {opt.tradeoffs && (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: NAVY,
                          opacity: 0.65,
                          lineHeight: 1.45,
                          paddingLeft: isSel ? 20 : 0,
                        }}
                      >
                        Trade-off: {opt.tradeoffs}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Apply button (host only) */}
            {isHost && (
              <div
                style={{
                  borderTop: `2px dashed ${NAVY}`,
                  paddingTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => selected && void applyResolution(selected)}
                  disabled={!selected || applying}
                  style={{
                    alignSelf: "flex-start",
                    border: `3px solid ${NAVY}`,
                    backgroundColor: selected && !applying ? GREEN : "#9CA3AF",
                    color: NAVY,
                    padding: "9px 20px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: selected && !applying ? "pointer" : "not-allowed",
                    boxShadow: selected && !applying ? `3px 3px 0 ${NAVY}` : "none",
                    transition: "background-color 0.1s",
                  }}
                >
                  {applying ? "Applying…" : "✓ Apply resolution"}
                </button>
                {!selected && (
                  <p style={{ margin: 0, fontSize: 11, color: NAVY, opacity: 0.55 }}>
                    Select an option above to continue.
                  </p>
                )}

                {/* Host override — always available, clearly marked */}
                <details style={{ marginTop: 4 }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 11,
                      color: NAVY,
                      opacity: 0.5,
                      userSelect: "none",
                    }}
                  >
                    👑 Host override (skip AI recommendation)
                  </summary>
                  <div
                    style={{
                      marginTop: 8,
                      border: `2px solid ${ORANGE}`,
                      backgroundColor: "#FFF7ED",
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: NAVY, opacity: 0.7 }}>
                      ⚠ This overrides the group vote. Use only if the group is stuck.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {tiedOptions.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => void applyOverride(opt)}
                          disabled={applying}
                          style={{
                            border: `2px solid ${NAVY}`,
                            backgroundColor: ORANGE,
                            color: NAVY,
                            padding: "5px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: applying ? "not-allowed" : "pointer",
                            boxShadow: `2px 2px 0 ${NAVY}`,
                            opacity: applying ? 0.6 : 1,
                          }}
                        >
                          Choose {optionLabel(opt)}
                        </button>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* Non-host waiting copy */}
            {!isHost && (
              <div
                style={{
                  borderTop: `2px dashed ${NAVY}`,
                  paddingTop: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 16 }}>👑</span>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: NAVY, opacity: 0.7 }}>
                  Only the host can break this tie. Waiting for their decision…
                </p>
              </div>
            )}

            {errorMsg && phase === "voting" && (
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: RED }}>
                ⚠ {errorMsg}
              </p>
            )}
          </>
        )}

        {/* ── Phase: resolved — show outcome summary ── */}
        {phase === "resolved" && resolved && (
          <div
            style={{
              border: `3px solid ${GREEN}`,
              backgroundColor: "#F0FDF4",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY }}>
              ✅ Decision made: {optionLabel(resolved.value)}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: NAVY }}>
              <strong>Why:</strong> {resolved.optionDescription}
            </p>
            {resolved.tradeoff && (
              <p style={{ margin: 0, fontSize: 11, color: NAVY, opacity: 0.7 }}>
                <strong>Accepted trade-off:</strong> {resolved.tradeoff}
              </p>
            )}
            {resolved.wasOverride && (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  fontWeight: 700,
                  color: ORANGE,
                  borderLeft: `3px solid ${ORANGE}`,
                  paddingLeft: 8,
                }}
              >
                👑 Host override — the host chose this directly.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
