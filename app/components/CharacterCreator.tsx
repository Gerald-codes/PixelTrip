"use client";

/**
 * CharacterCreator — composes BudgetSelector, TravelStyleSelector,
 * MultiInterestSelector, PixelAvatar, and InterestBadge into a unified
 * character creation UI.
 *
 * Layout:
 *   - Desktop (md+): two columns — left = avatar preview, right = selectors
 *   - Mobile: single column stacked
 *
 * chatMode=true: sequential chat step layout (steps revealed one at a time,
 * sticky avatar preview at top, InteractiveSlot per step).
 *
 * Palette:
 *   Sky blue     #38BDF8
 *   Sunset orange #FB923C
 *   Sand cream   #FEF3C7
 *   Grass green  #4ADE80
 *   Deep navy    #1E3A5F
 *   Neon purple  #A855F7
 */

import React, { useState } from "react";

import BudgetSelector from "./BudgetSelector";
import TravelStyleSelector from "./TravelStyleSelector";
import MultiInterestSelector from "./MultiInterestSelector";
import PixelAvatar from "./PixelAvatar";
import InterestBadge from "./InterestBadge";
import InteractiveSlot from "./InteractiveSlot";

import { deriveAvatarConfig, generatePersonaSummary } from "@/lib/avatarConfig";
import type {
  BudgetLevel,
  TravelStyle,
  TripInterest,
  AvatarConfig,
  Identity,
  CharacterProfile,
} from "@/lib/types";

// ─── Palette constants ────────────────────────────────────────────────────────

const MONO = "'Courier New', Courier, monospace";

// ─── Chat-mode data ───────────────────────────────────────────────────────────

interface BudgetOption {
  value: BudgetLevel;
  label: string;
  description: string;
  colour: string;
}

const BUDGET_OPTIONS: BudgetOption[] = [
  {
    value: "low",
    label: "Low Budget",
    description: "Hostels, street food, and adventure on the cheap",
    colour: "#4ADE80",
  },
  {
    value: "medium",
    label: "Medium Budget",
    description: "Comfortable hotels, mix of dining, and a few splurges",
    colour: "#38BDF8",
  },
  {
    value: "high",
    label: "High Budget",
    description: "Premium stays, fine dining, and business-class comfort",
    colour: "#A855F7",
  },
];

interface StyleOption {
  value: TravelStyle;
  label: string;
  description: string;
  emoji: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: "leader",
    label: "Leader",
    description: "Takes charge, drives decisions, sets the agenda",
    emoji: "👑",
  },
  {
    value: "planner",
    label: "Planner",
    description: "Researches everything, makes spreadsheets, loves itineraries",
    emoji: "📋",
  },
  {
    value: "follower",
    label: "Follower",
    description: "Goes with the flow, happy to join whatever the group decides",
    emoji: "🌿",
  },
  {
    value: "chill",
    label: "Chill",
    description: "Slow mornings, no rush, vibes over schedules",
    emoji: "🎧",
  },
  {
    value: "adventurer",
    label: "Adventurer",
    description: "Seeks the thrill, off the beaten path, always up for more",
    emoji: "🧭",
  },
];

interface InterestOption {
  value: TripInterest;
  label: string;
  emoji: string;
}

