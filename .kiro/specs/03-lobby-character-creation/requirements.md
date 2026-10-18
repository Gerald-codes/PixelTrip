# Requirements Document

## Introduction

This feature formalizes the **Lobby / Gather the Party / Character Creation** screen —
the interactive heart of the SETUP stage of the PixelArt Trip Planner adventure. It is a
two-column desktop surface: a **left panel** where an adventurer builds an 8-bit pixel
character out of composable visual layers and sets their travel preferences, and a
**right "Your Adventure" sidebar** that persistently shows trip status, the party, budget,
and the six-stage quest progression.

This feature is **frontend-only** and **session-only**. It introduces no backend, no new
service, and no persistence. "Save Character" places the character into in-memory React
state for the current session only; it is lost on reload. The feature composes cleanly
into the existing `src/features/party-lobby` room shell as the SETUP-stage content and is
designed to coexist with the future Party Room / NPC chatbot experience without
redesigning any later stage (DISCOVER → WRAP).

The right sidebar's DESTINATION and FLIGHT sections are **empty-state placeholders only**.
No destination, flight, itinerary, refinement, voting, feedback, export, or AI/chat
behavior is in scope.

### Scope Boundary (Non-Goals)

The following are explicit non-goals of this feature:

- **No persistence of any kind.** No Supabase, no `localStorage`, no `sessionStorage`, no
  cookies, no IndexedDB, no file writes. Saving stores the character in in-memory React
  state only.
- **No backend.** No FastAPI call, no Supabase call, no LangGraph, no API endpoint, and no
  change to `api-contracts.md` or any shared contract type.
- **No new service.** No new entry in `src/services`. The feature reads only mock/local
  feature-scoped data. It does not add a `characterService`.
- **No later-stage functionality.** DESTINATION and FLIGHT render fixed empty states with
  no behavior. DISCOVER, LOGISTICS, BUILD, REFINE, WRAP, voting, feedback, export, and
  AI/chat are out of scope.
- **No real invite system.** The INVITE MEMBERS affordance is UI-only; it triggers no
  network request and sends nothing.

## Glossary

- **Character_Creator**: The left-panel feature component where the user builds a character
  and sets travel preferences.
- **Character_Preview**: The large composable 8-bit avatar in the upper-left area that
  re-renders on every selection.
- **Layer_Renderer**: The rendering mechanism that stacks ordered pixel visual layers
  (Base, Archetype, Outfit, Accessory) into the Character_Preview.
- **Layer_Map**: The data-driven mapping from a selection id to the visual layer(s) it
  contributes, including stacking order.
- **Session_Character**: The character stored in in-memory React state after a successful
  save; the party character for the current browser session only. Its shape mirrors the
  backend request payload 1:1 (availableDates, destinations, travelStyle, budget, interests,
  activities with priority, hardConstraints, origin, and a nested `character` with appearance
  and spriteKey) so a future service can send it unchanged — though nothing is sent here.
- **Character_Draft**: The in-memory, not-yet-saved set of current selections.
- **Adventure_Sidebar**: The right-panel "Your Adventure" trip-status surface.
- **Progress_Stepper**: The six-stage (SETUP, DISCOVER, LOGISTICS, BUILD, REFINE, WRAP)
  RPG quest progression display in the Adventure_Sidebar.
- **Budget_Panel**: The Adventure_Sidebar section showing budget limit, estimated
  expenditure, and remaining budget, including an over-budget visual contract.
- **Theme_Token**: A named Tailwind theme token (e.g. `bg`, `ink`, `primary`, `accent`,
  `danger`, `muted`) from `pixel-design-system.md`. Raw hex and arbitrary values are
  forbidden.
- **Service_Boundary**: The `getServices()` selector in `src/services/index.ts`; the only
  sanctioned data-access seam. This feature imports no concrete `*.mock.ts`/`*.api.ts`.
- **Desktop_Viewport**: A viewport at or above the design system's two-column breakpoint.
- **Mobile_Viewport**: A viewport below the two-column breakpoint.

## Requirements

### Requirement 1: Two-column lobby layout

