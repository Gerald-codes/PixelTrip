# Requirements Document

## Introduction

This document specifies the requirements for a collaborative, agentic travel itinerary planner web application. The system enables friends to join a shared planning room without full user registration, submit travel availability and destination interests, receive AI-generated destination overviews, vote as a group, compare real flight and accommodation options, collect individual travel preferences, generate a validated itinerary, manage budget risks, optimize transportation, receive reminders, and export a final travel plan.

The application is designed for a hackathon-friendly step-by-step planning pipeline. To reduce duplicated agent responsibilities, destination suggestion, preference interpretation, itinerary generation, activity validation, booking feasibility checks, and itinerary replanning are handled by one combined **Travel_Planning_Agent**. More specialized data-heavy functions remain separate: **Flight_Agent**, **Hotel_Agent**, **Budget_Agent**, and **Transportation_Agent**.

## Glossary

- **Planning_Room**: A shared workspace where a group of travelers collaborates on one trip itinerary through a sequential planning process
- **Room_Owner**: The traveler who created a Planning_Room or has been granted administrative control over it
- **Room_Member**: A traveler who has joined a Planning_Room and can participate in the planning process
- **Guest_Session**: A temporary browser-local or room-local session used to identify a traveler within a Planning_Room without requiring account registration
- **Participant_Display_Name**: A room-local name entered by a traveler so other Room_Members can identify their contributions
- **Invite_Link**: A unique, shareable URL that grants access to join a specific Planning_Room
- **Planning_Phase**: One of the sequential stages of the planning process: Availability and Destination Input, Destination Overview, Destination Voting, Flight Selection, Accommodation Selection, Preference Collection, AI Itinerary Planning, Review, and Final Plan
- **Agentic_Pipeline**: The step-by-step workflow where agents process user inputs, generate suggestions, validate constraints, and update the shared trip plan
- **Room_State**: The current data, selected options, active phase, votes, itinerary, selected flights, selected accommodation, budget, transportation options, reminders, and unresolved warnings of a Planning_Room
- **Collaboration_Service**: The backend system responsible for managing rooms, guest sessions, memberships, real-time synchronization, room state, and phase progression
- **Voting_Service**: The system responsible for creating polls, collecting votes, closing votes, and storing group decisions
- **Notification_Service**: The system responsible for delivering in-app reminders, alerts, and planning updates to Room_Members
- **Reminder_Service**: The system responsible for managing planning deadlines, prompt windows, and reminders for incomplete inputs
- **Travel_Dashboard**: The user interface that displays trip progress, current phase, member completion status, selected destination, flights, accommodation, itinerary, budget, transportation, reminders, and unresolved warnings
- **Travel_Planning_Agent**: The combined agent responsible for destination overview generation, preference interpretation, itinerary generation, activity opening-hour checks, booking feasibility checks, conflict detection, and itinerary replanning
- **Flight_Agent**: The agent responsible for retrieving flight options from actual flight data sources and grouping options by budget, comfort, and value-for-money
- **Hotel_Agent**: The agent responsible for recommending accommodation options near tourist locations, suggested itinerary areas, and suitable neighborhoods, grouped by budget, comfort, and balanced value
- **Budget_Agent**: The agent responsible for tracking estimated spending, actual spending, budget risks, and cost-saving recommendations
- **Transportation_Agent**: The agent responsible for route calculation, transportation option ranking, disruption handling, and navigation support
- **Flight_Data_Source**: A flight provider API, travel search data source, or permitted scraping integration used to retrieve flight information
- **Hotel_Data_Source**: A hotel provider API, accommodation search data source, maps data source, or permitted scraping integration used to retrieve accommodation prices, locations, ratings, amenities, and booking links
- **Activity_Data_Source**: A maps, attraction, restaurant, booking, or tourism data source used to retrieve activity details, opening hours, closure days, prices, and booking links
- **Mapping_Service**: An external or internal mapping provider used to calculate routes and generate navigation links
- **Accommodation_Option**: A hotel, hostel, apartment, or other lodging option with location, price, rating, amenities, booking details, and suitability score
- **Itinerary_Item**: A planned activity, restaurant, attraction, transport segment, or free-time block inside the generated itinerary
- **Prompt_Window**: A defined period where Room_Members are expected to submit inputs, comments, votes, or preferences for the active Planning_Phase
- **Budget_Risk**: A warning state triggered when projected total spending exceeds the allocated budget by more than 10%
- **Spending_Record**: A recorded cost item linked to a budget category, amount, date, and optional planned activity
- **Manual_Verification**: A status used when live data is unavailable, stale, incomplete, or cannot be confidently verified by the system

