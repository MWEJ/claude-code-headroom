# Keep cache warm: live verification

What the spike of the design spec's §6 showed, item by item, before the feature was built. The
spike is a throwaway mod (`warm-spike`: `plugin.json` with one `userConfig` row, `hooks.json`,
`hooks/a.ts`) in a scratch folder outside the repo. Nothing from it ships.

- **Claude Code version:** 2.1.291
- **Where:** a headless cloud session on a Claude subscription (the usage snapshot carried
  `five_hour` and `seven_day` limits), `claude -p "<prompt>" --plugin-dir <SPIKE> --allowedTools Bash`
- **Date:** 2026-10-07

## Item 1: two hooks modules in one plugin

**Fail, by design of the engine.** `claude plugin validate` with `"modules": ["./a.ts", "./b.ts"]`:

```
modules: hooks.json `modules` names one hooks module per plugin; a second entry is refused
```

So the warmer's engine code joins `hooks/register.tsx`, as Agent-timed's did, and only the pure
policy lives in a file of its own (§3.4's fallback).

A second finding on the way: a helper that takes `$` must be declared at the top level of the
module. The spike's first logger was a closure inside `register`, and validate refused the
module: ``$ is passed to "say", which is not a function declared at the top of this file``.

## Item 2: the anchor from what `turn.complete` and `$.session.usage` already give

The spike logged, at the end of the one main turn (a Bash tool call in it, so two requests):

```
turn.complete agent=main
  e.usage={"input_tokens":4,"output_tokens":266,"cache_read_input_tokens":69320,"cache_creation_input_tokens":141,"model":"claude-sonnet-5-5"}
  apiUsage={"input_tokens":2,"output_tokens":183,"cache_creation_input_tokens":141,"cache_read_input_tokens":34660}
  percent=3 tokens=34803
  rateLimits=[{"kind":"five_hour","percentUsed":0,"resetsAt":"2026-10-07T06:00:00.000Z"},{"kind":"seven_day","percentUsed":6,"resetsAt":"2026-10-11T14:00:00.000Z"}]
```

- `e.usage` is the turn's total (the cache read is twice the prefix: two requests) and names
  the model. Right for the turn's cost.
- `context.breakdown.apiUsage` is the last request's own counts: prompt tokens
  2 + 34,660 + 141 = 34,803 = `context.tokens`. Right for the anchor.

**Pass.** No `turn.step` hook is needed.

## Item 3: a fork from a timer

Eight seconds into the Bash call (`sleep 20`), a timer forked the conversation:

```
fork took 5512ms
  reply={"isAnswered":true,"text":"ok","usage":{"input_tokens":16766,"output_tokens":308,"cache_read_input_tokens":49868,"cache_creation_input_tokens":9845}}
  apiUsage after fork={"input_tokens":2,"output_tokens":83,"cache_creation_input_tokens":0,"cache_read_input_tokens":34660}
```

- The fork answered `ok` with its usage. It read 49,868 tokens from the cache, more than the
  main request's 34,660 prefix, so the prefix was read warm (`outcomeOf`'s "at least half"
  holds).
- It also sent 16,766 uncached tokens and wrote 9,845: this fork was made mid-turn, after an
  assistant tool call with no result yet, so its tail diverged from the main request's. A fork
  made between turns, after a complete reply, appends one user message to an unchanged prefix;
  cache-warmer's live test of 2026-10-05 showed that keeps a 1-hour cache warm past 60
  minutes. The mod prices each refresh from its real usage, so a dearer fork is counted, not
  assumed away.
- `apiUsage` after the fork is the main request's still: the fork is not the live window's
  last response. The log shows no `turn.start`, `turn.complete` or `session.measure` from the
  fork: Auto compact and Agent-timed never take one for a turn.

**Pass** for the mechanics. The idle-session fork (no turn running) is item 4's interactive
run.

## Item 4: the automatic lifetime on a subscription

**Open.** Needs the maintainer, two runs of seven minutes (§6 of the spec): with nothing set, a
fork six minutes after the last prompt still reads at least half the prefix; with
`FORCE_PROMPT_CACHING_5M=1`, it reads nothing.

