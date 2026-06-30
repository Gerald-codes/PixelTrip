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

import { deriveAvatarConfig, generatePersonaSummary } from "@/lib/avatarConfig";
import type {
  BudgetLevel,
  TravelStyle,
  TripInterest,
  Identity,
  CharacterProfile,
} from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface CharacterCreatorProps {
  identity: Identity;
  roomId: string;
  onConfirmed: (profile: CharacterProfile) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CharacterCreator({
  identity,
  roomId,
  onConfirmed,
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
            Confirm Character ✔
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
