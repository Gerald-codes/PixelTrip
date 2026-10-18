# PixelArt Trip Planner — Project Context

## 1. Project Overview

PixelArt Trip Planner is an AI-powered collaborative group travel planning application.

The core concept is:

> An AI-guided 8-bit adventure with your friends.

Instead of behaving like a traditional travel booking website, the application presents trip planning as a collaborative RPG-style experience.

Users form a travelling party, create an 8-bit representation of themselves, enter their travel preferences, and then interact with an AI Travel Guide through a shared group chat / Party Room.

The AI Travel Guide guides the party through the entire trip-planning process.

The application should feel like an interactive adventure rather than a collection of conventional forms.

---

# 2. Team Responsibilities

There are three developers.

## My primary responsibility: FRONTEND

I am primarily responsible for:

- Frontend UI/UX
- Next.js
- React
- TypeScript
- Tailwind CSS
- Pixel-art design system
- Character creation
- Lobby / Gather the Party
- Party Room
- AI chatbot interface
- Trip status sidebar
- Destination UI
- Flight UI
- Itinerary UI
- Feedback / refinement UI
- Responsive design
- Frontend state management
- Frontend service abstraction

## My secondary responsibility: SUPABASE / INTEGRATION

I will also handle Supabase integration where required, including:

- Supabase client setup
- Authentication
- User/profile data
- Trip data
- Character data
- Preferences
- Realtime functionality
- Frontend-side database integration

I may occasionally touch backend/shared code when required for frontend integration.

However, I am NOT primarily responsible for:

- LangGraph architecture
- AI agent architecture
- Backend orchestration
- External API architecture
- Complex backend business logic

The other two developers are primarily responsible for backend/FastAPI/LangGraph/AI work.

Frontend and backend should be developed in parallel.

---

# 3. Overall Product Flow

The complete product flow is:

Create Trip
    ↓
Invite / Join Group
    ↓
Enter Preferences / Character Creation
    ↓
Discover Destinations
    ↓
Vote Destination
    ↓
Search Flights
    ↓
Vote Flight
    ↓
Generate Itinerary
    ↓
Group Feedback
    ↓
Negotiate / Refine
    ↓
Review New Version
    ↓
Approve
    ↓
Final Trip

The product is divided conceptually into six major stages:

1. SETUP
2. DISCOVER
3. LOGISTICS
4. BUILD
5. REFINE
6. WRAP

---

# 4. Critical UX Architecture

The AI chatbot / Party Room is the MAIN application workspace.

The application should NOT feel like:

Create Trip Page
    ↓
Destination Page
    ↓
Flight Page
    ↓
Itinerary Page
    ↓
Feedback Page

Instead, the user should generally remain inside a shared Party Room.

The Party Room changes its content according to the current planning stage.

Core UX principle:

> The AI conversation tells the story; the sidebar tells the state.

The main area answers:

"What is happening right now?"

The sidebar answers:

"What have we decided so far?"

---

# 5. Party Room Layout

Desktop layout:

---------------------------------------------------------
|                                                       |
|                  MAIN WORKSPACE        |   SIDEBAR   |
|                                         |             |
| AI Travel Guide                         | Character   |
| User messages                           | Party       |
| Interactive choices                     | Destination |
| Destination cards                       | Flight      |
| Flight cards                            | Budget      |
| Itinerary                               | Progress    |
| Feedback                                |             |
| Chat input                              |             |
|                                         |             |
---------------------------------------------------------

## Main workspace

The main workspace contains:

- AI Travel Guide messages
- User messages
- Chat input
- Interactive choices
- Destination cards
- Destination voting
- Flight cards
- Flight voting
- Itinerary
- Group feedback
- Refinement
- Version review
- Approval

## Sidebar

The persistent sidebar contains:

- Current user's 8-bit character
- Other party members
- Trip name
- Travel dates
- Destination
- Selected flight
- Flight cost
- Budget
- Estimated expenditure
- Remaining budget
- Amount over budget
- Planning stage
- Stage progress

---

# 6. Sidebar Behaviour

The sidebar is a live trip-status dashboard.

It should update as the trip progresses.

Initial example:

Destination:
Not selected

Flight:
Not selected

Budget:
$0 / $1,500

Later:

Destination:
Japan

Flight:
SQ12

Budget:
$1,720 / $1,500

Status:

$220 OVER BUDGET

