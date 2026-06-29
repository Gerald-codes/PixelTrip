# PixelTrip — Project Structure

## Directory Layout

```
app/
├── page.tsx                        # Landing: create or join a room
├── room/[code]/
│   └── page.tsx                    # Room shell + Supabase Realtime subscription
├── components/
│   ├── StageRouter.tsx             # Renders the active stage component by currentStage
│   ├── LobbyStage.tsx
│   ├── AvailabilityStage.tsx
│   ├── GroupProfileStage.tsx
│   ├── DestinationsStage.tsx
│   ├── VotingStage.tsx             # Reusable: destination, flight, conflict votes
│   ├── FlightStage.tsx
│   ├── ActivitiesStage.tsx
│   ├── ItineraryStage.tsx
│   ├── FairnessStage.tsx
│   ├── FeedbackStage.tsx
│   ├── NegotiationStage.tsx
│   ├── FinalStage.tsx
│   ├── PersonaCard.tsx
│   ├── DestinationCard.tsx
│   ├── ItineraryDay.tsx
│   ├── FairnessSummary.tsx
│   ├── VotePanel.tsx
│   ├── FeedbackForm.tsx
│   └── ExportButton.tsx
└── api/
    ├── rooms/                      # Room CRUD + stage transitions
    ├── personas/                   # Persona list
    ├── users/                      # Join / upsert user
    ├── availability/               # Dates + destination interests
    ├── activity-preferences/
    ├── votes/                      # Vote submission + results
    ├── feedback/                   # Feedback submission + aggregation
    ├── conflicts/                  # Conflict records
    ├── itinerary/                  # Itinerary CRUD, versions, finalise
    └── agents/                     # All AI agent endpoints (server-side only)
        ├── group-profile/
        ├── destinations/
        ├── itinerary/
        ├── feedback-analysis/
        └── negotiation/

lib/
├── types.ts                        # Shared data models + RoomStage enum
├── supabase.ts                     # Server-side Supabase helper
├── bedrock.ts                      # Bedrock client + JSON-safe agent helper
├── identity.ts                     # localStorage UUID + display name
└── overlap.ts                      # calculateOverlap() date utility
```

## Conventions

- **Stage-driven rendering.** The room page reads `currentStage` and delegates to `StageRouter`, which renders exactly one stage component. Wire each new stage component into `StageRouter` as it is built — never leave a stage component orphaned.
- **One agent per route.** Each AI agent maps to a single `app/api/agents/<name>/route.ts`. Keep prompt construction in the route (or a colocated helper), not in client code.
- **Reusable voting.** All voting (destination, flight, conflict resolution) flows through `VotingStage` + `VotePanel`, distinguished by `voteType`.
- **Components vs. stages.** `*Stage.tsx` files are full-screen pipeline steps; the remaining components are presentational pieces composed inside stages.
- **Naming.** Components in PascalCase; API route folders in kebab-case; `lib` helpers in camelCase files.
- **Type source of truth.** Import every model shape from `lib/types.ts`. Do not duplicate interfaces inline.

## Room Stage State Machine

`TripRoom.currentStage` is the single source of truth for pipeline position:

```
LOBBY → PERSONA → AVAILABILITY → GROUP_PROFILE → DESTINATIONS →
DESTINATION_VOTE → FLIGHTS → FLIGHT_VOTE → ACTIVITIES → ITINERARY →
FEEDBACK → NEGOTIATION → FINAL
```

`NEGOTIATION` may loop back to `ITINERARY → FEEDBACK` repeatedly until the host finalises.
