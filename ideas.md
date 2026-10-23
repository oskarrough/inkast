# Ideas

To consider, not planned.

## tail -f
A read that waits for the next string instead of answering right away, say `?since=41&wait=60`. Agents and scripts could follow a list live rather than poll. A Durable Object can hold the request open and answer when `append` runs.

## Self-hosting
A "Run your own" section in the README: clone, `pnpm install`, `pnpm alchemy deploy`, pick your own domain. Free access to a primitive really means anyone can run their own copy, not just use ours.

## Email in
An address per list, like `x7k2q9mf@inkast.0sk.ar`, that turns each email into a string. Cloudflare Email Routing can hand mail to the Worker. Needs a spam story first, since an address gets found faster than a URL.

## Webhooks
The owner sets a URL that gets each new string as it arrives. Pushes instead of pulls, but brings retries, failures and a URL to keep secret. tail -f may cover the same need with less.
