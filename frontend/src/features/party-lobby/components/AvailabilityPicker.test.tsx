import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { AvailabilityPicker, type AvailabilityRange } from "./AvailabilityPicker";

const TODAY = "2099-03-10";

/** The picker with real state behind it, as the character creator uses it. */
function Harness({ initial }: { initial: AvailabilityRange[] }) {
  const [ranges, setRanges] = useState(initial);
  return (
    <AvailabilityPicker
      today={TODAY}
      ranges={ranges}
      onChange={(index, range) =>
        setRanges((all) => all.map((r, i) => (i === index ? range : r)))
      }
      onAdd={() => setRanges((all) => [...all, { start: "", end: "" }])}
      onRemove={(index) => setRanges((all) => all.filter((_, i) => i !== index))}
    />
  );
}

const day = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

describe("AvailabilityPicker", () => {
  it("opens a calendar for the first period and blocks days already past", () => {
    render(<Harness initial={[{ start: "", end: "" }]} />);

    expect(screen.getByRole("grid", { name: "March 2099" })).toBeInTheDocument();
    expect(screen.getByText("Pick the first day you are free.")).toBeInTheDocument();
    expect(day(/^Mon 9 Mar, not free$/)).toBeDisabled();
    expect(day(/^Tue 10 Mar, free$/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
  });

  it("picks the first day, then the last, and folds down to a summary", () => {
    render(<Harness initial={[{ start: "", end: "" }]} />);

    fireEvent.click(day(/^Fri 13 Mar/));
    expect(screen.getByRole("group", { name: "Free period 1" })).toHaveTextContent(
      "From Fri 13 Mar. Now pick the last day.",
    );

    fireEvent.click(day(/^Sun 22 Mar, can be the last day$/));

    expect(screen.getByText("Fri 13 Mar – Sun 22 Mar, 10 days")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change free period 1" })).toBeInTheDocument();
  });

  it("lets a period be a single day", () => {
    render(<Harness initial={[{ start: "", end: "" }]} />);

    fireEvent.click(day(/^Fri 13 Mar/));
    fireEvent.click(day(/^Fri 13 Mar/));

    expect(screen.getByText("Fri 13 Mar, 1 day")).toBeInTheDocument();
  });

  it("reopens a finished period on its own month to change it", () => {
    render(<Harness initial={[{ start: "2099-06-05", end: "2099-06-12" }]} />);

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change free period 1" }));

    expect(screen.getByRole("grid", { name: "June 2099" })).toBeInTheDocument();
    expect(day(/^Fri 5 Jun, first day$/)).toHaveAttribute("aria-pressed", "true");
  });

  it("adds a second period with its own calendar, and removes one", () => {
    render(<Harness initial={[{ start: "2099-06-05", end: "2099-06-12" }]} />);
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add another period" }));

    expect(screen.getByRole("group", { name: "Free period 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("grid")).toHaveLength(1); // only the new one is open

    fireEvent.click(screen.getByRole("button", { name: "Remove free period 2" }));
    expect(screen.queryByRole("group", { name: "Free period 2" })).not.toBeInTheDocument();
  });
});
