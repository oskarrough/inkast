import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import Worker from "./src/worker.ts";

export default Alchemy.Stack(
  "inkast",
  {
    providers: Cloudflare.providers(),
    state: Effect.runSync(Alchemy.ALCHEMY_DEV) ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Worker;

    return {
      url: worker.url,
    };
  }),
);