const INTEREST_OPTIONS: InterestOption[] = [
  { value: "food", label: "Food", emoji: "🧋" },
  { value: "scenery", label: "Scenery", emoji: "📷" },
  { value: "adventure", label: "Adventure", emoji: "🥾" },
  { value: "shopping", label: "Shopping", emoji: "🛍️" },
  { value: "nightlife", label: "Nightlife", emoji: "🌃" },
  { value: "culture", label: "Culture", emoji: "📖" },
  { value: "relaxation", label: "Relaxation", emoji: "🎵" },
  { value: "hidden_gems", label: "Hidden Gems", emoji: "🧭" },
  { value: "flexible", label: "Flexible", emoji: "🗺️" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface CharacterCreatorProps {
  identity: Identity;
  roomId: string;
  onConfirmed: (profile: CharacterProfile) => void;
  /**
   * When `true`, the component will render a sequential chat-step layout.
   * When `false` (default), the existing two-column desktop layout is rendered
   * pixel-perfect unchanged.
   */
  chatMode?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CharacterCreator({
  identity,
  roomId,
  onConfirmed,
  chatMode = false,
}: CharacterCreatorProps) {
  // ── Internal state ──────────────────────────────────────────────────────────
  const [budget, setBudget] = useState<BudgetLevel | null>(null);
  const [travelStyle, setTravelStyle] = useState<TravelStyle | null>(null);
  const [interests, setInterests] = useState<TripInterest[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Derived avatar + summary (reactive — no debounce needed) ────────────────
  const allSelected =
    budget !== null && travelStyle !== null && interests.length > 0;

  const derivedConfig = allSelected
    ? deriveAvatarConfig(budget!, travelStyle!, interests[0])
    : null;

  const personaSummary = allSelected
    ? generatePersonaSummary(budget!, travelStyle!, interests, identity.displayName)
    : null;

  // Secondary interests: interests[1], interests[2], …
  const secondaryInterests = interests.slice(1);

  // ── Chat-mode: compute live avatar config for partial selections ────────────
  // This allows the avatar to update as soon as each step is selected,
  // even before all three steps are complete (budget only → outfit shows up, etc.).
  const chatAvatarConfig: AvatarConfig = {
    baseBody: "default",
    outfit: budget ? (budget === "low" ? "backpacker" : budget === "medium" ? "casual" : "luxury") : "backpacker",
    headwear: travelStyle
      ? { leader: "captain_hat", planner: "cap_glasses", follower: "villager_hat", chill: "beanie", adventurer: "explorer_hat" }[travelStyle]
      : "cap_glasses",
    handheldItem: interests.length > 0
      ? { food: "bubble_tea", scenery: "camera", adventure: "hiking_stick", shopping: "shopping_bag", nightlife: "neon_cup", culture: "guidebook", relaxation: "headphones", hidden_gems: "compass", flexible: "map" }[interests[0]] ?? "map"
      : "map",
  };

  // ── Confirm handler ─────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!budget || !travelStyle || interests.length === 0 || saving) return;

    setSaving(true);
    setSaveError(null);

    // Build planningWeights: equal weight per interest
    const weight = 1 / interests.length;
    const planningWeights: Record<string, number> = {};
    for (const interest of interests) {
      planningWeights[interest] = weight;
    }

    const avatarConfig = deriveAvatarConfig(budget, travelStyle, interests[0]);
    const generatedPersonaName = generatePersonaSummary(
      budget,
      travelStyle,
      interests,
      identity.displayName
    );

    try {
      const res = await fetch("/api/character-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: identity.userId,
          roomId,
          displayName: identity.displayName,
          budgetLevel: budget,
          travelStyle,
          tripInterests: interests,
          avatarConfig,
          generatedPersonaName,
          planningWeights,
        }),
      });

      if (res.status === 200 || res.status === 201) {
        const profile: CharacterProfile = await res.json();
        // Do NOT reset form state — spec 4.13 / step 6
        onConfirmed(profile);
      } else {
        setSaveError("Failed to save character. Please try again.");
      }
    } catch {
      setSaveError("Failed to save character. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Button state ─────────────────────────────────────────────────────────────
  const confirmDisabled =
    budget === null || travelStyle === null || interests.length === 0 || saving;

  // ── Chat-mode render branch ───────────────────────────────────────────────────
  if (chatMode) {
    const step2Visible = budget !== null;
    const step3Visible = budget !== null && travelStyle !== null;
    const confirmVisible = budget !== null && travelStyle !== null && interests.length > 0;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          fontFamily: MONO,
          width: "100%",
        }}
      >
        {/* ── Sticky avatar preview ───────────────────────────────────────── */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            backgroundColor: "#1E3A5F",
            border: "2px solid #38BDF8",
            boxShadow: "4px 4px 0 #38BDF8",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <PixelAvatar avatarConfig={chatAvatarConfig} size="md" />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <p style={{ color: "#FEF3C7", fontSize: "11px", margin: 0, fontFamily: MONO }}>
              Your travel character
            </p>
            {allSelected && personaSummary ? (
              <p
                style={{
                  color: "#4ADE80",
                  fontSize: "10px",
                  margin: 0,
                  fontFamily: MONO,
                  lineHeight: 1.5,
                  maxWidth: "220px",
                }}
              >
                {personaSummary}
              </p>
            ) : (
              <p
                style={{
                  color: "#38BDF8",
                  fontSize: "10px",
                  margin: 0,
                  fontFamily: MONO,
                  opacity: 0.7,
                }}
              >
                {!budget
                  ? "Pick your budget to begin"
                  : !travelStyle
                  ? "Now pick your travel style"
                  : interests.length === 0
                  ? "Pick at least one interest"
                  : "Ready to confirm!"}
              </p>
            )}
            {/* Secondary interest badges */}
            {interests.length > 1 && (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                {interests.slice(1).map((interest) => (
                  <InterestBadge key={interest} interest={interest} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Step 1: Budget ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p
            style={{
              color: "#FEF3C7",
              fontSize: "12px",
              fontFamily: MONO,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
              paddingLeft: "2px",
            }}
          >
            Step 1 — Choose your budget
          </p>
          <InteractiveSlot isSaving={saving}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {BUDGET_OPTIONS.map((opt) => {
                const isSelected = budget === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`Budget: ${opt.label}. ${opt.description}`}
                    onClick={() => setBudget(opt.value)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "4px",
                      padding: "12px 14px",
                      border: isSelected ? `3px solid ${opt.colour}` : "2px solid #1E3A5F",
                      backgroundColor: isSelected ? "#1E3A5F" : "#FEF3C7",
                      boxShadow: isSelected ? `4px 4px 0 ${opt.colour}` : "2px 2px 0 #1E3A5F",
                      borderRadius: 0,
                      cursor: "pointer",
                      fontFamily: MONO,
                      textAlign: "left",
                      width: "100%",
                      transition: "box-shadow 0.08s, border-color 0.08s",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.outline = "3px solid #A855F7";
                      e.currentTarget.style.outlineOffset = "2px";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.outline = "none";
                    }}
                  >
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: isSelected ? opt.colour : "#1E3A5F",
                        fontFamily: MONO,
                      }}
                    >
                      {isSelected ? "✔ " : ""}{opt.label}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: isSelected ? "#FEF3C7" : "#1E3A5F",
                        opacity: isSelected ? 0.9 : 0.7,
                        fontFamily: MONO,
                      }}
                    >
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </InteractiveSlot>
        </div>

        {/* ── Step 2: Travel Style (revealed after budget selected) ────────── */}
        {step2Visible && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p
              style={{
                color: "#FEF3C7",
                fontSize: "12px",
                fontFamily: MONO,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: 0,
                paddingLeft: "2px",
              }}
            >
              Step 2 — What role do you play in a group trip?
            </p>
            <InteractiveSlot isSaving={saving}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {STYLE_OPTIONS.map((opt) => {
                  const isSelected = travelStyle === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="button"
                      aria-pressed={isSelected}
                      aria-label={`Travel style: ${opt.label}. ${opt.description}`}
                      onClick={() => setTravelStyle(opt.value)}
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px 14px",
                        border: isSelected ? "3px solid #FB923C" : "2px solid #1E3A5F",
                        backgroundColor: isSelected ? "#1E3A5F" : "#FEF3C7",
                        boxShadow: isSelected ? "4px 4px 0 #FB923C" : "2px 2px 0 #1E3A5F",
                        borderRadius: 0,
                        cursor: "pointer",
                        fontFamily: MONO,
                        textAlign: "left",
                        width: "100%",
                        transition: "box-shadow 0.08s, border-color 0.08s",
                        outline: "none",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = "3px solid #A855F7";
                        e.currentTarget.style.outlineOffset = "2px";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = "none";
                      }}
                    >
                      <span style={{ fontSize: "20px" }} aria-hidden="true">{opt.emoji}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: isSelected ? "#FB923C" : "#1E3A5F",
                            fontFamily: MONO,
                          }}
                        >
                          {isSelected ? "✔ " : ""}{opt.label}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            color: isSelected ? "#FEF3C7" : "#1E3A5F",
                            opacity: isSelected ? 0.9 : 0.7,
                            fontFamily: MONO,
                          }}
                        >
                          {opt.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </InteractiveSlot>
          </div>
        )}

        {/* ── Step 3: Interests (revealed after travel style selected) ─────── */}
        {step3Visible && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p
              style={{
                color: "#FEF3C7",
                fontSize: "12px",
                fontFamily: MONO,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: 0,
                paddingLeft: "2px",
              }}
            >
              Step 3 — What do you want most from this trip? Pick as many as you like.
            </p>
            <InteractiveSlot isSaving={saving}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
                role="group"
                aria-label="Trip interests — select one or more"
              >
                {INTEREST_OPTIONS.map((opt) => {
                  const isSelected = interests.includes(opt.value as TripInterest);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Interest: ${opt.label}`}
                      onClick={() => {
                        setInterests((prev) => {
                          const v = opt.value as TripInterest;
                          return prev.includes(v)
                            ? prev.filter((i) => i !== v)
                            : [...prev, v];
                        });
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 12px",
                        border: isSelected ? "3px solid #4ADE80" : "2px solid #1E3A5F",
                        backgroundColor: isSelected ? "#1E3A5F" : "#FEF3C7",
                        boxShadow: isSelected ? "3px 3px 0 #4ADE80" : "2px 2px 0 #1E3A5F",
                        borderRadius: 0,
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: "12px",
                        fontWeight: isSelected ? 700 : 400,
                        color: isSelected ? "#4ADE80" : "#1E3A5F",
                        transition: "box-shadow 0.08s, border-color 0.08s",
                        outline: "none",
                        whiteSpace: "nowrap",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = "3px solid #A855F7";
                        e.currentTarget.style.outlineOffset = "2px";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = "none";
                      }}
                    >
                      <span aria-hidden="true">{opt.emoji}</span>
                      <span>{isSelected ? "✔ " : ""}{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </InteractiveSlot>
          </div>
        )}

        {/* ── Confirm button (revealed when ≥1 interest selected) ─────────── */}
        {confirmVisible && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              aria-disabled={saving}
              style={{
                borderRadius: 0,
                border: "2px solid #1E3A5F",
                padding: "14px 28px",
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: "14px",
                letterSpacing: "0.05em",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.5 : 1,
                backgroundColor: saving ? "#9CA3AF" : "#FB923C",
                color: "#1E3A5F",
                boxShadow: saving ? "none" : "4px 4px 0px #1E3A5F",
                alignSelf: "flex-start",
                transition: "opacity 0.1s",
              }}
              onFocus={(e) => {
                if (!saving) {
                  e.currentTarget.style.outline = "3px solid #A855F7";
                  e.currentTarget.style.outlineOffset = "2px";
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              ✔ Confirm
            </button>

            {/* Inline error for chat mode */}
            {saveError !== null && (
              <div
                role="alert"
                style={{
                  border: "2px solid #EF4444",
                  padding: "10px 14px",
                  backgroundColor: "#1E3A5F",
                  color: "#FEF3C7",
                  fontSize: "12px",
                  fontFamily: MONO,
                  lineHeight: 1.5,
                  borderRadius: 0,
                  boxShadow: "3px 3px 0 #EF4444",
                }}
              >
                ⚠ {saveError}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col md:flex-row gap-6 w-full"
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      {/* ── LEFT PANE: Avatar Preview ────────────────────────────────────────── */}
      <div
        className="flex flex-col items-center gap-4 p-6"
        style={{
          border: "2px solid #1E3A5F",
          backgroundColor: "#FEF3C7",
          minWidth: "220px",
          flex: "0 0 auto",
        }}
      >
        {/* Avatar or placeholder */}
        {derivedConfig ? (
          <div className="flex flex-col items-center gap-3">
            <PixelAvatar avatarConfig={derivedConfig} size="lg" />

            {/* Secondary interest badges */}
            {secondaryInterests.length > 0 && (
              <div
                className="flex flex-row gap-1 flex-wrap justify-center"
                aria-label="Secondary interests"
              >
                {secondaryInterests.map((interest) => (
                  <InterestBadge key={interest} interest={interest} />
                ))}
              </div>
            )}

            {/* Persona summary */}
            {personaSummary && (
              <p
                style={{
                  color: "#1E3A5F",
                  fontSize: "11px",
                  textAlign: "center",
                  lineHeight: 1.5,
                  maxWidth: "180px",
                }}
              >
                {personaSummary}
              </p>
            )}
          </div>
        ) : (
          /* Placeholder when not all selections made yet */
          <div
            className="flex flex-col items-center justify-center gap-2"
            style={{
              width: "96px",
              height: "144px",
              backgroundColor: "#9CA3AF",
              border: "2px solid #1E3A5F",
            }}
          >
            <span
              style={{
                color: "#FEF3C7",
                fontSize: "10px",
                textAlign: "center",
                padding: "8px",
                lineHeight: 1.4,
              }}
            >
              Pick your character
            </span>
          </div>
        )}

        {/* Section label */}
        <p
          style={{
            color: "#1E3A5F",
            fontSize: "10px",
            opacity: 0.6,
            textAlign: "center",
          }}
        >
          Your travel character
        </p>
      </div>

      {/* ── RIGHT PANE: Selectors ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6 flex-1">
        {/* Budget */}
        <div className="flex flex-col gap-2">
          <h3
            style={{
              color: "#1E3A5F",
              fontSize: "13px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Choose Your Budget
          </h3>
          <BudgetSelector
            value={budget}
            onChange={setBudget}
            disabled={saving}
          />
        </div>

        {/* Travel Style */}
        <div className="flex flex-col gap-2">
          <h3
            style={{
              color: "#1E3A5F",
              fontSize: "13px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Pick Your Travel Style
          </h3>
          <TravelStyleSelector
            value={travelStyle}
            onChange={setTravelStyle}
            disabled={saving}
          />
        </div>

        {/* Interests */}
        <div className="flex flex-col gap-2">
          <h3
            style={{
              color: "#1E3A5F",
              fontSize: "13px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            What Are You Into?
          </h3>
          <MultiInterestSelector
            value={interests}
            onChange={setInterests}
            disabled={saving}
          />
        </div>

        {/* Confirm button */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            aria-disabled={confirmDisabled}
            style={{
              // No border-radius — 8-bit aesthetic
              borderRadius: 0,
              border: "2px solid #1E3A5F",
              padding: "12px 24px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "14px",
              letterSpacing: "0.05em",
              cursor: confirmDisabled ? "not-allowed" : "pointer",
              opacity: confirmDisabled ? 0.5 : 1,
              // Enabled: sunset-orange bg + deep-navy text + deep-navy shadow
              backgroundColor: confirmDisabled ? "#9CA3AF" : "#FB923C",
              color: "#1E3A5F",
              boxShadow: confirmDisabled ? "none" : "4px 4px 0px #1E3A5F",
              transition: "opacity 0.1s",
              alignSelf: "flex-start",
            }}
          >
            ✔ Confirm Character
          </button>

          {/* Inline error */}
          {saveError !== null && (
            <div
              role="alert"
              style={{
                border: "2px solid #FB923C",
                padding: "10px 14px",
                backgroundColor: "#FFF7ED",
                color: "#1E3A5F",
                fontSize: "12px",
                fontFamily: "'Courier New', Courier, monospace",
                lineHeight: 1.5,
                borderRadius: 0,
              }}
            >
              {saveError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
