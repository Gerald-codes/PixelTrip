# Implementation Plan

## Overview

This plan fixes the four interrelated defects in `NegotiationStage.tsx` and `app/api/agents/negotiation/route.ts` using the bug condition methodology: first surface counterexamples on unfixed code (Tasks 1–2), then apply client-side fixes in dependency order (Tasks 3–6), then API-side fixes (Tasks 7–10), then validate both properties against the fixed code (Tasks 11–12), and finally run a build-clean checkpoint (Task 13).

## Notes

- Tasks 1 and 2 MUST run on unfixed code. Task 1 is expected to FAIL (proving the bugs); Task 2 is expected to PASS (establishing the preservation baseline).
- Client-side tasks (3–6) and API-side tasks (7–10) within the same wave can be worked in parallel across engineers, but each wave's tasks must complete before the next wave begins.
- The `ConflictCard` component is defined inline in `NegotiationStage.tsx` (not a separate file) — all `ConflictCard` changes are in that same file.
- The `isNegotiationAgentOutput` validator and `broadcastItineraryUpdated` helper in `route.ts` are unchanged by this fix.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "name": "Explore — Surface the bugs on unfixed code",
      "tasks": ["1", "2"]
    },
    {
      "wave": 2,
      "name": "Fix — NegotiationStage.tsx client-side handlers",
      "tasks": ["3.1", "3.2", "4.1", "4.2", "4.3"],
      "dependsOn": ["1"]
    },
    {
      "wave": 3,
      "name": "Fix — ConflictCard props and read-only rendering",
      "tasks": ["5.1", "5.2", "5.3", "5.4"],
      "dependsOn": ["4.1", "4.2", "4.3"]
    },
    {
      "wave": 4,
      "name": "Fix — NegotiationStage.tsx non-host message and global button",
      "tasks": ["6.1", "6.2"],
      "dependsOn": ["5.1", "5.2", "5.3", "5.4"]
    },
    {
      "wave": 5,
      "name": "Fix — API route: accept conflicts array and validate",
      "tasks": ["7.1", "7.2", "7.3"],
      "dependsOn": ["4.1", "4.2", "4.3"]
    },
    {
      "wave": 6,
      "name": "Fix — API route: bulk DB operations and single agent call",
      "tasks": ["8.1", "8.2", "8.3", "8.4"],
      "dependsOn": ["7.1", "7.2", "7.3"]
    },
    {
      "wave": 7,
      "name": "Fix — API route: auto-advance stage and update SYSTEM_PROMPT",
      "tasks": ["9.1", "9.2", "10.1"],
      "dependsOn": ["8.1", "8.2", "8.3", "8.4"]
    },
    {
      "wave": 8,
      "name": "Validate — Re-run property tests against fixed code",
      "tasks": ["11.1", "11.2", "12"],
      "dependsOn": ["3.1", "3.2", "4.1", "4.2", "4.3", "5.1", "5.2", "5.3", "5.4", "6.1", "6.2", "7.1", "7.2", "7.3", "8.1", "8.2", "8.3", "8.4", "9.1", "9.2", "10.1"]
    },
    {
      "wave": 9,
      "name": "Checkpoint — build clean",
      "tasks": ["13"],
      "dependsOn": ["11.1", "11.2", "12"]
    }
  ]
}
```

---

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Non-host mutation and per-conflict apply bugs
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms both bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples that demonstrate the exact defects
  - **Scoped PBT Approach**: Scope to two concrete failing scenarios:
    - Scenario A — non-host clicks a resolution option button (any `conflictId`, any `optionId`)
    - Scenario B — host applies resolutions one at a time when `conflictCount >= 2`
  - Mount `NegotiationStage` with a stubbed `fetch` and mock props
  - Scenario A: set `identity.userId !== room.hostUserId`; simulate clicking any option button;
    assert `fetch` was called with `PATCH /api/conflicts/<id>` — this WILL pass on unfixed code,
    proving the missing `isHost` guard in `handleSelectOption` (line ~112)
  - Scenario B: set `identity.userId === room.hostUserId`; simulate clicking "Apply resolution & revise itinerary"
    on one conflict card when two conflicts exist; assert `POST /api/agents/negotiation` was called
    with a single-conflict body (not an array) — proves the per-conflict `handleRevise` bug
  - Also assert: two sequential per-card applies fire `POST /api/agents/negotiation` twice —
    proving the N-calls defect (Bug Condition case 2)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves both bugs exist)
  - Document counterexamples: e.g. "non-host click triggered PATCH /api/conflicts/abc123",
    "host applied 2 conflicts → 2 POST calls to /api/agents/negotiation"
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.3, 1.4, 1.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Unchanged behaviors that must survive the refactor
  - **IMPORTANT**: Follow observation-first methodology — observe on UNFIXED code first, then codify
  - **GOAL**: Establish a regression baseline before touching any production code
  - Observe and record the following on unfixed code (non-bug-condition inputs):
    - Observe: host clicks option → `selectedResolutions` state updates immediately, no network call is needed
      for the visual change (the PATCH is a side effect, not a prerequisite for the UI update)
    - Observe: successful mock agent response → `diffSummary` amber banner renders
    - Observe: `conflicts = []` → empty-state message renders, no agent call fires
    - Observe: mock 500 from `POST /api/agents/negotiation` → error banner shown, `revising` set to false
    - Observe: conflict with `status === "resolved"` → RESOLVED badge present
    - Observe: `fetchConflicts` returns conflicts with non-null `selectedResolution` →
      `selectedResolutions` state pre-populated on mount
  - Write property-based tests that generate random inputs:
    - PBT: random arrays of 0–10 conflicts with varying `status`, for a HOST user — assert that
      visual selection state (`aria-pressed`) updates for each clicked option without any PATCH being fired
      (this is the baseline — the PATCH IS currently fired, but the visual update doesn't depend on it;
      verify the UI renders correctly regardless)
    - PBT: random `fetchConflicts` responses with varying `selectedResolution` values — assert
      `selectedResolutions` state always matches non-null `selectedResolution` fields after mount
    - Example test: render with `conflicts = [{...status:"resolved",...}]` → assert RESOLVED badge present
    - Example test: mock 500 response → assert error message rendered, `revising = false`
    - Example test: mock success response with `diffSummary` → assert amber banner rendered
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. Fix NegotiationStage.tsx — guard handleSelectOption and remove PATCH call

  - [x] 3.1 Add `isHost` guard as the first statement in `handleSelectOption`
    - In `app/components/NegotiationStage.tsx` at the `handleSelectOption` function (line ~112)
    - Add `if (!isHost) return;` as the very first line of the function body
    - This prevents non-host users from updating `selectedResolutions` state or triggering any network call
    - _Bug_Condition: isBugCondition(X) where X.actorIsHost = false AND X.action = "selectOption"_
    - _Expected_Behavior: no_patch_request_fired(result) AND local_state_unchanged(result)_
    - _Requirements: 2.1, 2.6_

  - [x] 3.2 Remove the PATCH fetch call and the subsequent `fetchConflicts()` call from `handleSelectOption`
    - Delete the entire `try { await fetch(...PATCH...) } catch {}` block inside `handleSelectOption`
    - Delete the `void fetchConflicts()` call inside that block
    - The function body should now be just: `if (!isHost) return;` followed by `setSelectedResolutions(prev => ({ ...prev, [conflictId]: optionId }));`
    - Convert the function from `async` to a plain synchronous function (remove the `async` keyword)
    - Selections are now ephemeral local state until `handleSubmitAll` fires
    - _Preservation: host visual selection state still updates immediately (Requirement 3.1)_
    - _Requirements: 2.6, 3.1_

- [x] 4. Fix NegotiationStage.tsx — delete handleRevise and add handleSubmitAll

  - [x] 4.1 Delete the `handleRevise` function entirely
    - Remove the entire `async function handleRevise(conflictId: string) { ... }` block (lines ~126–153)
    - This eliminates the per-conflict submit path that causes N agent calls for N conflicts
    - _Bug_Condition: isBugCondition(X) where X.actorIsHost = true AND X.action = "applyResolution" AND X.submissionMode = "per-conflict"_
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 4.2 Add the new `handleSubmitAll` async function
    - Add after the now-deleted `handleRevise` block (keep it near the other handler functions)
    - Derive `openConflicts` as `conflicts.filter(c => c.status !== "resolved")`
    - Derive `allSelected` as `openConflicts.every(c => selectedResolutions[c.id])`
    - Guard: `if (!allSelected || revising) return;`
    - Set `revising(true)` and clear `revisionError`
    - Call `fetch("/api/agents/negotiation", { method: "POST", body: JSON.stringify({ roomId: room.id, conflicts: openConflicts.map(c => ({ conflictId: c.id, selectedResolution: selectedResolutions[c.id] })) }) })`
    - On success: cast response to `NegotiationResult`, call `setItinerary(data)`, `setDiffSummary(data.diffSummary)`, and `if (data.updatedRoom) onRoomUpdated(data.updatedRoom)`, then `void fetchConflicts()`
    - On error: set `revisionError` with the error message
    - In `finally`: set `revising(false)`
    - _Expected_Behavior: agent_call_count(result) = 1 AND all_resolutions_sent_in_one_request(result)_
    - _Preservation: error display, revising loading state, diff summary banner, itinerary refresh all preserved_
    - _Requirements: 2.3, 2.4, 3.2, 3.3, 3.5_

  - [x] 4.3 Derive the `allOpenConflictsSelected` boolean for button gating
    - Add a derived constant above the render block:
      `const openConflicts = conflicts.filter(c => c.status !== "resolved");`
      `const allOpenConflictsSelected = openConflicts.length > 0 && openConflicts.every(c => selectedResolutions[c.id]);`
    - This value is used to disable the global submit button until every open conflict has a selection
    - _Requirements: 2.5_

- [x] 5. Fix ConflictCard — remove onRevise prop and make option buttons read-only for non-hosts

  - [x] 5.1 Remove `onRevise` from `ConflictCardProps` interface and from the destructured parameters
    - In the `ConflictCardProps` interface (line ~426), delete the `onRevise: () => void;` line
    - In the `ConflictCard` function signature (line ~436), remove `onRevise` from the destructured props
    - Delete the `canRevise` derived constant (no longer needed)
    - _Requirements: 2.5_

  - [x] 5.2 Delete the per-card "Apply resolution & revise itinerary" button JSX block
    - Remove the entire `{isHost && ( <div>...<button onClick={onRevise}>Apply resolution & revise itinerary</button>...</div> )}` block from `ConflictCard`'s render (lines ~527–539)
    - This removes the per-conflict submit entry point that triggers Bug Condition case 2
    - _Requirements: 1.5, 2.5_

  - [x] 5.3 Make option buttons non-interactive for non-hosts
    - In the `conflict.proposedOptions.map(...)` render, change the `onClick` attachment:
      - When `isHost` is true: keep `onClick={() => onSelectOption(option.id)}`
      - When `isHost` is false: omit `onClick` entirely (do not attach any handler)
    - Add `disabled={!isHost || revising}` to the button element (non-hosts always disabled)
    - For non-hosts, apply muted/read-only styling (e.g. `opacity-60`, `cursor-not-allowed`) regardless of selection state
    - For non-hosts, still render `aria-pressed={isSelected}` so non-hosts can see which option the host has highlighted via Realtime state (read-only indicator, not interactive)
    - The `isHost` prop is already passed to `ConflictCard` — no new prop needed
    - _Preservation: RESOLVED badge, conflict summary, affected members display, and host visual selection state all unchanged_
    - _Requirements: 2.1, 3.1, 3.6_

  - [x] 5.4 Remove `onRevise` from all `ConflictCard` usages in the parent render
    - In `NegotiationStage`'s `conflicts.map(...)` block, delete the `onRevise={() => void handleRevise(conflict.id)}` prop from each `<ConflictCard ... />` call
    - TypeScript will error until this is done — use the compiler as the guide
    - _Requirements: 2.5_

- [ ] 6. Fix NegotiationStage.tsx — non-host status message and global submit button

  - [x] 6.1 Replace the non-host bottom message
    - Find the `else` branch of `{isHost ? … : …}` near line ~399 (the bottom nav block)
    - Replace the text `"Select a resolution option above. The host will apply the chosen resolution and revise the itinerary."`
      with `"⏳ The host is selecting resolutions. You'll see the updated itinerary once they confirm."`
    - _Expected_Behavior: read-only status message shown to non-hosts (Requirement 2.2)_
    - _Requirements: 1.2, 2.2_

  - [x] 6.2 Add global "Apply selected resolutions and regenerate itinerary" button for the host
    - Inside the `{isHost ? (…) : (…)}` block, in the host branch, add the global submit button
      ABOVE (or replacing) the existing nav buttons area — position it below the conflict card list
      but before the "← Back to Itinerary" and "🔁 Another round of feedback" nav buttons
    - Render the button only when there are open conflicts: `{openConflicts.length > 0 && (...)}`
    - Button `disabled` condition: `!allOpenConflictsSelected || revising`
    - Button `onClick`: `() => void handleSubmitAll()`
    - Button label: `{revising ? "Regenerating itinerary…" : "✅ Apply selected resolutions and regenerate itinerary"}`
    - When `!allOpenConflictsSelected`, render a helper text below the button:
      `"Select a resolution for every conflict above to enable this button."`
    - Follow the existing pixel-art button styling (`border-4`, `shadow-pixel-card`, etc.) consistent with the rest of the stage
    - _Expected_Behavior: one global button, disabled until all open conflicts have a selection_
    - _Preservation: nav buttons (back to itinerary, another round of feedback) remain unchanged_
    - _Requirements: 2.3, 2.4, 2.5_

- [x] 7. Fix app/api/agents/negotiation/route.ts — update PostBody to accept conflicts array

  - [x] 7.1 Update the `PostBody` interface
    - In `app/api/agents/negotiation/route.ts`, replace the existing `PostBody` interface:
      ```typescript
      // BEFORE
      interface PostBody {
        roomId?: unknown;
        conflictId?: unknown;
        selectedResolution?: unknown;
      }

      // AFTER
      interface PostBody {
        roomId?: unknown;
        conflicts?: unknown; // Array<{ conflictId: string; selectedResolution: string }>
      }
      ```
    - _Requirements: 2.3_

  - [x] 7.2 Update body destructuring and validation
    - Replace `const { roomId, conflictId, selectedResolution } = body;` with `const { roomId, conflicts } = body;`
    - Remove the individual `conflictId` and `selectedResolution` string validation blocks
    - Add validation for the `conflicts` array:
      - `if (!Array.isArray(conflicts) || conflicts.length === 0)` → return 400 "conflicts must be a non-empty array"
      - For each entry, validate `typeof entry.conflictId === "string"` and `typeof entry.selectedResolution === "string"` → return 400 on failure
    - Define a typed alias: `const conflictEntries = conflicts as Array<{ conflictId: string; selectedResolution: string }>;`
    - _Requirements: 2.3_

  - [x] 7.3 Update the JSDoc comment on the `POST` function
    - Update the `@param` body description to reflect the new contract:
      `Body: { roomId: string; conflicts: Array<{ conflictId: string; selectedResolution: string }> }`
    - Remove references to `conflictId` and `selectedResolution` as top-level fields
    - _Requirements: 2.3_

- [x] 8. Fix app/api/agents/negotiation/route.ts — load all conflicts, call agent once, bulk-resolve

  - [x] 8.1 Replace single-conflict DB load with bulk conflict load
    - Replace the single `.eq("id", conflictId).single()` query with a bulk fetch:
      ```typescript
      const conflictIds = conflictEntries.map(e => e.conflictId);
      const { data: conflictsData, error: conflictsError } = await supabase
        .from("conflict_resolutions")
        .select("id, room_id, itinerary_id, conflict_summary, affected_users, proposed_options, selected_resolution, status")
        .in("id", conflictIds);
      ```
    - Handle 404-equivalent: if `conflictsData.length !== conflictIds.length`, return 404 with the missing IDs listed
    - Map each row through `mapConflictRow` to get a typed `ConflictResolution[]`
    - For each entry in `conflictEntries`, validate that the `selectedResolution` is present in that conflict's `proposedOptions` array — return 400 if any chosen option is not found
    - _Requirements: 2.3, 2.4_

  - [x] 8.2 Build combined agent context from all conflicts
    - Replace the single-conflict `userPromptContext` object with a multi-conflict shape:
      ```typescript
      const userPromptContext = {
        currentItinerary: { destination, startDate, endDate, days, fairnessSummary },
        conflicts: loadedConflicts.map(conflict => {
          const entry = conflictEntries.find(e => e.conflictId === conflict.id)!;
          const chosenOption = conflict.proposedOptions.find(o => o.id === entry.selectedResolution)!;
          return {
            conflictSummary: conflict.conflictSummary,
            affectedUsers: conflict.affectedUsers,
            proposedOptions: conflict.proposedOptions,
            chosenOptionId: entry.selectedResolution,
            chosenOptionDescription: chosenOption.description,
          };
        }),
        members: users.map(u => ({ userId: u.id, displayName: u.display_name, characterProfile: cpByUser.get(u.id) ?? null })),
      };
      ```
    - _Requirements: 2.4_

  - [x] 8.3 Replace single-conflict resolve with bulk resolve
    - Replace the single `.eq("id", conflictId)` update with:
      ```typescript
      const { error: resolveConflictsError } = await supabase
        .from("conflict_resolutions")
        .update({ status: "resolved" })
        .in("id", conflictIds);
      ```
    - Also update each conflict's `selected_resolution` field — either as a second query using `.in("id", ...)` or by iterating with individual updates (prefer a single `in` query for atomicity)
    - Keep the "non-fatal" pattern: log the error but don't fail the response if this step fails
    - Update the success log to reflect multiple conflicts:
      `[agent/negotiation] room ${room.room_code} revised itinerary to v${nextVersion} (${conflictIds.length} conflicts resolved)`
    - _Requirements: 2.4_

  - [x] 8.4 Include the new itinerary and updated room data in the response
    - Add `updatedRoom` to the 201 response body so the client can call `onRoomUpdated`:
      ```typescript
      return NextResponse.json(
        { ...newItinerary, diffSummary: agentOutput.diffSummary, updatedRoom: updatedRoomData },
        { status: 201 },
      );
      ```
    - `updatedRoomData` will be populated in Task 9 after the stage advance query
    - Update the `NegotiationResult` interface on the client side (in `NegotiationStage.tsx`) to add `updatedRoom?: TripRoom`
    - _Requirements: 2.7_

- [x] 9. Fix app/api/agents/negotiation/route.ts — auto-advance room stage after successful revision

  - [x] 9.1 Add stage-advance query after persisting the new itinerary
    - After updating `current_itinerary_id` and before the bulk-resolve step (Task 8.3), add:
      ```typescript
      const { data: updatedRoomData, error: stageAdvanceError } = await supabase
        .from("trip_rooms")
        .update({ current_stage: RoomStage.FEEDBACK })
        .eq("id", roomId)
        .select("id, room_code, current_stage, host_user_id, selected_destination, selected_flight_option, current_itinerary_id")
        .single();
      ```
    - If `stageAdvanceError`, log the error and continue (non-fatal — the itinerary was persisted successfully)
    - Note: the room state machine allows `NEGOTIATION → FEEDBACK → ITINERARY` loop, so advancing to `FEEDBACK` is always correct here per the existing state machine definition
    - _Expected_Behavior: auto-advance room stage so the host does not need a separate action_
    - _Requirements: 2.7_

  - [x] 9.2 Broadcast stage-change on the room channel after advancing
    - After the stage advance, call `broadcastStageChange(roomId)` (or replicate the broadcast pattern from the client-side helper using the service Supabase client) so non-host clients advance their view automatically
    - Keep this non-fatal (wrap in try/catch, log on failure)
    - _Preservation: stage broadcast behavior consistent with existing patterns (Requirement 3.2)_
    - _Requirements: 2.7_

- [x] 10. Fix app/api/agents/negotiation/route.ts — update SYSTEM_PROMPT for multiple conflicts

  - [x] 10.1 Rewrite the SYSTEM_PROMPT to handle a conflicts array
    - Replace the existing `SYSTEM_PROMPT` constant with a version that:
      - Instructs the agent that it will receive a `conflicts` array (not a single conflict)
      - States it must incorporate ALL chosen resolutions from the provided list in one pass
      - Emphasizes preserving unchanged parts of the itinerary across all resolutions
      - Keeps the existing non-negotiable rules (JSON only, `personaBenefits` non-empty, diff summary names changed items, fairness summary covers every persona)
    - Example revised preamble:
      "A group of friends resolved multiple conflicts. Revise the existing itinerary to incorporate ALL chosen resolutions from the provided conflicts list in a single pass. Preserve as many unchanged items as possible."
    - Keep the output shape identical: `{ days, fairnessSummary, diffSummary }` — the agent output validator `isNegotiationAgentOutput` does not need to change
    - _Preservation: output shape, validation logic, and retry behavior all unchanged_
    - _Requirements: 2.4_

- [x] 11. Verify bug condition exploration test now passes (after fix)

  - [x] 11.1 Verify Property 1: non-host cannot mutate selection state
    - **Property 1: Expected Behavior** - Non-host option click is a no-op
    - **IMPORTANT**: Re-run the SAME test from Task 1, Scenario A — do NOT write a new test
    - The test from Task 1 encodes the expected behavior (no PATCH fired, no state change)
    - When this test passes, it confirms the `isHost` guard in `handleSelectOption` is correct
    - Run bug condition exploration test Scenario A on FIXED code
    - **EXPECTED OUTCOME**: Test PASSES (confirms non-host mutation bug is fixed)
    - _Requirements: 2.1, 2.6_

  - [x] 11.2 Verify Property 1: single agent call for all conflicts on submission
    - **Property 1: Expected Behavior** - handleSubmitAll fires exactly one POST with all conflicts
    - **IMPORTANT**: Re-run the SAME test from Task 1, Scenarios B and C — do NOT write a new test
    - When this test passes, it confirms the per-conflict N-calls bug is fixed
    - Run bug condition exploration test Scenarios B/C on FIXED code
    - **EXPECTED OUTCOME**: Tests PASS (confirms single-agent-call behavior)
    - _Requirements: 2.3, 2.4_

- [x] 12. Verify preservation tests still pass (after fix)
  - **Property 2: Preservation** - All baseline behaviors unchanged after the refactor
  - **IMPORTANT**: Re-run the SAME tests from Task 2 — do NOT write new tests
  - Run all preservation property tests on FIXED code
  - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions)
  - Verify:
    - Host visual selection still updates immediately (no network round-trip required)
    - Diff summary amber banner still appears after successful submission
    - Empty-state message still shown when `conflicts = []`
    - Error banner still shown and `revising` cleared on 500 response
    - RESOLVED badge still present on resolved conflicts
    - `selectedResolutions` still pre-populated from resolved conflicts on mount
  - Confirm no preservation tests are newly failing after the fix

- [x] 13. Checkpoint — build clean
  - Run `npm run build` and confirm zero TypeScript errors
  - Run `npm run lint` and confirm zero lint errors
  - Verify the following assertions hold end-to-end:
    - Non-host users cannot update `selectedResolutions` state or trigger any network request by clicking option buttons
    - Host submitting N open conflicts always produces exactly one `POST /api/agents/negotiation` call
    - The `POST` body always contains exactly N entries (one per open conflict, resolved conflicts excluded)
    - The route processes all N conflicts, calls the agent once, marks all N resolved, advances the room stage
    - All preservation behaviors (diff summary, RESOLVED badge, error state, empty state, pre-population, realtime broadcast) are working as before
