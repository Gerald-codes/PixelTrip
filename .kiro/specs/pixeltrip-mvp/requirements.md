# PixelTrip — Requirements

## Introduction

PixelTrip is a collaborative AI travel planning web application built around 8-bit character personas. Users join a shared trip room, choose a travel character with unique preferences, and work together through an agentic planning pipeline to decide where to travel, build a fair itinerary, and negotiate changes. The MVP focuses on three core differentiators: agentic destination suggestions based on real travel factors, persona-driven itinerary fairness, and an AI-assisted feedback and negotiation loop.

---

## Requirement 1 — Trip Room Creation

### User Story

As a trip host, I want to create a shared trip room so that my friends and I can plan a trip together in one place.

### Acceptance Criteria

- WHEN the host creates a trip room, THE SYSTEM SHALL generate a unique 6-character room code.
- WHEN the room is created, THE SYSTEM SHALL display the room code and a shareable invite link.
- WHEN a user enters a valid room code, THE SYSTEM SHALL allow the user to join the room.
- WHEN a user enters an invalid or expired room code, THE SYSTEM SHALL display a clear error message.
- THE SYSTEM SHALL display all joined members and their connection status in real time.
- THE SYSTEM SHALL display the current planning stage to all users in the room.
- THE SYSTEM SHALL allow only the host to advance the room to the next planning stage.

---

## Requirement 2 — Persona Selection

### User Story

As a trip member, I want to choose an 8-bit character persona so that my travel style and preferences are reflected in the trip planning.

### Acceptance Criteria

- THE SYSTEM SHALL display a gallery of at least 5 selectable 8-bit travel personas.
- EACH persona SHALL have a name, pixel avatar, budget level, interests, travel pace, flexibility level, and decision style.
- WHEN a user selects a persona, THE SYSTEM SHALL save the selection to the user's room profile.
- THE SYSTEM SHALL display each user's chosen persona to all other members in the room.
- THE SYSTEM SHALL allow a user to change their persona before the host advances to the destination suggestion stage.
- THE SYSTEM SHALL pass persona attributes to the destination suggestion agent and the itinerary planning agent.

---

## Requirement 3 — Availability and Destination Interest Input

### User Story

As a trip member, I want to submit my available dates and destination interests so that the AI can find travel windows and destinations that work for the whole group.

### Acceptance Criteria

- THE SYSTEM SHALL allow each user to enter one or more available date ranges.
- THE SYSTEM SHALL allow each user to enter one or more preferred countries or cities.
- WHEN all users have submitted availability, THE SYSTEM SHALL calculate the overlapping travel dates across the group.
- WHEN no overlapping travel dates exist, THE SYSTEM SHALL notify the group clearly and suggest they revisit their availability.
- THE SYSTEM SHALL store each user's destination interests.
- THE SYSTEM SHALL pass overlapping dates and all destination interests to the destination suggestion agent.

---

## Requirement 4 — Group Travel Profile Generation

### User Story

As a group, we want the AI to summarise our combined travel profile so that we understand our collective preferences and tensions before choosing a destination.

### Acceptance Criteria

- WHEN all users have submitted personas, availability, and destination interests, THE SYSTEM SHALL generate a group travel profile.
- THE group profile SHALL include the group's combined budget level, travel pace, common interests, overlapping travel window, and dominant persona traits.
- THE group profile SHALL identify early tension points such as budget mismatch or pace mismatch between personas.
- THE SYSTEM SHALL display the group profile to all members before destination suggestions are shown.

---

## Requirement 5 — Agentic Destination Suggestions

### User Story

As a trip member, I want the AI to recommend destinations based on season, weather, crowd levels, price levels, and our group's personas so that we make a well-informed travel decision.

### Acceptance Criteria

