"use client";

import { RoomStage } from "@/lib/types";

interface StageProgressProps {
  currentStage: RoomStage;
  stages: RoomStage[]; // STAGE_ORDER constant from lib/stageOrder.ts
}

/**
 * Renders a compact horizontal row of 8-bit style dots — one per stage.
 *
 * Visual states:
 *   Completed  (index < currentIndex) — grass-green  #4ADE80, filled, 2px border
 *   Active     (index === currentIndex) — sunset-orange #FB923C, filled, pulse animation
 *   Pending    (index > currentIndex)  — sand-cream   var(--pt-bg-card) bg, 2px deep-navy border
 *
 * The pulse animation respects prefers-reduced-motion.
 */
export default function StageProgress({ currentStage, stages }: StageProgressProps) {
  const currentIndex = stages.indexOf(currentStage);

  return (
    <>
      {/* Inject keyframes + reduced-motion override once per render */}
      <style>{`
        @keyframes pixelPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        .pixel-pulse {
          animation: pixelPulse 1s infinite ease-in-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .pixel-pulse {
            animation: none;
          }
        }
      `}</style>

      <div
        className="flex flex-row gap-1 items-center"
        role="list"
        aria-label="Stage progress"
      >
        {stages.map((stage, index) => {
          const isCompleted = index < currentIndex;
          const isActive    = index === currentIndex;
          // isPending: index > currentIndex

          let bgColor     = "var(--pt-bg-card)"; // pending — sand-cream
          let borderColor = "var(--pt-bg-card)"; // pending — deep-navy
          if (isCompleted) {
            bgColor     = "#4ADE80"; // grass-green
            borderColor = "#4ADE80";
          } else if (isActive) {
            bgColor     = "#FB923C"; // sunset-orange
            borderColor = "#FB923C";
          }

          const state = isCompleted ? "completed" : isActive ? "active" : "pending";

          return (
            <div
              key={stage}
              role="listitem"
              aria-label={`${stage} - ${state}`}
              className={isActive ? "pixel-pulse" : undefined}
              style={{
                width: 10,
                height: 10,
                borderRadius: 0,           // 8-bit square dot — no border-radius
                backgroundColor: bgColor,
                border: `2px solid ${borderColor}`,
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
    </>
  );
}
