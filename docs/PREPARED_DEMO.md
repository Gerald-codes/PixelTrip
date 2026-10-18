# Prepared two-device demo

Create a **new** room as `DemoAlice`. Join its code from another device as
`DemoBob`. Matching ignores case and surrounding/repeated whitespace. These are
lobby display names, not character roles. `DemoBob` cannot create the demo room.
Demo rooms reserve those two seats; ordinary rooms keep the live workflow.

The room stores `demo_scenario = vietnam-five-days` and a shared departure date
seven days after creation, using Singapore time. The scenario key is retained for
compatibility; new destination votes now offer Vietnam, Indonesia and Thailand.
Both profiles are prefilled with
SGD 2,000, five matching availability days, complementary interests and roles.
Users can edit these questionnaire choices and save their own characters.
The prepared destinations, flights, dates, itinerary and scripted refinements
are selected by the room scenario and stay unchanged by those edits.
Each user still saves their character. The demo does not advance with just one
user or one submitted profile.

## Deployment order

1. Apply [the migration](../supabase/migrations/20261013000000_prepared_demo.sql)
   in the Supabase SQL editor, or through the project's normal migration process.
   It adds room metadata and updates the existing atomic creation RPC. A database
   trigger enforces the two named seats even during concurrent joins.
2. Deploy the backend containing `app/demo/` and restart it.
3. Deploy the frontend. Keep `NEXT_PUBLIC_SERVICE_MODE=real` and the existing
   API/Supabase environment variables. No new API key is needed.
4. Create a fresh demo room. Previously created rooms are not converted.

Apply the migration **before** deploying the frontend: room reads now select the
new metadata columns. A restart with the same old Docker image does not deploy
new backend code; use the normal full backend deployment.

For the multi-country content update, deploy the backend and frontend again; no
additional SQL migration or environment variable is needed. Start a fresh room to
see the new destination cards. Existing messages and itineraries remain stored as
published; old Hoi An/Hue selections can still finish with their original plans.

## Destinations and flights

All three choices have a distinct five-day itinerary and support every prepared
review choice. Flights are generated for the selected destination rather than
always using Da Nang airport.

| Destination | Route | Airline options | Highlights |
| --- | --- | --- | --- |
| Da Nang, Vietnam | SIN–DAD | Scoot, Vietjet Air, Singapore Airlines | My Khe Beach, Marble Mountains, Son Tra, Hoi An |
| Bali, Indonesia | SIN–DPS | Scoot, Garuda Indonesia, Singapore Airlines | Seminyak, Ubud, Tegallalang rice terraces, Uluwatu |
| Phuket, Thailand | SIN–HKT | Scoot, Thai AirAsia, Singapore Airlines | Patong, Wat Chalong, Old Town, Kata and Kamala beaches |

These are real airline names; fares, dates, departure times and durations are fixed
illustrative data, not live schedules or bookable offers. Times use each airport's
local offset: Singapore/Bali UTC+08:00 and Vietnam/Thailand UTC+07:00. Arrival and
return timestamps are calculated from the sample duration, leaving time for the
first activity and final airport transfer with any of the three flight options.

