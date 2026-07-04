# Negotiation Flow Refactor — Bugfix Design

## Overview

The NEGOTIATION stage contains four interrelated defects that break both correctness and UX. Non-host users can mutate database state (via PATCH to `/api/conflicts/[id]`), misleading UI instructs them to make selections they shouldn't, every conflict card holds its own apply button that fires `POST /api/agents/negotiation` immediately, and there is no unified submission point — meaning N conflicts produce N sequential itinerary regenerations.

The fix restructures `NegotiationStage.tsx` around a **bulk-selection + single-submit** model:

- Resolution selections are local-only state until the host clicks one global "Apply selected resolutions and regenerate itinerary" button.
- `handleSelectOption` is host-gated at the call site; no PATCH requests fire during the selection phase.
- The global submit button sends all `{ conflictId, selectedResolution }` pairs in one request body to `POST /api/agents/negotiation` (which must be updated to accept an array), triggering exactly one itinerary regeneration.
- The `POST /api/agents/negotiation` route is updated to accept `conflicts: Array<{ conflictId, selectedResolution }>` instead of a single pair, loop over all selections, and advance the room stage automatically on success.
- Non-host users see a fully read-only screen with an appropriate status message.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the defects — either a non-host user attempts to select a resolution option, or the host resolves conflicts via the old per-conflict apply flow (N conflicts → N agent calls).
- **Property (P)**: The desired behavior when the bug condition holds — no PATCH fires for non-host interactions; exactly one `POST /api/agents/negotiation` is fired with all resolutions when the host submits.
- **Preservation**: All behavior that is NOT the bug condition and must remain unchanged — visual selection state, diff summary display, realtime broadcast, empty/error states, RESOLVED badge, pre-population of selections from resolved conflicts.
- **`handleSelectOption`**: The client-side handler in `NegotiationStage.tsx` (line ~112) that currently updates local state AND fires a PATCH for any user.
- **`handleRevise`**: The per-conflict handler in `NegotiationStage.tsx` (line ~126) that calls `POST /api/agents/negotiation` once per conflict — to be removed and replaced by `handleSubmitAll`.
- **`handleSubmitAll`**: The new host-only handler that collects all `selectedResolutions` and fires a single `POST /api/agents/negotiation` with an array of resolutions.
- **`isHost`**: Derived boolean `identity.userId === room.hostUserId` — the gating condition for all mutable interactions.
- **`selectedResolutions`**: `Record<string, string>` local state mapping `conflictId → optionId`; populated on mount from resolved conflicts and updated on host selection clicks only.
- **`NegotiationInteraction`**: The abstract input type used in the Bug Condition pseudocode — represents one user action on the negotiation screen.

---

## Bug Details

### Bug Condition

The bug manifests in two overlapping cases:

1. **Non-host mutation**: A non-host user clicks a resolution option button. `handleSelectOption` has no `isHost` guard, so it (a) updates `selectedResolutions` local state and (b) fires `PATCH /api/conflicts/[id]`, writing `selectedResolution` to the database.

2. **Per-conflict apply**: The host clicks "Apply resolution & revise itinerary" on any individual conflict card. `handleRevise` calls `POST /api/agents/negotiation` immediately with a single `{ conflictId, selectedResolution }`, triggering a full itinerary regeneration for that one conflict. For N open conflicts, this produces N separate agent calls.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type NegotiationInteraction
  OUTPUT: boolean

  RETURN (X.actorIsHost = false AND X.action = "selectOption")
      OR (X.actorIsHost = true
          AND X.action = "applyResolution"
          AND X.submissionMode = "per-conflict")
