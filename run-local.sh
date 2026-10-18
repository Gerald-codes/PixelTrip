#!/usr/bin/env bash
# PixelTrip Booth — local runner.
#
#   ./run-local.sh              start backend (:8000) + frontend (:3000), mock services
#   ./run-local.sh --real       same, but the frontend talks to the real backend
#   ./run-local.sh --backend    backend only
#   ./run-local.sh --frontend   frontend only
#   ./run-local.sh --check      run all automated checks (pytest, tsc, vitest, ruff) and exit
#   ./run-local.sh --help
#
# Ctrl+C stops everything this script started. Logs go to ./.local-logs/.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="$ROOT/.local-logs"
BACKEND_PORT=8000
FRONTEND_PORT=3000

MODE="mock"
RUN_BACKEND=1
RUN_FRONTEND=1
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --real)     MODE="real" ;;
    --mock)     MODE="mock" ;;
    --backend)  RUN_FRONTEND=0 ;;
    --frontend) RUN_BACKEND=0 ;;
    --check)    CHECK_ONLY=1 ;;
    -h|--help)  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=; G=; Y=; R=; N=; fi
info() { echo "${B}==>${N} $*"; }
ok()   { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die()  { echo "${R}✗ $*${N}" >&2; exit 1; }

PIDS=()
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  trap - INT TERM EXIT
  if [ ${#PIDS[@]} -gt 0 ]; then
    echo; info "Stopping services..."
    for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
  fi
}
trap cleanup INT TERM EXIT

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for_url() { # url, seconds
  local i=0
  while [ "$i" -lt "$2" ]; do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# --- prerequisites ---------------------------------------------------------

pick_python() {
  local c
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
      echo "$c"; return 0
    fi
  done
  return 1
}

setup_backend() {
  info "Backend setup"
  if [ ! -x "$BACKEND/.venv/bin/python" ]; then
    local py; py="$(pick_python)" || die "Python 3.11+ not found. Install it (e.g. brew install python@3.13)."
    info "Creating backend/.venv with $py"
    "$py" -m venv "$BACKEND/.venv" || die "Could not create the virtualenv."
  fi
  if ! "$BACKEND/.venv/bin/python" -c 'import fastapi, uvicorn, langgraph, supabase' 2>/dev/null; then
    info "Installing backend dependencies (first run takes a minute)"
    (cd "$BACKEND" && .venv/bin/pip install -q -e ".[dev]") || die "pip install failed."
  fi
  if [ ! -f "$BACKEND/.env" ]; then
    cp "$BACKEND/.env.example" "$BACKEND/.env"
    warn "Created backend/.env from the example. Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  fi
  ok "Backend ready"
}

setup_frontend() {
  info "Frontend setup"
  command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 18.18+ (e.g. brew install node)."
  if [ ! -d "$FRONTEND/node_modules" ]; then
    info "Installing frontend dependencies (first run takes a minute)"
    (cd "$FRONTEND" && npm ci --no-audit --no-fund >/dev/null) || die "npm ci failed."
  fi
  if [ ! -f "$FRONTEND/.env.local" ]; then
    cp "$FRONTEND/.env.example" "$FRONTEND/.env.local"
    warn "Created frontend/.env.local from the example. Fill in the Supabase URL and anon key for --real."
  fi
  ok "Frontend ready"
}

env_value() { # file, KEY -> value (last assignment wins, quotes stripped)
  grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

is_placeholder() { case "$1" in ""|*YOUR_*) return 0 ;; *) return 1 ;; esac; }

# --- --check ---------------------------------------------------------------

if [ "$CHECK_ONLY" -eq 1 ]; then
  FAIL=0
  setup_backend; setup_frontend
  run() { # label, dir, cmd...
    local label=$1 dir=$2; shift 2
    info "$label"
    if (cd "$dir" && "$@"); then ok "$label"; else echo "${R}✗ $label failed${N}"; FAIL=1; fi
  }
  run "Backend tests (pytest)"   "$BACKEND"  .venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider
  run "Backend lint (ruff)"      "$BACKEND"  .venv/bin/ruff check .
  run "Frontend typecheck (tsc)" "$FRONTEND" npm run -s typecheck
  run "Frontend tests (vitest)"  "$FRONTEND" npm run -s test
  echo
  if [ "$FAIL" -eq 0 ]; then ok "All checks passed"; else die "Some checks failed"; fi
  exit 0
fi

# --- run -------------------------------------------------------------------

mkdir -p "$LOGS"

if [ "$RUN_BACKEND" -eq 1 ]; then
  setup_backend
  port_in_use "$BACKEND_PORT" && die "Port $BACKEND_PORT is already in use. Stop whatever is using it (lsof -i :$BACKEND_PORT)."
fi
if [ "$RUN_FRONTEND" -eq 1 ]; then
  setup_frontend
  port_in_use "$FRONTEND_PORT" && die "Port $FRONTEND_PORT is already in use. Stop whatever is using it (lsof -i :$FRONTEND_PORT)."
fi

SUPABASE_READY=1
if [ "$RUN_BACKEND" -eq 1 ]; then
  if is_placeholder "$(env_value "$BACKEND/.env" SUPABASE_URL)" || is_placeholder "$(env_value "$BACKEND/.env" SUPABASE_SERVICE_ROLE_KEY)"; then
    SUPABASE_READY=0
    warn "backend/.env still has placeholder Supabase values."
    warn "The backend will start, but POST /rooms and /rooms/{code}/join will return 503 DATABASE_ERROR."
  fi
fi
if [ "$RUN_FRONTEND" -eq 1 ] && [ "$MODE" = "real" ]; then
  if is_placeholder "$(env_value "$FRONTEND/.env.local" NEXT_PUBLIC_SUPABASE_URL)" || is_placeholder "$(env_value "$FRONTEND/.env.local" NEXT_PUBLIC_SUPABASE_ANON_KEY)"; then
    warn "frontend/.env.local has placeholder Supabase values: --real room reads will fail."
  fi
fi

if [ "$RUN_BACKEND" -eq 1 ]; then
  info "Starting backend on :$BACKEND_PORT"
  # ENABLE_DEV_ENDPOINTS mounts the testing-only /dev routes the test console uses.
  (cd "$BACKEND" && ENABLE_DEV_ENDPOINTS=true exec .venv/bin/python -m uvicorn app.main:app --reload --port "$BACKEND_PORT") >"$LOGS/backend.log" 2>&1 &
  PIDS+=($!)
  if wait_for_url "http://localhost:$BACKEND_PORT/health" 30; then
    ok "Backend up"
  else
    echo "--- last backend log lines ---"; tail -n 20 "$LOGS/backend.log"
    die "Backend did not become healthy. Full log: .local-logs/backend.log"
  fi
fi

if [ "$RUN_FRONTEND" -eq 1 ]; then
  info "Starting frontend on :$FRONTEND_PORT (service mode: $MODE)"
  # NEXT_PUBLIC_ENABLE_DEV_CONSOLE reveals the /dev/run test console (a 404 without it).
  (cd "$FRONTEND" && NEXT_PUBLIC_SERVICE_MODE="$MODE" NEXT_PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT" NEXT_PUBLIC_ENABLE_DEV_CONSOLE=true exec node_modules/.bin/next dev -p "$FRONTEND_PORT") >"$LOGS/frontend.log" 2>&1 &
  PIDS+=($!)
  if wait_for_url "http://localhost:$FRONTEND_PORT" 60; then
    ok "Frontend up"
  else
    echo "--- last frontend log lines ---"; tail -n 20 "$LOGS/frontend.log"
    die "Frontend did not start. Full log: .local-logs/frontend.log"
  fi
fi

echo
echo "${B}PixelTrip Booth is running${N}"
[ "$RUN_FRONTEND" -eq 1 ] && echo "  Frontend     http://localhost:$FRONTEND_PORT"
[ "$RUN_FRONTEND" -eq 1 ] && [ "$RUN_BACKEND" -eq 1 ] && echo "  AI test console  http://localhost:$FRONTEND_PORT/dev/run   <- create a room and run the AI agents"
if [ "$RUN_BACKEND" -eq 1 ]; then
  echo "  Backend      http://localhost:$BACKEND_PORT/health"
  echo "  API docs     http://localhost:$BACKEND_PORT/docs   <- try POST /rooms and /rooms/{room_code}/join here"
fi
echo "  Logs         tail -f .local-logs/backend.log .local-logs/frontend.log"
echo
[ "$SUPABASE_READY" -eq 0 ] && echo "${Y}Room endpoints need real Supabase credentials in backend/.env (and the migrations in supabase/migrations applied).${N}"
echo "Press Ctrl+C to stop."

# Exit (and clean up) as soon as any child dies; bash 3.2 (macOS) has no `wait -n`.
while :; do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || { warn "A service stopped unexpectedly. Check .local-logs/."; exit 1; }
  done
  sleep 2
done
