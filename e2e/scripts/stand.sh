#!/usr/bin/env bash
# Local e2e stand (spec BEVN-205 4.3): the backend stand on 127.0.0.1:5000 and the production frontend image on
# 127.0.0.1:5173 — the ports the frontend and CORS expect (FE-1). Compose holds both ports: stop it first.
set -euo pipefail
export MSYS_NO_PATHCONV=1
WEB=bevn205-stand-web
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
FRONTEND=$(cd "$ROOT/frontend" && (pwd -W 2>/dev/null || pwd)) # Windows path for docker under Git Bash
BACKEND_STAND="$ROOT/backend/scripts/stand.sh"
case "$(uname -s)" in MINGW* | MSYS*) NULL_OUT=NUL ;; *) NULL_OUT=/dev/null ;; esac

case "${1:-}" in
  build)
    bash "$BACKEND_STAND" build
    docker build -t brownevents-frontend:stand "$FRONTEND"
    ;;
  up)
    bash "$0" down
    STAND_PORT=5000 bash "$BACKEND_STAND" up
    # nginx.conf proxies /api/ to the host "backend", which this network has not got; the app never uses that proxy (FE-1).
    docker run -d --name $WEB -p 127.0.0.1:5173:80 --add-host backend:host-gateway brownevents-frontend:stand >/dev/null
    for _ in $(seq 1 60); do
      if [ "$(curl -s -m 2 -o "$NULL_OUT" -w '%{http_code}' http://127.0.0.1:5173/ || true)" = 200 ]; then
        echo "frontend up on http://localhost:5173 (container started $(docker inspect -f '{{.State.StartedAt}}' $WEB))"
        exit 0
      fi
      sleep 1
    done
    echo "frontend did not answer in 60 s; see: $0 logs" >&2
    exit 1
    ;;
  down)
    docker rm -f $WEB >/dev/null 2>&1 || true
    bash "$BACKEND_STAND" down
    ;;
  logs)
    bash "$BACKEND_STAND" logs
    docker logs $WEB
    ;;
  *)
    echo "usage: $0 build|up|down|logs" >&2
    exit 2
    ;;
esac
