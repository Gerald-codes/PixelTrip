"use client";

import { useState, KeyboardEvent } from "react";

interface CustomDestinationInputProps {
  /** Current list of custom destination strings. */
  value: string[];
  /** Called with the updated list whenever entries are added or removed. */
  onChange: (v: string[]) => void;
}

const MAX_ENTRIES = 10;

export default function CustomDestinationInput({
  value,
  onChange,
}: CustomDestinationInputProps) {
  const [inputText, setInputText] = useState("");

  function handleAdd() {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    if (value.length >= MAX_ENTRIES) return;
    // Avoid duplicates (case-insensitive)
    if (value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setInputText("");
      return;
    }
    onChange([...value, trimmed]);
    setInputText("");
  }

  function handleRemove(destination: string) {
    onChange(value.filter((v) => v !== destination));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  const isAddDisabled = inputText.trim() === "" || value.length >= MAX_ENTRIES;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Tags row — only rendered when there are entries */}
      {value.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}
          aria-label="Custom destinations"
        >
          {value.map((dest) => (
            <span
              key={dest}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: "#FEF3C7",       // sand-cream
                border: "2px solid #1E3A5F",       // deep-navy
                borderRadius: 0,                   // 8-bit: no radius
                color: "#1E3A5F",                  // deep-navy text
                padding: "4px 8px",
                fontFamily: "monospace",
                fontWeight: 600,
                fontSize: "0.8125rem",
              }}
            >
              {dest}
              <button
                type="button"
                onClick={() => handleRemove(dest)}
                aria-label={`Remove ${dest}`}
                style={{
                  background: "none",
                  border: "none",
                  padding: "0 0 0 2px",
                  cursor: "pointer",
                  color: "#FB923C",               // sunset-orange ×
                  fontFamily: "monospace",
                  fontWeight: 700,
                  fontSize: "1rem",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input + Add button row */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={100}
          placeholder="Add a custom destination…"
          aria-label="Custom destination input"
          style={{
            flex: 1,
            border: "2px solid #1E3A5F",         // deep-navy border
            borderRadius: 0,                      // 8-bit: no radius
            backgroundColor: "#FEF3C7",           // sand-cream background
            color: "#1E3A5F",                     // deep-navy text
            padding: "6px 10px",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            outline: "none",
            minWidth: 0,
          }}
          // Focus ring in sky-blue via className (Tailwind)
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8] focus-visible:ring-offset-1"
        />

        <button
          type="button"
          onClick={handleAdd}
          disabled={isAddDisabled}
          aria-disabled={isAddDisabled}
          style={{
            backgroundColor: "#38BDF8",           // sky-blue
            border: "2px solid #1E3A5F",          // deep-navy border
            borderRadius: 0,                      // 8-bit: no radius
            color: "#1E3A5F",                     // deep-navy text
            padding: "6px 14px",
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: "0.875rem",
            cursor: isAddDisabled ? "not-allowed" : "pointer",
            opacity: isAddDisabled ? 0.5 : 1,
            whiteSpace: "nowrap",
            boxShadow: isAddDisabled ? "none" : "2px 2px 0px #1E3A5F",
            transition: "opacity 0.1s",
          }}
        >
          Add
        </button>
      </div>

      {/* Capacity hint */}
      {value.length >= MAX_ENTRIES && (
        <p
          style={{
            margin: 0,
            color: "#FB923C",
            fontFamily: "monospace",
            fontSize: "0.75rem",
          }}
          role="status"
        >
          Maximum of {MAX_ENTRIES} custom destinations reached.
        </p>
      )}
    </div>
  );
}
