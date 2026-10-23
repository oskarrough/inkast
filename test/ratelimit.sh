#!/usr/bin/env bash
# Check that the open calls get a 429 once one IP goes over its budget.
# Uses up this IP's budget for a minute, so run it apart from smoke.sh.
#   test/ratelimit.sh http://localhost:1337
B=${1:-http://localhost:1337}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
MADE=()
# Keeps every list it makes, so they can be deleted at the end.
make() { curl -s -X POST "$B" > /tmp/ratelimit-last.json; jq -e .key /tmp/ratelimit-last.json >/dev/null 2>&1 && MADE+=("$(cat /tmp/ratelimit-last.json)"); }
make; ID=$(jq -r .id /tmp/ratelimit-last.json)
for i in $(seq 1 40); do c=$(code -d "flood $i" $B/$ID); [ "$c" = 429 ] && break; done
[ "$c" = 429 ] && echo "PASS writes limited after $i" || { echo "FAIL writes never limited"; FAILED=1; }
for i in $(seq 1 10); do make; jq -e .id /tmp/ratelimit-last.json >/dev/null 2>&1 || break; done
grep -q "too many" /tmp/ratelimit-last.json && echo "PASS creates limited after $i more" || { echo "FAIL creates never limited"; FAILED=1; }
for r in "${MADE[@]}"; do
  curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $(echo "$r" | jq -r .key)" "$B/$(echo "$r" | jq -r .id)"
done
echo "deleted ${#MADE[@]} lists"
[ -z "$FAILED" ]
