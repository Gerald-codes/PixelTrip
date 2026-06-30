# PixelTrip — UI Style Steering

PixelTrip must not look like a plain black-and-white SaaS app.

The app should feel like an 8-bit collaborative travel planning game inspired by playful AWS-style pixel characters.

## Visual Direction

Use a colourful, playful, pixel-art inspired interface.

The UI should feel:
- Game-like
- Collaborative
- Fun
- Travel-themed
- Slightly nostalgic
- Demo-friendly
- Easy to understand

Avoid:
- Plain black-and-white layouts
- Generic SaaS dashboards
- Text-only persona selection
- Full-page step-by-step form feeling
- Refreshing the page to sync users

## Core UX Direction

The app should feel like users are inside a shared trip room.

Instead of hard page reloads between stages, use a persistent room shell:

- Room header stays visible
- Member avatars stay visible
- Stage progress stays visible
- Main content changes based on currentStage
- Realtime updates should happen without refreshing the whole page

Use Supabase Realtime subscriptions for:
- Room stage changes
- Member/persona updates
- Vote updates
- Itinerary updates
- Feedback updates

When another collaborator makes a change, update local state smoothly instead of forcing a full page refresh.

## Character Creator

Persona selection should not be plain text.

Users should customise an 8-bit travel character using three main choices:

1. Budget
2. Travel style / decision role
3. Trip interest

These choices should visually affect the character.

### Budget affects outfit

Low budget:
- Backpacker clothes
- Simple shirt
- Small backpack

Medium budget:
- Casual traveller outfit
- Jacket or hoodie
- Normal travel bag

High budget:
- Stylish outfit
- Sunglasses or premium jacket
- Suitcase or luxury accessory

### Travel style affects headwear / personality

Leader:
- Pirate captain hat, crown, or explorer leader hat
- Confident stance

Planner:
- Cap, clipboard, map, or glasses
- Organised look

Follower:
- Simple villager-style hat or basic hairstyle
- Relaxed look

Chill:
- Beanie, headphones, or relaxed cap
- Calm pose

Adventurer:
- Explorer hat
- More energetic pose

### Trip interest affects handheld item

Food:
- Fork, snack, bubble tea, or food tray

Scenery:
- Camera or binoculars

Adventure:
- Hiking stick or compass

Shopping:
- Shopping bag

Nightlife:
- Small neon drink cup or music icon

Anything / flexible:
- Map or question-mark travel badge

## Multiple Interests

Users can select multiple trip interests.

Trip interests include:
- food
- scenery
- adventure
- shopping
- nightlife
- culture
- relaxation
- hidden gems
- flexible

The avatar should show one main interest item and smaller badges for additional interests.

Do not restrict users to only one interest.

## Guided Destination Discovery

Destination input should not be mainly a textbox.

The app should guide users with visual cards and chips.

First ask:
“Where do you feel like going?”

Show high-level choices:
- Asia
- Europe / Western Cities
- Beach Escape
- Nature & Scenery
- Food Trip
- Cultural Trip
- Adventure Trip
- Shopping City
- Hidden Gems
- Anywhere / Surprise Me

Then show suggested destination chips/cards based on those choices.

Users can select multiple suggestions.

Manual typing should exist only as an optional “Add custom destination” fallback.

The flow should feel like a travel discovery mood board, not a form.

## Character Creator UI

The character creator should have:
- A large pixel avatar preview
- Option cards for budget
- Option cards for travel style
- Option cards for trip interest
- Live preview changes when options are selected
- A short generated persona summary
- A “Confirm Character” button

Example summary:
“Keith is a medium-budget Foodie Planner who prefers organised routes, good meals, and balanced pacing.”

## Persona Data Model

Replace fixed text-only personas with a configurable character profile:

CharacterProfile:
- userId
- roomId
- displayName
- budgetLevel: low | medium | high
- travelStyle: leader | planner | follower | chill | adventurer
- tripInterest: food | scenery | adventure | shopping | nightlife | flexible
- avatarConfig:
  - baseBody
  - outfit
  - headwear
  - handheldItem
  - accessory
- generatedPersonaName
- planningWeights

The selected character attributes should affect:
- Destination suggestions
- Itinerary generation
- Fairness summary
- Negotiation

## Room UI

The room should feel alive and collaborative.

Show:
- Room code
- Current stage
- Connected members
- Each member’s pixel avatar
- Host badge
- Ready/submitted state
- Shared progress bar

Avoid:
- Moving users through disconnected pages
- Requiring full browser refresh
- Text-only status updates

## Design Style

Use:
- Tailwind CSS
- Bright travel-inspired colours
- Pixel-style borders and cards
- Soft gradients
- 8-bit icons
- Clear CTA buttons
- Card-based layouts
- Responsive layout

Suggested colours:
- Sky blue
- Sunset orange
- Grass green
- Sand cream
- Deep navy
- Neon purple accents

Use CSS pixel-art style where possible:
- image-rendering: pixelated
- blocky borders
- retro buttons
- simple sprite-like avatar layers

## Important Screens

Prioritise redesigning:
1. Landing page
2. Shared room shell
3. Character creator
4. Destination suggestions
5. Voting screen
6. Itinerary and fairness summary
7. Feedback and negotiation screen

## MVP Avatar Implementation

For the hackathon, do not require complex generated art.

Implement characters using layered simple pixel-style components:
- base body
- outfit
- headwear
- handheld item
- accessory

These can be implemented using:
- simple SVG components
- CSS pixel blocks
- emoji-like placeholder icons temporarily
- local PNG sprites if available

The important thing is that changing budget, travel style, and trip interest visibly changes the character preview.