END FUNCTION
```

### Examples

- **Non-host mutation**: User B (non-host) is on the NEGOTIATION screen with 2 conflicts. They click "Option A" on Conflict 1. **Current**: `selectedResolutions` is updated and `PATCH /api/conflicts/<id>` fires with `{ selectedResolution: "opt-a" }`. **Expected**: No state update, no network request.

- **Per-conflict N calls**: Host clicks "Apply resolution & revise itinerary" on Conflict 1, then again on Conflict 2. **Current**: Two sequential `POST /api/agents/negotiation` calls → two full itinerary regenerations. **Expected**: Host selects resolutions for both, then clicks one global button → one `POST` with both resolutions.

- **Misleading non-host message**: Non-host sees "Select a resolution option above. The host will apply the chosen resolution and revise the itinerary." **Current**: Message implies the non-host should interact. **Expected**: "The host is selecting resolutions. You'll see the updated itinerary once they confirm."

- **Global button disabled guard**: Host has 3 conflicts and has selected an option for only 2. **Expected**: Global apply button is disabled. Host selects the 3rd resolution → button enables.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Visual selected state updates locally and immediately when the host clicks a resolution option (no network call required, no visible lag).
- After a successful agent call, `itinerary-updated` is still broadcast on the Supabase realtime channel `room:{roomId}:itinerary` so non-host clients refresh automatically.
- The `diffSummary` amber banner is still displayed to all users after the revised itinerary is received from the agent.
- When there are no open conflicts, the empty-state message is still shown and the host can navigate away without triggering the agent.
- When the agent call fails, the error message is still displayed and the stage does not advance — the host can retry.
- Conflicts with `status === "resolved"` continue to show the RESOLVED badge on their card.
- On mount, `fetchConflicts` still pre-populates `selectedResolutions` from conflicts that already have a `selectedResolution` value (previously resolved).
- The host can still navigate back to the itinerary stage (the back button remains).
- The inline revised itinerary preview is still shown after a successful submission.

**Scope:**

All inputs that do NOT involve (a) a non-host clicking an option button or (b) the old per-conflict apply action are completely unaffected by this fix. This includes:

- All read operations (fetching conflicts, fetching itinerary).
- Realtime subscription setup and teardown.
- Host navigation (back to itinerary, advance to feedback).
- Display of conflict summaries, affected members, option trade-offs, and RESOLVED badges.
- The diff summary banner and revised itinerary inline preview.

**Note:** The expected correct behavior for buggy inputs is defined in the Correctness Properties section below (Properties 1 and 2).

---

## Hypothesized Root Cause

Based on code inspection of `NegotiationStage.tsx` and `app/api/agents/negotiation/route.ts`:

1. **Missing `isHost` guard in `handleSelectOption`** (line ~112): The function unconditionally updates local state and fires `PATCH /api/conflicts/${conflictId}`. Adding `if (!isHost) return;` as the first line is the minimal fix for the non-host mutation bug.

2. **PATCH call inside the selection handler**: Even for the host, firing a PATCH on every click is unnecessary — selections should be ephemeral local state until final submission. The PATCH call and the subsequent `fetchConflicts()` call inside `handleSelectOption` must be removed entirely.

3. **`handleRevise` is per-conflict and directly calls the agent**: The `onRevise` prop on `ConflictCard` calls `handleRevise(conflictId)` which immediately invokes `POST /api/agents/negotiation` with one conflict. This handler must be deleted and replaced with a new `handleSubmitAll` handler attached to a single global button outside the `ConflictCard` loop.

4. **`ConflictCard` exposes an `onRevise` prop that calls the agent**: The per-card apply button inside `ConflictCard` is the UX entry point for Bug Condition case 2. The `onRevise` prop and the apply button JSX inside `ConflictCard` must be removed.

5. **`POST /api/agents/negotiation` only accepts a single `{ conflictId, selectedResolution }`**: The route must be extended to accept `conflicts: Array<{ conflictId: string; selectedResolution: string }>`, loop over all entries, run the agent once with all context, and mark all conflicts resolved in a single DB operation. Additionally, the route should auto-advance the room stage after a successful revision (NEGOTIATION → FEEDBACK or FINAL per the state machine).

6. **Misleading non-host message hardcoded in the host-gated render block**: The string "Select a resolution option above…" is rendered in the `else` branch of `{isHost ? … : …}` at line ~399. This text must be replaced with a read-only status message.

---

## Correctness Properties

Property 1: Bug Condition — Non-host cannot mutate selection state or fire PATCH

_For any_ `NegotiationInteraction` X where `X.actorIsHost = false` and `X.action = "selectOption"`, the fixed `handleSelectOption` SHALL neither update `selectedResolutions` state nor fire any HTTP request to `/api/conflicts/[id]`, leaving all local and remote state identical to the state before the interaction.

**Validates: Requirements 2.1, 2.6**

Property 2: Bug Condition — Exactly one agent call for all conflicts on submission

_For any_ set of N ≥ 1 open conflicts where the host has selected one resolution option per conflict and clicks the global submit button, the fixed `handleSubmitAll` function SHALL fire exactly one `POST /api/agents/negotiation` request whose body contains all N `{ conflictId, selectedResolution }` pairs, resulting in exactly one itinerary regeneration regardless of N.

**Validates: Requirements 2.3, 2.4**

Property 3: Preservation — Selection state pre-population from resolved conflicts

_For any_ call to `fetchConflicts` that returns conflicts with non-null `selectedResolution` values, the fixed component SHALL pre-populate `selectedResolutions` state from those values, preserving the hydration behavior that existed in the original code.

**Validates: Requirements 3.7, 3.8**

---

## Fix Implementation

### Changes Required

**File 1: `app/components/NegotiationStage.tsx`**

**1. Guard `handleSelectOption` with an `isHost` check and remove the PATCH call:**

```
// BEFORE
async function handleSelectOption(conflictId, optionId) {
  setSelectedResolutions(prev => ({ ...prev, [conflictId]: optionId }));
  await fetch(`/api/conflicts/${conflictId}`, { method: "PATCH", ... });
  void fetchConflicts();
}

