# Product

## Product Vision

PixelArt Trip Planner is an AI-powered collaborative travel planning web app with an
8-bit retro RPG theme. Planning a trip should feel less like filling out forms and more
like a party of adventurers deciding on their next quest together.

The core idea: **an RPG party planning their next adventure.**

## Target User Experience

- Multiplayer and social by default. Users plan together in a shared room, not alone.
- Game-like interaction. Users act through buttons, selections, votes, and typed chat
  rather than traditional web forms.
- Guided, not overwhelming. An AI "NPC" leads the conversation one step at a time.
- Playful but usable. The retro theme never gets in the way of completing a real trip plan.

## RPG Theme

The entire product is framed as a cooperative adventure:

- Planning = a quest.
- Group members = a party.
- The AI = a non-player character (NPC) guide.
- The final plan = an adventure summary (journal, quest log, map, timeline).

The theme is a product requirement, not decoration. Features should reinforce the
party-adventure framing.

## Guest Access (No Sign-Up)

There is no account sign-up or sign-in. Users enter a **room code and guest name** and go
straight into the experience. Identity is room-scoped: the same name in the same room
resumes the same party member, who carries the character and preferences they created.
Keep the entry frictionless — no email, no password, no auth screens.

## Character System

Each user creates an 8-bit character that represents their travel identity. Character
customization is directly tied to travel preferences, so appearance and behavior stay
consistent.

Examples:
- Backpacker → explorer character, backpack sprite, budget preference.
- Luxury traveller → premium outfit, luxury preference, higher budget.

A character carries:
- Avatar / appearance selections.
- Travel preferences: available dates, preferred destinations, travel style, budget,
  interests, activity preferences.

## Party Room Concept

Users join a shared party room that contains:
- Pixel characters of all members.
- A group chat interface.
- The AI travel guide (NPC).
- Current planning progress.
- Decision cards (options, votes, summaries).

The room is the central multiplayer surface where the group makes decisions together.

## AI NPC Concept

The AI orchestration agent acts as an in-world NPC travel guide across all six stages. It:
- Welcomes the party and frames the journey.
- Asks one guiding question at a time and moves the party from stage to stage.
- Presents travel options, recommendation cards, and voting cards (destinations, flights).
- Generates and refines the itinerary from group preferences and feedback.
- Summarizes group decisions and negotiates compromises during refinement.

Example NPC prompt:
> "Welcome adventurers! Where shall our journey begin?"
> Options: Japan · Korea · Europe · Surprise Me

The AI drives the conversation; users respond through clicks, votes, and typed messages.

## User Journey (6 Stages)

The adventure runs through six stages. Each stage is framed in-world (a leg of the quest)
and driven by the AI NPC guide. Entry is frictionless: a user provides a guest name and
goes straight in — no sign-up or sign-in step precedes it.

1. **SETUP — Gather the party.**
   Create or join a trip, invite members, build an 8-bit character (avatar, outfit,
   accessories), and enter travel preferences (availability dates, budget, travel style,
   destination interests, activities). This forms the party and collects the preferences
   the AI reasons over.

2. **DISCOVER — Choose the destination.**
   The AI presents destination recommendations based on the group's combined preferences.
   The party compares options and votes; the winning destination is locked in.

3. **LOGISTICS — Arrange travel.**
   The AI presents flight and travel options ranked against budget, availability, and
   preferences. The party compares and votes; the chosen arrangement is locked in.

4. **BUILD — Draft the quest log.**
   The AI generates an initial itinerary from the destination, flights, preferences, and
   constraints. It is presented as an 8-bit adventure journal / quest log.

5. **REFINE — Improve together.**
   The party comments and suggests changes. The AI analyses feedback, negotiates
   compromises, and regenerates affected sections into new itinerary versions. This loops
   (feedback → negotiation → new version → review) until the party approves.

6. **WRAP — Complete the adventure.**
   The final approved itinerary is shown as the adventure summary and can be exported or
   shared.

## Application States

The system recognises these states as the party progresses. They drive progress UI and
gate which stage is active:

1. Trip created
2. Group formed
3. Preferences collected
4. Destination selected
5. Flight selected
6. Itinerary generated
7. Feedback collected
8. Refinement completed
9. Trip approved
10. Final trip exported

## Team Boundary (product level)

- Frontend team owns the app experience, UI, Supabase integration (data, realtime,
  storage — no Supabase Auth), and the API integration layer.
- Backend team owns FastAPI, LangGraph orchestration, AI workflows, and external APIs.
- Frontend and backend are built in parallel by different team members. Both sides
  implement against the agreed API contracts (`api-contracts.md`) so they integrate
  cleanly as each part lands, rather than one side waiting on the other.
