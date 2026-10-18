import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { BudgetAmountField } from "./BudgetAmountField";

function Harness({ error = null }: { error?: string | null }) {
  const [value, setValue] = useState("");
  return <BudgetAmountField value={value} onChange={setValue} error={error} />;
}

const field = (): HTMLInputElement =>
  screen.getByLabelText("Have an exact amount in mind? (optional)") as HTMLInputElement;

describe("BudgetAmountField", () => {
  it("fills the amount from a common amount, and a second tap clears it", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "1,500" }));
    expect(field().value).toBe("1500");
    expect(screen.getByRole("button", { name: "1,500" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "1,500" }));
    expect(field().value).toBe("");
  });

  it("keeps digits only, so pasted text or symbols cannot break the amount", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "SGD 2,400.50" } });
    expect(field().value).toBe("24005");
  });

  it("explains an amount outside the allowed range once the field is left", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "50" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.blur(field());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an amount from SGD 100 to 50,000, or leave it empty.",
    );
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a problem reported on save", () => {
    render(<Harness error="Budget must be between SGD 100 and SGD 50,000." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Budget must be between");
  });
});
