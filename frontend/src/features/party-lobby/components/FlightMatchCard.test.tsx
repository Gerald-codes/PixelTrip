import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MOCK_FLIGHTS } from "@/services/flight.mock";

import { FlightMatchCard, formatDuration, formatTime } from "./FlightMatchCard";

describe("FlightMatchCard", () => {
  it("shows a return date without a time as a round trip", () => {
    // A provider that prices the round trip but gives no return flight time.
    expect(formatTime("2026-12-27")).toBe("Sun, 27 Dec");
    const option = {
      ...MOCK_FLIGHTS[0],
      meta: { ...MOCK_FLIGHTS[0].meta, return_at: "2026-12-27", return_arrive_at: null },
    };
    render(<FlightMatchCard option={option} selected={false} onToggle={() => {}} />);

    expect(screen.getByText(/\/ person, round trip/)).toBeInTheDocument();
    expect(screen.getByText("RETURN").parentElement).toHaveTextContent("Sun, 27 Dec");
  });

  it("shows the flight, route, price, times, journey and return", () => {
    render(
      <FlightMatchCard
        option={MOCK_FLIGHTS[0]}
        selected={false}
        onToggle={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Scoot TR808" }),
    ).toBeInTheDocument();
    expect(screen.getByText("VALUE 72/100")).toBeInTheDocument();
    expect(screen.getByLabelText("SIN to NRT")).toBeInTheDocument();
    expect(
      screen.getByText(/\/ person, round trip/).parentElement,
    ).toHaveTextContent("SGD 600 / person, round trip");
    expect(screen.getByText("DEPART").nextSibling).toHaveTextContent(
      "20 Dec, 01:00",
    );
    expect(screen.getByText("JOURNEY").nextSibling).toHaveTextContent(
      "8h 00m · 1 stop",
    );
    expect(screen.getByText("RETURN").nextSibling).toHaveTextContent(
      "27 Dec, 10:30",
    );
    expect(
      screen.getByText("1 stop where other options fly with fewer."),
    ).toBeInTheDocument();
  });

  it("selects and expands details", () => {
    const onToggle = vi.fn();
    render(
      <FlightMatchCard
        option={MOCK_FLIGHTS[0]}
        selected={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(onToggle).toHaveBeenCalledWith("f1");
    fireEvent.click(screen.getByRole("button", { name: /View full details/ }));
    expect(screen.getByText(/per person, round trip\.$/)).toBeInTheDocument();
  });

  it("formats durations", () => {
    expect(formatDuration(405)).toBe("6h 45m");
    expect(formatDuration(50)).toBe("50m");
    expect(formatDuration(null)).toBeNull();
  });
});
