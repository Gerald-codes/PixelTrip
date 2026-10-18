"""NPC message content models and the emit helpers.

Every message the agent writes goes through :func:`emit_npc_message`, which is
the single place three invariants are enforced:

* ``sender_type='ai'`` with ``sender_member_id=None``, satisfying the ``messages``
  CHECK constraint regardless of what identity the triggering request carried
  (Requirement 15.1, 22.5).
* The room is resolved from the run's ``trip_id``, because ``messages`` is keyed
  by ``room_id`` while agent runs are keyed by ``trip_id``
  (Requirement 15.1, 15.9).
* Serialized content stays within 16 KiB (Requirement 15.3).

**On ``content.progress``.** The ``message_kind`` enum has no ``progress`` value
and ``agent_runs`` is not realtime-published, so "the NPC is thinking" has to
ride on a ``text`` message distinguished by a field inside ``content``. That
field is not yet in ``api-contracts.md`` — it is exactly Backend Change Request
Entry 2, already filed. This implements the proposed shape rather than inventing
a new gap.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.agents.errors import MessageContentTooLargeError, RoomResolutionError
from app.exceptions import RepositoryError
from app.repositories.message_repository import MAX_MESSAGES_PER_TURN

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

logger = logging.getLogger(__name__)

#: Requirement 15.3. Matches the limit the ``insert_message_turn`` RPC enforces,
#: so a payload rejected here would also have been rejected by the database.
MAX_CONTENT_BYTES = 16_384

#: Requirement 15.5 / 14.4 bounds on quick-reply options.
MIN_TEXT_OPTIONS = 2
MAX_TEXT_OPTIONS = 6
MAX_ESCALATION_OPTIONS = 4
MAX_OPTION_LABEL_LENGTH = 80

#: The six in-world stages carried on ``content.stage`` (Requirement 15.6).
STAGE_IDENTIFIERS: frozenset[str] = frozenset(
    {"SETUP", "DISCOVER", "LOGISTICS", "BUILD", "REFINE", "WRAP"}
)

#: Default progress copy. Short and in-character; the party sees this while a
#: long generation runs.
PROGRESS_TEXT = "The guide studies the map, considering your party's wishes..."


class _ContentModel(BaseModel):
    """Base for message content: unknown fields are an error."""

    model_config = ConfigDict(extra="forbid")

    def serialized_size(self) -> int:
        """Return the byte length of this content as JSON."""
        return len(self.model_dump_json().encode("utf-8"))


class QuickReplyOption(_ContentModel):
    """One tappable quick-reply choice."""

    id: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=MAX_OPTION_LABEL_LENGTH)


class TextMessageContent(_ContentModel):
    """NPC dialogue, optionally with quick replies.

    ``progress`` marks a transient "thinking" message. See the module docstring
    for why it lives in ``content`` rather than ``kind``.
    """

    text: str = Field(min_length=1)
    stage: str | None = None
    options: list[QuickReplyOption] | None = None
    #: ``True`` marks this a progress message (Backend Change Request Entry 2).
    progress: bool | None = None
    #: The run this progress message belongs to, so "at most one per run" is
    #: checkable without a ``run_id`` column on ``messages``.
    run_id: str | None = None

    @model_validator(mode="after")
    def _validate_content(self) -> TextMessageContent:
        """Enforce the stage vocabulary, the one-question rule, and option bounds."""
        if self.stage is not None and self.stage not in STAGE_IDENTIFIERS:
            raise ValueError(
                f"stage must be one of {sorted(STAGE_IDENTIFIERS)}, got {self.stage!r}"
            )

        question_marks = self.text.count("?")
        if question_marks > 1:
            raise ValueError(
                "a text message must contain at most one question, "
                f"found {question_marks} question marks"
            )

        if self.options is not None:
            if not MIN_TEXT_OPTIONS <= len(self.options) <= MAX_TEXT_OPTIONS:
                raise ValueError(
                    f"options must carry {MIN_TEXT_OPTIONS} to {MAX_TEXT_OPTIONS} "
                    f"entries, got {len(self.options)}"
                )
            ids = [option.id for option in self.options]
            if len(set(ids)) != len(ids):
                raise ValueError("option ids must be unique within a message")

        if self.progress:
            # A progress message is transient status, not a prompt: offering
            # choices or asking a question would invite a reply to something the
            # party cannot act on (Requirement 16.3).
            if self.options is not None:
                raise ValueError("a progress message must not offer options")
            if "?" in self.text:
                raise ValueError("a progress message must not ask a question")

        return self


class RecommendationMessageContent(_ContentModel):
    """A comparable option set (destinations or flights)."""

    title: str = Field(min_length=1)
    category: Literal["destination", "flight"]
    items: list[dict[str, Any]]
    prompt: str | None = None
    stage: str | None = None


class VoteMessageContent(_ContentModel):
    """A vote session rendered for the party."""

    vote_session_id: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=200)
    options: list[dict[str, Any]]
    status: Literal["open", "closed"] = "open"
    stage: str | None = None


class SummaryMessageContent(_ContentModel):
    """A resolved decision or a plan summary."""

    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    stage: str | None = None
    #: Set when the summary presents a persisted itinerary version.
    itinerary_version_id: str | None = None
    #: Populated when the summary explains a tie resolution or a conflict.
    details: dict[str, Any] | None = None
    #: Tiebreak advice for the room owner (set only on a tiebreak run's message).
    category: Literal["destination_tiebreak", "flight_tiebreak"] | None = None
    #: The tied options the owner chooses between.
    options: list[QuickReplyOption] | None = None
    #: The guide's full advice to the owner.
    advice: str | None = Field(default=None, max_length=2000)
    #: Per-option comparison: ``{id, label, analysis, details}``.
    items: list[dict[str, Any]] | None = None
    #: The tied vote session, for ``POST /votes/{id}/break-tie``.
    vote_session_id: str | None = None
    #: The option the guide leans towards (advice only; the owner decides).
    recommended_option_id: str | None = None


#: ``messages.kind`` -> the content model for that kind (Requirement 15.2).
CONTENT_MODEL_BY_KIND: dict[str, type[_ContentModel]] = {
    "text": TextMessageContent,
    "recommendation": RecommendationMessageContent,
    "vote": VoteMessageContent,
    "summary": SummaryMessageContent,
}


def build_message_row(kind: str, content: _ContentModel) -> dict[str, Any]:
    """Build one ``messages`` row payload for an agent turn.

    Always ``sender_type='ai'`` and ``sender_member_id=None``, independent of any
    identity in the triggering request (Requirement 22.5).
    """
    return {
        "sender_type": "ai",
        "sender_member_id": None,
        "kind": kind,
        "content": content.model_dump(mode="json", exclude_none=True),
    }


def validate_content(kind: str, content: Any) -> _ContentModel:
    """Validate ``content`` against the model registered for ``kind``.

    Raises:
        ValueError: If ``kind`` is not a known ``message_kind``.
        MessageContentTooLargeError: If the serialized content exceeds
            :data:`MAX_CONTENT_BYTES`.
        pydantic.ValidationError: If the content does not match its shape.
    """
    model_cls = CONTENT_MODEL_BY_KIND.get(kind)
    if model_cls is None:
        raise ValueError(
            f"{kind!r} is not a valid message kind; expected one of {sorted(CONTENT_MODEL_BY_KIND)}"
        )

    validated = content if isinstance(content, model_cls) else model_cls.model_validate(content)

    size = validated.serialized_size()
    if size > MAX_CONTENT_BYTES:
        raise MessageContentTooLargeError(size, MAX_CONTENT_BYTES)

    return validated


async def resolve_room_id(repos: RepositoryBundle, trip_id: str) -> str:
    """Resolve the room owning ``trip_id``.

    Raises:
        RoomResolutionError: If no room resolves. The repository returns ``None``
            rather than raising, so the decision to treat it as a failure is made
            here, in the agent layer (Requirement 15.9).
    """
    room_id = await repos.trip_repo.get_room_id_for_trip(trip_id)
    if room_id is None:
        raise RoomResolutionError(trip_id)
    return room_id


async def emit_npc_message(
    repos: RepositoryBundle,
    trip_id: str,
    kind: str,
    content: Any,
) -> dict[str, Any]:
    """Emit one NPC message for ``trip_id``.

    Args:
        repos: The repository bundle.
        trip_id: The run's trip.
        kind: A ``message_kind`` value.
        content: Content matching that kind's model.

    Returns:
        The inserted ``messages`` row.

    Raises:
        RoomResolutionError: If the trip's room cannot be resolved.
        MessageContentTooLargeError: If the content exceeds the size limit.
        RepositoryError: If the write fails.
    """
    validated = validate_content(kind, content)
    room_id = await resolve_room_id(repos, trip_id)

    rows = await repos.message_repo.insert_turn(room_id, [build_message_row(kind, validated)])
    return rows[0] if rows else {}


async def emit_npc_turn(
    repos: RepositoryBundle,
    trip_id: str,
    messages: list[tuple[str, Any]],
) -> list[dict[str, Any]]:
    """Emit several messages as one atomic turn.

    Every message is validated *before* the write is attempted, so an invalid
    third message cannot leave the first two committed. The repository's single
    RPC call then makes the insert itself all-or-nothing (Requirement 15.11).

    Args:
        repos: The repository bundle.
        trip_id: The run's trip.
        messages: ``(kind, content)`` pairs in presentation order.

    Returns:
        The inserted rows, oldest first.

    Raises:
        ValueError: If ``messages`` is empty or exceeds the per-turn limit.
        RoomResolutionError: If the trip's room cannot be resolved.
        MessageContentTooLargeError: If any content exceeds the size limit.
        RepositoryError: If the write fails. No partial turn is left behind.
    """
    # Checked here as well as in the repository so an over-long turn costs no
    # round trip at all, not even the room lookup below.
    if not 1 <= len(messages) <= MAX_MESSAGES_PER_TURN:
        raise ValueError(
            f"An agent turn must carry 1 to {MAX_MESSAGES_PER_TURN} messages, got {len(messages)}."
        )

    rows = [build_message_row(kind, validate_content(kind, content)) for kind, content in messages]
    room_id = await resolve_room_id(repos, trip_id)

    return await repos.message_repo.insert_turn(room_id, rows)


async def emit_progress_message(
    repos: RepositoryBundle,
    trip_id: str,
    run_id: str,
    stage: str | None = None,
) -> dict[str, Any] | None:
    """Emit the run's single progress message, best-effort.

    Two behaviours matter here, both deliberate:

    * **At most one per run** (Requirement 16.9). Checked against already-written
      messages rather than in-memory state, so a resumed run does not emit a
      second one and flood the transcript.
    * **Never fails the run** (Requirement 16.4). Progress is a courtesy; a
      failed write is swallowed and not retried, because the plan's correctness
      does not depend on it.

    Returns:
        The inserted row, or ``None`` when skipped or the write failed.
    """
    try:
        room_id = await resolve_room_id(repos, trip_id)
        already_emitted = await repos.message_repo.count_progress_messages(room_id, run_id)
        if already_emitted:
            return None

        content = TextMessageContent(
            text=PROGRESS_TEXT,
            stage=stage,
            progress=True,
            run_id=run_id,
        )
        rows = await repos.message_repo.insert_turn(room_id, [build_message_row("text", content)])
        return rows[0] if rows else None
    except (RepositoryError, RoomResolutionError) as exc:
        # Best-effort by design: log and carry on with the run.
        logger.info("Progress message skipped for run %s: %s", run_id, type(exc).__name__)
        return None