The sidebar should remain available throughout the Party Room experience.

---

# 7. Six Major Stages

## SETUP

Purpose:

Gather the party and collect user information.

Frontend includes:

- Create Trip
- Invite / Join Group
- Character creation
- Travel preferences
- Party member status

Backend operations may include:

- Create trip
- Manage membership
- Store user data
- Store character data
- Store preferences

The backend processing itself should not be exposed to the user.

---

## DISCOVER

Purpose:

Find suitable destinations.

Backend:

- Analyse group preferences
- Discover/recommend destinations
- Rank options

Frontend:

- AI explanation
- Destination recommendation cards
- Destination comparison
- Voting

---

## LOGISTICS

Purpose:

Find suitable flights.

Backend:

- Search flight APIs
- Filter flights
- Rank flights

Frontend:

- Flight cards
- Flight comparison
- Flight voting

While backend processing occurs, the frontend should show a friendly AI/game-like loading state.

Example:

"The Travel Guide is searching for suitable flights..."

---

## BUILD

Purpose:

Generate the initial itinerary.

Backend:

- Combine destination
- Selected flight
- Group preferences
- Budget
- Constraints
- Generate itinerary

Frontend:

- Display itinerary
- Adventure journal / quest-log presentation

The itinerary should fit the 8-bit RPG visual identity while remaining highly readable.

---

## REFINE

Purpose:

Collect group feedback and iteratively improve the itinerary.

Frontend:

- Display itinerary
- Allow comments
- Allow feedback
- Allow users to suggest changes
- Show refinement status
- Display new itinerary version

Backend:

- Analyse feedback
- Identify conflicts
- Negotiate
- Propose changes
- Generate updated itinerary version

The refinement process can repeat.

Feedback
    ↓
AI negotiation
    ↓
New version
    ↓
Review
    ↓
More feedback if required

---

## WRAP

Purpose:

Complete the trip.

Frontend:

- Final approved itinerary
- Final trip summary
- Destination
- Flight
- Budget
- Party
- Export
- Share

---

# 8. Character Creation

The character creation experience has been intentionally simplified.

The previous design had too many customization options.

DO NOT recreate a complex:

- Archetype
- Outfit
- Accessory
- Palette
- Travel Style

configuration system.

The character creator should instead feel like a simple 8-bit RPG personality questionnaire.

---

# 9. Character Visual Direction

The desired character style is based on a polished chibi 8-bit / pixel-art RPG character.

Characteristics:

- Clearly recognisable human
- Chibi proportions
- Large head relative to body
- Small body
- Simple readable face
- Clean silhouette
- Intentional pixel clusters
- Consistent pixel grid
- Deliberate shading
- Dark outline
- Cute but polished RPG aesthetic

The character should look like an actual designed RPG sprite.

Do NOT use:

- Emoji as the final character
- Rough HTML/CSS rectangles
- Random geometric shapes
- Generic avatar placeholders
- A crude collection of coloured blocks

The character should be visually polished.

---

# 10. Character Creation Flow

## STEP 1 — CHOOSE YOUR BUDGET

Options:

- Low Budget
- Medium Budget
- High Budget

This is a preference category.

---

## STEP 2 — WHAT ROLE DO YOU PLAY IN A GROUP TRIP?

Options:

- Leader
- Planner
- Follower
- Chill
- Adventurer

This is the primary personality/archetype representation of the character.

The selected role can influence the visual identity of the 8-bit character.

---

## STEP 3 — WHAT DO YOU WANT MOST FROM THIS TRIP?

Multiple selections allowed.

Options:

- Food
- Scenery
- Adventure
- Shopping
- Nightlife
- Culture
- Relaxation
- Hidden Gems
- Flexibility

---

# 11. Travel Preferences

Keep:

## Interests

- Food
- Museums
- Nature
- Nightlife
- Shopping
- History

Multiple selections allowed.

## Destinations

Initial example options:

- Tokyo
- Seoul
- Bangkok
- Paris

These may later become dynamically generated.

## Activities

- Hiking
- Markets
- Beaches
- Temples
- Tours
- Relaxing

Multiple selections allowed.

---

# 12. Adventure Funds

Keep a numeric budget input.

Example:

$1500

The budget should eventually be used by the backend/AI when:

- recommending destinations
- finding flights
- generating itineraries
- evaluating whether the trip exceeds the user's budget

---

# 13. Availability

Keep:

