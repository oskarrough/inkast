# inkast
A list anyone can add to and only you can read, set up in thirty seconds.

Every project wants a way for people to send feedback, and every project ends up building a little server for it. Storing a string is trivial; not having to run the trivial thing is the point. inkast is ingest only. What happens to the strings is your business: read them, or point an agent at the list every hour.

```sh
curl -X POST https://inkast.0sk.ar                                     # make a list
curl -d "the save button does nothing" https://inkast.0sk.ar/x7k2q9mf  # anyone adds to it
curl -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf # only you read it
```

## Make a list

```sh
curl -X POST https://inkast.0sk.ar
```

```json
{
  "id": "x7k2q9mf",
  "write": "https://inkast.0sk.ar/x7k2q9mf",
  "read": "https://inkast.0sk.ar/x7k2q9mf#k_8f3a…",
  "key": "k_8f3a…"
}
```

The key is shown once. Whoever holds it owns the list.

## Add to it

Anyone, from anywhere, no account and no SDK:

```js
fetch("https://inkast.0sk.ar/x7k2q9mf", {
  method: "POST",
  body: `${location.href}\n${message}`,
})
```

A string is plain text, up to 4 KB. Nothing is stored but the string and the time it arrived, so put any context you want into the string itself, like the page it came from.

## Read it

Open the `read` link in a browser to see the list and delete from it. Or ask for JSON:

```sh
curl -H "Authorization: Bearer k_8f3a…" "https://inkast.0sk.ar/x7k2q9mf?since=41"
```

```json
[{ "id": 42, "time": 1792764855, "text": "the save button does nothing" }]
```

Reading never removes anything. Ids count up per list, so a reader keeps its place with `?since=<last id>`. An agent checking in every hour needs only this:

```sh
SINCE=$(cat .inkast-since 2>/dev/null || echo 0)
NEW=$(curl -s -H "Authorization: Bearer $INKAST_KEY" "https://inkast.0sk.ar/x7k2q9mf?since=$SINCE")
echo "$NEW" | jq -r '.[].text'
echo "$NEW" | jq -r ".[-1].id // $SINCE" > .inkast-since
```

## Delete

```sh
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf/42    # one string
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf/all   # all strings
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf       # the list
```

## With HTTPie

```sh
http POST inkast.0sk.ar                                       # make a list
http POST inkast.0sk.ar/x7k2q9mf --raw "the save button does nothing"
http -A bearer -a k_8f3a… inkast.0sk.ar/x7k2q9mf since==41     # read
http -A bearer -a k_8f3a… DELETE inkast.0sk.ar/x7k2q9mf/42      # delete one
```

Send with `--raw` or pipe the text in. `text=hi` would send JSON, and `{"text": "hi"}` would become the string.

A session keeps the key for you:

```sh
http --session=inkast -A bearer -a k_8f3a… inkast.0sk.ar/x7k2q9mf   # once
http --session=inkast inkast.0sk.ar/x7k2q9mf                        # after that
```

## Not yet

Spam protection beyond rate limits, names instead of ids, email in, retention, recovering a lost key.

## Details

- The body is stored as-is, whatever the content type says, so `curl -d` works. An empty string gets a 400, anything over 4 KB a 413, never cut short.
- Only lists made with `POST /` exist. Any other id gets a 404, and writing to it doesn't create one.
- The key sits after the `#` in the read link, so it never reaches a server log. A browser opening the link therefore asks without a key, and the Accept header decides: a request for HTML gets a small page, which reads the key from the `#` and fetches the list with it. Any other request without the right key gets a 401.
- Deleting all strings keeps the list and its key working, and ids keep counting up, so `?since=` never skips or repeats.
- Deleting the list removes its strings and its key for good. Its id is never handed out again, since the write URL may still be pasted somewhere, and every request to it gets a 410.
- Each IP can make 5 lists and send 30 strings a minute. Past that it gets a 429. Calls that need the key aren't limited.
- Any website can send and read, CORS allows every origin.

## Develop

```sh
pnpm install
pnpm dev                                # runs locally on http://localhost:1337
test/smoke.sh http://localhost:1337     # the API, end to end
test/ratelimit.sh http://localhost:1337 # the 429s, run it apart from smoke.sh
pnpm alchemy deploy --stage prod
```
