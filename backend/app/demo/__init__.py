"""Prepared, two-device booth demo. No external AI or flight providers."""

SCENARIO = "vietnam-five-days"
DEMO_NAMES = frozenset({"demoalice", "demobob"})


def normalized_name(value: str) -> str:
    return " ".join(value.split()).lower()


def is_demo(room: dict) -> bool:
    return isinstance(room, dict) and room.get("demo_scenario") == SCENARIO


def require_demo_pair(members: list[dict]) -> None:
    from app.exceptions import ValidationError

    if len(members) != 2 or {normalized_name(m["display_name"]) for m in members} != DEMO_NAMES:
        raise ValidationError("This demo needs DemoAlice and DemoBob in the room.")
