# Keep the cache warm: analysis of cache-warmer and a design for the band

- **Date:** 2026-10-07
- **Status:** draft for review (analysis and proposal; no plan yet)
- **Source:** [cache-warmer](https://github.com/paulbkim-dev/claude-code-cache-warmer) 0.12.0 by
  Paul B. Kim (MIT), itself a port of the cache warmer in [Pi](https://github.com/earendil-works/pi)
  by Mario Zechner. Read at commit `ba86227` ("Default the prompt cache lifetime to 1h").

## 1. What cache-warmer does

Every prompt sends the whole conversation to the API. The API keeps the conversation's prefix in
a **prompt cache** for a lifetime of 5 minutes (the default) or 1 hour (`CLAUDE_CODE_PROMPT_CACHE_TTL`).
A request that reads the cache pays about a tenth of the input price (a fortieth on Fable 5.1) and
starts faster; after the cache expires the next request writes it all again at 1.25× (5m) or 2×
(1h) the input price. During a break the cache dies, and the first prompt after the break pays.

cache-warmer sends one tiny request shortly before the cache would expire. The request is a
**fork** of the main conversation's last request (`$.model.fork`), with one user message
("[cache-warmer] ... Reply with the single word ok."). It re-reads the cached prefix, which resets
the cache's timer, and costs a cache read plus about 200 output tokens. The fork never enters the
conversation; a notice row (`☕ ...`) records it in the transcript only.

### 1.1 Its rules

| Rule | What it is |
|---|---|
| When | at 90% of the lifetime (4m30s or 54m) after the last request or refresh |
| Worth it | Pi's rule: `chance of a prompt before expiry × cost of rewriting the prefix − cost of the refresh ≥ $0.05`. The chance is 100% while a turn runs, 15% while idle. So each model has a break-even prompt size; below it, nothing is sent |
| Idle limit | at most N refreshes per lifetime after the last prompt (0 to 20, default 5); the last one warns that warming stops and when the cache expires |
| Run limit | while a turn runs, warming stops 60 minutes after the last prompt (two lifetimes if longer) |
| Stops | compaction, `/clear`, a model switch, a failed refresh, an expired cache (a refresh that read under half the prefix), a timer that fired past its deadline, no price for the model |
| Lifetime | sets `CLAUDE_CODE_PROMPT_CACHE_TTL` for the process (default 1h); the first response locks it for the session |
| Accounting | per-session and all-time totals: refreshes, cost, wasted cost (chains no prompt followed), kept prompts and what they saved. A prompt is "kept" when it read a cache that would have expired |

### 1.2 Its shape

| Part | Lines | Keeps? |
|---|---|---|
| `hooks/warmer.ts`: prices, Pi's rule, costs, outcomes, formatting. Pure. | 261 | yes, ported |
| `hooks/register.tsx`: the chain (anchor, schedule, fork, settle, extend, stop), the lifetime, config rows, the notice band, the pane, Clawd's animation | 1,152 | the chain, about 400 lines of it |
| `hooks/mascot.ts`, `hooks/pane.tsx`, `hooks/pages.tsx`: Clawd, the pane's three pages, focus rows | 1,001 | no |
| `tests/`: world, warmer, pane, pages, band | 1,192 | the warmer and world parts, adapted |
| `plugin.json` `userConfig`: `ttl`, `idle5m`, `idle1h`, `band` as `/config` rows | | yes |

The engine facts it rests on, all shown by its tests on the same kit ours uses: `$.model.fork`
replays the main thread's last request and answers with `usage` (input, output, cache read, cache
write) or a reason; `turn.step` (a streaming hook) hands each request's `usage` with the model
that answered; `$.env.set` sets the lifetime for the process; `config.set` hooks and
`userConfig` give `/config` rows; `session.compact`, `session.end` (with `reason: 'clear'`) and
`classic.PostModelSwitch` are where a chain is forgotten.

## 2. Why it belongs in this mod

Both mods sell the same thing, cheaper sessions and limits that last longer, from the same spot
above the prompt, and they pull on the same lever from two ends:

- **Auto compact** makes the prefix smaller. A smaller prefix is cheaper to resend, cheaper to
  rewrite, and under the warmer's break-even more often (a compacted chat often needs no warming).
- **The warmer** keeps whatever prefix there is cheap across a break.

And the band already shows what warming costs in the currency a plan user cares about: the
5 Hour and Weekly limits. A refresh counts against them like any request. Today cache-warmer
counts dollars, which an API-key user pays and a plan user never sees. The band can show both,
and can do what neither mod does alone (§4).

Installing both side by side works today and costs nothing: cache-warmer's band appears only
during a refresh and for five seconds after, below or above ours. The case for merging is the
single switch, the one place to look, and §4.

## 3. The design: a third switch

### 3.1 The band

While the band is on, the header's controls gain, after Auto compact's and Agent-timed's:

- desktop: a switch `Keep cache warm`, and when on, `for [1h ▾]` (5m or 1h)
- terminal: `○ Keep cache warm`, and when on, `● Keep cache warm 1h`

Below the controls, where the hold row sits, a muted status line while warming is on:

- scheduled: `Cache warm · refresh in 38m · 3 refreshes this session, $0.04, saved $0.31`
- refreshing: `Refreshing the cache…` (amber)
- stopped: `Warming stopped: all 5 idle refreshes used, cache expires at 14:32` (muted) or
  `Warming stopped: 12.3k tokens is below the 48k break-even on claude-opus-5-5 at 1h` until the
  next prompt
- off below the break-even: nothing

No mascot, no pane, no animation. The transcript notice row stays (`☕ 1h · Cache warmed · read
48.2k · $0.01 · saves $0.09 vs rewrite`): it is the record a person scrolls back to.

### 3.2 Settings

Per chat, kept across restarts, in the same store entry as Auto compact's (`autoCompact:<chat
id>` becomes a wider per-chat record, or a sibling `warm:<chat id>`): on or off, the lifetime.
Off by default: a refresh spends the person's plan, and the mod must not spend it unasked.

Global, as `/config` rows from `plugin.json` `userConfig`, as cache-warmer has them: the default
lifetime (`usage-quota.cacheTtl`: 5m or 1h) and the idle limits (`usage-quota.idle5m`,
`usage-quota.idle1h`, 0 to 20, default 5). The switch in the band sets the chat; the rows set
the default for new chats.

The lifetime default: **set nothing, and follow what Claude Code chooses.** Claude Code 2.1.291
(read from its binary, the `promptCacheTtl` setting's own description and the function that
resolves the lifetime) picks the main conversation's lifetime in this order:

1. `FORCE_PROMPT_CACHING_5M` set: 5m
2. `CLAUDE_CODE_PROMPT_CACHE_TTL`: as set
3. the `promptCacheTtl` setting: as set
4. an agent's frontmatter
5. `ENABLE_PROMPT_CACHING_1H` (or its Bedrock twin): 1h
6. otherwise **automatic: 1 hour on a Claude subscription within its usage limits; 5 minutes on
   an API key, Bedrock, Vertex or Foundry**, and 5 minutes once the subscription is in overage.

Subagents and helpers default to 5m (`subagentPromptCacheTtl`). So a subscriber already has the
1h cache, chosen by Claude Code and withdrawn by it in overage, and an API-key user has 5m
because every 1h write would cost them twice. cache-warmer overrides that by always setting the
variable (to 1h by default), which also forces 1h writes on an API key and in overage. We do
better by not touching it: the switch's `5m | 1h | auto` field defaults to `auto`, and only an
explicit choice sets `CLAUDE_CODE_PROMPT_CACHE_TTL`.

That leaves the warmer needing to **know** the lifetime, since its refresh timing depends on it
(4m30s or 54m). Under `auto` the mod infers it the way Claude Code decides it: the three
variables and the setting through `$.env.get` and `$.config.list()`, then the plan (the band
already reads it for the limits: a subscription or an API key) and whether a limit is in
overage (the band has the limit figures). One mistake costs one refresh: a refresh that reads
under half the prefix found the cache gone, stops the chain, and from then the mod assumes 5m
for the session and says so in the status line. Item 4 of §6 proves the inference on a
subscription before the plan relies on it.

### 3.3 The chain, as ported

The policy (`hooks/cache-policy.ts`, pure, no `$`): the price table with its `PRICES_AS_OF`,
`decide` (Pi's rule), `costOf`, `missCostOf`, `outcomeOf`, `delayOf`, `deadlineOf`, `horizonOf`,
`idleSpanOf`, the formatters, the texts of the status line and the notice. Ported from
`warmer.ts` nearly as is, with the MIT notice kept in the file's header.

The engine side, in a hooks module: the anchor (the last request's model, prompt tokens,
lifetime, when), `schedule`, `refresh`, `forkFor`, `settle`, `extend`, `chain`, `stopChain`,
`forget`, `judgeChain`, the session and all-time totals. Ported from `register.tsx` with the pane,
the notice band, Clawd, the preview and the debug JSONL file left out (the debug lines go to
`$.ui.log(…, { to: 'debug' })` as the rest of our mod does).

Where the anchor comes from: cache-warmer reads it in a `turn.step` streaming hook, one per
request. Our mod has no streaming hook; it reads `$.session.usage` at `turn.complete` and on the
3-second tick, and that reading carries `context.breakdown.apiUsage`: the live window's last
response, with the four counts. `turn.complete`'s `e.usage` (TurnUsage) names the model. So the
anchor can be set at the end of each main turn from what `refresh` already reads, with no new
hook. A turn with several requests (tool calls) anchors on the last, which is the one whose
prefix the fork replays. Item 2 of §6 checks this.

Where chains are forgotten: our `session.compact` hook (already there), `session.end`, and
`classic.PostModelSwitch` (new, one line each). Auto compact's own compaction goes through the
`session.compact` path and so forgets the chain the same way.

### 3.4 Where the code lives

`hooks/hooks.json` takes a list of modules. The warmer can be a second hooks module,
`hooks/warm.tsx`, with its own `$`-taking functions and its own hooks, so `hooks/register.tsx`
(1,720 lines now) does not grow by 500. The band in `register.tsx` draws the warmer's state from
the shared plugin state (`usage-quota.warm`, declared in `types/index.d.ts`), and the switch's
press calls into it the same way. Whether two modules of one plugin may read and write one state
key, and whether a second module's `on` sees the same events, is item 1 of §6; if not, it all
goes in `register.tsx` as Agent-timed did.

## 4. What the merger adds that neither mod has

1. **Warming that knows the limits.** Stop warming (or lower the idle limit to 1) when the 5 Hour
   or Weekly bar is at or past a threshold (say 85%), or when the forecast says the person runs
   out before the reset. The band has both figures; cache-warmer never sees them. A refresh that
   pushes someone over their weekly limit is the one refresh nobody wants.
2. **Savings in the plan's currency.** Beside dollars, the status line can say what refreshes
   spent of the window (`0.3% of 5 Hour`) and what the kept prompts would have spent. The band
   already turns tokens into limit %; the warmer's `Usage` has the tokens.
3. **Compact or warm.** When Agent-timed asks the agent to compact at the start %, the band knows
   the warmer is keeping a 48k prefix warm at $0.01 a refresh; the toast can say what the
   compaction forfeits, and after it the chain is forgotten and starts afresh. No new rule, just
   the two features reading one state.
4. **One Credits line, one switch row, one README section.**

## 5. Costs and risks

- **Size.** About the size of Agent-timed: a 300-line policy file, a 450-line engine module, 80
  lines of band, 400 lines of tests. One subagent, one plan.
- **The price table rots.** Fifteen models with three prices each, dated. A model not in the
  table gets no warming (`no price for …`), never a wrong one. We keep the date in the file and
  the status line says `no price for claude-x` so a person sees why. The alternative, reading
  prices live, has no API.
- **It spends the person's plan.** Off by default, per chat, and the switch says so: `Keep cache
  warm (sends a small request before the cache expires)`. The idle limit bounds it: at 1h and the
  default 5, a chat left open warms for 5h30m and then stops.
- **`CLAUDE_CODE_PROMPT_CACHE_TTL` is process-wide.** Setting it from a chat's switch sets it for
  every chat of that process until the first response locks it, as cache-warmer does. We set it
  only when the person picks 1h; 5m needs nothing set.
- **Two bands if both are installed.** The README says: with this on, disable cache-warmer.
- **Licence.** MIT: the copyright notice travels with the ported code, and Credits names
  cache-warmer and Pi, as the README names compactor for Agent-timed.

## 6. Verified live first

As with Agent-timed, a spike in a throwaway mod before any plan, into
`docs/superpowers/specs/2026-10-07-cache-warmer-verification.md`:

1. Two hooks modules in one plugin: both load, both see events, both read and write one state
   key (`atom` with the same plugin and key in each file). Headless.
2. At `turn.complete`, `context.breakdown.apiUsage` from `$.session.usage({ breakdown:
   'summary' })` carries the last request's four counts, and `e.usage.model` the model; a fork
   made between turns leaves them as they were (the fork is not the live window's last
   response). Headless, two prompts and a fork from a timer.
3. `$.model.fork` from a timer in an idle session: `usage.cache_read_input_tokens` is at least
   half the prompt tokens (the cache was warm), and the fork raises no `turn.*` hook and no
   `session.measure` of ours (so Auto compact and Agent-timed do not take it for a turn).
   Headless, with a 20-second timer.
4. The automatic lifetime, on the maintainer's subscription: with nothing set, a fork made from a
   timer 6 minutes after the last prompt still reads the cache (`cache_read_input_tokens` at
   least half the prompt tokens), so the lifetime was 1h; and with `FORCE_PROMPT_CACHING_5M=1`
   the same fork reads nothing, so the inference's inputs are the right ones. Interactive, two
   runs of seven minutes.
5. `/config` rows from `userConfig` appear and their `config.set` hooks fire. Headless
   (`claude config set`).

## 7. Decided, and what is left

Decided by the maintainer on 2026-10-07:

1. **The full merge** (§3), not cache-warmer beside the mod.
2. **The lifetime default is `auto`**: Claude Code already gives a subscription the 1h cache
   within its limits (§3.2); the mod follows that and sets nothing unless asked.

Still open, with a proposed answer each:

3. The limit threshold of §4.1: a `/config` row `usage-quota.warmUntil`, default 85% of either
   window; past it no refresh is sent and the status line says why.
4. All-time totals across sessions: kept, as cache-warmer keeps them, in `$.store` under
   `warmAllTime`; the status line shows the session's, a press on it the all-time.