// AFTER
function handleSelectOption(conflictId: string, optionId: string) {
  if (!isHost) return;
  setSelectedResolutions(prev => ({ ...prev, [conflictId]: optionId }));
  // No network call — state is local until handleSubmitAll
}
```

**2. Delete `handleRevise` and add `handleSubmitAll`:**

```
// NEW
async function handleSubmitAll() {
  const openConflicts = conflicts.filter(c => c.status !== "resolved");
  const allSelected = openConflicts.every(c => selectedResolutions[c.id]);
  if (!allSelected || revising) return;

  setRevising(true);
  setRevisionError(null);
  try {
    const res = await fetch("/api/agents/negotiation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: room.id,
        conflicts: openConflicts.map(c => ({
          conflictId: c.id,
          selectedResolution: selectedResolutions[c.id],
        })),
      }),
    });
    if (!res.ok) { ... throw error }
    const data = await res.json() as NegotiationResult;
    setItinerary(data);
    setDiffSummary(data.diffSummary);
    // Stage advance is handled server-side; update local room state
    if (data.updatedRoom) onRoomUpdated(data.updatedRoom);
    void fetchConflicts();
  } catch (err) {
    setRevisionError(...);
  } finally {
    setRevising(false);
  }
}
```

**3. Remove `onRevise` prop from `ConflictCard` and add global submit button below the conflict list:**

```jsx
// Global button — replaces per-card apply buttons
{isHost && conflicts.filter(c => c.status !== "resolved").length > 0 && (
  <div className="...">
    <button
      type="button"
      onClick={() => void handleSubmitAll()}
      disabled={!allOpenConflictsSelected || revising}
      className="..."
    >
      {revising ? "Regenerating itinerary…" : "✅ Apply selected resolutions and regenerate itinerary"}
    </button>
    {!allOpenConflictsSelected && (
      <p className="text-xs ...">
        Select a resolution for every conflict above to enable this button.
      </p>
    )}
  </div>
)}
```

**4. Make `ConflictCard` read-only for non-hosts (option buttons have no `onClick`):**

Pass `isHost` down; only attach `onClick` and interactive styling when `isHost` is true. Non-host option buttons render with `disabled` attribute and muted styling, showing which option the host has currently selected (reflected via the Realtime subscription) but accepting no input.

**5. Replace the non-host bottom message:**

```jsx
// BEFORE
"Select a resolution option above. The host will apply the chosen resolution and revise the itinerary."

// AFTER
"⏳ The host is selecting resolutions. You'll see the updated itinerary once they confirm."
```

---

**File 2: `app/api/agents/negotiation/route.ts`**

**6. Update `PostBody` to accept an array of conflicts:**

```typescript
interface PostBody {
  roomId?: unknown;
  conflicts?: unknown; // Array<{ conflictId: string; selectedResolution: string }>
}
```

**7. Loop over all conflicts, build combined agent context, call the agent once:**

Instead of loading one conflict row, load all N conflict rows whose IDs appear in the `conflicts` array, build a single agent prompt that includes all conflict summaries and chosen options, call `runAgent` once, persist one new itinerary version, mark all N conflicts as resolved in a single `UPDATE … WHERE id = ANY(...)`, and update `current_itinerary_id`.

**8. Auto-advance room stage after successful revision:**

```typescript
// After persisting the new itinerary, advance NEGOTIATION → next stage
await supabase
  .from("trip_rooms")
  .update({ current_stage: RoomStage.FEEDBACK })  // or FINAL per state machine
  .eq("id", roomId);
