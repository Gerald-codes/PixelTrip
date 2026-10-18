/**
 * Room service — real (backend-backed) implementation.
 *
 * - `createRoom` / `joinRoom` are mutations, so they go through FastAPI
 *   (`POST /rooms`, `POST /rooms/{roomCode}/join`; see "HTTP API" in
 *   `api-contracts.md`).
 * - `getRoom` / `listMembers` are approved direct anon-key Supabase reads (see
 *   `docs/SUPABASE_ACCESS_BOUNDARY.md`).
 * - `subscribeMembers` is an approved anon-key Supabase Realtime subscription on
 *   `room_members`; on any change it re-reads via `listMembers`.
 *
 * Failures surface as `ApiError`.
 */
import { getApiClient } from "@/lib/apiClient";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type {
  PartyRoom,
  RoomMember,
  RoomSession,
  Unsubscribe,
} from "@/types";

import type {
  CreateRoomInput,
  JoinRoomInput,
  RoomService,
} from "./room.contract";
import {
  type MemberRow,
  ROSTER_COLUMNS,
  ROOM_COLUMNS,
  type RoomRow,
  supabaseReadError,
  toPartyRoom,
  toRoomMember,
} from "./supabaseRows";

/** How long after a roster change the character row is safely written. */
const CHARACTER_SETTLE_MS = 1500;

class RoomApiService implements RoomService {
  createRoom(input: CreateRoomInput): Promise<RoomSession> {
    return getApiClient().post<RoomSession>("/rooms", {
      name: input.name,
      ownerDisplayName: input.ownerDisplayName,
    });
  }

  joinRoom(input: JoinRoomInput): Promise<RoomSession> {
    // The backend only accepts uppercase codes, so normalise user input first.
    const roomCode = input.roomCode.trim().toUpperCase();
    return getApiClient().post<RoomSession>(
      `/rooms/${encodeURIComponent(roomCode)}/join`,
      { displayName: input.displayName },
    );
  }

  // Direct Supabase access (approved: read-only).
  // Table: party_rooms — room header for a room the user is already in; no side effects.
  // Shape: { id, room_code, name, status, planning_stage } → PartyRoom.
  async getRoom(roomId: string): Promise<PartyRoom | null> {
    const { data, error } = await getSupabaseClient()
      .from("party_rooms")
      .select(ROOM_COLUMNS)
      .eq("id", roomId)
      .maybeSingle<RoomRow>();
    if (error) {
      throw supabaseReadError("party_rooms");
    }
    return data ? toPartyRoom(data) : null;
  }

  // Direct Supabase access (approved: read-only).
  // Table: room_members — the party roster for the current room; no side effects.
  // Shape: { id, room_id, guest_id, display_name, role } → RoomMember[] (join order),
  // plus each member's saved character look (`characters.sprite_key`, anon-readable).
  async listMembers(roomId: string): Promise<RoomMember[]> {
    const { data, error } = await getSupabaseClient()
      .from("room_members")
      .select(ROSTER_COLUMNS)
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemberRow[]>();
    if (error) {
      throw supabaseReadError("room_members");
    }
    return (data ?? []).map(toRoomMember);
  }

  // Direct Supabase access (approved: Realtime subscription + read-only reads).
  // Subscribes to postgres_changes on room_members for this room and, on any
  // INSERT/UPDATE/DELETE, re-runs listMembers and pushes the full mapped roster
  // (simplest correct approach — avoids mapping partial change payloads). Primes
  // the roster once immediately. Read failures are swallowed so the UI keeps the
  // last known roster and never sees a throw.
  subscribeMembers(
    roomId: string,
    onChange: (members: RoomMember[]) => void,
  ): Unsubscribe {
    const supabase = getSupabaseClient();

    const pushRoster = async (): Promise<void> => {
      try {
        onChange(await this.listMembers(roomId));
      } catch {
        // Keep the last known roster; never throw into the UI.
      }
    };

    // Prime immediately so the roster is populated before the first change.
    void pushRoster();

    // A member's row flips to "ready" just before their character is stored, and
    // the characters table does not stream. Reading once more shortly after each
    // change picks up the new look.
    let followUp: ReturnType<typeof setTimeout> | undefined;
    const pushNowAndAgain = (): void => {
      void pushRoster();
      clearTimeout(followUp);
      followUp = setTimeout(() => void pushRoster(), CHARACTER_SETTLE_MS);
    };

    const channel = supabase
      .channel(`room_members:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        pushNowAndAgain,
      )
      .subscribe();

    return () => {
      clearTimeout(followUp);
      void supabase.removeChannel(channel);
    };
  }

  // Direct Supabase access (approved: Realtime subscription + read-only reads).
  // Subscribes to postgres_changes on party_rooms for this room and, on any
  // change (e.g. planning_stage advancing), re-reads via getRoom and pushes the
  // full mapped room. Primes once immediately. Read failures are swallowed so the
  // UI keeps the last known room and never sees a throw.
  subscribeRoom(
    roomId: string,
    onChange: (room: PartyRoom) => void,
  ): Unsubscribe {
    const supabase = getSupabaseClient();

    const pushRoom = async (): Promise<void> => {
      try {
        const room = await this.getRoom(roomId);
        if (room) onChange(room);
      } catch {
        // Keep the last known room; never throw into the UI.
      }
    };

    void pushRoom();

    const channel = supabase
      .channel(`party_rooms:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "party_rooms",
          filter: `id=eq.${roomId}`,
        },
        () => {
          void pushRoom();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }
}

/** Singleton real Room service. */
export const roomApiService: RoomService = new RoomApiService();