**User Story:** As an adventurer, I want a clear two-column lobby, so that I can build my
character while always seeing the trip status.

#### Acceptance Criteria

1. WHILE rendering on a Desktop_Viewport, THE Character_Creator SHALL display the character
   creation panel on the left and the Adventure_Sidebar on the right as two columns.
2. THE Character_Creator SHALL render the heading "CREATE YOUR CHARACTER".
3. THE Character_Creator SHALL render the subtitle "Build your traveller for the
   adventure.".
4. THE Adventure_Sidebar SHALL render the heading "YOUR ADVENTURE".
5. THE Character_Creator SHALL compose as the SETUP-stage left content of the existing
   party-lobby room shell without altering any later-stage view.

### Requirement 2: Composable layered character preview

**User Story:** As an adventurer, I want a large pixel character made of stacked layers,
so that my choices visibly build a unique traveller.

#### Acceptance Criteria

1. THE Character_Preview SHALL render the character as an ordered stack of visual layers
   drawn from the layer set Base, Archetype, Outfit, and Accessory.
2. THE Character_Preview SHALL render each active layer as an 8-bit pixel visual, not as an
   emoji and not as a single flat combined image.
3. WHEN a user changes any archetype, outfit, or accessory selection, THE Character_Preview
   SHALL update the corresponding layer to reflect the new selection.
4. THE Layer_Renderer SHALL resolve each selection to its layer(s) through the data-driven
   Layer_Map rather than through hard-coded per-combination rendering.
5. WHERE a new asset is added to the Layer_Map, THE Layer_Renderer SHALL render that asset
   without requiring changes to the Character_Preview component.
6. THE Character_Preview SHALL render the Base layer so that the preview is non-empty before
   any archetype, outfit, or accessory is selected.
7. THE Character_Preview SHALL stack layers in the Layer_Map's defined order so that
   higher-order layers render in front of lower-order layers.

### Requirement 3: Archetype selection

**User Story:** As an adventurer, I want to pick a character archetype, so that my traveller
has a role identity.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the archetype options Explorer, Ranger, Scholar, and
   Wanderer as single-select pixel-art cards.
2. WHEN a user selects an archetype, THE Character_Creator SHALL mark that archetype as the
   single active archetype and clear any previously active archetype.
3. WHEN a user selects an archetype, THE Character_Preview SHALL update the Archetype layer.
4. THE Character_Creator SHALL expose the active archetype card's pressed state to assistive
   technology via `aria-pressed`.

### Requirement 4: Outfit selection

**User Story:** As an adventurer, I want to choose an outfit, so that my traveller looks the
part.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the outfit options Casual, Backpack, Premium, and
   All-weather as single-select cards.
2. WHEN a user selects an outfit, THE Character_Creator SHALL mark that outfit as the single
   active outfit and clear any previously active outfit.
3. WHEN a user selects an outfit, THE Character_Preview SHALL update the Outfit layer.
4. THE Character_Creator SHALL expose the active outfit card's pressed state via
   `aria-pressed`.

### Requirement 5: Accessory selection

**User Story:** As an adventurer, I want to add an accessory, so that my traveller carries
adventuring gear.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the accessory options Map, Camera, Compass, and
   Lantern as single-select cards.
2. WHEN a user selects an accessory, THE Character_Creator SHALL mark that accessory as the
   single active accessory and clear any previously active accessory.
3. WHEN a user selects an accessory, THE Character_Preview SHALL layer the accessory onto the
   preview.
4. THE Character_Creator SHALL expose the active accessory card's pressed state via
   `aria-pressed`.

### Requirement 6: Travel style selection

**User Story:** As an adventurer, I want to set one travel style, so that the party knows how
I like to travel.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the travel style options Backpacker, Luxury, Balanced,
   Foodie, and Adventure as single-select pixel choice cards.
2. WHEN a user selects a travel style, THE Character_Creator SHALL mark that travel style as
   the single active travel style and clear any previously active travel style.
3. THE Character_Creator SHALL expose the active travel style card's pressed state via
   `aria-pressed`.

### Requirement 7: Interests selection

