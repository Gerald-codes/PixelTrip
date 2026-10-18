/**
 * Itinerary, version, feedback, and export fixtures.
 *
 * Contract-shaped data (see "Itinerary Format", "Itinerary Versioning",
 * "Feedback & Refinement", and "Export" in `api-contracts.md`). Consumed only
 * by the mock service implementations. IDs are UUID-format strings; dates are
 * ISO 8601 (date-only where the contract shows a calendar date).
 */
import type {
  ExportPayload,
  Feedback,
  Itinerary,
  ItineraryVersion,
} from "@/types";

/** The base itinerary shared by the fixture versions. */
export const mockItinerary: Itinerary = {
  tripId: "bbbbbbb0-bbbb-4bbb-8bbb-bbbbbbbbbbb0",
  roomId: "22222222-2222-4222-8222-222222222222",
  title: "Quest to the Land of the Rising Sun",
  summary: "A five-day adventure through Tokyo and Kyoto.",
  destination: { name: "Japan", country: "JP" },
  dates: { start: "2025-04-01", end: "2025-04-05" },
  days: [
    {
      day: 1,
      date: "2025-04-01",
      items: [
        {
          time: "09:00",
          title: "Arrive in Tokyo",
          description: "Land at Narita and check in.",
          location: "Narita International Airport",
          tags: ["travel", "arrival"],
        },
        {
          time: "14:00",
          title: "Explore Asakusa",
          description: "Visit Senso-ji temple.",
          location: "Asakusa",
          tags: ["culture", "temple"],
        },
      ],
    },
    {
      day: 2,
      date: "2025-04-02",
      items: [
        {
          title: "Day trip to Kyoto",
          description: "Shinkansen to Kyoto and back.",
          location: "Kyoto",
          tags: ["culture", "day-trip"],
        },
      ],
    },
  ],
  map: [
    { label: "Tokyo", lat: 35.6762, lng: 139.6503 },
    { label: "Kyoto", lat: 35.0116, lng: 135.7681 },
  ],
};

/** The current (approved-candidate) itinerary version. */
export const mockCurrentVersion: ItineraryVersion = {
  version: 1,
  source: "build",
  isCurrent: true,
  itinerary: mockItinerary,
};

/** All fixture versions for a trip; only one is current. */
export const mockItineraryVersions: readonly ItineraryVersion[] = [
  mockCurrentVersion,
];

/** Keyed current version by trip id; unknown ids resolve to `null`. */
export const mockCurrentVersionByTripId: Readonly<
  Record<string, ItineraryVersion>
> = {
  [mockItinerary.tripId]: mockCurrentVersion,
};

/** A persisted feedback fixture returned by `submitFeedback`. */
export const mockFeedback: Feedback = {
  id: "ccccccc0-cccc-4ccc-8ccc-ccccccccccc0",
  tripId: mockItinerary.tripId,
  itineraryVersionId: mockCurrentVersion.id ?? "version-1",
  memberId: "member-1",
  target: { day: 1 },
  comment: "Can we add more free time on the first day?",
  status: "open",
};

/** A shareable export payload fixture. */
export const mockExportPayload: ExportPayload = {
  tripId: mockItinerary.tripId,
  shareable: {
    format: "link",
    url: "https://example.invalid/share/bbbbbbb0",
  },
};
