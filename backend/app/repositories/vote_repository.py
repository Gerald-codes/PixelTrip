"""Per-member vote data access.

``votes`` carries ``UNIQUE(vote_session_id, member_id)``, so re-voting replaces a
member's prior choice rather than adding a second row. :meth:`VoteRepository.upsert`
relies on that constraint directly instead of a read-then-write, which would race.
"""

from __future__ import annotations

from typing import Any

from app.repositories.base import BaseRepository

_TABLE = "votes"


class VoteRepository(BaseRepository):
    """Casts votes and tallies them for a session."""

    async def upsert(
        self,
        vote_session_id: str,
        member_id: str,
        option_id: str,
    ) -> dict[str, Any]:
        """Record a member's choice, replacing any prior vote in this session.

        Uses the ``UNIQUE(vote_session_id, member_id)`` constraint as the conflict
        target, so one member always holds exactly one vote per session.
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .upsert(
                    {
                        "vote_session_id": vote_session_id,
                        "member_id": member_id,
                        "option_id": option_id,
                    },
                    on_conflict="vote_session_id,member_id",
                )
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="upsert", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("upsert returned no row"), operation="upsert", table=_TABLE
            )
        return row

    async def list_by_session(self, vote_session_id: str) -> list[dict[str, Any]]:
        """Return every vote row for ``vote_session_id``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("vote_session_id", vote_session_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_by_session", table=_TABLE)
        return self._rows(response)

    async def count_by_option(
        self,
        vote_session_id: str,
        eligible_member_ids: list[str] | None = None,
    ) -> dict[str, int]:
        """Tally votes per option id.

        Args:
            vote_session_id: The session to tally.
            eligible_member_ids: When given, only votes from these members count.
                Requirement 17.6 restricts the tally to members still present in
                the room, so a departed member's vote cannot decide an outcome.

        Returns:
            ``{option_id: count}``, containing only options that received a vote.
        """
        votes = await self.list_by_session(vote_session_id)
        if eligible_member_ids is not None:
            eligible = set(eligible_member_ids)
            votes = [v for v in votes if v.get("member_id") in eligible]

        tally: dict[str, int] = {}
        for vote in votes:
            option_id = vote.get("option_id")
            if option_id is not None:
                tally[option_id] = tally.get(option_id, 0) + 1
        return tally

    async def count_distinct_voters(
        self,
        vote_session_id: str,
        eligible_member_ids: list[str] | None = None,
    ) -> int:
        """Count distinct members who have voted in this session.

        Compared against the room's member count to decide whether everyone has
        voted (Requirement 17.11). ``UNIQUE(vote_session_id, member_id)`` makes
        this exact.
        """
        votes = await self.list_by_session(vote_session_id)
        member_ids = {v.get("member_id") for v in votes if v.get("member_id")}
        if eligible_member_ids is not None:
            member_ids &= set(eligible_member_ids)
        return len(member_ids)