Available From

dd/mm/yyyy

Available Until

dd/mm/yyyy

Store these as structured dates.

---

# 14. Remove These Inputs

Do NOT ask for:

## Origin

All users are assumed to depart from:

Singapore

Therefore there is no origin selection field.

## Hard Constraints

This field has intentionally been removed from the current character/preference flow.

---

# 15. Character Creation Screen

The initial lobby should use a two-column layout.

LEFT:

Character creation and preferences.

RIGHT:

Your Adventure / Trip Status.

Conceptually:

------------------------------------------------
| CREATE YOUR CHARACTER       | YOUR ADVENTURE |
|                             |                |
|      8-BIT CHARACTER        | Trip name      |
|                             | Dates          |
| STEP 1 — BUDGET            | Party          |
|                             | Destination    |
| STEP 2 — GROUP ROLE        | Flight         |
|                             | Budget         |
| STEP 3 — TRIP PRIORITIES   | Progress       |
|                             |                |
| INTERESTS                   |                |
| DESTINATIONS                |                |
| ACTIVITIES                  |                |
|                             |                |
| ADVENTURE FUNDS             |                |
|                             |                |
| AVAILABLE FROM              |                |
| AVAILABLE UNTIL             |                |
|                             |                |
| [ SAVE CHARACTER ]          |                |
------------------------------------------------

The character should be visually prominent.

---

# 16. Character Implementation

The character should be reusable.

The character should not be a one-off element only used in character creation.

It should eventually be reusable in:

- Character creation
- Party member cards
- Party Room
- Sidebar
- Chat participants
- Final trip summary

The current simplified system should primarily use the selected group role to influence the character.

Do not over-engineer character customization.

---

# 17. UI Design Philosophy

The application should feel like an 8-bit RPG.

Use pixel-art styling for:

- Character sprites
- Dialogue boxes
- Buttons
- Selection cards
- Quest/status panels
- Progress indicators
- Decorative borders
- Icons
- Party members

However, readability takes priority.

Use conventional readable UI for:

- Dates
- Prices
- Budget
- Long descriptions
- Forms
- Important information

Do not make every element excessively pixelated.

---

# 18. AI Travel Guide

The AI orchestration agent is presented to the user as an NPC Travel Guide.

The frontend should show:

- AI avatar
- AI name/title
- Dialogue
- Questions
- Recommendations
- Decisions
- Loading/processing states

Do NOT expose:

- LangGraph
- Agent nodes
- Internal prompts
- Orchestration architecture
- Backend service names

Instead use user-facing messages.

Examples:

"The Travel Guide is comparing everyone's preferences..."

"The Travel Guide is searching for suitable flights..."

"The Travel Guide is preparing your adventure..."

"The party's feedback is being considered..."

---

# 19. Frontend/Backend Boundary

Not every backend operation appears as a visible screen.

Example:

User action:
Vote Destination

Frontend:
User clicks vote.

Backend:
Calculate/update vote.

Frontend:
Show voting result.

Example:

Backend:
Search flights.

Frontend:
Show:

"The Travel Guide is searching for suitable flights..."

Then display flight cards when results arrive.

The frontend must understand what backend operation is required for each interaction, but should not expose internal backend implementation.

---

# 20. Service Architecture

Frontend components should NOT directly call APIs or Supabase.

Use a service abstraction.

Conceptually:

UI Component
    ↓
Service Interface
    ↓
Mock Service / API Service
    ↓
Backend or Supabase

During development, mock services are allowed.

Mocks MUST follow the same interfaces and response structures defined by `api-contracts.md`.

This allows frontend and backend developers to work in parallel.

When backend services are ready:

Mock Service
    ↓
replace with
    ↓
API Service

The UI should not need to be rewritten.

---

# 21. Supabase

Supabase is part of my responsibilities.

Expected areas include:

- Authentication
- Users
- Profiles
- Characters
- Trip membership
- Preferences
- Votes
- Messages
- Itinerary versions
- Realtime updates

However, follow the existing Supabase architecture before creating or modifying tables.

Do not expose Supabase service-role keys on the frontend.

Privileged operations remain backend responsibilities.

---

# 22. Current Frontend Development Priority

The immediate goal is NOT to build the entire application.

Focus first on:

1. Frontend shell
2. Pixel design foundation
3. Lobby / Gather the Party
4. Character creation
5. Travel preferences
6. Party Room
7. Chat interface

