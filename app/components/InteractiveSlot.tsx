"use client";

import React from "react";

interface InteractiveSlotProps {
  isSaving: boolean;
  children: React.ReactNode;
}

/**
 * InteractiveSlot — wrapper for all stage interactive content in the chat thread.
 *
 * When `isSaving` is false: renders children normally.
 * When `isSaving` is true:
 *  - Sets `data-saving="true"` on the wrapper so CSS can disable pointer events
 *    on all descendants: `[data-saving="true"] * { pointer-events: none }`
 *  - Adds `aria-disabled="true"` for accessibility
 *  - Overlays a semi-transparent sky-blue layer with a centred pixel-art spinner
 *
 * The slot is scrollable (overflow-y: auto) when embedded content exceeds the
 * visible area.
 */
export default function InteractiveSlot({
  isSaving,
  children,
}: InteractiveSlotProps) {
  return (
    <>
      {/* Keyframe animation injected once via a style tag */}
      <style>{`
        @keyframes pixel-spin {
          0%   { transform: rotate(0deg); }
          25%  { transform: rotate(90deg); }
          50%  { transform: rotate(180deg); }
          75%  { transform: rotate(270deg); }
          100% { transform: rotate(360deg); }
        }
        .pixel-spinner {
          width: 16px;
          height: 16px;
          background: #1E3A5F;
          box-shadow: 4px 0 0 #7DD3FC, -4px 0 0 #7DD3FC, 0 4px 0 #7DD3FC, 0 -4px 0 #7DD3FC;
          animation: pixel-spin 0.8s steps(4, end) infinite;
          image-rendering: pixelated;
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
        {/* Children rendered at full opacity underneath */}
        {children}

        {/* Saving overlay — only mounted when isSaving is true */}
        {isSaving && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "#7DD3FC",
              opacity: 0.6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
            aria-hidden="true"
          >
            <div className="pixel-spinner" />
          </div>
        )}
      </div>
    </>
  );
}