## Requirements

### Requirement 1: Guest-Based Planning Room Creation and Joining

**User Story:** As a traveler, I want to create or join a shared planning room without making a full account, so that my friends and I can start planning quickly during the hackathon flow.

#### Acceptance Criteria

1. WHEN a traveler creates a new Planning_Room with a trip name between 1 and 100 characters and a Participant_Display_Name between 2 and 50 characters, THE Collaboration_Service SHALL create the room, create a Guest_Session for the traveler, assign the traveler as Room_Owner, and set the initial Planning_Phase to Availability and Destination Input
2. WHEN a Planning_Room is created, THE Collaboration_Service SHALL generate a unique Invite_Link for the newly created Planning_Room
3. WHEN a traveler navigates to a valid Invite_Link and submits a Participant_Display_Name between 2 and 50 characters, THE Collaboration_Service SHALL create or resume a Guest_Session, add the traveler as a Room_Member, and redirect the traveler to the Planning_Room
4. THE Collaboration_Service SHALL NOT require user registration, password login, password reset, profile avatar upload, or long-term user profile management before a traveler can create or join a Planning_Room
5. WHEN a Planning_Room is created, THE Collaboration_Service SHALL allow the Room_Owner to set an optional maximum member limit between 2 and 20, defaulting to 20 if not specified
6. IF a traveler opens an expired, invalid, or revoked Invite_Link, THEN THE Collaboration_Service SHALL display an error message indicating that the room link is no longer valid
7. IF a traveler attempts to join a Planning_Room that has reached its maximum member limit, THEN THE Collaboration_Service SHALL reject the join request and display a message indicating that the room is full
8. IF a traveler submits a missing, empty, shorter than 2 characters, or longer than 50 characters Participant_Display_Name, THEN THE Collaboration_Service SHALL reject the request and return an error message indicating the valid length range

### Requirement 2: Planning Phase Progression and Shared Room State

**User Story:** As a room member, I want the planning process to move step by step, so that the group can make decisions in a structured order.

#### Acceptance Criteria

1. THE Collaboration_Service SHALL enforce the following phase order: Availability and Destination Input → Destination Overview → Destination Voting → Flight Selection → Accommodation Selection → Preference Collection → AI Itinerary Planning → Review → Final Plan
2. WHEN the Room_Owner advances the Planning_Phase, THE Collaboration_Service SHALL transition the Planning_Room to the next phase and notify all Room_Members via the Notification_Service
3. IF a traveler who is not a Room_Owner attempts to advance or revert a Planning_Phase, THEN THE Collaboration_Service SHALL reject the request and return an authorization error
4. WHEN a Planning_Phase transition occurs, THE Collaboration_Service SHALL preserve all data from the previous phase and mark it as read-only unless the Room_Owner reopens that phase
5. WHEN the Room_Owner reverts the Planning_Room to an earlier phase, THE Collaboration_Service SHALL restore that phase's data to an editable state and mark all dependent downstream outputs as requiring regeneration or review
6. WHILE a Planning_Room is in a given Planning_Phase, THE Travel_Dashboard SHALL display only the primary inputs, actions, and agent outputs relevant to that phase
7. THE Collaboration_Service SHALL maintain the current Room_State, including members, availability, destination interests, votes, selected destination, selected flights, selected accommodation, preferences, itinerary, budget, transportation options, reminders, and unresolved warnings
8. IF the Planning_Room is in the Final Plan phase, THEN THE Collaboration_Service SHALL prevent further phase advancement and display that the trip plan has been finalized

### Requirement 3: Availability, Destination Interest, and Trip Constraint Collection

**User Story:** As a traveler, I want to submit my free dates, countries I am interested in, and travel constraints, so that the system can suggest suitable destinations for the group.

#### Acceptance Criteria

