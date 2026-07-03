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
                // Selected: grass-green bg + deep-navy text + 2px sunset-orange border
                // Unselected: sand-cream bg + deep-navy text + 2px deep-navy border
                backgroundColor: isSelected ? "#4ADE80" : "var(--pt-bg-card)",
                color: "var(--pt-text-primary, #E8ECF1)",
                border: isSelected ? "2px solid #FB923C" : "2px solid rgba(232, 236, 241, 0.2)",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "6px 12px",
                fontFamily: "monospace",
                fontWeight: 600,
                fontSize: "0.875rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                outline: "none",
                transition: "background-color 0.1s, border-color 0.1s",
              }}
              className="focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#FB923C]"
            >
              {isSelected && (
                <span aria-hidden="true" style={{ fontSize: "0.75rem" }}>
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