// Return the updated room data alongside the itinerary so the client can call onRoomUpdated
```

**9. Update the system prompt to handle multiple conflicts:**

The `SYSTEM_PROMPT` must instruct the agent to incorporate all chosen resolutions from the provided list, not just one. The user prompt context shape changes from `{ conflict: {...}, chosenOptionId }` to `{ conflicts: [{ conflictSummary, proposedOptions, chosenOptionId, chosenOptionDescription }] }`.

---

## Testing Strategy

### Validation Approach

Testing follows two phases: first surface counterexamples against the **unfixed** code to confirm root causes, then verify fix correctness and preservation against the **fixed** code.

### Exploratory Bug Condition Checking

**Goal**: Demonstrate the bugs on unfixed code before implementing the fix. Confirm or refute each root cause hypothesis. If refuted, re-hypothesize.

**Test Plan**: Mount `NegotiationStage` with mock props and a stubbed `fetch`. Simulate non-host option clicks and per-conflict apply clicks. Observe which fetch calls are made.

**Test Cases:**

1. **Non-host click fires PATCH** — Mount with `identity.userId ≠ room.hostUserId`. Simulate clicking a resolution option button. Assert that `fetch` was called with `PATCH /api/conflicts/<id>`. *(will pass on unfixed code, proving the bug)*
2. **Non-host state mutation** — Same setup. After clicking, assert `selectedResolutions` state was updated. *(will pass on unfixed code, proving the bug)*
3. **Per-conflict apply triggers agent** — Mount with `identity.userId === room.hostUserId`. Simulate clicking "Apply resolution & revise itinerary" on one conflict card when two conflicts exist. Assert `fetch` was called with `POST /api/agents/negotiation` exactly once with a single-conflict body. *(will pass on unfixed code, proving Bug Condition case 2)*
4. **Two conflicts → two agent calls** — Same setup with two conflicts, host selects and applies both in sequence. Assert `POST /api/agents/negotiation` was called twice. *(will pass on unfixed code, proving N-calls bug)*

**Expected Counterexamples:**
- Non-host option click results in a PATCH request being observed — confirms missing `isHost` guard.
- Per-card apply button calls the agent immediately with one conflict — confirms per-conflict submit design.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed component and API produce the correct behavior.

**Pseudocode:**

```
FOR ALL X WHERE isBugCondition(X) DO
  result ← NegotiationStage'(X)
  IF X.actorIsHost = false AND X.action = "selectOption" THEN
    ASSERT no_fetch_called(result)
    ASSERT selectedResolutions_unchanged(result)
  END IF
  IF X.actorIsHost = true AND X.action = "applyResolution" THEN
    ASSERT agent_call_count(result) = 1
    ASSERT request_body_contains_all_resolutions(result)
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed component produces the same behavior as the original.

**Pseudocode:**

```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT NegotiationStage_original(X) = NegotiationStage_fixed(X)
END FOR
```

**Testing Approach**: Property-based testing is used for preservation checking because:
- It generates random combinations of conflict counts, resolution states, and user roles.
- It catches edge cases like zero open conflicts, all conflicts pre-resolved, or a mix of resolved and open.
- It provides strong guarantees that host visual selection, realtime updates, error display, and empty states all remain unchanged.

**Test Cases:**

1. **Host visual selection preserved** — For any `isHost=true` interaction that selects an option, assert that the option's `aria-pressed` state updates without a network call. Observe this on unfixed code first, then write the test.
2. **Diff summary banner preserved** — Mock a successful agent response. Assert `diffSummary` is rendered in the amber banner after submission. Observe on unfixed code, then test.
3. **Empty state preserved** — Render with `conflicts = []`. Assert empty-state message appears. No agent call should fire.
4. **Error state preserved** — Mock a 500 from `POST /api/agents/negotiation`. Assert error banner shown, `revising` set back to false, stage not advanced.
5. **RESOLVED badge preserved** — Render a conflict with `status = "resolved"`. Assert the RESOLVED badge is present.
6. **Selection pre-population preserved** — Mount with conflicts that have `selectedResolution` values. Assert `selectedResolutions` state matches on first render.

### Unit Tests

- Test `handleSelectOption` is a no-op for non-host users (no state change, no fetch).
- Test `handleSelectOption` updates `selectedResolutions` for host users without firing any network request.
- Test `handleSubmitAll` sends a single POST with all open conflict resolutions in the body.
- Test global submit button is disabled when not all open conflicts have a selection.
- Test global submit button is enabled when all open conflicts have a selection.
- Test `ConflictCard` renders option buttons as non-interactive (no `onClick`) when `isHost=false`.
- Test `ConflictCard` renders the host-selected option with `aria-pressed=true` for non-hosts (read-only indicator).

### Property-Based Tests

- Generate random arrays of conflicts (0–10 items, random `status`, random `proposedOptions`) for a non-host user and verify zero PATCH requests are ever fired regardless of click sequence.
- Generate random conflict arrays for a host user and verify that `handleSubmitAll` always produces exactly one POST whose body contains exactly one entry per open conflict.
- Generate random `fetchConflicts` responses with varying pre-existing `selectedResolution` values and verify `selectedResolutions` state is always correctly pre-populated (Property 3).

### Integration Tests

- Full flow: host selects one option per conflict → clicks global apply → agent mock returns revised itinerary → assert itinerary rendered, diff summary shown, all conflict cards show RESOLVED badge, global apply button gone or disabled.
- Non-host flow: mount same screen with non-host identity → assert all option buttons are non-interactive, correct read-only message shown, no network calls on any interaction.
- Stage advance: after successful `handleSubmitAll`, assert `onRoomUpdated` is called with the updated room reflecting the new stage.
- Retry flow: first agent call returns 500, host clicks apply again → assert exactly two POST calls total, error cleared on second attempt.