1. THE Collaboration_Service SHALL allow each Room_Member to submit one or more available date ranges with start date, end date, and optional priority level
2. THE Collaboration_Service SHALL allow each Room_Member to submit countries, cities, regions, or travel themes they are interested in visiting
3. THE Collaboration_Service SHALL allow each Room_Member to optionally submit rough budget range, preferred trip duration, preferred travel pace, dietary constraints, accessibility constraints, and travel style preferences
4. WHEN availability is submitted or updated, THE Collaboration_Service SHALL recalculate overlapping group travel windows within 5 seconds
5. THE Travel_Dashboard SHALL display which Room_Members have submitted availability, destination interests, and constraints without requiring account profiles
6. IF no overlapping travel window exists, THEN THE Collaboration_Service SHALL display the closest possible date overlaps and identify which Room_Members have conflicting availability
7. IF a Room_Member submits an invalid date range where the end date is earlier than the start date, THEN THE Collaboration_Service SHALL reject the date range and display a validation error
8. WHEN the Room_Owner starts the Destination Overview phase, THE Collaboration_Service SHALL pass submitted availability, destination interests, and constraints to the Travel_Planning_Agent

### Requirement 4: Travel Planning Agent for Destination Overview, Itinerary Generation, and Validation

**User Story:** As a traveler, I want one AI planning agent to suggest destinations, build the itinerary, check feasibility, and adjust the plan, so that the planning experience feels connected and not fragmented.

#### Acceptance Criteria

1. WHEN the Destination Overview phase starts, THE Travel_Planning_Agent SHALL analyse group availability, destination interests, rough budget ranges, travel constraints, seasonality, estimated destination cost, and rough flight feasibility
2. THE Travel_Planning_Agent SHALL generate between 3 and 8 destination options, unless fewer than 3 suitable options can be identified from the submitted inputs
3. FOR each destination option, THE Travel_Planning_Agent SHALL provide destination name, suggested travel dates or travel window, short reason for recommendation, estimated travel suitability score, rough estimated cost level, likely weather or seasonality notes, known major tourist areas, and flight feasibility summary where available
4. IF live data for weather, pricing, opening hours, booking availability, or destination feasibility is unavailable or stale, THEN THE Travel_Planning_Agent SHALL mark the affected field as Manual_Verification instead of treating it as confirmed
5. WHEN the selected destination is confirmed and the Preference Collection phase starts, THE Travel_Planning_Agent SHALL allow each Room_Member to submit free-text preferences for places to visit, food to eat, activities to do, travel pace, budget comfort level, must-go items, nice-to-have items, and avoid items
6. WHEN preferences are submitted, THE Travel_Planning_Agent SHALL structure the input into categories including attractions, food, shopping, nightlife, nature, culture, activities, accommodation area preference, transportation preference, and constraints
7. THE Travel_Planning_Agent SHALL identify duplicate, similar, or conflicting preferences across Room_Members within 10 seconds of submission
8. WHEN preferences conflict due to time, budget, location, availability, or traveler disagreement, THE Travel_Planning_Agent SHALL either suggest a compromise option or request a group vote through the Voting_Service
9. WHEN the AI Itinerary Planning phase starts, THE Travel_Planning_Agent SHALL generate a day-by-day itinerary using the selected destination, selected flight times, selected accommodation area or hotel, trip dates, group preferences, estimated budget, activity availability, booking feasibility, and transportation constraints
10. FOR each Itinerary_Item, THE Travel_Planning_Agent SHALL include activity name, date, start time, end time, location, estimated cost, booking requirement where known, opening-hour status where known, relevant preference source, and travel segment to the next item where available
11. THE Travel_Planning_Agent SHALL generate the initial itinerary within 90 seconds of request initiation
12. THE Travel_Planning_Agent SHALL check planned attractions, restaurants, ticketed activities, and transport-dependent experiences against available opening hours, closure days, booking availability, and date-specific constraints from configured Activity_Data_Sources
13. WHEN an Itinerary_Item is confirmed as closed, unavailable, or not bookable on the planned date, THE Travel_Planning_Agent SHALL flag the item and suggest at least one alternative activity or alternative date where possible
14. WHEN availability data is missing, outdated, or unavailable, THE Travel_Planning_Agent SHALL mark the item as Manual_Verification rather than treating it as confirmed
15. WHEN a Room_Member adds a new preference, comments on an itinerary item, changes a budget value, or completes a vote, THE Travel_Planning_Agent SHALL update affected itinerary sections and mark changed items within 30 seconds
16. WHEN the Travel_Planning_Agent removes or replaces an activity, THE Travel_Dashboard SHALL display a short explanation indicating which constraint caused the change
17. THE Travel_Planning_Agent SHALL preserve a version history of generated itineraries so that the Room_Owner can compare the latest itinerary against at least one previous version
18. IF the Travel_Planning_Agent cannot satisfy all Must Have preferences, THEN it SHALL list the unsatisfied preferences and explain whether the limitation is due to time, distance, budget, opening hours, booking availability, or missing data
19. IF two or more itinerary options are equally feasible but satisfy different Room_Member preferences, THEN THE Travel_Planning_Agent SHALL request a group vote instead of choosing silently
20. THE Travel_Dashboard SHALL display all unresolved planning, validation, and Manual_Verification warnings in the Review phase before the plan can be finalized

