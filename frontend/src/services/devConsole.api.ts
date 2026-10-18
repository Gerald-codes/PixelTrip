/**
 * Dev console service — drives the AI agent runs against the REAL backend.
 *
 * Powers the `/dev/run` test console only; it is not part of the service registry
 * and has no mock, because its whole purpose is to exercise the real backend and the
 * real Supabase data. It follows the Supabase access boundary
 * (`docs/SUPABASE_ACCESS_BOUNDARY.md`): every write goes through FastAPI, and the
 * only direct Supabase reads are the anon-key reads of tables the party already
 * watches (messages, vote sessions).
 *
 * `lockTestFlight` and `addTestFeedback` call the backend's `/dev` routes, which
 * exist only when the backend runs with `ENABLE_DEV_ENDPOINTS=true`.
 */
import { getApiClient } from "@/lib/apiClient";
import { ApiError } from "@/lib/errors";
import { getSupabaseClient } from "@/lib/supabaseClient";

export type RunType = "discovery" | "logistics" | "itinerary" | "refinement";
export type RunStatus = "pending" | "running" | "completed" | "failed";

/** What the console needs to remember about the room it created or joined. */
export interface ConsoleSession {
  roomId: string;
  roomCode: string;
  roomName: string;
  planningStage: string;
  memberId: string;
  displayName: string;
  tripId: string;
  tripStatus: string;
}

export interface ConsoleRun {
  id: string;
  tripId: string;
  runType: RunType;
  status: RunStatus;
  baseVersion: number;
  resultVersionId: string | null;
  error: string | null;
}

