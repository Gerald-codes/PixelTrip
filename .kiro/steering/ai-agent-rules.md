---
inclusion: fileMatch
fileMatchPattern: 'app/api/agents/**'
---

# PixelTrip — AI Agent Behavior Rules

These rules apply to every AI agent in `app/api/agents/*`. PixelTrip's entire differentiation lives in agent behavior, so these contracts protect the three demo moments.

## Universal Contract (all agents)

- **JSON only.** Prompts must instruct the model to return only valid JSON matching the documented output shape, with no preamble, markdown fences, or commentary.
- **Parse + retry.** The route parses the response, retries exactly once on parse failure with a corrective instruction, then returns `{ error: "Agent failed", retryable: true }` with status 500.
- **Server-side only.** Agents run only in API routes. Never expose prompts, credentials, or model calls to the browser.
- **Stage check.** Verify the room is in the correct stage before invoking the agent.
- **Respect output shapes** exactly as defined in `lib/types.ts` — do not invent or drop fields.

## Demo Moment 1 — Destination Research Agent

Protects: "The recommendation explains *why* a place is or isn't right for this group at this time."

- Always justify each destination with concrete reasoning: seasonality for the actual travel window, weather, crowd level, estimated price level, and persona fit.
- **Never give generic popularity picks.** When a destination conflicts with the group's dates, budget, or persona mix, either exclude it or state the trade-off explicitly.
- Return 3–5 suggestions sorted by `fitScore` descending. Populate `downsides` honestly — every option should have at least one stated trade-off.

## Demo Moment 2 — Persona-Based Itinerary Agent

Protects: "The generated itinerary visibly reflects each person's character."

- Every itinerary item must populate `personaBenefits` (which persona names gain from it) and a `reason`. Persona influence must be visible, not implied.
- Ensure each persona has activities they value; honor `must_have` preferences; respect `avoid` items.
- Balance budget, pace, food, scenery, and comfort across personas. Flag budget concerns for low-budget personas.
- Always return a `fairnessSummary` with per-persona coverage, warnings (too expensive / too packed / unbalanced), and concrete recommendations.

## Demo Moment 3 — Feedback Analysis & Negotiation Agents

Protects: "When someone is unhappy, the AI helps the group negotiate — not just regenerate blindly."

- The feedback agent must identify low scorers, underrepresented personas, and requests that genuinely conflict with others' preferences, and set `requiresNegotiation` accordingly.
- The negotiation agent must explain each conflict in plain language, name the affected users/personas, and propose **at least two** concrete resolution options, each with explicit trade-offs.
- Revisions apply the group's chosen resolution and **preserve unchanged parts of the itinerary** where possible — do not regenerate from scratch. Always produce a diff summary and a regenerated fairness summary.

## Group Profile Agent

- Summarize the group as a travel advisor would: combined budget, dominant pace, common interests, overlapping window, and dominant persona traits.
- Surface tension points early (e.g. low-budget vs. luxury persona, chill vs. fast pace). Keep output under 300 words.

## Tone

- Outputs are read by a group of friends mid-planning. Keep language friendly, clear, and concise. Be specific over generic. Honesty about downsides builds trust — never oversell.