- WHEN the group profile is ready, THE SYSTEM SHALL generate between 3 and 5 destination suggestions.
- EACH destination suggestion SHALL include: destination name, fit score, best travel period reasoning, weather suitability, estimated crowd level, estimated price level, top activities, potential downsides, and which personas it suits best.
- THE SYSTEM SHALL rank destination suggestions from strongest to weakest fit for the group.
- WHEN a destination clearly conflicts with the group's dates, budget, or persona mix, THE SYSTEM SHALL either exclude it or explain the trade-off explicitly.
- THE SYSTEM SHALL avoid generic recommendations and provide context-aware reasoning for each suggestion.

---

## Requirement 6 — Destination Voting

### User Story

As a trip member, I want to vote on the AI-suggested destinations so that the group can collectively decide where to travel.

### Acceptance Criteria

- THE SYSTEM SHALL allow each user to cast exactly one vote per destination vote round.
- THE SYSTEM SHALL prevent a user from casting duplicate votes in the same round.
- WHEN all users have voted, THE SYSTEM SHALL display the vote results to the group.
- THE SYSTEM SHALL select the destination with the most votes as the group's chosen destination.
- WHEN there is a tie, THE SYSTEM SHALL trigger a tie-break vote between the tied destinations.
- WHEN a destination is selected, THE SYSTEM SHALL advance the room to the flight option stage.

---

## Requirement 7 — Flight Option Selection

### User Story

As a trip member, I want to compare flight option categories so that the group can choose a travel approach that fits our budget and comfort preferences.

### Acceptance Criteria

- THE SYSTEM SHALL present three flight option categories: Budget, Comfort, and Best Value.
- EACH flight option SHALL include an estimated price range, estimated travel duration, number of stops, and a short explanation.
- FOR the MVP, THE SYSTEM MAY use mocked or seeded flight data instead of a live flight API.
- THE SYSTEM SHALL explain how each flight category may affect the itinerary experience.
- THE SYSTEM SHALL allow users to vote on their preferred flight category.
- WHEN the group selects a flight category, THE SYSTEM SHALL store the selection for use in itinerary planning.

---

## Requirement 8 — Activity and Preference Collection

### User Story

As a trip member, I want to submit activities, food stops, sights, and experiences I care about so that the AI can include them in the itinerary.

### Acceptance Criteria

- THE SYSTEM SHALL allow each user to submit desired activities, restaurants, sights, and experiences.
- THE SYSTEM SHALL allow users to mark each preference item as must-have or optional.
- THE SYSTEM SHALL allow users to enter things they want to avoid.
- THE SYSTEM SHALL store each submitted preference against the user who submitted it.
- THE SYSTEM SHALL pass all activity preferences to the itinerary building agent.

---

## Requirement 9 — Persona-Driven Itinerary Generation

### User Story

As a group, we want the AI to generate a day-by-day itinerary that balances everyone's personas and preferences fairly.

### Acceptance Criteria

- WHEN the destination, travel dates, flight option, personas, and activity preferences are all available, THE SYSTEM SHALL generate a day-by-day itinerary.
- THE itinerary SHALL include morning, afternoon, evening, and optional night sections for each day.
- THE itinerary SHALL include recommended activities, food stops, and rest periods.
- THE itinerary SHALL consider each user's persona when selecting and weighting activities.
- THE itinerary SHALL balance budget, travel pace, food, scenery, and comfort across all personas.
- THE itinerary SHALL include the reasoning behind major activity choices.
- THE itinerary SHALL indicate which persona or personas benefit from each activity.

---

## Requirement 10 — Fairness Summary

### User Story

As a trip member, I want to see a fairness summary after the itinerary is generated so that I know my preferences were considered.

### Acceptance Criteria

- WHEN the itinerary is generated, THE SYSTEM SHALL generate a fairness summary alongside it.
- THE fairness summary SHALL show how each user's persona was represented in the plan.
- THE fairness summary SHALL highlight if any user's persona has too few preferences included.
- THE fairness summary SHALL flag if the itinerary may be too expensive for low-budget personas, too packed for chill personas, or too unbalanced overall.
- WHEN the itinerary is unfair to one or more personas, THE fairness summary SHALL recommend specific improvements.

