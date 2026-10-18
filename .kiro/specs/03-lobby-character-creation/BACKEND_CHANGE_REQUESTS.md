# Backend Change Requests (frontend -> backend)

Hand these to whoever owns the FastAPI + AI-agent layer. Both are additive and
scoped so the frontend can render the new DISCOVER / LOGISTICS experience.

---

## CR-1: Enrich recommendation items so the destination/flight cards can show
         fit score, "why this fits", tags, and trade-offs

### Why
The frontend now renders rich recommendation cards (fit-score badge, "WHY THIS
FITS", highlight tags, a trade-off note, expandable details). The card reads
these from each recommendation item's `description` and `meta` and **degrades
gracefully** when they are absent — so today it only shows the title + a Select
button, because the discovery node emits `description=""` and `meta={}`.

### No schema change needed
`app/agents/proposals.py::RecommendationItem` already has:
- `description: str` (currently defaulted to `""`)
- `meta: dict[str, Any]` (currently `{}`)

So this is purely about **populating** those two fields in the producing nodes.

### Where to change
- Destinations: `app/agents/nodes/discovery.py` — `_build_proposal()` (and the
  LLM step that generates candidates) currently builds
  `{"id", "title", "meta": {}}` with no description. Populate `description` and
  `meta` per item.
- Flights: `app/agents/nodes/logistics.py` — same idea for flight items.

### `meta` keys the frontend card reads (all optional)
The card is tolerant and checks several aliases; emit any one per concept:

| Concept            | Preferred key   | Also accepted            | Type       | Example |
|--------------------|-----------------|--------------------------|------------|---------|
| Fit score /100     | `score`         | `fit`, `fitScore`, `match` | number 0-100 | `92` |
| Why it fits        | `whyThisFits`   | `why`, `reason`          | string (or use the item's `description`) | "Phuket in July is a nightlife paradise on a shoestring…" |
| Highlight tags     | `tags`          | `highlights`, `pros`     | string[]   | `["Budget", "Low crowds"]` |
| Trade-off / caution| `tradeOff`      | `tradeoff`, `con`, `warning` | string | "Monsoon rain can disrupt beach time." |
| Full details       | `details`       | `fullDetails`, `longDescription` | string | longer blurb shown under "View full details" |

Notes:
- `description` on the item is used as the "WHY THIS FITS" text if `meta.whyThisFits`
  is absent — so at minimum, fill `description`.
- `score` should be the AI's fit/confidence for how well the option matches the
  group profile (budget ceiling, interests, activities, availability). The card
  renders it as a green `FIT {score}/100` badge; omit it and no badge shows.
- For **flights** (LOGISTICS) the same card is reused, so the same `meta` keys
  apply; put price/airline/duration/stops into `tags` and/or `details`, and the
  value-for-money judgement into `score`.

### Example item the frontend wants
```json
{
  "id": "phuket-thailand",
  "title": "Phuket, Thailand",
  "description": "Phuket in July is a nightlife paradise on a shoestring. Bangla Road delivers nightly energy; food is $1-3 per meal.",
  "meta": {
    "score": 92,
    "whyThisFits": "Matches the party's nightlife + budget priorities within the shared July window.",
    "tags": ["Budget", "Low crowds", "Nightlife"],
    "tradeOff": "Monsoon rain can disrupt beach time and outdoor activities.",
    "details": "Accommodation runs $10-30/night; the monsoon keeps crowds minimal; …"
  }
}
```

### Acceptance
- `discovery` run emits items with a non-empty `description` and a populated
  `meta` (at least `score` + `tags` + `tradeOff` where the model can produce them).
- `logistics` run does the same for flights.
- No change to `RecommendationItem` fields, the vote flow, or the contract shape
  (still `kind:"recommendation"`, `items[]`); only the per-item content is richer.
- Update `api-contracts.md` "Recommendation Response Structure" to document the
  `meta` keys above so both sides agree.

---

## CR-2: AI-assisted tiebreak (leader decides) — destination AND flight

(See the separate tiebreak brief already shared. Summary: on a tie,
`resolve_vote_session` should defer instead of auto-picking by index; trigger a
new `tiebreak` agent run that posts leader-facing advice built from the group
profile + the actual vote split; add an owner-only
`POST /votes/{voteSessionId}/break-tie` that locks the chosen option and advances
the trip. Applies to both `destination` and `flight` categories, which already
share `resolve_vote_session` / `selection_data` / `_STATUS_BY_KIND`.)