export interface ConsoleMessage {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface ConsoleVoteOption {
  id: string;
  label: string;
}

export interface ConsoleVoteSession {
  id: string;
  question: string;
  options: ConsoleVoteOption[];
  status: "open" | "closed";
}

export interface ConsoleItineraryItem {
  id: string;
  title: string;
  time: string | null;
  description: string | null;
  location: string | null;
}

export interface ConsoleItineraryVersion {
  id: string;
  version: number;
  source: "build" | "refine";
  status: string;
  changeSummary: string | null;
  itinerary: {
    title: string;
    summary?: string | null;
    days: Array<{
      day: number;
      date: string | null;
      items: ConsoleItineraryItem[];
    }>;
  };
}

/** The room payload shared by create and join (the parts the console reads). */
interface RoomPayload {
  room: { id: string; roomCode: string; name: string; planningStage: string };
  member: { id: string; displayName: string };
  trip?: { id: string; status: string };
}

interface MessageRow {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  created_at: string;
}

interface VoteSessionRow {
  id: string;
  question: string;
  options: ConsoleVoteOption[];
  status: "open" | "closed";
}

function readError(table: string): ApiError {
  return new ApiError("DATABASE_ERROR", `Could not read ${table}.`, null);
}

/** Find the trip for a room (anon read), for a join response that omits it. */
async function fetchTrip(
  roomId: string,
): Promise<{ id: string; status: string }> {
  const { data, error } = await getSupabaseClient()
    .from("trips")
    .select("id,status")
    .eq("room_id", roomId)
    .maybeSingle<{ id: string; status: string }>();
  if (error || !data) {
    throw readError("trips");
  }
  return data;
}

async function toSession(payload: RoomPayload): Promise<ConsoleSession> {
  const trip = payload.trip ?? (await fetchTrip(payload.room.id));
  return {
    roomId: payload.room.id,
    roomCode: payload.room.roomCode,
    roomName: payload.room.name,
    planningStage: payload.room.planningStage,
    memberId: payload.member.id,
    displayName: payload.member.displayName,
    tripId: trip.id,
    tripStatus: trip.status,
  };
}

export async function createRoom(
  name: string,
  ownerDisplayName: string,
): Promise<ConsoleSession> {
  const payload = await getApiClient().post<RoomPayload>("/rooms", {
    name,
    ownerDisplayName,
  });
  return toSession(payload);
}

export async function joinRoom(
  roomCode: string,
  displayName: string,
): Promise<ConsoleSession> {
  const code = roomCode.trim().toUpperCase();
  const payload = await getApiClient().post<RoomPayload>(
    `/rooms/${encodeURIComponent(code)}/join`,
    { displayName },
  );
  return toSession(payload);
}

export async function savePreferences(
  session: ConsoleSession,
  preferences: Record<string, unknown>,
): Promise<{ tripStatus: string }> {
  const result = await getApiClient().put<{ trip: { status: string } }>(
    `/rooms/${encodeURIComponent(session.roomCode)}/members/${session.memberId}/preferences`,
    preferences,
  );
  return { tripStatus: result.trip.status };
}

export function startRun(
  session: ConsoleSession,
  runType: RunType,
  idempotencyKey: string,
): Promise<ConsoleRun> {
  return getApiClient().post<ConsoleRun>(`/trips/${session.tripId}/runs`, {
    runType,
    memberId: session.memberId,
    idempotencyKey,
  });
}

export function getRun(runId: string): Promise<ConsoleRun> {
  return getApiClient().get<ConsoleRun>(`/runs/${runId}`);
}

export async function listMessages(roomId: string): Promise<ConsoleMessage[]> {
  const { data, error } = await getSupabaseClient()
    .from("messages")
    .select("id,kind,content,created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();
  if (error) {
    throw readError("messages");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function listVoteSessions(
  roomId: string,
): Promise<ConsoleVoteSession[]> {
  const { data, error } = await getSupabaseClient()
    .from("vote_sessions")
    .select("id,question,options,status")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .returns<VoteSessionRow[]>();
  if (error) {
    throw readError("vote_sessions");
  }
  return data ?? [];
}

export function castVote(
  session: ConsoleSession,
  voteSessionId: string,
  optionId: string,
): Promise<{ sessionStatus: "open" | "closed" }> {
  return getApiClient().post(`/votes/${voteSessionId}/cast`, {
    memberId: session.memberId,
    optionId,
  });
}

export function closeVote(
  session: ConsoleSession,
  voteSessionId: string,
): Promise<unknown> {
  return getApiClient().post(`/votes/${voteSessionId}/close`, {
    memberId: session.memberId,
  });
}

export function listItineraryVersions(
  tripId: string,
): Promise<ConsoleItineraryVersion[]> {
  return getApiClient().get<ConsoleItineraryVersion[]>(
    `/trips/${tripId}/itinerary/versions`,
  );
}

/** Lock a made-up flight (backend `/dev` route; needs `ENABLE_DEV_ENDPOINTS`). */
export function lockTestFlight(
  tripId: string,
  departAt: string,
  returnAt: string,
): Promise<{ selectionId: string }> {
  return getApiClient().post(`/dev/trips/${tripId}/test-flight`, {
    departAt,
    returnAt,
  });
}

/** Comment on one itinerary item (backend `/dev` route; needs `ENABLE_DEV_ENDPOINTS`). */
export function addTestFeedback(
  session: ConsoleSession,
  itineraryVersionId: string,
  itemId: string,
  comment: string,
): Promise<{ feedbackId: string }> {
  return getApiClient().post(`/dev/trips/${session.tripId}/feedback`, {
    memberId: session.memberId,
    itineraryVersionId,
    itemId,
    comment,
  });
}

/** One recent LLM call: the exact prompts sent and the parsed reply. */
export interface ConsoleLlmCall {
  at: string;
  operation: string;
  model: string | null;
  systemPrompt: string;
  userPrompt: string;
  response: unknown;
  error: string | null;
}

/** The latest LLM calls, newest first (backend `/dev` route; needs `ENABLE_DEV_ENDPOINTS`). */
export function listLlmCalls(limit = 10): Promise<ConsoleLlmCall[]> {
  return getApiClient().get<ConsoleLlmCall[]>(`/dev/llm-calls?limit=${limit}`);
}