For the record, in this cloud session `CLAUDE_CODE_PROMPT_CACHE_TTL` was unset, so the
automatic rule applied.

## Item 5: `userConfig` rows

`register(on, options)` received `options={"ttl":"auto"}`, the row's default. **Pass** for
the path the mod reads at start. `$.config.list()` listed no `warm-spike.*` row before any
set; the mod follows cache-warmer and applies a `$.config.set` result itself.

## Item 6: the meter is linear in cost

**Open.** Needs the maintainer: ten main turns of varied size on the subscription, the
`five_hour` jump per turn against the turn's dollars. The built mod logs both to the debug
log at each turn end (`usage-quota: cache rate …`), so the check is a `claude --debug`
session and a read of the log.

## Baseline

On the branch before the feature: `claude plugin test .` 69 pass, 0 fail; `claude plugin
validate .` passes; `tsc` exits 0.

## The finished mod

What the test kit and a headless run proved on the finished branch (Claude Code 2.1.291, the
same cloud session), checked by the main session after one Opus subagent built it:

- `claude plugin test .`: **109 pass, 0 fail** across five files (40 new tests in
  `tests/cache-policy.test.ts` and `tests/cache-warm.test.tsx`). The suite takes about 20
  seconds now: the engine tests advance the clock through the mod's timers.
- `claude plugin validate .` passes; every gating hook, the four `config.set` rows and
  `classic.PostModelSwitch` included, is listed with `.catch`.
- `tsc --noEmit` exits 0.
- `claude -p "Run the bash command: echo hi. Then reply with the single word done." --plugin-dir .
  --allowedTools Bash --debug`: the debug log shows `cache anchor: 34.6k tokens on
  claude-sonnet-5-5 at 1h` (the automatic lifetime, inferred from the subscription's limits) and
  `cache rate: nothing measured (no earlier reading of the same window)` for a first turn.
- Four deliberate breaks of the engine, each caught by exactly the tests meant for it: the
  `warmUntil` stop dropped (2 tests), an expired 1h cache no longer assuming 5m (1), the cache
  line not drawn (3), a `/clear` no longer forgetting the chain (1).
- The invisible characters of `hooks/register.tsx` are intact.

Left out of this build, on purpose, from the spec's proposals: a press on the status line to
show the all-time totals (they are kept in the store and the state, not shown), and the
"compact or warm" toast of §4.3.

## The maintainer's interactive checklist

Items 4 and 6 of §6, and the feature live. In a terminal from the repo, on the subscription:

```text
claude --debug --plugin-dir .
1. Send a prompt. The band shows nothing new yet (warming is off). Then wait past an hour
   without a prompt: an amber line "Cache expired Nm ago: your next message rewrites …k tokens,
   about $… (warm: $…) · Keep cache warm would have kept it for about $…". Two minutes before,
   the muted "Cache expires in 2m" line.
   -> Item 4 (the automatic 1h) passes if the "expires" line comes about 58 minutes after the
      prompt, not 3 minutes after; and if a prompt sent at 50 minutes still reads the cache
      (the reply is quick and the debug log's next "cache anchor" shows the same size).
2. Switch Keep cache warm on (a toast says each refresh counts against the plan). Press the
   lifetime button once: "5m". Send a prompt. The band: "Cache warm · refresh in 4m".
   -> 4m30s later a ☕ row in the transcript, "Cache warmed · read …k · $… · saves $… vs
      rewrite", and the line "Cache warm · refresh in 4m · 1 refresh this session, $…".
   -> After 5 refreshes (the idle limit) the line says "Warming stopped: all 5 idle refreshes
      used, cache expires at H:MM", and a ☕ row says the same.
3. Send ten prompts of varied size, a few minutes apart. In the debug log
   (~/.claude/debug/<session>.txt), the lines "usage-quota: cache rate: five_hour +X% for $Y".
   -> Item 6 passes if X against Y fits a line through the origin within 20%. From then the
      band's warning reads in "% of 5 Hour" instead of dollars.
4. /clear, then a prompt: the line "Warming stopped: conversation cleared" went with the clear,
   and the new chain anchors on the prompt's reply.
```