### Requirement 5: Voting System and Group Decision Resolution

**User Story:** As a room member, I want to vote on destinations, flights, hotels, activities, and conflicting preferences, so that the group can make decisions fairly.

#### Acceptance Criteria

1. WHEN the Room_Owner initiates a vote with a question and between 2 and 10 options, THE Voting_Service SHALL create a poll visible to all Room_Members with the specified options and optional deadline
2. THE Voting_Service SHALL allow each Room_Member to cast exactly one vote per poll and SHALL prevent a Room_Member from changing their vote after submission
3. WHEN all Room_Members have voted OR a Room_Owner-defined deadline passes, whichever occurs first, THE Voting_Service SHALL close the poll and display the results to all Room_Members in real time
4. WHEN a poll is closed, THE Voting_Service SHALL determine the winning option by simple majority
5. IF a poll results in a tie between two or more options, THEN THE Voting_Service SHALL automatically create a tiebreaker poll containing only the tied options and notify all Room_Members
6. IF a Room_Owner initiates a vote with fewer than 2 options or more than 10 options, THEN THE Voting_Service SHALL reject the request and return an error indicating the valid option count range
7. WHEN a poll is active, THE Voting_Service SHALL display the count of members who have voted without revealing individual vote choices until the poll is closed
8. WHEN a destination vote is completed, THE Collaboration_Service SHALL store the winning destination in the Room_State and unlock the Flight Selection phase
9. WHEN a vote is requested by the Travel_Planning_Agent due to a conflict, THE Voting_Service SHALL store the decision outcome and pass the result back to the Travel_Planning_Agent for itinerary adjustment

### Requirement 6: Flight Suggestions and Selection

**User Story:** As a traveler, I want the system to show actual flight options grouped by budget, comfort, and value, so that the group can choose a practical way to travel.

#### Acceptance Criteria

1. WHEN the Flight Selection phase starts, THE Flight_Agent SHALL retrieve available flight options for the selected destination and group travel window from configured Flight_Data_Sources
2. THE Flight_Agent SHALL provide at least three categories of flight recommendations where data is available: Budget, Comfort, and Best Value
3. FOR each flight option, THE Flight_Agent SHALL display airline, departure airport, arrival airport, departure time, arrival time, total duration, number of stops, baggage information where available, estimated price, booking link where available, and data retrieval timestamp
4. WHEN multiple flight options are available, THE Flight_Agent SHALL rank options using a weighted score of price (40%), total travel time (30%), number of stops (20%), and schedule convenience (10%)
5. IF real flight data is unavailable, stale, blocked, or incomplete, THEN THE Flight_Agent SHALL clearly mark the result as Manual_Verification and allow the Room_Owner to enter manual flight details
6. WHEN a flight option is selected by vote or Room_Owner confirmation, THE Collaboration_Service SHALL store the selected flight in the Room_State and update the Budget_Agent transportation category within 5 seconds
7. IF no flight options are returned by the Flight_Data_Source, THEN THE Flight_Agent SHALL notify the group that flight data is unavailable and suggest retrying with adjusted dates, nearby airports, or manual flight entry
8. THE Flight_Agent SHALL NOT claim that a flight price or seat availability is guaranteed unless the Flight_Data_Source explicitly confirms it at retrieval time

### Requirement 7: Accommodation Suggestions and Hotel Selection

**User Story:** As a traveler, I want hotel suggestions based on budget, comfort, and a balance of both near tourist locations or suggested itinerary areas, so that the group can choose a convenient place to stay.

#### Acceptance Criteria

