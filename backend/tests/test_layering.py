"""Static-analysis checks for Requirement 20's layering and secret-safety rules.

These are plain `ast` import/call scans over source files, not runtime
behavior tests — they catch a structural violation (a forbidden import, an
unsafe logging call) that a unit test exercising one code path could miss.
"""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
ROUTES_DIR = BACKEND_ROOT / "app" / "api" / "routes"
AGENTS_DIR = BACKEND_ROOT / "app" / "agents"

#: Requirement 20.5: these must never reach a log call's arguments as a raw
#: variable formed from an exception's own text.
_FORBIDDEN_LOG_PATTERNS = ("str(exc)", "str(e)", "exc.args", "traceback.format_exc")


def _imported_modules(path: Path) -> set[str]:
    """Return every module name imported by the file at ``path``."""
    tree = ast.parse(path.read_text(), filename=str(path))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def _python_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return [p for p in directory.rglob("*.py") if "__pycache__" not in p.parts]


# ===========================================================================
# Requirement 20.1-20.2: layering
# ===========================================================================


def test_no_route_module_imports_app_agents() -> None:
    """Requirement 20.2: the Route_Layer never imports anything under app.agents."""
    offenders = [
        str(path.relative_to(BACKEND_ROOT))
        for path in _python_files(ROUTES_DIR)
        if any(
            mod == "app.agents" or mod.startswith("app.agents.") for mod in _imported_modules(path)
        )
    ]
    assert offenders == [], f"routes importing app.agents: {offenders}"


def test_no_agents_module_imports_the_supabase_client_factory() -> None:
    """Requirement 20.1: app.agents never constructs a Supabase client itself.

    ``app.db.supabase_client`` is the one factory; a module under
    ``app/agents/`` importing it directly would mean that module is building
    its own client instead of receiving a Repository_Layer instance.
    """
    offenders = [
        str(path.relative_to(BACKEND_ROOT))
        for path in _python_files(AGENTS_DIR)
        if "app.db.supabase_client" in _imported_modules(path)
    ]
    assert offenders == [], f"app.agents modules importing the Supabase client factory: {offenders}"


def test_no_agents_module_imports_the_supabase_package_directly() -> None:
    """A finer-grained check: no `import supabase` / `from supabase import ...` either."""
    offenders = [
        str(path.relative_to(BACKEND_ROOT))
        for path in _python_files(AGENTS_DIR)
        if any(mod == "supabase" or mod.startswith("supabase.") for mod in _imported_modules(path))
    ]
    assert offenders == [], f"app.agents modules importing supabase directly: {offenders}"


# ===========================================================================
# Requirement 20.5-20.6: logging redaction discipline
# ===========================================================================


def test_no_agents_log_call_formats_a_raw_exception_message() -> None:
    """Requirement 20.5-20.6: a log call must never embed `str(exc)` or similar.

    Every existing log call in app/agents (and app/services, which the agent
    layer's own run/escalation paths log through) already logs
    `type(exc).__name__` rather than the exception's own text — this test
    makes that a checked invariant rather than a convention someone could
    quietly break in a later change.
    """
    offenders: list[str] = []
    for directory in (AGENTS_DIR, BACKEND_ROOT / "app" / "services"):
        for path in _python_files(directory):
            for lineno, line in enumerate(path.read_text().splitlines(), start=1):
                if "logger." not in line:
                    continue
                for pattern in _FORBIDDEN_LOG_PATTERNS:
                    if pattern in line:
                        offenders.append(
                            f"{path.relative_to(BACKEND_ROOT)}:{lineno}: contains {pattern!r}"
                        )
    assert offenders == [], f"unsafe log formatting found: {offenders}"
