"""Publish prepared demo results through the normal shared persistence lifecycle."""

from copy import deepcopy

from app.agents.errors import DestinationNotSelectedError, FlightNotSelectedError
from app.agents.messages import (
    QuickReplyOption,
    RecommendationMessageContent,
    SummaryMessageContent,
    TextMessageContent,
    emit_npc_message,
)
from app.agents.nodes.itinerary import _never_still_applicable, persist_itinerary_version
from app.agents.progress import report_phase
from app.agents.proposals import (
    DestinationRecommendationProposal,
    FlightRecommendationProposal,
    ItineraryModel,
    ItineraryProposal,
    RefinementProposal,
)
from app.agents.state import AgentState, RepositoryBundle, load_trip_context
from app.demo import is_demo, require_demo_pair
from app.demo.scenario import (
    REFINEMENTS,
    SUPPORTED_DESTINATIONS,
    build_itinerary,
    destination_items,
    flight_items,
)
from app.demo.tiebreak_copy import OPTION_COPY, member_reason
from app.exceptions import ValidationError
from app.services.trip_status_service import advance_trip_status


async def dispatch_run(state: AgentState, repos: RepositoryBundle, live_runner) -> AgentState:
    """Used by both synchronous and HTTP/background runs, including tiebreaks."""
    trip = await repos.trip_repo.get_by_id(state.trip_id)
    room = await repos.room_repo.get_by_id(trip["room_id"]) if trip else None
    if room and is_demo(room):
        return await run_demo(state, repos)
    return await live_runner(state, repos)


async def run_demo(state: AgentState, repos: RepositoryBundle) -> AgentState:
    context = await load_trip_context(repos, state.trip_id, state.run_type)
    if not is_demo(context["room"]):
        raise ValidationError("This room has no prepared demo scenario.")
    require_demo_pair(context["members"])
    if state.created_by_member_id not in {m["id"] for m in context["members"]}:
        raise ValidationError("The demo run must be started by a member of this room.")
    state = state.with_trip_context(context)
    await report_phase(repos, state, "posting")
    if state.run_type in {"discovery", "logistics"}:
        return await _recommend(state, repos, context)
    if state.run_type == "tiebreak":
        return await _tiebreak(state, repos, context)
    return await _itinerary(state, repos, context)


async def _recommend(state: AgentState, repos: RepositoryBundle, context: dict) -> AgentState:
    room, room_id = context["room"], context["room_id"]
    if (
        not all(p.get("submitted_at") for p in context["preferences"])
        or len(context["preferences"]) != 2
    ):
        raise ValidationError("Both demo users must save their characters first.")
    if state.run_type == "discovery":
        category, stage = "destination", "DISCOVER"
        proposal = DestinationRecommendationProposal(
            title="Your prepared Southeast Asia adventures",
            items=destination_items(room),
            question="Which destination shall the demo party choose?",
            prompt="Vote independently. A split vote lets the leader try a tiebreak.",
        )
    else:
        destination = context["selections"].get("destination")
        if destination is None:
            raise DestinationNotSelectedError()
        destination_id = destination["data"].get("id")
        if destination_id not in SUPPORTED_DESTINATIONS:
            raise ValidationError("Choose one of the prepared destinations.")
        category, stage = "flight", "LOGISTICS"
        proposal = FlightRecommendationProposal(
            title="Prepared sample return flights",
            items=flight_items(room, destination_id),
            question="Which sample flight shall the demo party choose?",
            prompt="Sample flights only; no live search or booking is performed.",
        )
    prior = await repos.vote_session_repo.get_open_by_room_and_category(room_id, category)
    if prior:
        await repos.vote_session_repo.close(prior["id"])
    message = await emit_npc_message(
        repos,
        state.trip_id,
        "recommendation",
        RecommendationMessageContent(
            title=proposal.title,
            category=category,
            items=[item.model_dump(mode="json") for item in proposal.items],
            prompt=proposal.prompt,
            stage=stage,
        ),
    )
    await repos.vote_session_repo.create(
        room_id=room_id,
        message_id=message["id"],
        question=proposal.question,
        options=[{"id": i.id, "label": i.title} for i in proposal.items],
    )
    return state.with_proposal(proposal.model_dump(mode="json"))


async def _tiebreak(state: AgentState, repos: RepositoryBundle, context: dict) -> AgentState:
    session = await repos.vote_session_repo.get_tie_pending_by_room(context["room_id"])
    if not session:
        return state
    options = [o for o in session["options"] if o["id"] in session["tie_option_ids"]]
    if len(options) < 2:
        return state
    category = session.get("category") or "destination"
    message = await repos.message_repo.get_by_id(session["message_id"])
    cards = {i["id"]: i for i in (message or {}).get("content", {}).get("items", [])}
    recommended = max(options, key=lambda o: cards.get(o["id"], {}).get("meta", {}).get("score", 0))
    profiles = {p["member_id"]: p for p in context.get("preferences", [])}
    fit = OPTION_COPY[recommended["id"]]["whyThisFits"]
    advice = (
        f"I recommend {OPTION_COPY[recommended['id']]['recommendation']} "
        f"because {fit[0].lower() + fit[1:]}"
    )
    await emit_npc_message(
        repos,
        state.trip_id,
        "summary",
        SummaryMessageContent(
            title="A tie for the party leader to break",
            text=advice,
            advice=advice,
            category=f"{category}_tiebreak",
            stage="DISCOVER" if category == "destination" else "LOGISTICS",
            vote_session_id=session["id"],
            recommended_option_id=recommended["id"],
            options=[QuickReplyOption(id=o["id"], label=o["label"][:100]) for o in options],
            items=[
                {
                    "id": o["id"],
                    "title": o["label"],
                    "score": cards.get(o["id"], {}).get("meta", {}).get("score", 80),
                    **{
                        key: value
                        for key, value in OPTION_COPY[o["id"]].items()
                        if key != "recommendation"
                    },
                    "memberFit": [
                        {
                            "memberId": m["id"],
                            "displayName": m["display_name"],
                            "score": 85,
                            "reason": member_reason(
                                o["id"], m["display_name"], profiles.get(m["id"], {})
                            ),
                        }
                        for m in context["members"]
                    ],
                }
                for o in options
            ],
        ),
    )
    return state