1. WHEN the Accommodation Selection phase starts, THE Hotel_Agent SHALL retrieve Accommodation_Options for the selected destination, selected trip dates, group size, selected flight timing where available, and known suggested tourist areas or itinerary clusters
2. THE Hotel_Agent SHALL provide at least three categories of accommodation recommendations where data is available: Budget, Comfort, and Best Value
3. FOR each Accommodation_Option, THE Hotel_Agent SHALL display accommodation name, accommodation type, neighborhood or area, estimated total stay price, estimated price per traveler where possible, rating where available, key amenities, distance to suggested locations or major tourist areas, booking link where available, cancellation flexibility where available, and data retrieval timestamp
4. WHEN multiple Accommodation_Options are available, THE Hotel_Agent SHALL rank them using a weighted score of location convenience near suggested locations and tourist areas (35%), price (25%), rating and review quality (20%), and comfort or amenities (20%)
5. THE Hotel_Agent SHALL identify recommended areas known as good places to stay for the selected destination and provide a short reason for each area, such as transport access, tourist convenience, nightlife, food access, safety, or family-friendliness
6. WHEN suggested locations or activity clusters are available from the Travel_Planning_Agent, THE Hotel_Agent SHALL prioritize accommodations that reduce average travel time to those suggested locations
7. IF fewer than three suitable Accommodation_Options are found near the suggested locations, THEN THE Hotel_Agent SHALL present all available options and suggest the nearest viable alternative neighborhoods
8. IF hotel price, rating, availability, or booking data is unavailable or stale, THEN THE Hotel_Agent SHALL clearly mark the affected Accommodation_Option as Manual_Verification instead of treating it as confirmed
9. WHEN an Accommodation_Option is selected by vote or Room_Owner confirmation, THE Collaboration_Service SHALL store the selected accommodation in the Room_State and update the Budget_Agent accommodation category within 5 seconds
10. IF no Accommodation_Options are returned by the Hotel_Data_Source, THEN THE Hotel_Agent SHALL notify the group that live accommodation data is unavailable and allow the Room_Owner to enter manual accommodation details or retry the search
11. THE Hotel_Agent SHALL NOT claim that an accommodation price, room availability, or cancellation policy is guaranteed unless the Hotel_Data_Source explicitly confirms it at retrieval time

### Requirement 8: Budget Management

**User Story:** As a traveler, I want the system to continuously track my spending against my budget and alert me to budget risks, so that I stay within my financial plan.

#### Acceptance Criteria

1. THE Budget_Agent SHALL maintain a breakdown of estimated and actual spending across categories (accommodation, food, transportation, activities, miscellaneous), updated within 5 seconds of any spending record or budget change
2. WHEN actual spending is recorded, THE Budget_Agent SHALL update the remaining budget and recalculate spending projections for the remainder of the trip based on the daily average spend rate per category within 3 seconds
3. WHEN projected total spending exceeds the allocated budget by more than 10%, THE Budget_Agent SHALL flag a Budget_Risk and suggest at least two alternative options for upcoming activities, each costing at least 20% less than the originally planned option
4. IF fewer than two cheaper alternatives are available for upcoming activities when a Budget_Risk is flagged, THEN THE Budget_Agent SHALL present all available alternatives and display a notification indicating that limited cost-saving options were found
5. IF actual total spending exceeds the allocated budget, THEN THE Budget_Agent SHALL display an over-budget alert indicating the overspent amount and flag all remaining unpaid planned activities for review
6. THE Travel_Dashboard SHALL display the current budget status including total budget, spent amount, remaining amount, and per-category allocation within 5 seconds of any update
7. WHEN selected flights, accommodation, paid activities, or transportation options are added to the Room_State, THE Budget_Agent SHALL update the estimated spending breakdown within 5 seconds
8. IF a Room_Member enters a Spending_Record with a missing amount, negative amount, or unsupported currency, THEN THE Budget_Agent SHALL reject the record and display a validation error

### Requirement 9: Transportation Optimization

**User Story:** As a traveler, I want the system to optimize my transportation routes and suggest the most efficient travel options, so that I minimize transit time and costs.

#### Acceptance Criteria

