"use client";

/**
 * DevRunConsole — a developer test bench for the AI agent runs.
 *
 * Create or join a real room, save preferences, start discovery / logistics /
 * itinerary / refinement runs, vote, and watch the guide's messages and itinerary
 * appear. It talks to the real backend only (see `devConsole.api.ts`), so it needs
 * the backend running with `ENABLE_DEV_ENDPOINTS=true` for the two testing helpers
 * (lock a test flight, add feedback). Presentational: all state is in the hook.
 */
import { useState, type ReactElement, type ReactNode } from "react";

import { PixelButton } from "@/components/PixelButton";
import { PixelCard } from "@/components/PixelCard";
import {
  listLlmCalls,
  type ConsoleLlmCall,
  type ConsoleItineraryVersion,
  type ConsoleMessage,
  type ConsoleRun,
  type RunType,
} from "@/services/devConsole.api";

import { useDevConsole } from "./useDevConsole";

/** Sample preferences (camelCase, as the API expects). Editable in the page. */
export const SAMPLE_PREFERENCES = JSON.stringify(
  {
    availableDates: [{ start: "2026-12-20", end: "2026-12-24" }],
    destinations: ["Kyoto, Japan"],
    interests: ["street food", "temples"],
    activities: [{ name: "tea ceremony", priority: "must_have" }],
    hardConstraints: ["no beaches"],
    budget: 1500,
    origin: "SIN",
  },
  null,
  2,
);

const RUN_TYPES: ReadonlyArray<{ type: RunType; label: string; hint: string }> =
  [
    {
      type: "discovery",
      label: "1. Discovery",
      hint: "recommends destinations",
    },
    {
      type: "logistics",
      label: "2. Logistics",
      hint: "needs a flight API key",
    },
    {
      type: "itinerary",
      label: "3. Itinerary",
      hint: "needs a locked destination and flight",
    },
    {
      type: "refinement",
      label: "4. Refinement",
      hint: "applies open feedback",
    },
  ];

const FIELD = "bg-bg text-ink border-2 border-ink p-8 font-body w-full";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="flex flex-col gap-8 font-body">
      <span className="text-subtle">{label}</span>
      {children}
    </label>
  );
}

/** One readable line (or block) for a chat message of any kind. */
export function describeMessage(message: ConsoleMessage): {
  heading: string;
  lines: string[];
} {
  const content = message.content;
  const heading =
    typeof content.title === "string" ? content.title : message.kind;
  const lines: string[] = [];
  if (typeof content.text === "string") {
    lines.push(content.text);
  }
  if (Array.isArray(content.items)) {
    for (const item of content.items as Array<{ title?: string }>) {
      if (item.title) {
        lines.push(`• ${item.title}`);
      }
    }
  }
  if (lines.length === 0) {
    lines.push(JSON.stringify(content));
  }
  return { heading, lines };
}

function RunRow({ run }: { run: ConsoleRun }): ReactElement {
  const tone =
    run.status === "completed"
      ? "text-success"
      : run.status === "failed"
        ? "text-alert"
        : "text-accent";
  return (
    <li className="flex flex-wrap gap-8 font-body">
      <span>{run.runType}</span>
      <span className={tone}>{run.status}</span>
      {run.error ? <span className="text-alert">{run.error}</span> : null}
    </li>
  );
}