def refine_itinerary(base: dict, feedback: list[dict]) -> tuple[dict, list[str]]:
    result = deepcopy(base)
    addressed = []
    for row in feedback:
        script = REFINEMENTS.get(row["comment"])
        if script is None or (row.get("target") or {}).get("day") != script[0]:
            continue
        day_number, action = script
        day = result["days"][day_number - 1]
        items = day["items"]
        if action in {"club", "dinner", "cafe"}:
            item_id = f"d{day_number}-demo-{action}"
            if any(i["id"] == item_id for i in items):
                addressed.append(row["id"])
                continue
            if len(items) >= 10:
                continue
            title, time, description = {
                "club": (
                    "Separate Evening Club Visit",
                    "21:00",
                    "Visit a local nightlife venue after dinner. This is a separate activity.",
                ),
                "dinner": (
                    "Dinner Before the Evening Walk",
                    "18:00",
                    "Have dinner together before the evening activity.",
                ),
                "cafe": (
                    "Farewell Café Stop",
                    "10:00",
                    "Enjoy a final café break before the airport transfer.",
                ),
            }[action]
            items.append(
                {
                    "id": item_id,
                    "title": title,
                    "time": time,
                    "description": description,
                    "location": {
                        "Bali, Indonesia": "Seminyak",
                        "Phuket, Thailand": "Patong",
                    }.get(
                        base["destination"]["name"],
                        base["destination"]["name"] + " city centre",
                    ),
                    "cost": 20,
                    "tags": [],
                    "location_id": None,
                }
            )
            items.sort(key=lambda i: i.get("time") or "")
        elif action == "lunch":
            lunch = next((i for i in items if i["id"] == "d2-i2"), None)
            if not lunch:
                continue
            lunch.update(
                title="Relaxed Bar Lunch",
                description="Enjoy lunch at a relaxed bar instead of the original lunch stop.",
                location_id=None,
            )
        else:
            morning = next((i for i in items if i["id"] == "d4-i1"), None)
            if not morning:
                continue
            morning["time"] = "11:00"
        addressed.append(row["id"])
    return result, addressed


async def _itinerary(state: AgentState, repos: RepositoryBundle, context: dict) -> AgentState:
    latest = context["latest_itinerary_version"]
    if state.run_type == "itinerary":
        if latest:
            return state
        destination = context["selections"].get("destination")
        if destination is None:
            raise DestinationNotSelectedError()
        if context["selections"].get("flight") is None:
            raise FlightNotSelectedError()
        itinerary = build_itinerary(state.trip_id, context["room"], destination["data"]["id"])
        proposal = ItineraryProposal(itinerary=itinerary)
        source, summary, new_status = "build", None, "itinerary_generated"
        addressed = []
    else:
        if latest is None:
            raise ValidationError("Build the prepared itinerary before refining it.")
        if not all(m.get("stage_ready") for m in context["members"]):
            raise ValidationError("Both demo users must lock their reviews first.")
        state = state.with_base_version(latest["version"])
        updated, addressed = refine_itinerary(latest["itinerary"], context["open_feedback"])
        if not addressed:
            await emit_npc_message(
                repos,
                state.trip_id,
                "text",
                TextMessageContent(
                    text="No prepared change was applied. Use one of the demo review choices.",
                    stage="REFINE",
                ),
            )
            return state
        summary = "Applied the party's prepared demo changes."
        proposal = RefinementProposal(
            itinerary=ItineraryModel(**updated),
            change_summary=summary,
            addressed_feedback_ids=addressed,
            unresolved_feedback_ids=[
                r["id"] for r in context["open_feedback"] if r["id"] not in addressed
            ],
        )
        source, new_status = "refine", "refinement_completed"
    state = state.with_proposal(proposal.model_dump(mode="json"))
    row, state = await persist_itinerary_version(
        state,
        repos,
        proposal.to_persistable(),
        source=source,
        change_summary=summary,
        is_still_applicable=_never_still_applicable,
    )
    if row is None:
        return state
    if addressed:
        await repos.feedback_repo.mark_addressed(addressed)
    await emit_npc_message(
        repos,
        state.trip_id,
        "summary",
        SummaryMessageContent(
            title=proposal.itinerary.title,
            text=summary or proposal.itinerary.summary,
            stage="BUILD" if source == "build" else "REFINE",
            itinerary_version_id=row["id"],
        ),
    )
    await advance_trip_status(repos, state.trip_id, new_status, context["trip"]["status"])
    return state.with_trip_context({**context, "result_version_id": row["id"]})
