#!/usr/bin/env bash
# Demo data for the BEVN-203 dashboard check on an isolated stand (spec 7.4): the seed has no attendees or registrations.
# Usage (from backend/, after `STAND_PORT=5000 bash scripts/stand.sh up`): bash scripts/bevn203-demo-data.sh [base URL]
# Creates its own conferences through the API, so the seeded ones stay as they are. Needs GNU date (Git Bash has it).
set -euo pipefail
BASE=${1:-http://127.0.0.1:5000}
ANN=ann.demo@example.com
BOB=bob.demo@example.com

day() { date -u -d "$1 days" +%Y-%m-%d; } # day 40 -> 40 days from today, day -30 -> 30 days ago

# call METHOD PATH [JSON]: prints the body; stops the script on a status other than 2xx.
call() {
  local out status
  if [ $# -ge 3 ]; then
    out=$(curl -s -m 10 -X "$1" "$BASE$2" -H 'Content-Type: application/json' --data "$3" -w $'\n%{http_code}')
  else
    out=$(curl -s -m 10 -X "$1" "$BASE$2" -w $'\n%{http_code}')
  fi
  status=${out##*$'\n'}
  echo "$1 $2 -> $status" >&2
  case "$status" in 2??) ;; *) echo "${out%$'\n'*}" >&2; exit 1 ;; esac
  printf '%s' "${out%$'\n'*}"
}
# Every answer used here starts with the id of the record: {"id":12,...}
id_of() { sed -n 's/^{"id":\([0-9]*\).*/\1/p'; }

conference() { call POST /api/conferences "{\"title\":\"$1\",\"startDate\":\"$2T00:00:00\",\"endDate\":\"$3T00:00:00\"}" | id_of; }
put_conference() { # id title start end status(JSON)
  call PUT "/api/conferences/$1" "{\"title\":\"$2\",\"description\":null,\"location\":null,\"venue\":null,\"startDate\":\"$3T00:00:00\",\"endDate\":\"$4T00:00:00\",\"status\":$5,\"maxAttendees\":null,\"organizerName\":null,\"website\":null}" >/dev/null
}
register() { call POST "/api/conferences/$1/register" "{\"firstName\":\"$2\",\"lastName\":\"Demo\",\"email\":\"$3\"}" | id_of; }
session() { call POST "/api/conferences/$1/sessions" "{\"title\":\"$2\",\"startTime\":\"$3T$4:00\",\"endTime\":\"$3T$5:00\",\"capacity\":$6}" | id_of; }
enrol() { call POST "/api/sessions/$1/$2" "{\"email\":\"$3\"}" >/dev/null; }

# Open: Ann holds the only seat of the first talk with Bob waiting, and a seat in the second talk.
d=$(day 40)
open=$(conference 'Dashboard Demo: Open' "$d" "$(day 41)")
one=$(session "$open" 'Demo talk: one seat' "$d" 10:00 11:00 1)
five=$(session "$open" 'Demo talk: five seats' "$d" 12:00 13:00 5)
register "$open" Ann "$ANN" >/dev/null
register "$open" Bob "$BOB" >/dev/null
enrol "$one" register "$ANN"
enrol "$one" waitlist "$BOB"
enrol "$five" register "$ANN"

# Cancelled by the organiser after Ann registered: her registration stays CONFIRMED, the cancel button is disabled.
closed=$(conference 'Dashboard Demo: Cancelled by organiser' "$(day 50)" "$(day 51)")
register "$closed" Ann "$ANN" >/dev/null
put_conference "$closed" 'Dashboard Demo: Cancelled by organiser' "$(day 50)" "$(day 51)" '"CANCELLED"'

# Past: registered while upcoming, then the dates moved 30 days back (COMPLETED).
past=$(conference 'Dashboard Demo: Past' "$(day 45)" "$(day 45)")
register "$past" Ann "$ANN" >/dev/null
put_conference "$past" 'Dashboard Demo: Past' "$(day -30)" "$(day -30)" null

# A registration Ann cancelled herself: read-only on the dashboard.
gone=$(conference 'Dashboard Demo: Cancelled registration' "$(day 60)" "$(day 61)")
reg=$(register "$gone" Ann "$ANN")
call POST "/api/attendees/ann.demo%40example.com/registrations/$reg/cancel" '{}' >/dev/null

echo "conferences: open=$open closed=$closed past=$past cancelled-registration=$gone; sessions of open: one seat=$one, five seats=$five"
