# Bugfix Requirements Document

## Introduction

The NEGOTIATION stage in PixelTrip is broken in four distinct ways. First, non-host users can select resolution options and trigger PATCH calls to the database even though conflict resolution is a host-only action. Second, each conflict has its own independent "Apply resolution & revise itinerary" button, meaning the negotiation agent fires once per resolved conflict — so three conflicts produce three sequential itinerary regenerations instead of one. Third, non-host users see messaging that actively instructs them to "select a resolution option", implying they have agency they shouldn't have. Fourth, the overall flow has no single final submission point: the host applies resolutions piecemeal rather than reviewing all conflicts together and committing once.

The fix restructures the stage so the host reviews all conflicts on one screen, selects exactly one resolution option per conflict, then clicks a single "Apply selected resolutions and regenerate itinerary" button that sends all selections together in one request. Non-host users see the same screen read-only — they can view the conflicts and see which option the host has highlighted, but they cannot interact with the controls.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a non-host user is on the NEGOTIATION stage THEN the system allows them to click resolution option buttons and fires a PATCH request to `/api/conflicts/[id]` that writes `selectedResolution` to the database

1.2 WHEN a non-host user is on the NEGOTIATION stage THEN the system displays the message "Select a resolution option above. The host will apply the chosen resolution and revise the itinerary." which implies the non-host user should be making a selection

1.3 WHEN the host clicks "Apply resolution & revise itinerary" on a single conflict card THEN the system calls `POST /api/agents/negotiation` for that one conflict immediately, triggering a full itinerary regeneration

1.4 WHEN there are multiple open conflicts and the host resolves them one at a time THEN the system triggers one separate `POST /api/agents/negotiation` call per conflict, regenerating the itinerary N times instead of once

1.5 WHEN the host is reviewing conflicts THEN the system presents each conflict card with its own individual apply button, fragmenting the resolution flow across N separate actions rather than one unified submission

1.6 WHEN `handleSelectOption` is called THEN the system allows any user (host or non-host) to update `selectedResolutions` state and write to the database, with no host identity check

### Expected Behavior (Correct)

2.1 WHEN a non-host user is on the NEGOTIATION stage THEN the system SHALL render all resolution option buttons as visually non-interactive (no click handler, disabled styling) and SHALL NOT fire any PATCH request when a non-host user clicks an option

2.2 WHEN a non-host user is on the NEGOTIATION stage THEN the system SHALL display a read-only status message such as "The host is selecting resolutions. You'll see the updated itinerary once they confirm." with no instruction to select options

2.3 WHEN the host has selected one resolution option per conflict and clicks the single "Apply selected resolutions and regenerate itinerary" button THEN the system SHALL send all selected resolutions together in one `POST /api/agents/negotiation` request

2.4 WHEN the host submits all conflict resolutions at once THEN the system SHALL trigger exactly one itinerary regeneration regardless of how many conflicts exist

2.5 WHEN the host is on the NEGOTIATION stage THEN the system SHALL show one global "Apply selected resolutions and regenerate itinerary" button at the bottom of the page (not one button per conflict card) and SHALL disable it until the host has selected an option for every open conflict

2.6 WHEN `handleSelectOption` is called THEN the system SHALL only update local `selectedResolutions` state if `isHost` is true and SHALL NOT make any PATCH request to `/api/conflicts/[id]` during the selection phase — persistence happens only as part of the final bulk submission

2.7 WHEN the negotiation agent has successfully revised the itinerary THEN the system SHALL advance to the next stage per the existing room state machine (NEGOTIATION → FEEDBACK or FINAL as appropriate) without requiring a separate host action

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the host selects a resolution option THEN the system SHALL CONTINUE TO update the visual selected state locally so the host can see which option they have picked for each conflict before submitting

3.2 WHEN the itinerary is successfully revised THEN the system SHALL CONTINUE TO broadcast `itinerary-updated` on the Supabase realtime channel so non-host clients refresh their itinerary view

3.3 WHEN `POST /api/agents/negotiation` returns a diff summary THEN the system SHALL CONTINUE TO display the `diffSummary` banner to all users after the revised itinerary is received

3.4 WHEN there are no open conflicts THEN the system SHALL CONTINUE TO show the empty-state message and allow the host to advance or go back without triggering the agent

3.5 WHEN the agent call fails THEN the system SHALL CONTINUE TO display an error message and leave the host on the NEGOTIATION stage so they can retry

3.6 WHEN a conflict has `status === "resolved"` from a prior round THEN the system SHALL CONTINUE TO display the RESOLVED badge on that conflict card

3.7 WHEN `GET /api/conflicts?roomId=...` returns conflicts with pre-existing `selectedResolution` values THEN the system SHALL CONTINUE TO pre-populate the host's local selection state from those values

3.8 WHEN the host navigates away and returns THEN the system SHALL CONTINUE TO re-fetch conflicts and restore the selection state from any already-resolved conflicts via the existing `fetchConflicts` hydration logic

---

## Bug Condition Analysis

**Bug Condition Function** — identifies inputs that trigger the multi-regeneration and non-host mutation bugs:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type NegotiationInteraction
  OUTPUT: boolean

  // Returns true when either:
  //   (a) a non-host user attempts a resolution selection, OR
  //   (b) the host resolves conflicts one at a time (N > 1 conflict, per-conflict apply)
  RETURN (X.actorIsHost = false AND X.action = "selectOption")
      OR (X.actorIsHost = true  AND X.conflictCount > 1 AND X.action = "applyResolution" AND X.submissionMode = "per-conflict")
END FUNCTION
```

**Property: Fix Checking — Non-host cannot mutate selection state**
```pascal
FOR ALL X WHERE X.actorIsHost = false AND X.action = "selectOption" DO
  result ← NegotiationStage'(X)
  ASSERT no_patch_request_fired(result)
  ASSERT local_state_unchanged(result)
END FOR
```

**Property: Fix Checking — Single regeneration for all conflicts**
```pascal
FOR ALL X WHERE X.actorIsHost = true AND X.conflictCount >= 1 DO
  result ← NegotiationStage'(X)
  ASSERT agent_call_count(result) = 1
  ASSERT all_resolutions_sent_in_one_request(result)
END FOR
```

**Preservation Goal**
```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
