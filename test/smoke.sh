#!/usr/bin/env bash
# Exercise a running inkast with curl. Start `pnpm alchemy dev` first.
#   test/smoke.sh http://localhost:1337
B=${1:-http://localhost:1337}
R=$(curl -s -X POST "$B")
ID=$(echo "$R" | jq -r .id)
KEY=$(echo "$R" | jq -r .key)
A="Authorization: Bearer $KEY"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got $2, want $3)"; FAILED=1; fi; }

check "create list" "$(echo "$R" | jq -r '.write == "'$B/$ID'" and .read == "'$B/$ID#$KEY'" and (.key | startswith("k_"))')" true
check "POST string" "$(code -d 'the jump feels floaty' $B/$ID)" 201
check "POST form-looking body" "$(code -d 'a=b&c=d' $B/$ID)" 201
check "POST empty" "$(code -d '' $B/$ID)" 400
check "POST whitespace" "$(code -d '   ' $B/$ID)" 400
check "POST 5 KB" "$(head -c 5120 /dev/zero | tr '\0' x | code --data-binary @- $B/$ID)" 413
check "POST 64 KB chunked, no length" "$(head -c 65536 /dev/zero | tr '\0' x | code -H 'Transfer-Encoding: chunked' --data-binary @- $B/$ID)" 413
check "POST exactly 4 KB" "$(head -c 4096 /dev/zero | tr '\0' y | code --data-binary @- $B/$ID)" 201

check "GET no key, Accept */*" "$(code -H 'Accept: */*' $B/$ID)" 401
check "GET wrong key" "$(code -H 'Authorization: Bearer k_nope' $B/$ID)" 401
check "GET Accept text/html -> page" "$(curl -s -H 'Accept: text/html,application/xhtml+xml' -o /dev/null -w '%{http_code} %{content_type}' $B/$ID)" "200 text/html; charset=utf-8"
check "page sends a CSP and no-store" "$(curl -s -D - -o /dev/null -H 'Accept: text/html' $B/$ID | grep -ciE '^(content-security-policy|cache-control: no-store)')" 2
check "page reads the key from location.hash" "$(curl -s -H "Accept: text/html" $B/$ID | grep -c location.hash)" 1
check "form body stored raw" "$(curl -s -H "$A" $B/$ID | jq -r '.[1].text')" "a=b&c=d"
check "since=1 returns ids >1" "$(curl -s -H "$A" "$B/$ID?since=1" | jq -c '[.[].id]')" "[2,3]"
check "since=3 returns []" "$(curl -s -H "$A" "$B/$ID?since=3")" "[]"
check "DELETE one no key" "$(code -X DELETE $B/$ID/3)" 401
check "DELETE one" "$(code -X DELETE -H "$A" $B/$ID/3)" 204
check "DELETE same again" "$(code -X DELETE -H "$A" $B/$ID/3)" 404
check "new POST after delete gets id 4" "$(curl -s -d 'after delete' $B/$ID | jq .id)" 4
check "ids now" "$(curl -s -H "$A" $B/$ID | jq -c '[.[].id]')" "[1,2,4]"
check "DELETE all no key" "$(code -X DELETE $B/$ID/all)" 401
check "DELETE all" "$(code -X DELETE -H "$A" $B/$ID/all)" 204
check "list empty after delete all" "$(curl -s -H "$A" $B/$ID)" "[]"
check "POST after delete all gets id 5" "$(curl -s -d 'still works' $B/$ID | jq .id)" 5
check "key still works" "$(curl -s -H "$A" $B/$ID | jq -c '[.[].id]')" "[5]"
check "DELETE list no key" "$(code -X DELETE $B/$ID)" 401
check "DELETE list wrong key" "$(code -X DELETE -H 'Authorization: Bearer k_nope' $B/$ID)" 401
check "list survived wrong key" "$(curl -s -H "$A" $B/$ID | jq -c '[.[].id]')" "[5]"
check "DELETE list" "$(code -X DELETE -H "$A" $B/$ID)" 204
check "deleted: POST" "$(code -d 'too late' $B/$ID)" 410
check "deleted: GET with key" "$(code -H "$A" $B/$ID)" 410
check "deleted: GET no key" "$(code $B/$ID)" 410
check "deleted: GET html" "$(code -H 'Accept: text/html' $B/$ID)" 410
check "deleted: DELETE one" "$(code -X DELETE -H "$A" $B/$ID/5)" 410
check "deleted: DELETE all" "$(code -X DELETE -H "$A" $B/$ID/all)" 410
check "deleted: DELETE list again" "$(code -X DELETE -H "$A" $B/$ID)" 410
U=zzzz9999
check "unknown POST" "$(code -d hello $B/$U)" 404
check "unknown GET html" "$(code -H 'Accept: text/html' $B/$U)" 404
check "unknown GET with key" "$(code -H "$A" $B/$U)" 404
check "unknown GET no key" "$(code $B/$U)" 404
check "unknown DELETE" "$(code -X DELETE -H "$A" $B/$U)" 404
check "unknown DELETE all" "$(code -X DELETE -H "$A" $B/$U/all)" 404
check "unknown POST again (still not a list)" "$(code -d hello $B/$U)" 404
check "malformed id" "$(code -d hello $B/NOT-AN-ID)" 404
check "OPTIONS preflight" "$(code -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' $B/$ID)" 204
check "CORS on POST" "$(curl -s -i -d x $B/$ID | grep -ci '^access-control-allow-origin: \*')" 1
[ -z "$FAILED" ]
