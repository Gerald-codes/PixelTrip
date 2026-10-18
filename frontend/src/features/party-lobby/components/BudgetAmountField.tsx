"use client";

/**
 * BudgetAmountField — an optional exact budget, per person for the whole trip.
 *
 * Sits under the budget-level question as its follow-up. Typing a sum is the slow
 * way to answer, so common amounts are one tap; the field takes any other figure.
 * It is a text field with a number keypad rather than a number input: no spinner
 * arrows, and scrolling the page can never change the amount.
 */
import { useState, type ReactElement } from "react";

const MIN = 100;
const MAX = 50000;
const PRESETS = [500, 1000, 1500, 2500, 4000] as const;

const INPUT =
  "min-w-0 flex-1 bg-bg px-16 py-8 font-display text-pixel-q text-ink tabular-nums focus-visible:outline-none";

function money(amount: number): string {
  return amount.toLocaleString("en-SG");
}

export interface BudgetAmountFieldProps {
  /** The amount as typed: digits only, or "" when left empty. */
  value: string;
  onChange: (value: string) => void;
  /** A problem reported by the server on save, shown under the field. */
  error?: string | null;
}

export function BudgetAmountField({
  value,
  onChange,
  error = null,
}: BudgetAmountFieldProps): ReactElement {
  const [touched, setTouched] = useState(false);
  const amount = value === "" ? null : Number(value);
  const outOfRange = amount !== null && (amount < MIN || amount > MAX);
  const problem =
    error ??
    (touched && outOfRange
      ? `Enter an amount from SGD ${money(MIN)} to ${money(MAX)}, or leave it empty.`
      : null);

  return (
    <div className="flex flex-col gap-8">
      <label htmlFor="pref-budget" className="font-display text-ink">
        Have an exact amount in mind? (optional)
      </label>

      <div
        className={`flex max-w-xs items-stretch border-2 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-bg-alt ${
          problem ? "border-alert" : "border-muted focus-within:border-accent"
        }`}
      >
        <span
          aria-hidden
          className="flex items-center border-r-2 border-muted bg-bg px-16 font-display text-subtle"
        >
          SGD
        </span>
        <input
          id="pref-budget"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 5))
          }
          onBlur={() => setTouched(true)}
          placeholder="1500"
          aria-describedby="pref-budget-hint"
          aria-invalid={problem !== null}
          className={INPUT}
        />
      </div>

      <div
        role="group"
        aria-label="Common amounts"
        className="flex flex-wrap items-center gap-8"
      >
        {PRESETS.map((preset) => {
          const chosen = amount === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChange(chosen ? "" : String(preset))}
              className={`rounded-full border-2 px-16 py-1 font-body text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-alt ${
                chosen
                  ? "border-ink bg-accent text-bg"
                  : "border-accent text-accent hover:bg-bg"
              }`}
            >
              {money(preset)}
            </button>
          );
        })}
        {value !== "" ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="font-body text-sm text-subtle underline decoration-dotted underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="font-body text-alert">
          {problem}
        </p>
      ) : null}
      <p id="pref-budget-hint" className="font-body text-subtle">
        Your budget covers the entire trip, including flights. MILO plans around the lowest budget in your crew, keeping the adventure affordable for everyone!
      </p>
    </div>
  );
}

export default BudgetAmountField;
