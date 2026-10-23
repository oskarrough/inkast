#!/usr/bin/env bash
# Check that the open calls get a 429 once one IP goes over its budget.
# Uses up this IP's budget for a minute, so run it apart from smoke.sh.
#   test/ratelimit.sh http://localhost:1337
B=${1:-http://localhost:1337}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
ID=$(curl -s -X POST "$B" | jq -r .id)
for i in $(seq 1 40); do c=$(code -d "flood $i" $B/$ID); [ "$c" = 429 ] && break; done
[ "$c" = 429 ] && echo "PASS writes limited after $i" || { echo "FAIL writes never limited"; FAILED=1; }
for i in $(seq 1 10); do c=$(code -X POST $B); [ "$c" = 429 ] && break; done
[ "$c" = 429 ] && echo "PASS creates limited after $i more" || { echo "FAIL creates never limited"; FAILED=1; }
[ -z "$FAILED" ]
