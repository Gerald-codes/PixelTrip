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
        <div className="border-2 border-[#FB923C] bg-amber-50 shadow-pixel-sm p-4">
          <p className="font-bold text-pt-text-primary text-sm mb-2 flex items-center gap-1">
            <span aria-hidden="true">⚠️</span>
            Warnings
          </p>
          <ul className="flex flex-col gap-1 list-none" role="list">
            {summary.warnings.map((warning, i) => (
              <li key={i} className="text-sm text-pt-text-primary flex items-start gap-2">
                <span className="mt-0.5 text-[#FB923C] font-bold leading-none" aria-hidden="true">•</span>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {summary.recommendations.length > 0 && (
        <div className="border-2 border-[#38BDF8] bg-[#e0f2fe] shadow-pixel-sm p-4">
          <p className="font-bold text-pt-text-primary text-sm mb-2 flex items-center gap-1">
            <span aria-hidden="true">💡</span>
            Recommendations
          </p>
          <ul className="flex flex-col gap-1 list-none" role="list">
            {summary.recommendations.map((rec, i) => (
              <li key={i} className="text-sm text-pt-text-primary flex items-start gap-2">
                <span className="mt-0.5 text-[#38BDF8] font-bold leading-none" aria-hidden="true">•</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