1. THE Transportation_Agent SHALL calculate routes between all activities in a daily schedule considering distance, travel time, and cost, and SHALL return results within 30 seconds of request initiation
2. WHEN multiple transportation options exist between two locations, THE Transportation_Agent SHALL present up to 5 options ranked by a weighted score of time (40%), cost (40%), and number of transfers (20%)
3. WHEN a transportation disruption occurs, including flight delay or transit cancellation, THE Transportation_Agent SHALL calculate alternative routes within 60 seconds and notify the traveler with the updated options
4. THE Transportation_Agent SHALL integrate with Mapping_Services to provide turn-by-turn navigation links for each transit segment
5. IF no route can be calculated between two locations, THEN THE Transportation_Agent SHALL notify the traveler with an indication of why no route is available and suggest the nearest reachable alternative
6. IF a Mapping_Service is unavailable, THEN THE Transportation_Agent SHALL provide text-based route directions including origin, destination, and recommended transportation mode for each segment
7. WHEN the Travel_Planning_Agent updates the itinerary, THE Transportation_Agent SHALL recalculate affected daily route segments and update the Travel_Dashboard within 30 seconds
8. WHEN transportation costs are available, THE Transportation_Agent SHALL pass estimated costs to the Budget_Agent within 5 seconds

### Requirement 10: Planning Timeline, Prompt Windows, and Reminders

**User Story:** As a traveler, I want to see when I need to submit availability, votes, preferences, and feedback, so that the group does not get stuck waiting for missing input.

#### Acceptance Criteria

1. THE Reminder_Service SHALL allow the Room_Owner to set a Prompt_Window deadline for availability submission, destination voting, flight selection, accommodation selection, preference submission, itinerary feedback, and final review
2. THE Travel_Dashboard SHALL display a planning timeline showing the current phase, upcoming phases, deadline for each Prompt_Window, and completion status of each Room_Member
3. WHEN a Room_Member has not completed a required input before 50% of the Prompt_Window has elapsed, THE Notification_Service SHALL send an in-app reminder to that Room_Member
4. WHEN a Prompt_Window deadline is reached, THE Notification_Service SHALL notify the Room_Owner which Room_Members have not completed the required input
5. IF a Prompt_Window deadline passes with incomplete inputs, THEN THE Collaboration_Service SHALL allow the Room_Owner to proceed using available inputs and SHALL mark missing inputs in the Room_State
6. WHEN a Room_Member rejoins a Planning_Room, THE Travel_Dashboard SHALL display their pending tasks for the current Planning_Phase within 5 seconds
7. THE Reminder_Service SHALL NOT require email notification preferences or user profile settings to send in-app reminders during a Guest_Session

### Requirement 11: Real-Time Collaboration and Synchronization

**User Story:** As a room member, I want to see updates from my friends in real time, so that the group can collaborate without delays.

#### Acceptance Criteria

1. WHEN a Room_Member submits data including availability, destination interests, votes, flight choices, accommodation choices, preferences, comments, spending records, activity changes, or transportation choices, THE Collaboration_Service SHALL broadcast the update to all connected Room_Members within 2 seconds
2. WHILE a Room_Member is connected to a Planning_Room, THE Collaboration_Service SHALL display the online or offline status of all other Room_Members, where a member is considered offline after 30 seconds without a heartbeat signal
3. WHEN a Room_Member reconnects after a disconnection, THE Collaboration_Service SHALL synchronize the client with the current Room_State by transmitting all changes that occurred during the disconnection period
4. THE Collaboration_Service SHALL resolve concurrent edits to shared data using a last-write-wins strategy with server timestamps unless the edited item is a vote, where submitted votes SHALL remain immutable after submission
5. WHEN a Room_Member transitions from online to offline, THE Collaboration_Service SHALL notify all other connected Room_Members of the status change within 5 seconds
6. IF a Room_Member submits data while disconnected, THEN THE Collaboration_Service SHALL queue the submission and deliver it upon reconnection, applying the same conflict resolution rules
7. WHEN an agent output is regenerated, THE Collaboration_Service SHALL broadcast the regenerated output and mark previous dependent outputs as superseded where applicable

### Requirement 12: Travel Dashboard

**User Story:** As a traveler, I want one dashboard that shows the current trip status, pending actions, selected options, warnings, and final plan, so that I always know what the group has decided and what still needs work.

#### Acceptance Criteria

