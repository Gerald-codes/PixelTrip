"""Prompt templates, kept as editable text files next to this module.

Each ``<name>.md`` file is a prompt with ``{slot}`` placeholders filled by
:func:`render`. A leading ``<!-- ... -->`` note is for editors only and is
stripped before the prompt is sent. To show a literal brace in a template,
double it (``{{`` / ``}}``).
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path

_DIR = Path(__file__).parent
_EDITOR_NOTE = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)


@cache
def load(name: str) -> str:
    """The template text for ``name`` (without the editor note)."""
    text = (_DIR / f"{name}.md").read_text(encoding="utf-8")
    return _EDITOR_NOTE.sub("", text).strip()


def render(name: str, **values: object) -> str:
    """Fill a template's ``{slot}`` placeholders."""
    return load(name).format(**values)
