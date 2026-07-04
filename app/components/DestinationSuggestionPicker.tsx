"use client";

import { TravelVibe } from "@/lib/types";
import { VIBE_CHIPS } from "@/lib/vibeChips";

interface DestinationSuggestionPickerProps {
  selectedVibes: TravelVibe[];
  value: string[]; // selected destination chip names
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

/**
 * Derives the visible chip set as the deduplicated union of VIBE_CHIPS entries
 * for all non-'anywhere' selected vibes.
 */
function deriveChips(selectedVibes: TravelVibe[]): string[] {
  const seen = new Set<string>();
  const chips: string[] = [];

  for (const vibe of selectedVibes) {
    if (vibe === "anywhere") continue;
    const vibeKey = vibe as Exclude<TravelVibe, "anywhere">;
    for (const chip of VIBE_CHIPS[vibeKey] ?? []) {
      if (!seen.has(chip)) {
        seen.add(chip);
        chips.push(chip);
      }
    }
  }

  return chips;
}

export default function DestinationSuggestionPicker({
  selectedVibes,
  value,
  onChange,
  disabled = false,
}: DestinationSuggestionPickerProps) {
  // Return null when: selectedVibes is empty, OR contains ONLY 'anywhere'
  const nonAnywhereVibes = selectedVibes.filter((v) => v !== "anywhere");
  if (selectedVibes.length === 0 || nonAnywhereVibes.length === 0) {
    return null;
  }

  const chips = deriveChips(selectedVibes);

  function handleToggle(chip: string) {
    if (disabled) return;
    if (value.includes(chip)) {
      onChange(value.filter((c) => c !== chip));
    } else {
      onChange([...value, chip]);
    }
  }

  return (
    <div style={disabled ? { opacity: 0.5 } : undefined}>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isSelected = value.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => handleToggle(chip)}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={chip}
              style={{
                // NO border-radius — 8-bit square
                borderRadius: 0,
                // Selected: dark teal bg + sky-blue text + orange border
                // Unselected: card bg + muted text + subtle border
                backgroundColor: isSelected ? "#0D2D3F" : "var(--pt-bg-card)",
                color: isSelected ? "#38BDF8" : "var(--pt-text-secondary, #AFC5E6)",
                border: isSelected ? "2px solid #FB923C" : "2px solid var(--pt-border, #2F5E93)",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "6px 14px",
                fontFamily: "monospace",
                fontWeight: isSelected ? 700 : 600,
                fontSize: "0.875rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: isSelected ? "2px 2px 0 #081A33" : "none",
                outline: "none",
                transition: "background-color 0.1s, border-color 0.1s",
              }}
              className="focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#FB923C]"
            >
              {isSelected && (
                <span aria-hidden="true" style={{ fontSize: "0.75rem", color: "#FB923C", fontWeight: 900 }}>
                  ✓
                </span>
              )}
              {chip}
            </button>
          );
        })}
      </div>
    </div>
  );
}