1. THE Travel_Dashboard SHALL display the current Planning_Phase, selected destination, selected flights, selected accommodation, active votes, itinerary draft, budget status, transportation summary, pending tasks, and unresolved warnings
2. THE Travel_Dashboard SHALL display Room_Member completion status for availability, destination interests, votes, flight selection, accommodation selection, preferences, itinerary feedback, and final review
3. WHEN the Room_State changes, THE Travel_Dashboard SHALL update affected sections within 5 seconds
4. THE Travel_Dashboard SHALL visually distinguish confirmed items, draft items, Manual_Verification items, Budget_Risk items, and unavailable items
5. THE Travel_Dashboard SHALL provide links or actions to reopen the current phase input, view vote results, compare flight options, compare accommodation options, review itinerary changes, and export the final plan
6. IF a data source fails or an agent output cannot be generated, THEN THE Travel_Dashboard SHALL display a clear error message and provide a retry or manual entry option where appropriate

### Requirement 13: Review, Final Plan, and Itinerary Output

**User Story:** As a traveler, I want the final itinerary to be presented clearly with flights, accommodation, activities, transport, budget, and booking notes, so that the whole trip is ready to follow.

#### Acceptance Criteria

1. WHEN the Review phase starts, THE Travel_Dashboard SHALL display the selected destination, selected flights, selected accommodation, day-by-day itinerary, transportation routes, budget status, unresolved votes, and Manual_Verification warnings
2. THE Travel_Dashboard SHALL require unresolved critical warnings, including unavailable activities, missing flight selection, missing accommodation selection, or over-budget alerts, to be reviewed before the Room_Owner can move the Planning_Room to the Final Plan phase
3. WHEN the Planning_Room reaches the Final Plan phase, THE Travel_Planning_Agent SHALL generate a final itinerary summary containing trip dates, selected destination, selected flights, selected accommodation, daily schedule, route guidance, estimated costs, booking links, and Manual_Verification notes
4. THE system SHALL allow Room_Members to export or copy the final itinerary in at least one structured format such as Markdown, plain text, table view, or PDF
5. WHEN the final itinerary is exported, THE exported output SHALL include unresolved warnings instead of hiding them
6. WHEN the Room_Owner archives a finalized Planning_Room, THE Collaboration_Service SHALL set the room to read-only mode while preserving the final itinerary, votes, preferences, accommodation choice, budget records, and transportation details
7. IF the itinerary has not been finalized, THEN THE Travel_Dashboard SHALL clearly indicate that the displayed plan is still a draft
8. THE final itinerary output SHALL include a disclaimer that live prices, opening hours, and booking availability may require manual confirmation before purchase or travel

### Requirement 14: Notifications and Alerts

**User Story:** As a room member, I want to receive notifications about important planning updates, so that I know when action is required from me.

#### Acceptance Criteria

1. WHEN a Planning_Phase transition occurs, THE Notification_Service SHALL send an in-app notification to all Room_Members within 30 seconds of the transition
2. WHEN a vote is initiated, THE Notification_Service SHALL send an in-app notification to all Room_Members immediately
3. WHEN a Room_Member has not voted after 50% of the poll deadline has elapsed, THE Notification_Service SHALL send an in-app reminder to that Room_Member
4. WHEN a Budget_Risk is flagged, THE Notification_Service SHALL send an in-app notification to all Room_Members within 30 seconds and include a link to the Travel_Dashboard budget section
5. WHEN the Transportation_Agent calculates alternative routes due to a disruption, THE Notification_Service SHALL send an in-app notification to affected Room_Members within 30 seconds and include the updated transportation options
6. WHEN the Travel_Planning_Agent flags an activity as closed, unavailable, not bookable, or requiring Manual_Verification, THE Notification_Service SHALL notify Room_Members within 30 seconds
7. WHEN the Hotel_Agent marks an Accommodation_Option as unavailable, stale, or requiring Manual_Verification, THE Notification_Service SHALL notify Room_Members within 30 seconds
8. WHEN the Flight_Agent marks a flight option as stale, unavailable, or requiring Manual_Verification, THE Notification_Service SHALL notify Room_Members within 30 seconds
9. THE Notification_Service SHALL support a chronological in-app notification feed accessible from the Planning_Room
10. WHEN a Room_Member views their notification feed, THE Notification_Service SHALL mark displayed notifications as read and SHALL distinguish between read and unread notifications visually
11. THE Notification_Service SHALL NOT require external email delivery for the hackathon version of the application