Then progressively build:

8. Destination interaction
9. Flight interaction
10. Itinerary
11. Feedback
12. Refinement
13. Final trip
14. Export

---

# 23. Current Character Creation Scope

The immediate implementation should contain:

- 8-bit character preview
- Budget selection
- Group role selection
- Trip priorities
- Interests
- Destination preferences
- Activities
- Adventure funds
- Available from
- Available until
- Save Character

Do NOT implement yet:

- Supabase persistence
- FastAPI
- LangGraph
- Destination discovery
- Flight search
- Voting
- Itinerary generation
- Feedback
- Negotiation
- Export

unless specifically requested.

Use local/mock state while developing the frontend.

---

# 24. Important Coding Principles

Prioritise:

- Reusable components
- TypeScript type safety
- Small focused components
- Feature-based organisation
- Consistent naming
- Responsive design
- Accessibility
- Maintainable state management
- Clear frontend/backend boundaries

Avoid:

- Giant monolithic components
- Duplicated UI
- Direct API calls inside presentational components
- Hardcoded business logic
- Unnecessary abstraction
- Overengineering
- Rewriting unrelated working code

Before creating a new component, check whether an existing reusable component can be extended.

---

# 25. Codex Working Instructions

When working on this project:

1. Inspect the existing repository before making assumptions.
2. Read the relevant `.kiro/steering/` files if they exist.
3. Read the existing Specs before implementing a feature.
4. Preserve the existing architecture.
5. Do not unnecessarily rewrite working code.
6. Follow existing API contracts.
7. Follow existing Supabase architecture.
8. Use mock services where backend functionality is not yet available.
9. Keep frontend/backend responsibilities separated.
10. Prefer incremental changes over large rewrites.

When a requirement is unclear:

- Check the existing project documentation first.
- Check the user experience flow.
- Check the API contract.
- Check the existing implementation.
- Ask before making a major architectural assumption.

When backend changes are required for frontend functionality:

- Clearly identify why the backend change is needed.
- Keep the change minimal.
- Do not independently redesign the backend architecture.

---

# Canonical User-Facing Trip Progression

The application has six user-facing stages.

These names and descriptions are the canonical terminology shown to users.

## Stage 1 — Gather the Party

"Form your party and share the room code so others can join."

Purpose:
- Create trip
- Invite / join party
- Share room code
- Create 8-bit character
- Enter travel preferences
- Wait for party members

Initial state:
IN PROGRESS


## Stage 2 — Choose the Destination

"Compare destinations and vote on where the quest begins."

Purpose:
- Display destination recommendations
- Compare destinations
- Vote on destination

Initial state:
LOCKED until Stage 1 requirements are satisfied.


## Stage 3 — Arrange Travel

"Weigh flight and travel options against budget and dates."

Purpose:
- Search flights
- Display flight options
- Compare flights
- Vote on flight

Initial state:
LOCKED until destination selection is complete.


## Stage 4 — Draft the Quest Log

"Draft the first itinerary from the party's choices."

Purpose:
- Generate itinerary
- Display initial itinerary
- Present itinerary as an adventure / quest log

Initial state:
LOCKED until travel arrangements are complete.


## Stage 5 — Improve Together

"Refine the plan together until the whole party approves."

Purpose:
- Group feedback
- AI negotiation
- Itinerary refinement
- Review new version
- Repeat refinement if required

Initial state:
LOCKED until the initial itinerary is generated.


## Stage 6 — Complete the Adventure

"Review and share the final adventure summary."

Purpose:
- Review final itinerary
- Approve final trip
- Export
- Share

Initial state:
LOCKED until the group approves the itinerary.


# Stage State Model

The frontend should represent each stage as one of:

- LOCKED
- ACTIVE / IN PROGRESS
- COMPLETE

The backend should be the source of truth for the current trip stage.

The frontend should not independently determine the overall trip stage.

The right-hand Adventure sidebar should display the six stages and their current state.

User-facing terminology should use the names above.

Internal code may use concise enum values such as:

GATHER_PARTY
CHOOSE_DESTINATION
ARRANGE_TRAVEL
DRAFT_QUEST_LOG
IMPROVE_TOGETHER
COMPLETE_ADVENTURE

The final product should feel like:

> An AI-guided 8-bit adventure with your friends.

It should NOT feel like:

> A conventional travel planning website with pixel-art decorations.