"use client";

import { TripInterest } from "@/lib/types";

interface MultiInterestSelectorProps {
  value: TripInterest[];
  onChange: (v: TripInterest[]) => void;
  disabled?: boolean;
}

const INTEREST_CHIPS: { interest: TripInterest; label: string; emoji: string }[] = [
  { interest: "food",        label: "Food",        emoji: "🍜" },
  { interest: "scenery",     label: "Scenery",     emoji: "📷" },
  { interest: "adventure",   label: "Adventure",   emoji: "🏔" },
  { interest: "shopping",    label: "Shopping",    emoji: "🛍" },
  { interest: "nightlife",   label: "Nightlife",   emoji: "🌙" },
  { interest: "culture",     label: "Culture",     emoji: "🏛" },
  { interest: "relaxation",  label: "Relaxation",  emoji: "🎧" },
  { interest: "hidden_gems", label: "Hidden Gems", emoji: "💎" },
  { interest: "flexible",    label: "Flexible",    emoji: "🗺" },
];

export default function MultiInterestSelector({
  value,
  onChange,
  disabled = false,
}: MultiInterestSelectorProps) {
  function handleToggle(interest: TripInterest) {
    if (disabled) return;
    if (value.includes(interest)) {
      onChange(value.filter((i) => i !== interest));
    } else {
      onChange([...value, interest]);
    }
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {INTEREST_CHIPS.map(({ interest, label, emoji }) => {
        const isSelected = value.includes(interest);
        return (
          <button
            key={interest}
            type="button"
            onClick={() => handleToggle(interest)}
            disabled={disabled}
            aria-pressed={isSelected}
            aria-label={`${label} ${emoji}`}
            style={{
              // No border-radius — 8-bit square
              borderRadius: 0,
              // Selected: grass-green bg + deep-navy text + 2px sunset-orange border
              // Unselected: sand-cream bg + deep-navy text + 2px deep-navy border
              backgroundColor: isSelected ? "#4ADE80" : "#FEF3C7",
              color: "#1E3A5F",
              border: isSelected ? "2px solid #FB923C" : "2px solid #1E3A5F",
              cursor: disabled ? "not-allowed" : "pointer",
              padding: "6px 12px",
              fontFamily: "monospace",
              fontWeight: 600,
              fontSize: "0.875rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              // Subtle box-shadow for 8-bit feel
              boxShadow: isSelected
                ? "2px 2px 0px #1E3A5F"
                : "2px 2px 0px #1E3A5F",
              outline: "none",
              transition: "background-color 0.1s, border-color 0.1s",
            }}
            className="focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#FB923C]"
          >
            <span aria-hidden="true">{emoji}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
