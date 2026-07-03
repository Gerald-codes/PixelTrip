"use client";

import React from "react";

interface InteractiveSlotProps {
  isSaving: boolean;
  children: React.ReactNode;
}

/**
 * InteractiveSlot — wrapper for all stage interactive content in the chat thread.
 *
 * Dark theme version. Renders a saving overlay with a subtle spinner when
 * isSaving is true.
 */
export default function InteractiveSlot({
  isSaving,
  children,
}: InteractiveSlotProps) {
  return (
    <>
      <style>{`
        @keyframes slot-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        [data-saving="true"] * {
          pointer-events: none;
        }
      `}</style>

      <div
        data-saving={isSaving ? "true" : undefined}
        aria-disabled={isSaving ? "true" : undefined}
        style={{
          position: "relative",
          overflowY: "auto",
        }}
      >
        {children}

        {isSaving && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(15,27,46,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              borderRadius: 8,
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: "var(--pt-agent-compass, #4FD1C5)",
                animation: "slot-pulse 1s ease-in-out infinite",
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}
