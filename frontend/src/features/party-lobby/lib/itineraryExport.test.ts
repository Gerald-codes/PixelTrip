import { describe, expect, it } from "vitest";

import type { ItineraryVersion } from "@/types";

import {
  buildCalendar,
  buildPlainText,
  canExportCalendar,
  exportFileName,
} from "./itineraryExport";

function version(
  overrides: Partial<ItineraryVersion["itinerary"]> = {},
): ItineraryVersion {
  return {
    version: 2,
    source: "refine",
    isCurrent: true,
    itinerary: {
      tripId: "trip-1",
      roomId: "room-1",
      title: "Quest to Hanoi",
      summary: "Three days of food and lakes.",
      destination: { name: "Hanoi" },
      dates: { start: "2026-12-30", end: "2027-01-01" },
      days: [
        {
          day: 1,
          date: "2026-12-30",
          items: [
            {
              id: "a",
              time: "09:00",
              title: "Pho breakfast",
              location: "Old Quarter; Hanoi",
              description: "Beef, or chicken",
            },
            { id: "b", time: "11:30", title: "Hoan Kiem Lake" },
            { id: "c", title: "Free evening" },
          ],
        },
        // No date of its own: counted from the trip start, across the year end.
        { day: 3, items: [{ id: "d", time: "23:30", title: "Night market" }] },
      ],
      ...overrides,
    },
  };
}

const STAMP = new Date("2026-10-13T08:00:00Z");

describe("buildPlainText", () => {
  it("lists every day and activity without markdown", () => {
    const text = buildPlainText(version());
    expect(text).toContain("QUEST TO HANOI");
    expect(text).toContain("Day 1 (2026-12-30)");
    expect(text).toContain("09:00  Pho breakfast");
    expect(text).toContain("    Location: Old Quarter; Hanoi");
    expect(text).toContain("Free evening");
    expect(text).not.toMatch(/[*#]/);
  });

  it("puts the outbound flight on the first day and the return on the last", () => {
    const text = buildPlainText(version(), {
      title: "SQ 176",
      departure: "30 Dec, 07:00",
      arrival: null,
      returnDeparture: "1 Jan, 20:00",
      returnArrival: null,
    });
    const lines = text.split("\n");
    expect(lines.indexOf("Outbound flight: SQ 176")).toBeLessThan(
      lines.indexOf("09:00  Pho breakfast"),
    );
    expect(lines.indexOf("Return flight: SQ 176")).toBeGreaterThan(
      lines.indexOf("23:30  Night market"),
    );
  });
});

describe("buildCalendar", () => {
  const calendar = buildCalendar(version(), null, STAMP);
  const lines = calendar.split("\r\n");

  it("is a well-formed calendar with one event per activity", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(calendar.endsWith("\r\n")).toBe(true);
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(4);
    expect(lines.filter((line) => line === "END:VEVENT")).toHaveLength(4);
    expect(new Set(lines.filter((line) => line.startsWith("UID:"))).size).toBe(
      4,
    );
  });

  it("ends a timed activity at the next one, else after an hour", () => {
    expect(calendar).toContain(
      "DTSTART:20261230T090000\r\nDTEND:20261230T113000",
    );
    expect(calendar).toContain(
      "DTSTART:20261230T113000\r\nDTEND:20261230T123000",
    );
  });

  it("makes an untimed activity an all-day event", () => {
    expect(calendar).toContain(
      "DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20261231",
    );
  });

  it("counts an undated day from the trip start and never runs past midnight", () => {
    expect(calendar).toContain(
      "DTSTART:20270101T233000\r\nDTEND:20270101T235900",
    );
  });

  it("escapes text and keeps every line within 75 bytes", () => {
    expect(calendar).toContain("LOCATION:Old Quarter\\; Hanoi");
    expect(calendar).toContain("DESCRIPTION:Beef\\, or chicken");
    const long = buildCalendar(
      version({
        days: [
          { day: 1, date: "2026-12-30", items: [{ title: "Phở ".repeat(60) }] },
        ],
      }),
      null,
      STAMP,
    );
    const encoder = new TextEncoder();
    for (const line of long.split("\r\n"))
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain(
      `SUMMARY:${"Phở ".repeat(60)}`,
    );
  });

  it("adds the flights, converting offset times to UTC", () => {
    const withFlight = buildCalendar(
      version(),
      {
        title: "SQ 176",
        data: {
          depart_at: "2026-12-30T07:00:00+08:00",
          arrive_at: "2026-12-30T09:20:00+07:00",
          returnAt: "2027-01-01T20:00:00",
        },
      } as never,
      STAMP,
    );
    expect(withFlight).toContain(
      "DTSTART:20261229T230000Z\r\nDTEND:20261230T022000Z\r\nSUMMARY:Outbound flight: SQ 176",
    );
    expect(withFlight).toContain(
      "DTSTART:20270101T200000\r\nDTEND:20270101T200000\r\nSUMMARY:Return flight: SQ 176",
    );
  });

  it("is unavailable when no day can be dated", () => {
    const undated = version({
      dates: undefined,
      days: [{ day: 1, items: [{ title: "Somewhere" }] }],
    });
    expect(canExportCalendar(undated)).toBe(false);
    expect(canExportCalendar(version())).toBe(true);
    expect(buildCalendar(undated, null, STAMP)).not.toContain("BEGIN:VEVENT");
  });
});

describe("exportFileName", () => {
  it("makes a safe file name", () => {
    expect(exportFileName("Quest to Hà Nội!", "ics")).toBe(
      "quest-to-h-n-i.ics",
    );
    expect(exportFileName("!!!", "txt")).toBe("adventure.txt");
  });
});
