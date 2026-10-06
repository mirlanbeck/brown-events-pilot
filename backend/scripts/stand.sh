#!/usr/bin/env bash
# Isolated stand of the new backend from its Docker images (CLAUDE.md): own network, throwaway Postgres without a
# volume and without a host port, API on 127.0.0.1:${STAND_PORT:-5098}. STAND_ENV adds API env, e.g. "LOG_SQL=true".
set -euo pipefail
export MSYS_NO_PATHCONV=1
NET=ext150-stand-net
PG=ext150-stand-pg
API=ext150-stand-api
PORT=${STAND_PORT:-5098}
DB_URL=postgresql://brown:brown123@$PG:5432/brownevents
HERE=$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd)) # Windows path for docker under Git Bash
case "$(uname -s)" in MINGW* | MSYS*) NULL_OUT=NUL ;; *) NULL_OUT=/dev/null ;; esac

wait_healthy() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -m 2 -o "$NULL_OUT" -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)" = 200 ]; then
      echo "stand up on http://127.0.0.1:$PORT (container started $(docker inspect -f '{{.State.StartedAt}}' $API))"
      return 0
    fi
    sleep 1
  done
  echo "API did not become healthy in 60 s; see: $0 logs" >&2
  return 1
}

case "${1:-}" in
  build)
    docker build --target migrator -t brownevents-migrator:stand "$HERE"
    docker build --target runtime -t brownevents-api:stand "$HERE"
    ;;
  up)
    "$0" down
    docker network create $NET >/dev/null
    docker run -d --name $PG --network $NET -e POSTGRES_DB=brownevents -e POSTGRES_USER=brown -e POSTGRES_PASSWORD=brown123 postgres:14 -c log_statement=all >/dev/null
    for _ in $(seq 1 60); do docker exec $PG pg_isready -h 127.0.0.1 -U brown -d brownevents >/dev/null 2>&1 && break; sleep 1; done
    docker run --rm --network $NET -e DATABASE_URL=$DB_URL brownevents-migrator:stand
    extra=()
    for kv in ${STAND_ENV:-}; do extra+=(-e "$kv"); done
    docker run -d --name $API --network $NET -p "127.0.0.1:$PORT:80" -e DATABASE_URL=$DB_URL -e CORS_ORIGINS=http://localhost:5173 \
      -e SWAGGER_ENABLED=true "${extra[@]}" brownevents-api:stand >/dev/null
    wait_healthy
    ;;
  restart)
    docker restart -t 2 $API >/dev/null
    wait_healthy
    ;;
  down)
    docker rm -f -v $API $PG >/dev/null 2>&1 || true
    docker network rm $NET >/dev/null 2>&1 || true
    ;;
  logs) docker logs $API ;;
  pglog) docker logs $PG 2>&1 ;;
  psql)
    shift
    docker exec -i $PG psql -U brown -d brownevents "$@"
    ;;
  *)
    echo "usage: $0 build|up|restart|down|logs|pglog|psql" >&2
    exit 2
    ;;
esac
