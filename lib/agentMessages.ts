/**
 * Stage intro messages for the TripAgentChat message thread.
 *
 * Each entry maps a `RoomStage` to the exact intro string the Trip Agent
 * appends when that stage becomes active. Strings are ≤ 40 words and
 * ≤ 2 sentences (Requirements 3.1, 3.6).
 */

import { RoomStage } from "@/lib/types";

export const STAGE_INTRO_MESSAGES: Record<RoomStage, string> = {
  [RoomStage.LOBBY]:
    "Let's build your travel character — your choices shape where we go and what we do.",
  [RoomStage.PERSONA]:
    "Time to choose your travel persona. Pick the character that fits you best.",
  [RoomStage.AVAILABILITY]: "Nice. Now when are you free to travel?",
  [RoomStage.GROUP_PROFILE]:
    "Putting your group's preferences together now — this takes just a moment.",
  [RoomStage.DESTINATIONS]:
    "Based on your group's characters, dates, and vibes — here are your best destination options.",
  [RoomStage.DESTINATION_VOTE]:
    "Time to vote. Which destination works best for your group?",
  [RoomStage.FLIGHTS]: "Now let's pick a flight style for the group.",
  [RoomStage.FLIGHT_VOTE]: "Now let's pick a flight style for the group.",
  [RoomStage.ACTIVITIES]:
    "Great choice! Now let's add your must-have activities and experiences.",
  [RoomStage.ITINERARY]:
    "Your itinerary is ready. Check how well it fits everyone in the group.",
  [RoomStage.FEEDBACK]:
    "How does the plan look? Score it and flag anything you'd like to change.",
  [RoomStage.NEGOTIATION]:
    "The agent found some trade-offs to resolve. Vote on the best compromise.",
  [RoomStage.FINAL]:
    "Your trip is locked in. Here's the final plan — export or share it below.",
};
