/**
 * Shared reader for the two recommendation stages (DISCOVER and LOGISTICS).
 *
 * Both stages follow the same shape: an AI run posts a `kind:"recommendation"`
 * message with a `category` ("destination" or "flight"), opens a vote session
 * linked to that message, and a resolved vote locks a `selections` row of the same
 * kind. This module reads that state for one category, so the destination and
 * flight services stay thin and cannot drift apart.
 *
 * The vote session is the one linked (`message_id`) to the category's latest
 * recommendation, never simply "the room's latest vote", so a flight vote can
 * never be mistaken for the destination vote (or the other way round).
 */
import { getSupabaseClient } from "@/lib/supabaseClient";
import { ApiError } from "@/lib/errors";

import type { TiebreakAdvice, TiebreakOption } from "./destination.contract";

export type StageCategory = "destination" | "flight";

/** One recommended option (destination or flight) the party can vote for. */
export interface StageOption {
  id: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
}

/** The open (or resolved) vote for a stage. */
export interface StageVote {
  voteSessionId: string;
  question: string;
  options: readonly { id: string; label: string; count: number }[];
  status: "open" | "closed";
}

/** A locked selection: the winning option plus its full details. */
export interface StageSelection {
  id: string;
  title: string;
  data: Record<string, unknown>;
}

export interface StageSnapshot {
  /** True while nothing has been posted yet (no options and no vote). */
  loading: boolean;
  options: readonly StageOption[];
  selected: StageSelection | null;
  vote: StageVote | null;
  tiePending: boolean;
  tiebreak: TiebreakAdvice | null;
  /** The guide's latest plain-text message, e.g. a question when it could not
   * recommend anything ("Would the party like to widen their dates?"). */
  guideNote: string | null;
}

interface MessageRow {
  id: string;
  kind: string;
  sender_type?: string;
  content: Record<string, unknown>;
  created_at: string;
}

interface VoteSessionRow {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  status: "open" | "closed";
  tie_pending: boolean | null;
  tie_option_ids: string[] | null;
  message_id: string | null;
}

export function readError(table: string): ApiError {
  return new ApiError("DATABASE_ERROR", `Could not read ${table}.`, null);
}

/** Pull options out of a recommendation message's content. */
export function toOptions(content: Record<string, unknown>): StageOption[] {
  const items = content.items;
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      description:
        typeof item.description === "string" ? item.description : undefined,
      meta:
        item.meta && typeof item.meta === "object"
          ? (item.meta as Record<string, unknown>)
          : undefined,
    };
  });
}

/** Parse a `*_tiebreak` summary message's content into TiebreakAdvice. */
export function toTiebreakAdvice(
  content: Record<string, unknown>,
  voteSessionId: string,
): TiebreakAdvice | null {
  const category = String(content.category ?? "");
  const base = category.endsWith("_tiebreak")
    ? (category.replace("_tiebreak", "") as StageCategory)
    : null;
  if (base !== "destination" && base !== "flight") return null;

  const rawItems = Array.isArray(content.items) ? content.items : [];
  const options: TiebreakOption[] = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() !== "" ? v : undefined;
    const memberFit = Array.isArray(item.memberFit)
      ? item.memberFit.map((f) => {
          const fit = f as Record<string, unknown>;
          return {
            memberId: String(fit.memberId ?? ""),
            displayName: String(fit.displayName ?? ""),
            score: num(fit.score) ?? 0,
            reason: String(fit.reason ?? ""),
          };
        })
      : undefined;
    return {
      id: String(item.id ?? ""),
      title: String(item.title ?? item.label ?? ""),
      description: str(item.description),
      score: num(item.score),
      whyThisFits: str(item.whyThisFits),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
      tradeOff: str(item.tradeOff),
      details: str(item.details),
      votes: Array.isArray(item.votes) ? item.votes.map(String) : undefined,
      memberFit,
    };
  });

  // SummaryMessageContent stores top-level fields snake_case (no camel alias);
  // the hand-built items[] use camelCase. Read the snake_case key here.
  const recommended = content.recommended_option_id;
  return {
    voteSessionId,
    category: base,
    advice: String(content.advice ?? content.text ?? ""),
    recommendedOptionId:
      typeof recommended === "string" && recommended.trim() !== ""
        ? recommended
        : null,
    options,
  };
}

/** The tie as known before the guide's advice: tied options and who backed them. */
async function provisionalTie(
  roomId: string,
  category: StageCategory,
  session: VoteSessionRow,
  options: readonly StageOption[],
  votes: readonly { option_id: string; member_id: string }[],
): Promise<TiebreakAdvice> {
  const { data: members } = await getSupabaseClient()
    .from("room_members")
    .select("id,display_name")
    .eq("room_id", roomId)
    .returns<{ id: string; display_name: string }[]>();
  const names = new Map((members ?? []).map((m) => [m.id, m.display_name]));
  const tied = session.tie_option_ids ?? [];
  const cards = new Map(options.map((o) => [o.id, o]));
  return {
    voteSessionId: session.id,
    category,
    advice: "",
    recommendedOptionId: null,
    pending: true,
    options: tied.map((id) => {
      const card = cards.get(id);
      const label = session.options.find((o) => o.id === id)?.label;
      return {
        id,
        title: card?.title ?? label ?? id,
        description: card?.description,
        votes: votes
          .filter((v) => v.option_id === id)
          .map((v) => names.get(v.member_id) ?? "A party member"),
      };
    }),
  };
}

