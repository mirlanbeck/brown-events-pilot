#!/usr/bin/env bash
# One-off Postgres for integration tests (CLAUDE.md): own network, no volume, 127.0.0.1 only.
set -euo pipefail
export MSYS_NO_PATHCONV=1
NET=ext150-test-net
PG=ext150-test-pg
PORT=${TEST_DB_PORT:-15432}

case "${1:-}" in
  up)
    docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
    docker rm -f -v "$PG" >/dev/null 2>&1 || true
    docker run -d --name "$PG" --network "$NET" -p "127.0.0.1:$PORT:5432" \
      -e POSTGRES_DB=brownevents_test -e POSTGRES_USER=brown -e POSTGRES_PASSWORD=brown123 postgres:14 >/dev/null
    # -h 127.0.0.1: the temporary server started by initdb listens on the socket only, so TCP readiness means the real one.
    for _ in $(seq 1 60); do
      if docker exec "$PG" pg_isready -h 127.0.0.1 -U brown -d brownevents_test >/dev/null 2>&1; then
        echo "test db ready on 127.0.0.1:$PORT"
        exit 0
      fi
      sleep 1
    done
    echo "test db did not become ready in 60 s" >&2
    exit 1
    ;;
  down)
    docker rm -f -v "$PG" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    ;;
  psql)
    shift
    docker exec -i "$PG" psql -U brown -d brownevents_test "$@"
    ;;
  *)
    echo "usage: $0 up|down|psql [psql args]" >&2
    exit 2
    ;;
esac