Route references: Scoot's [Bali](https://www.flyscoot.com/flights/en/flights-from-singapore-to-bali-denpasar),
[Da Nang](https://www.flyscoot.com/flights/en/flights-from-singapore-to-da-nang) and
[Phuket](https://www.flyscoot.com/flights/en/flights-from-singapore-to-phuket) pages;
[AirAsia's Phuket route page](https://www.airasia.com/flights/from-singapore-sin-to-phuket-hkt/);
[Vietjet's Singapore routes announcement](https://www1.vietjetair.com/en/news/news-1697697232035/vietjet-announces-nha-trangsingapore-route-in-the-presence-of-vietnams-general-secretary-and-president-to-lam-1780282637654);
[Garuda's Bali–Singapore page](https://www.garuda-indonesia.com/flights/en-id/flights-from-bali-denpasar-to-republic-singapore)
and [Singapore Airlines' destination network](https://www.singaporeair.com/sg/en/plan-travel/destinations/).

## Demo walkthrough

1. On device A, create a room as **DemoAlice** and share its code.
2. On device B, join as **DemoBob**. Keep or change the prefilled character choices,
   then save both characters. These choices do not recalculate the prepared plan.
3. Vote for different destination options to demonstrate a real 1–1 tie.
   Prepared MILO advice appears; DemoAlice makes the final choice. Choose Da Nang
   for the main walkthrough, or select Bali or Phuket for a different five-day plan.
4. Confirm the fixed dates and start the flight stage. Vote for the same sample
   flight to advance immediately, or different ones to demonstrate another tie.
5. The selected sample flight and matching itinerary appear. Airline names are
   real; fares, schedules and estimated costs are illustrative data, not bookable offers.
6. In day 1, choose **Add a separate club visit after dinner**, then request
   changes. Keep the other days. The other member can keep all days. Both users
   lock their complete reviews before the prepared refinement runs.
7. The next version contains a separate 21:00 club row with its own description;
   the original dinner is preserved. Both users review and approve the new plan.
8. At WRAP, export the final plan as Markdown through the existing frontend export.

There is one prepared review choice per day: a club addition, bar lunch replacement,
dinner before the evening walk, later morning start, and a café before the airport.
The backend rejects unsupported feedback before writing it. Repeated additions
reuse their stable activity IDs rather than duplicating rows.

Voting is interactive, not forced: one vote per current member, readiness for both
users, ties held for the owner, selections and review rounds all use the existing
backend/Supabase lifecycle. The demo never auto-picks a winner. Supabase Realtime
and existing polls synchronize devices. Refreshing and joining with the same name
resume that member. Display-name identity retains the project's existing guest
trust model; demo names are not credentials.

Destination and flight tiebreaks use prewritten option explanations and a single
sentence per traveller. Destination reasons name Alice/Bob's saved preferences and
concrete matching features; flight reasons explain early arrival, an easier start
or a later return. Saved roles provide a fallback when no recognized interests are
selected. The main recommendation is also one sentence. The prose does not say
"demo", "prepared" or "sample"; scores, options and prepared plans remain fixed.
The owner still makes the final decision.

Destination match cards include fuller explanations of the food/nightlife fit for
Alice and the scenery/culture fit for Bob. Each has a one-sentence traveller-specific
trade-off, shared with its tiebreak card. The suggested dates still show five days,
but the explanatory line "The prepared demo covers five days" is no longer shown.

## External-call boundary and verification

Both synchronous and HTTP/background agent entry points route demo rooms around
the live graph. Prepared runs write normal messages, vote sessions and itinerary
versions. The demo does not invoke Gemini, flight providers, or other agent tools.
Normal rooms continue using the live graph. FastAPI, Supabase and network access
between the devices and those services remain required.

The backend integration test exercises all nine destination/flight combinations,
both vote ties, owner decisions, a separate club addition, readiness resets and
final approval over a shared test store while asserting zero live graph/Gemini/flight
calls. Route tests check local offsets, elapsed duration and airport-transfer timing;
older Hoi An/Hue selections are also tested. Frontend tests cover shared dates,
profile submission, demo metadata on refresh, supported feedback, and completed
refinement between polls. These do not replace a live two-device smoke test after
the migration and deployments.

Multi-country update verification (2026-10-14): 55 focused backend tests and 13
frontend tests passed, plus TypeScript and Ruff. The original demo implementation
also passed 171 focused backend tests, 28 frontend tests and the production Next.js
build. Existing RoomShell tests emit React `act` warnings. No live migration,
external provider call or deployment was performed while implementing these changes.

For that smoke test, confirm both devices see the same room, selected destination,
flight and itinerary version. Try a refresh, a third name, and repeated votes.
Verify one user's approval alone does not reach WRAP. Backend run phases should
go to `posting` rather than `asking_guide` or `searching_flights` for demo runs.