/** Read one stage's live state for a room. */
export async function readStage(
  roomId: string,
  category: StageCategory,
): Promise<StageSnapshot> {
  const supabase = getSupabaseClient();

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("id,kind,sender_type,content,created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .returns<MessageRow[]>();
  if (msgErr) throw readError("messages");
  const rows = messages ?? [];

  const recommendation = rows.find(
    (m) =>
      m.kind === "recommendation" &&
      (m.content as { category?: string }).category === category,
  );
  const options = recommendation ? toOptions(recommendation.content) : [];

  const { data: selection, error: selectionErr } = await supabase
    .from("selections")
    .select("data")
    .eq("room_id", roomId)
    .eq("kind", category)
    .maybeSingle<{ data: Record<string, unknown> }>();
  if (selectionErr) throw readError("selections");
  const data = selection?.data ?? {};
  const selectedId = data.id ?? data.option_id;
  const selectedTitle = data.title ?? data.label;
  const selected: StageSelection | null =
    typeof selectedId === "string" && typeof selectedTitle === "string"
      ? { id: selectedId, title: selectedTitle, data }
      : null;

  let sessionRow: VoteSessionRow | null = null;
  if (recommendation) {
    const { data: sessions, error: vsErr } = await supabase
      .from("vote_sessions")
      .select("id,question,options,status,tie_pending,tie_option_ids,message_id")
      .eq("room_id", roomId)
      .eq("message_id", recommendation.id)
      .order("created_at", { ascending: false })
      .returns<VoteSessionRow[]>();
    if (vsErr) throw readError("vote_sessions");
    sessionRow = (sessions ?? [])[0] ?? null;
  }

  let vote: StageVote | null = null;
  let voteRows: { option_id: string; member_id: string }[] = [];
  if (sessionRow) {
    const { data: votes, error: vErr } = await supabase
      .from("votes")
      .select("option_id,member_id")
      .eq("vote_session_id", sessionRow.id)
      .returns<{ option_id: string; member_id: string }[]>();
    voteRows = votes ?? [];
    if (vErr) throw readError("votes");
    const counts = new Map<string, number>();
    for (const v of votes ?? []) {
      counts.set(v.option_id, (counts.get(v.option_id) ?? 0) + 1);
    }
    vote = {
      voteSessionId: sessionRow.id,
      question: sessionRow.question,
      status: sessionRow.status,
      options: sessionRow.options.map((o) => ({
        id: o.id,
        label: o.label,
        count: counts.get(o.id) ?? 0,
      })),
    };
  }

  const tiePending = sessionRow?.tie_pending === true;
  let tiebreak: TiebreakAdvice | null = null;
  if (tiePending && sessionRow) {
    const wanted = `${category}_tiebreak`;
    const advice = rows.find(
      (m) =>
        m.kind === "summary" &&
        (m.content as { category?: string }).category === wanted,
    );
    if (advice) {
      tiebreak = toTiebreakAdvice(advice.content, sessionRow.id);
    } else {
      // The guide is still writing its advice (it can take a minute or more). Show
      // the tie right away from the vote itself so the leader can already choose.
      tiebreak = await provisionalTie(roomId, category, sessionRow, options, voteRows);
    }
  }

  const latestNote = rows.find(
    (m) => m.kind === "text" && m.sender_type === "ai",
  );
  const noteText = (latestNote?.content as { text?: unknown } | undefined)
    ?.text;

  return {
    loading: options.length === 0 && vote === null,
    options,
    selected,
    vote,
    tiePending,
    tiebreak,
    guideNote: typeof noteText === "string" ? noteText : null,
  };
}

/**
 * Push a stage's state now and on every change to the room's messages, vote
 * sessions, votes or selections. Returns the unsubscribe function.
 */
export function subscribeStage(
  roomId: string,
  category: StageCategory,
  onChange: (snapshot: StageSnapshot) => void,
): () => void {
  const supabase = getSupabaseClient();

  const push = async (): Promise<void> => {
    try {
      onChange(await readStage(roomId, category));
    } catch {
      // Keep the last known state; never throw into the UI.
    }
  };

  void push();

  const channel = supabase
    .channel(`${category}-stage:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `room_id=eq.${roomId}`,
      },
      () => void push(),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "vote_sessions",
        filter: `room_id=eq.${roomId}`,
      },
      () => void push(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes" },
      () => void push(),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "selections",
        filter: `room_id=eq.${roomId}`,
      },
      () => void push(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
