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
    "Build your travel character. Your budget and interests shape where we go.",
  [RoomStage.PERSONA]:
    "Choose your travel persona — it sets the tone for the whole trip.",
  [RoomStage.AVAILABILITY]: "When are you free? Enter your travel dates and pick your destination vibes.",
  [RoomStage.GROUP_PROFILE]:
    "Putting your group's preferences together — this takes a moment.",
  [RoomStage.DESTINATIONS]:
    "Here are your best destination matches. Pick the ones that excite you most.",
  [RoomStage.DESTINATION_VOTE]:
    "Time to vote. Tap a destination to cast your vote.",
  [RoomStage.FLIGHTS]: "Three flight styles to choose from. Review them, then the host moves to the vote.",
  [RoomStage.FLIGHT_VOTE]: "Vote for your preferred flight style. One vote per person.",
  [RoomStage.ACTIVITIES]:
    "Add must-have activities and places. Mark anything you'd hate as avoid.",
  [RoomStage.ITINERARY]:
    "Your day-by-day plan is ready. Check the fairness summary and give feedback.",
  [RoomStage.FEEDBACK]:
    "Score the itinerary and flag anything you'd change. Be honest — the AI reads every note.",
  [RoomStage.NEGOTIATION]:
    "The AI found trade-offs to resolve. Select a resolution, then the host applies it.",
  [RoomStage.FINAL]:
    "Trip locked in. Copy or share the final plan below.",
};