**User Story:** As an adventurer, I want to pick several interests, so that the trip reflects
what I enjoy.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the interest options Food, Museums, Nature, Nightlife,
   Shopping, and History as multi-select pixel tags.
2. WHEN a user selects an unselected interest, THE Character_Creator SHALL add that interest
   to the active interest set.
3. WHEN a user selects an already-selected interest, THE Character_Creator SHALL remove that
   interest from the active interest set.
4. THE Character_Creator SHALL expose each interest tag's selected state via `aria-pressed`.

### Requirement 8: Activities selection

**User Story:** As an adventurer, I want to pick several activities, so that the plan matches
what I want to do.

#### Acceptance Criteria

1. THE Character_Creator SHALL present the activity options Hiking, Markets, Beaches, Temples,
   Tours, and Relaxing as multi-select pixel tags.
2. WHEN a user selects an unselected activity, THE Character_Creator SHALL add that activity
   to the active activity set with a default priority of "must_have".
3. WHEN a user selects an already-selected activity, THE Character_Creator SHALL remove that
   activity from the active activity set.
4. THE Character_Creator SHALL expose each activity tag's selected state via `aria-pressed`.
5. WHERE an activity is selected, THE Character_Creator SHALL present a priority control
   allowing the user to set that activity's priority to "must_have" or "optional".
6. THE Character_Creator SHALL store each selected activity in the Character_Draft as an
   object with a name and a priority of "must_have" or "optional".

### Requirement 9: Budget input

**User Story:** As an adventurer, I want to enter my adventure funds, so that the party can
plan within budget.

#### Acceptance Criteria

1. THE Character_Creator SHALL present a numeric budget input labelled "ADVENTURE FUNDS".
2. THE Character_Creator SHALL render the budget input with placeholder text "1500".
3. THE Character_Creator SHALL render the budget input as a conventional readable numeric
   field rather than an over-pixelated field.
4. WHEN a user enters a numeric budget value, THE Character_Creator SHALL store that value
   numerically in the Character_Draft.
5. IF the budget input is empty, THEN THE Character_Creator SHALL store the Character_Draft
   budget as null.

### Requirement 10: Availability dates

**User Story:** As an adventurer, I want to enter the dates I'm free, so that the trip fits my
schedule.

#### Acceptance Criteria

1. THE Character_Creator SHALL present at least one availability range, each range having an
   "Available From" date input and an "Available Until" date input as conventional readable
   date fields.
2. WHEN a user sets a range's Available From date, THE Character_Creator SHALL store that date
   in the range as an ISO 8601 date string.
3. WHEN a user sets a range's Available Until date, THE Character_Creator SHALL store that date
   in the range as an ISO 8601 date string.
4. THE Character_Creator SHALL store availability in the Character_Draft as a list of
   `{ start, end }` ranges.
5. THE Character_Creator SHALL allow the user to add and remove availability ranges, keeping at
   least one range present.

### Requirement 11: Save character to session

**User Story:** As an adventurer, I want to save my character, so that it becomes my party
character for this session.

#### Acceptance Criteria

1. THE Character_Creator SHALL present a primary save control labelled "SAVE CHARACTER".
2. WHEN a user activates the save control, THE Character_Creator SHALL copy the current
   Character_Draft into the Session_Character held in in-memory React state.
3. WHEN a save completes, THE Character_Creator SHALL display a status message stating the
   character is saved for this session only and is not persisted.
4. THE Character_Creator SHALL hold the Session_Character in in-memory React state only and
   SHALL NOT write it to Supabase, `localStorage`, `sessionStorage`, cookies, or any
   backend.
5. THE Character_Creator SHALL render the save status message via a polite live region so
   assistive technology announces it.
6. WHILE the Character_Draft lacks a selected archetype, outfit, or accessory, THE
   Character_Creator SHALL disable the save control.

### Requirement 12: Adventure sidebar trip header

**User Story:** As an adventurer, I want to see the trip name and dates, so that I know which
adventure the party is planning.

#### Acceptance Criteria

