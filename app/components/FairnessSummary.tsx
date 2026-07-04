"use client";

import type { FairnessSummary, User } from "@/lib/types";

interface FairnessSummaryProps {
  summary: FairnessSummary;
  members: User[];
}

export default function FairnessSummary({ summary, members: _members }: FairnessSummaryProps) {
  const personaEntries = Object.entries(summary.perPersona);

  return (
    <section aria-label="Fairness Summary" className="flex flex-col gap-4">
      {/* Section header */}
      <header className="border-4 border-[var(--pt-agent-atlas)] bg-[var(--pt-bg-card)] shadow-pixel-card p-4">
        <h3 className="text-xl font-bold text-pt-text-primary flex items-center gap-2">
          <span aria-hidden="true">⚖️</span>
          Fairness Summary
        </h3>
      </header>

      {/* Per-persona cards */}
      {personaEntries.length > 0 && (
        <div className="flex flex-col gap-3">
          {personaEntries.map(([personaName, summaryText]) => (
            <article
              key={personaName}
              className="border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] shadow-pixel-sm p-4"
            >
              <h4 className="font-bold text-pt-text-primary text-base mb-1">{personaName}</h4>
              <p className="text-sm text-pt-text-primary leading-relaxed">{summaryText}</p>
            </article>
          ))}
        </div>
      )}

      {/* Warnings */}
      {summary.warnings.length > 0 && (
        <div
          className="shadow-pixel-sm p-4"
          style={{
            border: "2px solid #92400E",
            backgroundColor: "#1C0F00",
          }}
        >
          <p
            className="font-bold text-sm mb-2 flex items-center gap-1"
            style={{ color: "#FDE68A" }}
          >
            <span aria-hidden="true">⚠️</span>
            Warnings
          </p>
          <ul className="flex flex-col gap-1.5 list-none" role="list">
            {summary.warnings.map((warning, i) => (
              <li
                key={i}
                className="text-sm flex items-start gap-2"
                style={{ color: "#FEF3C7", lineHeight: 1.6, wordBreak: "break-word" }}
              >
                <span
                  className="mt-0.5 font-bold leading-none flex-shrink-0"
                  aria-hidden="true"
                  style={{ color: "#FB923C" }}
                >
                  •
                </span>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {summary.recommendations.length > 0 && (
        <div
          className="shadow-pixel-sm p-4"
          style={{
            border: "2px solid #0369A1",
            backgroundColor: "#071E2E",
          }}
        >
          <p
            className="font-bold text-sm mb-2 flex items-center gap-1"
            style={{ color: "#38BDF8" }}
          >
            <span aria-hidden="true">💡</span>
            Recommendations
          </p>
          <ul className="flex flex-col gap-1.5 list-none" role="list">
            {summary.recommendations.map((rec, i) => (
              <li
                key={i}
                className="text-sm flex items-start gap-2"
                style={{ color: "#BAE6FD", lineHeight: 1.6, wordBreak: "break-word" }}
              >
                <span
                  className="mt-0.5 font-bold leading-none flex-shrink-0"
                  aria-hidden="true"
                  style={{ color: "#38BDF8" }}
                >
                  •
                </span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