function ItineraryView({
  version,
}: {
  version: ConsoleItineraryVersion;
}): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <p className="font-body">
        <strong>v{version.version}</strong> ({version.source}, {version.status})
        — {version.itinerary.title}
      </p>
      {version.changeSummary ? (
        <p className="font-body text-subtle">{version.changeSummary}</p>
      ) : null}
      <ol className="flex flex-col gap-8">
        {version.itinerary.days.map((day) => (
          <li key={day.day} className="font-body">
            <strong>Day {day.day}</strong> {day.date ? `(${day.date})` : ""}
            <ul className="ml-16 flex flex-col gap-8">
              {day.items.map((item) => (
                <li key={item.id}>
                  <span className="text-accent">{item.time ?? "--:--"}</span>{" "}
                  {item.title}
                  {item.description ? (
                    <span className="text-subtle"> — {item.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The exact prompts sent to the LLM and its parsed replies, newest first, for
 * tuning prompts. Needs the backend running with `ENABLE_DEV_ENDPOINTS=true`.
 */
function LlmCallsPanel(): ReactElement {
  const [calls, setCalls] = useState<ConsoleLlmCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setCalls(await listLlmCalls());
      setError(null);
    } catch {
      setError(
        "Could not load. Is the backend running with ENABLE_DEV_ENDPOINTS=true?",
      );
    }
  }

  return (
    <PixelCard title="AI prompts (latest calls)">
      <div className="flex flex-col gap-16">
        <PixelButton
          variant="secondary"
          label={calls === null ? "Load prompts" : "Refresh"}
          onClick={() => void refresh()}
        />
        {error ? <p className="text-alert">{error}</p> : null}
        {calls?.length === 0 ? (
          <p className="text-subtle">No LLM calls since the backend started.</p>
        ) : null}
        {calls?.map((call) => (
          <details
            key={`${call.at}-${call.operation}`}
            className="flex flex-col gap-8"
          >
            <summary>
              <strong className="text-accent">{call.operation}</strong> ·{" "}
              {call.model ?? "no model"} · {call.at}
              {call.error ? ` · ${call.error}` : ""}
            </summary>
            <h4 className="font-display">System prompt</h4>
            <pre className="whitespace-pre-wrap">{call.systemPrompt}</pre>
            <h4 className="font-display">User prompt</h4>
            <pre className="whitespace-pre-wrap">{call.userPrompt}</pre>
            <h4 className="font-display">Reply</h4>
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(call.response, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </PixelCard>
  );
}

export function DevRunConsole(): ReactElement {
  const dev = useDevConsole();
  const [roomName, setRoomName] = useState("andy-test");
  const [ownerName, setOwnerName] = useState("Andy");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [preferences, setPreferences] = useState(SAMPLE_PREFERENCES);
  const [departAt, setDepartAt] = useState("2026-12-20T08:00:00");
  const [returnAt, setReturnAt] = useState("2026-12-24T20:00:00");
  const [feedbackItem, setFeedbackItem] = useState("");
  const [feedbackComment, setFeedbackComment] = useState(
    "could we do this later in the evening instead",
  );

  const latest = dev.versions.at(-1);
  const feedbackItems = latest?.itinerary.days.flatMap((day) =>
    day.items.map((item) => ({
      id: item.id,
      label: `Day ${day.day}: ${item.title}`,
    })),
  );
  const openVotes = dev.votes.filter((vote) => vote.status === "open");
  const disabled = dev.busy !== null;

  return (
    <main className="bg-bg text-ink font-body min-h-screen p-24">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-24">
        <h1 className="font-display text-accent">AI RUN CONSOLE</h1>
        <p className="text-subtle">
          Developer test bench. Talks to the real backend and database; every
          room you create here is a real room, so give it an obvious name.
        </p>

        {dev.error ? (
          <p role="alert" className="border-danger text-alert border-2 p-8">
            {dev.error}
          </p>
        ) : null}
        {dev.notice ? (
          <p role="status" className="border-success text-success border-2 p-8">
            {dev.notice}
          </p>
        ) : null}
        {dev.busy ? <p className="text-accent">Working: {dev.busy}…</p> : null}

        <PixelCard title="1. Room">
          {dev.session ? (
            <div className="flex flex-col gap-8">
              <p>
                <strong data-testid="room-code">{dev.session.roomCode}</strong>{" "}
                — {dev.session.roomName} · you are {dev.session.displayName} ·
                stage {dev.session.planningStage} · trip{" "}
                {dev.session.tripStatus}
              </p>
              <p className="text-subtle">
                trip {dev.session.tripId} · member {dev.session.memberId}
              </p>
              <PixelButton
                variant="secondary"
                label="Leave room"
                onClick={dev.leave}
              />
            </div>
          ) : (
            <div className="grid gap-24 md:grid-cols-2">
              <form
                className="flex flex-col gap-8"
                onSubmit={(event) => {
                  event.preventDefault();
                  void dev.createRoom(roomName, ownerName);
                }}
              >
                <h4 className="font-display">Create</h4>
                <Field label="Room name">
                  <input
                    className={FIELD}
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </Field>
                <Field label="Your name">
                  <input
                    className={FIELD}
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </Field>
                <PixelButton
                  type="submit"
                  label="Create room"
                  disabled={disabled}
                />
              </form>
              <form
                className="flex flex-col gap-8"
                onSubmit={(event) => {
                  event.preventDefault();
                  void dev.joinRoom(joinCode, joinName);
                }}
              >
                <h4 className="font-display">Join</h4>
                <Field label="Room code">
                  <input
                    className={FIELD}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                </Field>
                <Field label="Your name">
                  <input
                    className={FIELD}
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                  />
                </Field>
                <PixelButton
                  type="submit"
                  variant="secondary"
                  label="Join room"
                  disabled={disabled}
                />
              </form>
            </div>
          )}
        </PixelCard>

        {dev.session ? (
          <>
            <PixelCard title="2. Preferences">
              <div className="flex flex-col gap-8">
                <Field label="Preferences JSON (camelCase)">
                  <textarea
                    className={`${FIELD} h-64`}
                    rows={12}
                    value={preferences}
                    onChange={(e) => setPreferences(e.target.value)}
                  />
                </Field>
                <PixelButton
                  label="Save preferences"
                  disabled={disabled}
                  onClick={() => void dev.savePreferences(preferences)}
                />
              </div>
            </PixelCard>

            <PixelCard title="3. Runs">
              <div className="flex flex-col gap-16">
                <div className="flex flex-wrap gap-8">
                  {RUN_TYPES.map(({ type, label, hint }) => (
                    <PixelButton
                      key={type}
                      label={label}
                      ariaLabel={`Start ${type} run (${hint})`}
                      variant={type === "discovery" ? "primary" : "secondary"}
                      disabled={disabled}
                      onClick={() => void dev.startRun(type)}
                    />
                  ))}
                </div>
                <p className="text-subtle">
                  Order: discovery → vote → (logistics, or lock a test flight
                  below) → itinerary → add feedback → refinement.
                </p>
                {dev.runs.length > 0 ? (
                  <ul aria-label="Runs" className="flex flex-col gap-8">
                    {dev.runs.map((run) => (
                      <RunRow key={run.id} run={run} />
                    ))}
                  </ul>
                ) : null}
              </div>
            </PixelCard>

            <PixelCard title="Skip logistics (testing only)">
              <div className="flex flex-col gap-8">
                <p className="text-subtle">
                  Locks a made-up flight so an itinerary run can start without a
                  flight API key. Needs the backend started with
                  ENABLE_DEV_ENDPOINTS=true.
                </p>
                <div className="grid gap-8 md:grid-cols-2">
                  <Field label="Departs">
                    <input
                      className={FIELD}
                      value={departAt}
                      onChange={(e) => setDepartAt(e.target.value)}
                    />
                  </Field>
                  <Field label="Returns">
                    <input
                      className={FIELD}
                      value={returnAt}
                      onChange={(e) => setReturnAt(e.target.value)}
                    />
                  </Field>
                </div>
                <PixelButton
                  variant="secondary"
                  label="Lock test flight"
                  disabled={disabled}
                  onClick={() => void dev.lockTestFlight(departAt, returnAt)}
                />
              </div>
            </PixelCard>

            <PixelCard title="Votes">
              {openVotes.length === 0 ? (
                <p className="text-subtle">
                  No open vote. Run discovery to open one.
                </p>
              ) : (
                <div className="flex flex-col gap-16">
                  {openVotes.map((vote) => (
                    <div key={vote.id} className="flex flex-col gap-8">
                      <p>{vote.question}</p>
                      <div className="flex flex-wrap gap-8">
                        {vote.options.map((option) => (
                          <PixelButton
                            key={option.id}
                            variant="option"
                            label={option.label}
                            ariaLabel={`Vote for ${option.label}`}
                            disabled={disabled}
                            onClick={() =>
                              void dev.castVote(vote.id, option.id)
                            }
                          />
                        ))}
                      </div>
                      <PixelButton
                        variant="secondary"
                        label="Close vote"
                        disabled={disabled}
                        onClick={() => void dev.closeVote(vote.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </PixelCard>

            <PixelCard title="Guide messages">
              {dev.messages.length === 0 ? (
                <p className="text-subtle">Nothing yet.</p>
              ) : (
                <ul
                  aria-label="Guide messages"
                  className="flex flex-col gap-16"
                >
                  {dev.messages.map((message) => {
                    const { heading, lines } = describeMessage(message);
                    return (
                      <li key={message.id}>
                        <strong className="text-accent">{heading}</strong>
                        {lines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              )}
            </PixelCard>

            <PixelCard title="Itinerary">
              {!latest ? (
                <p className="text-subtle">
                  No itinerary yet. Run itinerary after voting and locking a
                  flight.
                </p>
              ) : (
                <div className="flex flex-col gap-16">
                  <ItineraryView version={latest} />
                  <div className="flex flex-col gap-8">
                    <h4 className="font-display">Add feedback</h4>
                    <Field label="Item">
                      <select
                        className={FIELD}
                        value={feedbackItem}
                        onChange={(e) => setFeedbackItem(e.target.value)}
                      >
                        <option value="">Choose an item…</option>
                        {feedbackItems?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Comment">
                      <input
                        className={FIELD}
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                      />
                    </Field>
                    <PixelButton
                      variant="secondary"
                      label="Add feedback"
                      disabled={
                        disabled || !feedbackItem || !feedbackComment.trim()
                      }
                      onClick={() =>
                        void dev.addFeedback(
                          latest.id,
                          feedbackItem,
                          feedbackComment,
                        )
                      }
                    />
                  </div>
                </div>
              )}
            </PixelCard>
          </>
        ) : null}
        <LlmCallsPanel />
      </div>
    </main>
  );
}

export default DevRunConsole;