1. THE Adventure_Sidebar SHALL display a trip name from feature-local mock data.
2. THE Adventure_Sidebar SHALL display trip travel dates from feature-local mock data in a
   conventional readable format.
3. THE Adventure_Sidebar SHALL source the trip name and dates from feature-local mock data
   and SHALL NOT request them from any backend.

### Requirement 13: Adventure sidebar party section

**User Story:** As an adventurer, I want to see the party, so that I know who has joined.

#### Acceptance Criteria

1. THE Adventure_Sidebar SHALL display each party member as a small 8-bit character with a
   name label.
2. WHERE the party has fewer members than its displayed capacity, THE Adventure_Sidebar
   SHALL render the remaining positions as empty party slots.
3. THE Adventure_Sidebar SHALL render each decorative member sprite as hidden from assistive
   technology.
4. THE Adventure_Sidebar SHALL present an "INVITE MEMBERS" affordance that performs no
   network request.
5. WHERE a room session with a room code is available, THE Adventure_Sidebar SHALL surface
   that room code within the invite affordance.
6. WHERE no room session is available, THE Adventure_Sidebar SHALL render a placeholder in
   place of the room code.

### Requirement 14: Adventure sidebar destination and flight placeholders

**User Story:** As an adventurer, I want to see where destination and flight will appear, so
that I understand what the quest will fill in later.

#### Acceptance Criteria

1. THE Adventure_Sidebar SHALL render a DESTINATION section whose value is the empty state
   "Not selected".
2. THE Adventure_Sidebar SHALL render a FLIGHT section whose value is the empty state
   "Not selected".
3. THE Adventure_Sidebar SHALL render the DESTINATION and FLIGHT sections as non-interactive
   display-only placeholders.

### Requirement 15: Adventure sidebar budget panel

**User Story:** As an adventurer, I want a budget readout, so that the party can see spend
against the limit.

#### Acceptance Criteria

1. THE Budget_Panel SHALL display a budget limit, an estimated expenditure, and a remaining
   budget.
2. WHILE no expenditure is recorded, THE Budget_Panel SHALL display an estimated expenditure
   of "$0" and a remaining budget of "$1,500".
3. WHILE the estimated expenditure is less than or equal to the budget limit, THE
   Budget_Panel SHALL present the remaining budget in a within-budget visual state.
4. WHILE the estimated expenditure is greater than the budget limit, THE Budget_Panel SHALL
   present an over-budget visual state showing the overage amount and the label "OVER
   BUDGET".
5. THE Budget_Panel SHALL convey the over-budget state through a Theme_Token status color
   together with a text label rather than through color alone.

### Requirement 16: Adventure progress stepper

**User Story:** As an adventurer, I want to see quest progress, so that I know how far the
party has come.

#### Acceptance Criteria

1. THE Progress_Stepper SHALL display the six stages SETUP, DISCOVER, LOGISTICS, BUILD,
   REFINE, and WRAP in that order.
2. THE Progress_Stepper SHALL present SETUP as the active stage.
3. THE Progress_Stepper SHALL present DISCOVER, LOGISTICS, BUILD, REFINE, and WRAP as
   inactive upcoming stages.
4. THE Progress_Stepper SHALL distinguish the active stage from inactive stages through a
   text or structural indicator in addition to a Theme_Token color.

### Requirement 17: Responsive layout

**User Story:** As an adventurer on a phone, I want the lobby to adapt, so that I can still
build my character comfortably.

#### Acceptance Criteria

1. WHILE rendering on a Mobile_Viewport, THE Character_Creator SHALL keep the Character_Preview
   prominent above the selection options.
2. WHILE rendering on a Mobile_Viewport, THE Adventure_Sidebar SHALL render as a collapsible
   drawer panel rather than a fixed second column.
3. WHILE rendering on a Mobile_Viewport, THE Character_Creator SHALL present the selection
   options in a single vertically scrollable column.
4. WHEN a user activates the drawer toggle on a Mobile_Viewport, THE Adventure_Sidebar SHALL
   expand or collapse accordingly.
5. THE Adventure_Sidebar drawer toggle SHALL expose its expanded or collapsed state to
   assistive technology.