---

## Requirement 11 — Itinerary Feedback Scoring

### User Story

As a trip member, I want to score the itinerary so that the group can see how satisfied everyone is with the current plan.

### Acceptance Criteria

- THE SYSTEM SHALL allow each user to give the itinerary a score from 1 to 10.
- THE SYSTEM SHALL store each user's score individually.
- THE SYSTEM SHALL calculate and display the group's average satisfaction score.
- THE SYSTEM SHALL display per-persona feedback summaries.
- WHEN the average score is below 6, THE SYSTEM SHALL recommend that the host trigger a revision.
- WHEN a single user gives a score below 4, THE SYSTEM SHALL highlight that the itinerary may be unfair to that user's persona.

---

## Requirement 12 — Itinerary Feedback and Amendments

### User Story

As a trip member, I want to request changes to the itinerary so that the plan can better reflect my preferences.

### Acceptance Criteria

- THE SYSTEM SHALL allow each user to submit written feedback comments.
- THE SYSTEM SHALL allow each user to request additions of specific places or activities.
- THE SYSTEM SHALL allow each user to request the removal of activities they dislike.
- THE SYSTEM SHALL allow each user to mark up to 3 requests as important (high-priority).
- THE SYSTEM SHALL display all submitted amendment requests to the full group.
- THE AI SHALL summarise the combined requested changes across all users.
- THE AI SHALL identify whether requested changes create conflicts with budget, timing, routing, or other users' preferences.

---

## Requirement 13 — AI Negotiation and Conflict Resolution

### User Story

As a group, we want the AI to help us resolve conflicts in the itinerary so that we can reach a fair compromise without arguing.

### Acceptance Criteria

- WHEN user feedback creates a conflict, THE SYSTEM SHALL trigger the conflict resolution agent.
- THE conflict resolution agent SHALL explain the conflict in plain, clear language.
- THE conflict resolution agent SHALL identify which users or personas are affected.
- THE conflict resolution agent SHALL propose at least two possible resolution options.
- THE SYSTEM SHALL allow users to vote on the proposed resolution.
- WHEN a resolution option wins the vote, THE SYSTEM SHALL update the itinerary accordingly.
- THE SYSTEM SHALL preserve unchanged parts of the itinerary where possible.
- THE SYSTEM SHALL display a clear summary of what changed after the revision.

---

## Requirement 14 — Itinerary Revision Loop

### User Story

As a trip member, I want the AI to revise the itinerary based on feedback and votes so that the final plan improves over multiple rounds.

### Acceptance Criteria

- THE SYSTEM SHALL allow multiple rounds of feedback, negotiation, and revision.
- THE SYSTEM SHALL maintain a version history of all itinerary drafts.
- THE SYSTEM SHALL display a diff summary showing what changed between the previous and current version.
- THE SYSTEM SHALL regenerate the fairness summary after each revision.
- THE SYSTEM SHALL update the satisfaction score after each revision.
- THE SYSTEM SHALL allow the host to end the revision loop and finalise the itinerary at any time.

---

## Requirement 15 — Final Itinerary Export

### User Story

As a trip host, I want to finalise and export the itinerary so that the group has a usable plan for the actual trip.

### Acceptance Criteria

- THE SYSTEM SHALL allow the host to mark the itinerary as finalised.
- THE SYSTEM SHALL display the final itinerary in a clean, readable day-by-day format.
- THE final itinerary SHALL include destination, travel dates, selected flight category, daily plan, activity notes, and the final fairness summary.
- THE SYSTEM SHALL allow all users to copy the itinerary as plain text or Markdown.
- WHEN the itinerary is finalised, THE SYSTEM SHALL prevent further edits unless the host explicitly reopens planning.