### Requirement 18: Accessibility

**User Story:** As an adventurer using a keyboard or screen reader, I want full operability,
so that I can create my character without a mouse.

#### Acceptance Criteria

1. THE Character_Creator SHALL arrange interactive controls in a logical focus order that
   follows the visual reading order.
2. THE Character_Creator SHALL render a visible focus indicator on every focusable control.
3. THE Character_Creator SHALL allow every selection and the save control to be operated by
   keyboard.
4. THE Character_Creator SHALL associate every budget and date input with a programmatic
   label.
5. WHILE the user has requested reduced motion, THE Character_Creator SHALL suppress
   non-essential animation.
6. THE Character_Preview and decorative sidebar sprites SHALL be hidden from assistive
   technology.

### Requirement 19: Visual token compliance and layering boundaries

**User Story:** As a frontend developer, I want the feature to follow the design system and
architecture, so that it stays consistent and maintainable.

#### Acceptance Criteria

1. THE Character_Creator and THE Adventure_Sidebar SHALL style every element using
   Theme_Tokens and SHALL NOT use raw hex values or arbitrary magic values.
2. THE Character_Creator and THE Adventure_Sidebar SHALL compose the shared primitives
   PixelButton, PixelCard, and CharacterSprite from `src/components` rather than
   re-implementing them.
3. THE Character_Creator and THE Adventure_Sidebar SHALL raise user events through callback
   props and receive data through props rather than embedding data fetching.
4. THE Character_Creator and THE Adventure_Sidebar SHALL NOT import any concrete
   `*.mock.ts` or `*.api.ts` service implementation, accessing data only through local
   feature data or the Service_Boundary selector.
5. THE Character_Creator and THE Adventure_Sidebar SHALL be typed in TypeScript strict mode
   without the use of `any`.

### Requirement 20: Destinations selection

**User Story:** As an adventurer, I want to name the destinations I'm interested in, so that
the party knows where I'd like to go.

#### Acceptance Criteria

1. THE Character_Creator SHALL allow the user to specify one or more destinations.
2. WHEN a user adds a destination, THE Character_Creator SHALL store it in the Character_Draft
   destinations list as a string.
3. WHEN a user removes a destination, THE Character_Creator SHALL remove it from the
   Character_Draft destinations list.
4. THE Character_Creator SHALL store destinations in the Character_Draft as a list of strings.

### Requirement 21: Origin input

**User Story:** As an adventurer, I want to enter my departure origin, so that travel can be
planned from where I start.

#### Acceptance Criteria

1. THE Character_Creator SHALL present an origin input labelled "ORIGIN" with placeholder
   "SIN".
2. WHEN a user enters an origin, THE Character_Creator SHALL store it in the Character_Draft as
   a string.
3. THE Character_Creator SHALL associate the origin input with a programmatic label.

### Requirement 22: Hard constraints input

**User Story:** As an adventurer, I want to list hard constraints, so that the plan respects my
non-negotiables.

#### Acceptance Criteria

1. THE Character_Creator SHALL allow the user to add and remove free-text hard constraints
   (e.g. "no red-eye flights").
2. WHEN a user adds a hard constraint, THE Character_Creator SHALL store it in the
   Character_Draft hard constraints list as a string.
3. WHEN a user removes a hard constraint, THE Character_Creator SHALL remove it from the
   Character_Draft hard constraints list.
4. THE Character_Creator SHALL store hard constraints in the Character_Draft as a list of
   strings.

### Requirement 23: Palette selection and derived sprite key

**User Story:** As an adventurer, I want to pick a colour palette for my character, so that my
traveller's appearance is complete.

#### Acceptance Criteria

1. THE Character_Creator SHALL present palette options as single-select cards.
2. WHEN a user selects a palette, THE Character_Creator SHALL mark it as the single active
   palette and clear any previously active palette.
3. THE Character_Creator SHALL expose the active palette card's pressed state via
   `aria-pressed`.
4. WHEN the character is saved, THE Character_Creator SHALL store the appearance as accessory,
   outfit, and palette, and SHALL derive a deterministic sprite key from the appearance.

