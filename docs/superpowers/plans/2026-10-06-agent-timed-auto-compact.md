# Agent-timed Auto compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution method chosen by the maintainer:** one Opus subagent implements Tasks 2 to 7; the main session runs Task 1 and reviews the whole branch at the end. See `docs/superpowers/plans/2026-10-06-agent-timed-auto-compact-handoff.md`, which takes the place of the sub-skill line above.

**Goal:** Add an optional, per-chat "Agent-timed" mode to the band's Auto compact, in which the agent holds, releases or asks for compaction between a start % and the Auto compact % (the cap), and raise Auto compact's default from 30% to 80%.

**Architecture:** The decisions and every text the agent reads are pure functions in a new `hooks/agent-policy.ts`. Everything that touches the engine stays in `hooks/register.tsx`, because the engine follows `$` only into functions declared in the hooks module's own file: the session state, the agent's tool, what rides on tool results, the `session.compact` hook, the row after a compaction, and the band's new switch, field and rows. `watchAuto` asks the policy before compacting.

**Proven ahead:** every code block in Tasks 2 to 6 was applied in order to a scratch copy of the repo and run with `claude plugin test` after each task (Claude Code 2.1.291): 34, 46, 60 and 68 passing, with the one baseline failure throughout. The tests were then checked against ten deliberate breaks of the code, each of which they caught. Task 1's live checks and Task 7's live checklist are what that could not prove.

**Tech Stack:** TypeScript/TSX function hooks for Claude Code (the `claude-code` mod API, early access), tested with `claude plugin test` (`claude-code/testing`). No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-10-06-agent-timed-auto-compact-design.md`. Read it first; section numbers below (§) refer to it.

## Global Constraints

- The cap is `autoCompact.at`: 15 to 99, default **80** (was 30). A chat with a saved % keeps it.
- The start % is `autoCompact.startAt`: 10 to cap − 1, default **30**.
- Agent-timed is off by default, per chat, and only acts while Auto compact is on.
- Auto compact acts between turns only. Nothing here compacts mid-reply or vetoes Claude Code's own compaction.
- No hold survives the cap. Whatever fails in Agent-timed code, compaction still happens at the cap.
- A handoff note is at most 4,000 characters and is used by one compaction.
- Only the main agent holds, releases, asks or writes notes; a call carrying `agentId` is refused (`status` allowed).
- The tool is `compaction`; the model sees `mcp__claude-code-usage-quota__compaction`.
- The plugin's name stays `claude-code-usage-quota`. `claude plugin validate .` already fails on that name ("reserved"); that failure is the baseline and not this plan's to fix. Compare the rest of its report.
- Baseline: `claude plugin test .` gives **33 pass, 1 fail** before any change. The failure is `says when a limit is reached`; it is not caused by this work. Leave it, and never count it as a regression.
- Match the code's style: no semicolons, single quotes, 2 spaces, booleans named `is…`/`has…`, comments that say why in plain words (read 20 lines around any edit first).
- Every file the hooks module imports from the plugin is `.ts` or `.tsx` and is imported with a static `import` (no `import()`).
- Commit after every task, on the branch `agent-timed-auto-compact`, never on `main`. Subjects in the repo's style (`Auto compact: …`, `README: …`). Never bump the version or retake screenshots: those are the maintainer's (§13).

## Review Focus

Inputs the spec implies and a person will hit, each pinned by a test in the task named:

1. **A saved start % at or above the cap** (an older or hand-edited setting): it reads as cap − 1, never above. Task 5.
2. **A reason that is blank, whitespace or very long** (10,000 characters): refused when blank; stored cut to 500; drawn cut to 80. Tasks 4 and 8.
3. **The cap lowered under the current context while the agent holds**: the band asks about the cap, and "Now" compacts with the hold ended. Task 8.
4. **Agent-timed switched off while a hold is set**: the hold row goes, the hold has no say, and plain Auto compact applies. Task 8.
5. **A compaction that is skipped after the agent asked for it**: the request is spent, so nothing loops. Task 6.

## What the engine and the test kit do (probed on Claude Code 2.1.291)

Facts the code and the tests below rely on. If one no longer holds, stop and say so.

- **`$` is followed only into a function declared in the hooks module's own file.** Passing `$` to an imported function, or through an object (`host.settings($)`), stops the module loading. Pure helpers that take no `$` may be imported.
- **`read($, x)` and `update($, x, fn)` take an atom named outright**, a `const` of the file made by `atom(...)`. `update($, table[key].text, fn)` stops the module loading.

- A test file may import a plugin file: `import { decide } from '../hooks/agent-policy'`.
- `$.tool.call({ tool, …args, agentId })` from a test reaches the plugin's `tool.call` hooks with `agentId` intact, and resolves to what the hook answered, `context` included.
- `$.tool.check({ tool, input })` resolves to the plugin's `{ decision }`.
- `$.session.compact(args)` from a test runs the plugin's `session.compact` hook only when `args` carries `messages` (a list); without it the hook's `next` is refused and the hook is skipped. Pass `{ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] }`.
- The plugin's own `$.session.compact()` made from a timer goes straight to the test's hook; the test reads `e.instructions` there. A compaction that stands must answer at least one message.
- **A row the plugin appends with `$.session.append` reaches no test hook** and the call rejects (`no implementation for session.append`). So rows are asserted through the debug-log line `tell` writes (hook `ui.log`), and their texts as pure functions.
- Operations are answered as `on('<noun>.<method>', () => ({ value }))`: `tool.register`, `agent.list`, `session.usage`, `command.register`.

## File Structure

| File | Responsibility |
|---|---|
| `hooks/agent-policy.ts` (new) | Pure: constants, a chat's settings as they stand (`capOf`, `isTimed`, `startOf`), `decide`, nudge levels, breakpoint matching, the tool's reducer `answerTool`, and every text the agent reads. Imports types only. |
| `hooks/register.tsx` | Auto compact, the band, and all of Agent-timed that touches the engine. Changes: `stuck` per threshold; `watchAuto` asking `decide`; the session state atom with `tell`, `afterCompaction`, `hasRunningAgents`, `ensureTool`, `linesFor`; the tool's hooks, the tool-result context and the `session.compact` hook; the note on the direct compaction; the turn hooks; the second switch and field; the hold and asked rows. It grows from about 1,400 to about 1,720 lines: the engine's rule above leaves no other place. |
| `types/index.d.ts` | `AutoCompact` extended; `AgentTimed`; three new state keys. |
| `tests/agent-policy.test.ts` (new) | Tables over the pure functions. |
| `tests/agent-timed.test.tsx` (new) | Behaviour through the engine: zone, cap, tool, note, band. |
| `tests/band.test.tsx` | The 80% default; the subagent bug. |
| `README.md`, `docs/badges/auto-compact-v3.svg` | Docs for the new default and the mode. |
| `docs/superpowers/specs/2026-10-06-agent-timed-verification.md` (new) | What the live spike showed. |

Run from the repo root, `/Users/martinjoergensen/code/claude-code-usage-quota-mod`. Check `pwd` first; never prefix commands with `cd`.

---

### Task 0: Branch

**Files:** none changed.

The branch `agent-timed-auto-compact` already exists on `origin` and holds the spec, this plan and the handoff.

- [ ] **Step 1: Switch to the branch**

```bash
git fetch origin
git switch agent-timed-auto-compact
git status --short
```

Expected: on `agent-timed-auto-compact`, nothing to commit.

- [ ] **Step 2: Record the baseline**

Run: `claude plugin test .`
Expected: `33 pass`, `1 fail` (`says when a limit is reached`).

---

### Task 1: Live spike

Proves the five API facts of §12 in a throwaway mod before any feature code. Nothing from it ships.

**Files:**
- Create (outside the repo): `$SPIKE/.claude-plugin/plugin.json`, `$SPIKE/hooks/hooks.json`, `$SPIKE/hooks/register.ts`, where `SPIKE` is a new empty scratch folder (`export SPIKE=...` in each shell that runs a step)
- Create: `docs/superpowers/specs/2026-10-06-agent-timed-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the verification file; a go / no-go for Tasks 5 to 7.

- [ ] **Step 1: Write the spike mod**

`$SPIKE/.claude-plugin/plugin.json`:

```json
{ "name": "agent-timed-spike", "version": "0.0.1", "description": "Throwaway: proves five API facts" }
```

`$SPIKE/hooks/hooks.json`:

```json
{ "modules": ["./register.ts"] }
```

`$SPIKE/hooks/register.ts` (replace `SPIKE_DIR` with the folder's absolute path):

```ts
import type { Register } from 'claude-code'

const OUT = 'SPIKE_DIR/agents.json'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.tool.register({
      name: 'compaction',
      description: 'Spike tool. Call it with an action.',
      inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
    })
    return result
  })

  // 1: the tool answers, and no permission prompt stands in its way
  on('tool.check', { tool: 'mcp__agent-timed-spike__compaction' }, () => ({ decision: 'allow' as const }))
  on('tool.call', { tool: 'mcp__agent-timed-spike__compaction' }, async (_$, e) => {
    const input = e as unknown as { action?: string; agentId?: string }
    return { result: `SPIKE-TOOL-4410 action=${input.action} loop=${input.agentId ?? 'main'}` }
  })

  // 2: context on a tool result reaches the model; 5: what the agent list says mid-run
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) === 'Agent') {
      $.clock.after(4_000, async () => {
        await $.fs.write(OUT, JSON.stringify(await $.agent.list(), null, 2))
      })
    }
    const ran = await next(e)
    if (String(e.tool) !== 'Bash' || e.agentId !== undefined || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), 'SPIKE-CONTEXT-7391: quote this code in your answer.'] }
  })

  // 3 and 4: instructions reach the summarizer, and a row appended afterwards is read
  on('session.compact', async ($, e, next) => {
    $.ui.log(`spike: session.compact trigger=${e.trigger} agent=${e.agentId ?? 'main'}`, { to: 'debug' })
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    const asked = 'End the summary with the exact line SPIKE-NOTE-5512.'
    const done = await next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${asked}` : asked })
    if (done.skip === undefined) {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'SPIKE-ROW-8824: a row appended after the compaction.' }] } })
    }
    return done
  })
}
```

- [ ] **Step 2: Check it loads**

Run: `claude plugin validate "$SPIKE"`
Expected: its report lists the hooks `session.start`, `tool.check`, `tool.call` (twice), `session.compact`, and no error.

- [ ] **Step 3: Item 1 (terminal half): the tool is callable, with no permission prompt**

Run: `claude -p --plugin-dir "$SPIKE" "Call the tool mcp__agent-timed-spike__compaction with action hold. Reply with exactly what it returned and nothing else."`
Expected: the reply contains `SPIKE-TOOL-4410 action=hold loop=main`.

- [ ] **Step 4: Item 2: context on a tool result reaches the model**

Run: `claude -p --plugin-dir "$SPIKE" --allowedTools Bash "Run the bash command: echo hi. Then reply with any SPIKE code you were shown, or NONE."`
Expected: the reply contains `SPIKE-CONTEXT-7391`.

- [ ] **Step 5: Item 5: the agent list while a subagent runs**

Run: `claude -p --plugin-dir "$SPIKE" --allowedTools Bash,Agent "Use the Agent tool to start one general-purpose subagent whose whole task is to run the bash command: sleep 10; echo done. Wait for it and reply DONE."`
Then read `$SPIKE/agents.json`.
Expected: one entry whose `status` is `running` (or `pending`/`waiting`). Note the exact word.

- [ ] **Step 6: Hand the interactive checklist to the maintainer**

A headless session cannot compact, so items 3 and 4 need a person. Give them this, with `$SPIKE` filled in, and wait for the answers:

```text
In a terminal:  claude --debug --plugin-dir <SPIKE>
1. Send: Say hello in one word.
2. Type: /compact
3. Send: Quote the last line of the summary you were given, and any row containing SPIKE-ROW.
   -> Item 4 passes if the reply quotes SPIKE-NOTE-5512.
   -> Item 3 passes if the reply quotes SPIKE-ROW-8824.
4. Optional, for the desktop half of item 1: add
     "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<SPIKE>" }
   to ~/.claude/settings.json, quit and reopen the desktop app, and in the Code tab send:
     Call the tool mcp__agent-timed-spike__compaction with action hold and tell me what it returned.
   -> passes if the reply contains SPIKE-TOOL-4410. Remove the env line afterwards.
```

Tasks 2 to 4 do not depend on the answers: go on with them while waiting. **Do not start Task 5 until items 3 and 4 are answered.**

- [ ] **Step 7: Write the verification file**

`docs/superpowers/specs/2026-10-06-agent-timed-verification.md`, one section per item of §12: the command or steps, the output seen (quoted), the Claude Code version (`claude --version`), and **pass** or **fail**. Add the test-kit facts from this plan's "What the test kit does" section under their own heading.

- [ ] **Step 8: Act on a failure**

If every item passed, go on. If one failed, stop and report it with the fallback from this table; the spec is amended before the plan continues.

| Failed | Fallback to propose |
|---|---|
| 1 (tool not callable) | No tool: the agent writes a marker line the mod reads at `turn.complete`. Redesign §4. |
| 2 (context not read) | Tell and nudge through `$.session.append` rows mid-turn instead. |
| 3 (row after compaction not read) | Add the row to the `messages` the `session.compact` hook hands up; or deliver it as `context` on the first main tool result after the compaction. |
| 4 (hook instructions not used) | Pass the note only on the mod's own direct compaction; say so in the README. |
| 5 (statuses differ) | Use the status words seen in `agents.json` in `hasRunningAgents`. |

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-10-06-agent-timed-verification.md
git commit -m "Agent-timed Auto compact: live verification of the API it stands on"
```

---
### Task 2: A subagent's turn ending is not the main turn ending

`turn.complete` fires for subagent turns too (`e.agentId` set). Today's hook then marks the main turn as over, so Auto compact can fire mid-turn. Fix that, and rename `isHeld` so "held" is free for the agent's hold.

**Files:**
- Modify: `hooks/register.tsx` (the flags block near line 551, `watchAuto`, `loadAuto`, `askIfPast`, `answerAsk`, the `turn.complete` hook near line 982)
- Test: `tests/band.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: the module variable `isNewChatsOnly` (was `isHeld`); a `turn.complete` hook that returns early for `e.agentId !== undefined`.

- [ ] **Step 1: Write the failing test**

Append to `tests/band.test.tsx`, after the test `auto compact tries again while the turn is still winding down`:

```ts
test("a subagent's turn ending is not the main turn ending: auto compact waits for the main one", async ($, on) => {
  const percent = { value: 16 }
  const ran: string[] = []
  const clock = startWorld(on, percent, ran, [], 'Compact now', { 'autoCompact:chat': { isOn: true, at: 40 } })
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  percent.value = 45
  // a subagent of the turn finishes: the main turn is still running
  await $.turn.complete({ ...(TURN as object), agentId: 'a1' } as never)
  await clock.advance(3_100)
  expect(ran).toEqual([])
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test .`
Expected: the new test fails with `Expected: []`, `Received: ["compact"]`. (34 pass minus the baseline failure: `33 pass, 2 fail`.)

- [ ] **Step 3: Fix the hook**

In `hooks/register.tsx`, in the `turn.complete` hook, add the early return right after `const result = await next(e)`:

```ts
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // a subagent's turn ending: the main turn goes on, so nothing here is over yet
    if (e.agentId !== undefined) return result
    await refresh($)
```

- [ ] **Step 4: Rename `isHeld` to `isNewChatsOnly`**

Five places in `hooks/register.tsx`, each a plain rename: the declaration `let isHeld = false`; `watchAuto`'s `|| isHeld`; `loadAuto`'s `isHeld = false`; `askIfPast`'s `isHeld = false`; `answerAsk`'s `isHeld = true`. In the comment above the flags, `` `isHeld` ("only in new chats") `` becomes `` `isNewChatsOnly` ("only in new chats") ``.

Run: `grep -n "isHeld" hooks/register.tsx`
Expected: no output.

- [ ] **Step 5: Run the tests**

Run: `claude plugin test .`
Expected: `34 pass, 1 fail` (the baseline failure only).

- [ ] **Step 6: Commit**

```bash
git add hooks/register.tsx tests/band.test.tsx
git commit -m "Auto compact: a subagent finishing no longer counts as the turn ending"
```

---

### Task 3: Auto compact defaults to 80%

**Files:**
- Modify: `hooks/register.tsx` (`AT_DEFAULT` and its comment, near line 673)
- Test: `tests/band.test.tsx` (two tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `AT_DEFAULT = 80`.

- [ ] **Step 1: Change the tests first**

In `tests/band.test.tsx`, in the test `auto compact: the switch shows the field, …`, the comment and the table's blank case:

```ts
  // below 15 becomes 15, each time; over 99 is 99 each time; blank is 80
  for (const [typed, shown] of [['5', '15'], ['0', '15'], ['14', '15'], ['100', '99'], ['250', '99'], ['', '80'], ['20', '20']]) {
```

Replace the whole test `auto compact is per chat: another chat opens with it off, at 30%; turned on past it, it asks and waits` with:

```ts
test('auto compact is per chat: another chat opens with it off, at 80%; turned on past it, it asks and waits', async ($, on) => {
  const percent: { value: number; isCompacted?: boolean } = { value: 85 }
  const ran: string[] = []
  // another chat has it on at 20%
  const clock = startWorld(on, percent, ran, [], 'Compact now', { 'autoCompact:other': { isOn: true, at: 20 } })
  on('session.id', () => ({ value: 'this' }) as never)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await clock.advance(3_000)
  expect(ran).toEqual([])

  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg', alt: 'Auto compact off' })).toBeDefined()
  await ui.press({ key: 'auto' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('80')
  expect(await ui.find({ type: 'Text', text: /already at 85%, past 80%/ })).toBeDefined()
  // left unanswered: as "after my next compact"
  await $.turn.complete(TURN)
  await clock.advance(3_000)
  expect(ran).toEqual([])
  percent.value = 5
  percent.isCompacted = true
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /already at/ })).toBeUndefined()
  percent.isCompacted = false
  percent.value = 81
  await $.turn.complete(TURN)
  await clock.advance(1_100)
  expect(ran).toEqual(['compact'])
  await ui.unmount()
})
```

- [ ] **Step 2: Run to see both fail**

Run: `claude plugin test .`
Expected: those two tests fail (`Expected: "80"`, `Received: "30"`).

- [ ] **Step 3: Change the default**

In `hooks/register.tsx`:

```ts
// the % whenever there is none: a blank field, a first switch-on
const AT_DEFAULT = 80
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test .`
Expected: `34 pass, 1 fail` (the baseline failure only).

- [ ] **Step 5: Commit**

```bash
git add hooks/register.tsx tests/band.test.tsx
git commit -m "Auto compact: defaults to 80% for a chat that never set it"
```

---

### Task 4: The policy module

Everything that needs no engine: a chat's settings as they stand, the decision of §3.1, the nudge levels of §5.2, breakpoints (§5.3), the tool's answers (§4) and every text the agent reads (§5, §6). It is the one part that can live outside `hooks/register.tsx` (see "What the engine and the test kit do").

**Files:**
- Modify: `types/index.d.ts`
- Create: `hooks/agent-policy.ts`
- Test: `tests/agent-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `hooks/agent-policy.ts`):
  - constants `TOOL_NAME`, `TOOL`, `TOOL_DESCRIPTION`, `TOOL_SCHEMA`, `AT_DEFAULT = 80`, `START_MIN = 10`, `START_DEFAULT = 30`, `NOTE_MAX = 4000`, `REASON_MAX = 500`, `REASON_SHOWN = 80`, `ASK_MIN = 10`, `NEAR_CAP = 5`, `NUDGE_EVERY = 10`, `EMPTY: AgentTimed`
  - `capOf(auto: AutoCompact): number`, `isTimed(auto: AutoCompact): boolean`, `startOf(auto: AutoCompact): number`
  - `type Stuck = 'no' | 'start' | 'cap'`, `type DecideInput`, `type Decision`, `decide(input: DecideInput): Decision`
  - `nudgeLevel(percent, startAt, cap, isHolding): 0 | 2 | 3`
  - `stepNudge(nudge: AgentTimed['nudge'], level: 0 | 2 | 3): { isSaid: boolean; nudge: AgentTimed['nudge'] }`
  - `breakpointOf(command: string): 'commit' | 'tests' | null`
  - `figures(percent, startAt, cap): string`, `toldText(percent, startAt, cap): string`, `nudgeText(level: 2 | 3, percent, startAt, cap, reason): string`, `breakpointText(kind): string`
  - `withNote(instructions: string | undefined, note: string | null): string | undefined`
  - `afterText(note: string | null, overridden: AgentTimed['overridden'], cap: number): string | null`
  - `type ToolInput`, `type ToolContext`, `answerTool(state: AgentTimed, input: ToolInput, ctx: ToolContext): { state: AgentTimed; text: string }`
- Produces (from `types/index.d.ts`): `AgentTimed`, the extended `AutoCompact`, state keys `agentTimed`, `startTick`, `startText`.

`hooks/register.tsx` keeps its own `AT_DEFAULT` until Task 5 switches it to this module's.

- [ ] **Step 1: Extend the type contract**

In `types/index.d.ts`, replace the `AutoCompact` line and its comment with:

```ts
/**
 * auto compact: on or off, and the context % that sets it off (kept for every chat).
 * Agent-timed: from `startAt` % the agent chooses the moment, up to `at` %, the cap
 */
export type AutoCompact = { isOn: boolean; at: number | null; isAgentTimed?: boolean; startAt?: number | null }

/** what Agent-timed holds for the session; every compaction of the main conversation starts it over */
export type AgentTimed = {
  /** the agent's request to defer compaction below the cap */
  hold: { reason: string; since: number } | null
  /** the handoff note: to the summarizer, back to the agent, then cleared */
  note: string | null
  /** the agent asked to compact when this turn ends */
  isAsked: boolean
  /** whether the agent knows it is past the start %: `next` until the coming turn begins */
  told: 'no' | 'next' | 'yes'
  /** the highest nudge sent this cycle, main tool calls since, and the breakpoint hint */
  nudge: { level: number; calls: number; isBreakpointSaid: boolean }
  /** a hold the cap ended, until the row after the compaction says so */
  overridden: { reason: string; percent: number } | null
}
```

and inside `interface PluginState`'s `'claude-code-usage-quota'` block, after the `fieldText` line:

```ts
      agentTimed: AgentTimed
      /** the start % field's own tick and typed text, as fieldTick and fieldText are the cap's */
      startTick: number
      startText: string | null
```

- [ ] **Step 2: Write the failing tests**

Create `tests/agent-policy.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import {
  ASK_MIN, AT_DEFAULT, EMPTY, NOTE_MAX, NUDGE_EVERY, REASON_MAX,
  afterText, answerTool, breakpointOf, capOf, decide, figures, isTimed, nudgeLevel, startOf, stepNudge, toldText, withNote,
} from '../hooks/agent-policy'
import type { DecideInput, ToolContext } from '../hooks/agent-policy'

const HOLD = { reason: 'mid-refactor of auth', since: 1_000 }
const TOLD = { hold: null, isAsked: false, told: 'yes' as const }
const BASE: DecideInput = {
  percent: 40, cap: 80, startAt: 30, isAgentTimed: true, isPaused: false, stuck: 'no', state: TOLD, hasRunningAgents: false,
}

test("a chat's setting: the cap, whether Agent-timed is on, and a start % always below the cap", () => {
  expect(capOf({ isOn: true, at: null })).toBe(AT_DEFAULT)
  expect(AT_DEFAULT).toBe(80)
  expect(isTimed({ isOn: true, at: 80 })).toBe(false)
  expect(isTimed({ isOn: true, at: 80, isAgentTimed: true })).toBe(true)
  // Agent-timed is a mode of auto compact: off with it
  expect(isTimed({ isOn: false, at: 80, isAgentTimed: true })).toBe(false)
  expect(startOf({ isOn: true, at: 80 })).toBe(30)
  expect(startOf({ isOn: true, at: 80, startAt: null })).toBe(30)
  expect(startOf({ isOn: true, at: 80, startAt: 3 })).toBe(10)
  // a saved start % at or above the cap (an older or hand-edited setting) reads as one below it
  expect(startOf({ isOn: true, at: 40, startAt: 90 })).toBe(39)
  expect(startOf({ isOn: true, at: 40, startAt: 40 })).toBe(39)
  expect(startOf({ isOn: true, at: 20 })).toBe(19)
})

test('decide: the first rule that applies decides', () => {
  const cases: [string, Partial<DecideInput>, unknown][] = [
    ['asked passes a pause', { isPaused: true, state: { ...TOLD, isAsked: true } }, { action: 'compact', why: 'asked' }],
    ['asked passes a hold and stuck', { stuck: 'cap', state: { hold: HOLD, isAsked: true, told: 'no' } }, { action: 'compact', why: 'asked' }],
    ['a pause waits, even at the cap', { isPaused: true, percent: 90 }, { action: 'wait', why: 'paused' }],
    ['the cap compacts', { percent: 80 }, { action: 'compact', why: 'cap' }],
    ['the cap is compared rounded', { percent: 79.5 }, { action: 'compact', why: 'cap' }],
    ['the cap compacts through a hold', { percent: 85, state: { hold: HOLD, isAsked: false, told: 'no' } }, { action: 'compact', why: 'cap' }],
    ['the cap compacts with subagents running', { percent: 85, hasRunningAgents: true }, { action: 'compact', why: 'cap' }],
    ['the cap compacts with Agent-timed off', { percent: 85, isAgentTimed: false }, { action: 'compact', why: 'cap' }],
    ['stuck at the cap waits', { percent: 85, stuck: 'cap' }, { action: 'wait', why: 'stuck' }],
    ['stuck at the start never blocks the cap', { percent: 85, stuck: 'start' }, { action: 'compact', why: 'cap' }],
    ['Agent-timed off waits below the cap', { isAgentTimed: false }, { action: 'wait', why: 'below' }],
    ['below the start waits', { percent: 29 }, { action: 'wait', why: 'below' }],
    ['stuck at the start waits in the zone', { stuck: 'start' }, { action: 'wait', why: 'stuck' }],
    ['a hold waits', { state: { ...TOLD, hold: HOLD } }, { action: 'wait', why: 'held' }],
    ['a hold is said before the subagents', { hasRunningAgents: true, state: { ...TOLD, hold: HOLD } }, { action: 'wait', why: 'held' }],
    ['a running subagent waits', { hasRunningAgents: true }, { action: 'wait', why: 'agents' }],
    ['a running subagent waits before the agent is told', { hasRunningAgents: true, state: { ...TOLD, told: 'no' } }, { action: 'wait', why: 'agents' }],
    ['untold: tell', { state: { ...TOLD, told: 'no' } }, { action: 'tell' }],
    ['told for the coming turn: wait', { state: { ...TOLD, told: 'next' } }, { action: 'wait', why: 'told' }],
    ['told: compact at the start', {}, { action: 'compact', why: 'start' }],
    ['the start is compared rounded', { percent: 29.5 }, { action: 'compact', why: 'start' }],
  ]
  for (const [name, change, verdict] of cases) {
    expect({ name, verdict: decide({ ...BASE, ...change }) }).toEqual({ name, verdict })
  }
})

test('nudges: level 2 from halfway to the cap, level 3 from five points under it, only while holding', () => {
  expect(nudgeLevel(54, 30, 80, true)).toBe(0)
  expect(nudgeLevel(55, 30, 80, true)).toBe(2)
  expect(nudgeLevel(74, 30, 80, true)).toBe(2)
  expect(nudgeLevel(75, 30, 80, true)).toBe(3)
  expect(nudgeLevel(90, 30, 80, false)).toBe(0)
  expect(nudgeLevel(20, 30, 80, true)).toBe(0)
  // a narrow zone goes straight to level 3
  expect(nudgeLevel(31, 30, 34, true)).toBe(3)
})

test('nudges: each level is said once; level 3 again every tenth main tool call', () => {
  let nudge = EMPTY.nudge
  const said: boolean[] = []
  const step = (level: 0 | 2 | 3) => {
    const next = stepNudge(nudge, level)
    nudge = next.nudge
    said.push(next.isSaid)
  }
  step(0)
  step(2)
  step(2)
  step(3)
  for (let i = 0; i < NUDGE_EVERY; i++) step(3)
  expect(said).toEqual([false, true, false, true, ...Array(NUDGE_EVERY - 1).fill(false), true])
  expect(nudge.level).toBe(3)
})

test('breakpoints: a commit or a test run, in command position, never a dry run or a mention', () => {
  const cases: [string, string | null][] = [
    ['git commit -m "x"', 'commit'],
    ['git add -A && git commit -m "x"', 'commit'],
    ['git -C ../other commit -m x', 'commit'],
    ['git commit --dry-run', null],
    ['echo "git commit"', null],
    ['git log --grep=commit', null],
    ['npx jest', 'tests'],
    ['npm run test:unit', 'tests'],
    ['pnpm test', 'tests'],
    ['python3 -m pytest -q', 'tests'],
    ['cargo test --lib', 'tests'],
    ['go test ./...', 'tests'],
    ['claude plugin test .', 'tests'],
    ['cat tests/jest.config.js', null],
    ['ls', null],
    ['', null],
  ]
  for (const [command, kind] of cases) expect({ command, kind: breakpointOf(command) }).toEqual({ command, kind })
})

test('texts: every number names what it measures', () => {
  expect(figures(41.2, 30, 80)).toBe('Context 41%. Agent-timed compaction starts at 30%; at 80% it runs whatever is held.')
  expect(toldText(31, 30, 80)).toBe(
    'Agent-timed compaction: context is at 31% (starts at 30%, cap 80%). This conversation will be compacted when your turn ends. ' +
      'If you are mid-task, call the compaction tool with action "hold" and a reason. Otherwise save a "note" of what must survive.',
  )
})

test('the note joins the instructions once, however often it is added', () => {
  const block = 'The agent left this handoff note. Keep what it says matters:\nnext: run the tests'
  expect(withNote(undefined, null)).toBeUndefined()
  expect(withNote('keep the plan', null)).toBe('keep the plan')
  expect(withNote(undefined, 'next: run the tests')).toBe(block)
  expect(withNote('keep the plan', 'next: run the tests')).toBe(`keep the plan\n\n${block}`)
  expect(withNote(withNote('keep the plan', 'next: run the tests'), 'next: run the tests')).toBe(`keep the plan\n\n${block}`)
})

test('after a compaction the agent gets its note and word of a hold the cap ended, or nothing', () => {
  expect(afterText(null, null, 80)).toBeNull()
  expect(afterText('next: run the tests', null, 80)).toBe(
    'Agent-timed compaction: the conversation was just compacted.\nHandoff note you left:\nnext: run the tests',
  )
  expect(afterText(null, { reason: 'mid-refactor of auth', percent: 82 }, 80)).toBe(
    'Agent-timed compaction: the conversation was just compacted.\n' +
      'Your hold (mid-refactor of auth) ended at the 80% cap. Hold again if the work is still fragile.',
  )
})

const CTX: ToolContext = { isOn: true, isSubagent: false, percent: 41, startAt: 30, cap: 80, now: 61_000 }
const TAIL = '\nContext 41%. Agent-timed compaction starts at 30%; at 80% it runs whatever is held.'

test('the tool: hold needs a reason, keeps its start time, and cuts a very long reason', () => {
  for (const reason of [undefined, '', '   ', 7]) {
    const refused = answerTool(EMPTY, { action: 'hold', reason }, CTX)
    expect(refused.state).toBe(EMPTY)
    expect(refused.text).toBe(`A hold needs a reason: action "hold", reason "<what is fragile>". Nothing changed.${TAIL}`)
  }
  const held = answerTool(EMPTY, { action: 'hold', reason: '  mid-refactor of auth ' }, CTX)
  expect(held.state.hold).toEqual({ reason: 'mid-refactor of auth', since: 61_000 })
  expect(held.text).toStartWith('Hold set: compaction waits until you release, or until the cap. Reason: mid-refactor of auth.')
  const again = answerTool(held.state, { action: 'hold', reason: 'tasks 3 to 5' }, { ...CTX, now: 999_000 })
  expect(again.state.hold).toEqual({ reason: 'tasks 3 to 5', since: 61_000 })
  expect(again.text).toStartWith('Hold updated')
  const long = answerTool(EMPTY, { action: 'hold', reason: 'x'.repeat(10_000) }, CTX)
  expect(long.state.hold?.reason).toHaveLength(REASON_MAX)
})

test('the tool: release clears the hold and may save a note; compact asks, and is refused when there is nothing to compact', () => {
  const held = { ...EMPTY, hold: HOLD }
  const released = answerTool(held, { action: 'release', note: 'next: run the tests' }, CTX)
  expect(released.state).toEqual({ ...EMPTY, note: 'next: run the tests' })
  expect(released.text).toBe(`Released. Compaction can run when this turn ends. Handoff note saved; it comes back after the compaction.${TAIL}`)
  expect(answerTool(EMPTY, { action: 'release' }, { ...CTX, percent: 20 }).text).toStartWith('No hold was set. Compaction waits until context reaches 30%.')

  const asked = answerTool(held, { action: 'compact' }, CTX)
  expect(asked.state).toEqual({ ...EMPTY, isAsked: true })
  expect(asked.text).toBe(`Compaction runs when this turn ends.${TAIL}`)
  const tiny = answerTool(held, { action: 'compact' }, { ...CTX, percent: ASK_MIN - 1 })
  expect(tiny.state).toBe(held)
  expect(tiny.text).toStartWith(`Context is under ${ASK_MIN}%: there is nothing worth compacting. Nothing changed.`)
  // a hold after asking takes the request back
  expect(answerTool(asked.state, { action: 'hold', reason: 'not yet' }, CTX).state.isAsked).toBe(false)
})

test('the tool: a note is saved, cleared by an empty one, and refused past its limit', () => {
  const noted = answerTool(EMPTY, { action: 'note', note: 'hypothesis: the cache key' }, CTX)
  expect(noted.state.note).toBe('hypothesis: the cache key')
  expect(answerTool(noted.state, { action: 'note', note: '' }, CTX).state.note).toBeNull()
  expect(answerTool(EMPTY, { action: 'note' }, CTX).text).toStartWith('A note needs text')
  for (const action of ['note', 'release', 'compact']) {
    const refused = answerTool(noted.state, { action, note: 'x'.repeat(NOTE_MAX + 1) }, CTX)
    expect(refused.state).toBe(noted.state)
    expect(refused.text).toStartWith(`The note is ${NOTE_MAX + 1} characters; the most is ${NOTE_MAX}. Nothing changed.`)
  }
})

test('the tool: only the main agent changes anything; anyone may ask for status; off, it says so', () => {
  const sub = { ...CTX, isSubagent: true }
  for (const action of ['hold', 'release', 'compact', 'note']) {
    const refused = answerTool(EMPTY, { action, reason: 'x', note: 'y' }, sub)
    expect(refused.state).toBe(EMPTY)
    expect(refused.text).toStartWith('Only the main agent can hold, release, compact or write notes')
  }
  const status = answerTool({ ...EMPTY, hold: HOLD, note: 'next: run the tests', isAsked: true }, { action: 'status' }, sub)
  expect(status.text).toBe(`hold: mid-refactor of auth (1m)\nnote: next: run the tests\ncompaction asked for: when this turn ends${TAIL}`)
  expect(answerTool(EMPTY, { action: 'status' }, CTX).text).toBe(`hold: none\nnote: none${TAIL}`)

  const off = answerTool(EMPTY, { action: 'hold', reason: 'x' }, { ...CTX, isOn: false })
  expect(off).toEqual({ state: EMPTY, text: 'Agent-timed compaction is off in this chat. Nothing changed.' })
  for (const action of [undefined, 'pause', 3]) {
    expect(answerTool(EMPTY, { action }, CTX).text).toStartWith('Unknown action. Call it with action "hold" (and a reason), "release", "compact", "note" or "status". Nothing changed.')
  }
})
```

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test .`
Expected: `tests/agent-policy.test.ts` does not load: `../hooks/agent-policy` does not exist.

- [ ] **Step 4: Write the module**

Create `hooks/agent-policy.ts`:

```ts
import type { AgentTimed, AutoCompact } from '../types'

// Agent-timed Auto compact, the part with no engine in it: when to compact, what the
// agent's tool answers, and every word the agent reads. The idea (the agent holds
// compaction through fragile work and releases it at a safe point, leaving a note that
// survives) is compactor's, github.com/rhwendt/compactor (MIT), as is the shape of the
// breakpoint patterns.

export const TOOL_NAME = 'compaction'
export const TOOL = 'mcp__claude-code-usage-quota__compaction'
export const TOOL_DESCRIPTION =
  'Controls when this conversation is compacted. Compaction runs when your turn ends once context passes the start %. ' +
  '"hold" (with a reason) before fragile multi-step work whose state lives only in this conversation; "release" at a safe point; ' +
  '"compact" to compact when this turn ends; "note" to save what must survive (current hypothesis, next steps, file:line references). ' +
  'At the cap % compaction runs whatever is held.'
export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { enum: ['hold', 'release', 'compact', 'note', 'status'] },
    reason: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['action'],
}

// the cap (the auto compact %) whenever there is none: a blank field, a first switch-on
export const AT_DEFAULT = 80
// the start %: 10 at the least, always below the cap; 30 where none was set
export const START_MIN = 10
export const START_DEFAULT = 30
export const NOTE_MAX = 4_000
// a reason is kept to this, and drawn in the band to less
export const REASON_MAX = 500
export const REASON_SHOWN = 80
// "compact" under this context % is refused: there is nothing worth compacting
export const ASK_MIN = 10
// within this many points of the cap, a holding agent is told the cap is close
export const NEAR_CAP = 5
// main tool calls between repeats of that last warning
export const NUDGE_EVERY = 10

export const EMPTY: AgentTimed = {
  hold: null,
  note: null,
  isAsked: false,
  told: 'no',
  nudge: { level: 0, calls: 0, isBreakpointSaid: false },
  overridden: null,
}

// a chat's setting as it stands: the cap, whether Agent-timed is on (it needs auto
// compact on), and the start %: the saved one or the default, never under the least,
// always below the cap
export const capOf = (auto: AutoCompact): number => auto.at ?? AT_DEFAULT
export const isTimed = (auto: AutoCompact): boolean => auto.isOn && auto.isAgentTimed === true
export const startOf = (auto: AutoCompact): number => Math.min(Math.max(START_MIN, auto.startAt ?? START_DEFAULT), capOf(auto) - 1)

/** a compaction ran and the context is still past a %: `start` never blocks the cap */
export type Stuck = 'no' | 'start' | 'cap'

export type DecideInput = {
  percent: number
  cap: number
  startAt: number
  isAgentTimed: boolean
  /** the band is asking, "After my next compact", or "Only in new chats" */
  isPaused: boolean
  stuck: Stuck
  state: Pick<AgentTimed, 'hold' | 'isAsked' | 'told'>
  hasRunningAgents: boolean
}

export type Decision =
  | { action: 'compact'; why: 'asked' | 'cap' | 'start' }
  | { action: 'tell' }
  | { action: 'wait'; why: 'paused' | 'stuck' | 'below' | 'held' | 'agents' | 'told' }

// What auto compact does with an idle chat: the first rule that applies decides. The %
// is compared as the band shows it, rounded.
export function decide(i: DecideInput): Decision {
  const shown = Math.round(i.percent)
  // the agent's own request is as deliberate as the Compact button: no pause stops it
  if (i.state.isAsked) return { action: 'compact', why: 'asked' }
  if (i.isPaused) return { action: 'wait', why: 'paused' }
  // the cap: no hold, no subagent and no untold agent survives it
  if (shown >= i.cap) return i.stuck === 'cap' ? { action: 'wait', why: 'stuck' } : { action: 'compact', why: 'cap' }
  if (!i.isAgentTimed || shown < i.startAt) return { action: 'wait', why: 'below' }
  if (i.stuck !== 'no') return { action: 'wait', why: 'stuck' }
  if (i.state.hold) return { action: 'wait', why: 'held' }
  // the main agent is waiting on work whose results it must still take in
  if (i.hasRunningAgents) return { action: 'wait', why: 'agents' }
  // never compacted unawares: told first, and given the coming turn to hold
  if (i.state.told === 'no') return { action: 'tell' }
  if (i.state.told === 'next') return { action: 'wait', why: 'told' }
  return { action: 'compact', why: 'start' }
}

// How firmly a holding agent is reminded: 2 from halfway between the start % and the
// cap, 3 from NEAR_CAP points under the cap.
export function nudgeLevel(percent: number, startAt: number, cap: number, isHolding: boolean): 0 | 2 | 3 {
  const shown = Math.round(percent)
  if (!isHolding || shown < startAt) return 0
  if (shown >= cap - NEAR_CAP) return 3
  if (shown >= startAt + (cap - startAt) / 2) return 2
  return 0
}

// One main tool call later: a level is said when first reached, and level 3 again
// every NUDGE_EVERY calls while it lasts.
export function stepNudge(nudge: AgentTimed['nudge'], level: 0 | 2 | 3): { isSaid: boolean; nudge: AgentTimed['nudge'] } {
  if (level === 0) return { isSaid: false, nudge }
  if (level > nudge.level) return { isSaid: true, nudge: { ...nudge, level, calls: 0 } }
  if (level < 3) return { isSaid: false, nudge }
  const calls = nudge.calls + 1
  return calls >= NUDGE_EVERY ? { isSaid: true, nudge: { ...nudge, calls: 0 } } : { isSaid: false, nudge: { ...nudge, calls } }
}

// a command word: at the start, or after a space or a shell separator
const SEP = String.raw`(?:^|[\s;&|(])`
const END = String.raw`(?=$|[\s;&|)])`
const COMMIT = new RegExp(SEP + String.raw`git(?:\s+-[Cc]\s+\S+)*\s+commit` + END)
const TESTS = new RegExp(
  SEP +
    '(?:' +
    String.raw`pytest|py\.test|python3?\s+-m\s+(?:pytest|unittest)` +
    String.raw`|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?` +
    String.raw`|go\s+test|cargo\s+test|make\s+(?:test|check)|mvn(?:\s+\S+)*?\s+test` +
    String.raw`|(?:\./)?gradlew?(?:\s+\S+)*?\s+test|rspec|(?:npx\s+)?(?:jest|vitest)|claude\s+plugin\s+test` +
    ')' +
    END,
)
const SEGMENTS = /&&|\|\||[;|&\n]/

// Which natural breakpoint a Bash command that succeeded was: read one shell segment
// at a time, so "echo git commit" and a --dry-run are not one.
export function breakpointOf(command: string): 'commit' | 'tests' | null {
  const segments = command.split(SEGMENTS).filter(s => s.trim() !== '')
  if (segments.some(s => COMMIT.test(s) && !s.includes('--dry-run'))) return 'commit'
  if (segments.some(s => TESTS.test(s))) return 'tests'
  return null
}

export function figures(percent: number, startAt: number, cap: number): string {
  return `Context ${Math.round(percent)}%. Agent-timed compaction starts at ${startAt}%; at ${cap}% it runs whatever is held.`
}

export function toldText(percent: number, startAt: number, cap: number): string {
  return (
    `Agent-timed compaction: context is at ${Math.round(percent)}% (starts at ${startAt}%, cap ${cap}%). ` +
    'This conversation will be compacted when your turn ends. ' +
    'If you are mid-task, call the compaction tool with action "hold" and a reason. Otherwise save a "note" of what must survive.'
  )
}

export function nudgeText(level: 2 | 3, percent: number, startAt: number, cap: number, reason: string): string {
  const body =
    level === 3
      ? `the cap is close. At ${cap}% compaction runs when your turn ends, whatever is held. Save a note now.`
      : `you are holding (${reason}) well past the start. Finish the current step, save a note, and release.`
  return `Agent-timed compaction: ${body}\n${figures(percent, startAt, cap)}`
}

export function breakpointText(kind: 'commit' | 'tests'): string {
  const what = kind === 'commit' ? 'a commit just landed' : 'tests just passed'
  return `Agent-timed compaction: ${what}, a natural breakpoint. Consider "release" or "compact", with a note.`
}

const NOTE_HEAD = 'The agent left this handoff note. Keep what it says matters:'

// The note as the summarizer's instructions, after whatever was asked for already.
// Adding it twice adds it once: a compaction may pass more than one place that adds it.
export function withNote(instructions: string | undefined, note: string | null): string | undefined {
  if (note === null) return instructions
  const block = `${NOTE_HEAD}\n${note}`
  if (instructions?.includes(block)) return instructions
  return instructions ? `${instructions}\n\n${block}` : block
}

// The row the agent reads after a compaction, or null with nothing to say.
export function afterText(note: string | null, overridden: AgentTimed['overridden'], cap: number): string | null {
  if (note === null && overridden === null) return null
  const lines = ['Agent-timed compaction: the conversation was just compacted.']
  if (overridden) lines.push(`Your hold (${overridden.reason}) ended at the ${cap}% cap. Hold again if the work is still fragile.`)
  if (note !== null) lines.push(`Handoff note you left:\n${note}`)
  return lines.join('\n')
}

export type ToolInput = { action?: unknown; reason?: unknown; note?: unknown }
export type ToolContext = {
  /** Agent-timed is on in this chat */
  isOn: boolean
  /** the call came from a subagent's or a teammate's loop */
  isSubagent: boolean
  percent: number
  startAt: number
  cap: number
  now: number
}

const ACTIONS = ['hold', 'release', 'compact', 'note', 'status']

function statusText(state: AgentTimed, now: number): string {
  const lines = [
    state.hold ? `hold: ${state.hold.reason} (${Math.max(0, Math.round((now - state.hold.since) / 60_000))}m)` : 'hold: none',
    state.note === null ? 'note: none' : `note: ${state.note}`,
  ]
  if (state.isAsked) lines.push('compaction asked for: when this turn ends')
  return lines.join('\n')
}

// What a call of the tool does and answers. A refusal says what was wrong and changes
// nothing: the state handed back is then the very one handed in.
export function answerTool(state: AgentTimed, input: ToolInput, ctx: ToolContext): { state: AgentTimed; text: string } {
  if (!ctx.isOn) return { state, text: 'Agent-timed compaction is off in this chat. Nothing changed.' }
  const say = (text: string, next: AgentTimed = state) => ({ state: next, text: `${text}\n${figures(ctx.percent, ctx.startAt, ctx.cap)}` })
  const { action } = input
  if (typeof action !== 'string' || !ACTIONS.includes(action)) {
    return say('Unknown action. Call it with action "hold" (and a reason), "release", "compact", "note" or "status". Nothing changed.')
  }
  if (action === 'status') return say(statusText(state, ctx.now))
  if (ctx.isSubagent) {
    return say('Only the main agent can hold, release, compact or write notes: the hold and the note are its own. Finish your task and report back. Nothing changed.')
  }
  if (action === 'hold') {
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, REASON_MAX) : ''
    if (reason === '') return say('A hold needs a reason: action "hold", reason "<what is fragile>". Nothing changed.')
    const hold = { reason, since: state.hold?.since ?? ctx.now }
    return say(`${state.hold ? 'Hold updated' : 'Hold set'}: compaction waits until you release, or until the cap. Reason: ${reason}.`, {
      ...state,
      hold,
      isAsked: false,
      nudge: { ...state.nudge, isBreakpointSaid: false },
    })
  }
  const note = typeof input.note === 'string' ? input.note : undefined
  if (note !== undefined && note.length > NOTE_MAX) return say(`The note is ${note.length} characters; the most is ${NOTE_MAX}. Nothing changed.`)
  const noted = (next: AgentTimed): AgentTimed => (note === undefined ? next : { ...next, note: note === '' ? null : note })
  const saved = note === undefined ? '' : note === '' ? ' Handoff note cleared.' : ' Handoff note saved; it comes back after the compaction.'
  if (action === 'release') {
    const when = Math.round(ctx.percent) >= ctx.startAt ? 'Compaction can run when this turn ends.' : `Compaction waits until context reaches ${ctx.startAt}%.`
    return say(`${state.hold ? 'Released.' : 'No hold was set.'} ${when}${saved}`, noted({ ...state, hold: null }))
  }
  if (action === 'compact') {
    if (Math.round(ctx.percent) < ASK_MIN) return say(`Context is under ${ASK_MIN}%: there is nothing worth compacting. Nothing changed.`)
    return say(`Compaction runs when this turn ends.${saved}`, noted({ ...state, hold: null, isAsked: true }))
  }
  if (note === undefined) return say('A note needs text: action "note", note "<what must survive>" (an empty note clears it). Nothing changed.')
  return say(note === '' ? 'Handoff note cleared.' : `Handoff note saved (${note.length} characters). It goes to the summarizer and comes back after the next compaction.`, noted(state))
}
```

- [ ] **Step 5: Run the tests**

Run: `claude plugin test .`
Expected: all 12 tests of `tests/agent-policy.test.ts` pass; overall `46 pass, 1 fail` (the baseline failure only).

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/agent-policy.ts tests/agent-policy.test.ts
git commit -m "Agent-timed: the decision, the tool's answers and the agent's texts, as pure functions"
```

---

### Task 5: The engine side

Agent-timed without its band controls: the session state, the compaction cycle, the agent's tool, what rides on tool results, and the note. A chat gets the mode from its saved setting (`isAgentTimed: true`), which the tests seed; Task 6 adds the switch.

**Do not start until the maintainer has answered items 3 and 4 of Task 1.**

**Files:**
- Modify: `hooks/register.tsx`
- Test: `tests/agent-timed.test.tsx` (new)

**Interfaces:**
- Consumes: everything Task 4 produces; `isNewChatsOnly` and the early return in `turn.complete` from Task 2.
- Produces (module-level in `hooks/register.tsx`, for Task 6):
  - `agentTimed`: the atom of `AgentTimed`
  - `stuck: Stuck` (replaces `isStuck`), `isWatching`
  - `tell($, text): Promise<void>`, `hasRunningAgents($): Promise<boolean>`, `ensureTool($): Promise<boolean>`, `afterCompaction($): Promise<void>`, `dropAsked($): Promise<void>`, `linesFor($, command): Promise<string[]>`
  - `watchAuto($, percent)` deciding through `decide`
  - hooks: `tool.check` and `tool.call` on `mcp__claude-code-usage-quota__compaction`, an unmatched `tool.call`, `session.compact`

Three rules of the engine shape this task (all found by running it):
- `$` is followed only into functions **declared in `hooks/register.tsx`**. Never pass `$` to an imported function or through an object. That is why this code is not in a file of its own.
- `read($, x)` and `update($, x, fn)` take an atom **named outright** (a `const` of this file), never `table[key]`.
- `claude plugin validate` will list the four new hooks as "gating hook without .catch". That is intended: if one fails it is skipped, and the tool's result or the compaction goes on as if the mod were not there.

- [ ] **Step 1: Write the failing tests**

Create `tests/agent-timed.test.tsx`:

```tsx
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const HOUR = 3_600_000
const TOOL = 'mcp__claude-code-usage-quota__compaction'
const START = { cwd: '.', surface: 'desktop', isInteractive: true } as const
const TURN = { answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never
const GO = { text: 'go', turnId: 't1' } as never
// Agent-timed on, from 30% to the 80% cap
const TIMED = { isOn: true, at: 80, isAgentTimed: true, startAt: 30 }
const NOTE = 'The agent left this handoff note. Keep what it says matters:\n'

type Percent = { value: number; isCompacted?: boolean }

// The engine beneath the plugin. `seen` is what reached it: each compaction's
// instructions, toasts, debug-log lines, tools registered. `after`: the context % a
// compaction leaves; `agents`: the subagents the session lists (null: the list cannot
// be read); `skip`: a compaction answered as skipped; `canRegister`: false refuses the tool
function world(on: On, percent: Percent, saved: unknown = TIMED) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, saved === null ? {} : { 'autoCompact:chat': saved })
  const seen = {
    compacted: [] as (string | undefined)[],
    toasts: [] as string[],
    logs: [] as string[],
    registered: [] as string[],
    agents: [] as { id: string; description: string; type: string; status: string }[] | null,
    after: 8,
    skip: undefined as string | undefined,
    canRegister: true,
  }
  on('session.usage', () => ({
    value: {
      startedAt: NOW - HOUR,
      context: {
        window: 1_000_000,
        tokens: percent.isCompacted ? undefined : percent.value * 10_000,
        percent: percent.value,
        breakdown: { categories: [], totalTokens: percent.value * 10_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, percentage: percent.value } as never,
      },
      rateLimits: [],
    },
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.authorize', () => ({ value: null }))
  on('session.measure', () => ({ changed: [] }))
  on('command.register', () => ({ value: { command: 'quota' } }))
  on('tool.register', (_$, e) => {
    if (!seen.canRegister) throw new Error('the session refuses tools')
    seen.registered.push(e.name)
    return { value: { tool: `mcp__claude-code-usage-quota__${e.name}` } }
  })
  on('agent.list', () => {
    if (seen.agents === null) throw new Error('the agents cannot be listed')
    return { value: seen.agents } as never
  })
  on('session.compact', (_$, e) => {
    seen.compacted.push(e.instructions)
    if (seen.skip !== undefined) return { skip: seen.skip } as never
    percent.value = seen.after
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' } }) as never)
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(String((e as { text?: string }).text))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', () => ({ turnId: 't1' }))
  return { clock, seen }
}

// the rows the mod appended for the agent, as the debug log has them
const rows = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('claude-code-usage-quota: agent-timed row')).map(l => l.replace(/^[^)]*\): /, ''))

const tool = async ($: Engine, input: Record<string, unknown>) => String((await $.tool.call({ tool: TOOL, ...input } as never)).result)
const bash = async ($: Engine, command = 'ls', agentId?: string) =>
  (await $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)).context ?? []

// a main turn in which the context reaches `value` (the 3s tick reads it mid-turn)
async function into($: Engine, clock: { advance: (ms: number) => Promise<void> }, percent: Percent, value: number) {
  await $.turn.start(GO)
  percent.value = value
  await clock.advance(3_000)
}
async function end($: Engine, clock: { advance: (ms: number) => Promise<void> }, turn: unknown = TURN) {
  await $.turn.complete(turn as never)
  await clock.advance(1_100)
}

test('past the start % the agent is told first: that turn end is skipped, the next one compacts', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)
  expect(seen.registered).toEqual(['compaction'])

  await into($, clock, percent, 35)
  await end($, clock)
  expect(seen.compacted).toEqual([])
  expect(rows(seen)).toEqual([
    'Agent-timed compaction: context is at 35% (starts at 30%, cap 80%). This conversation will be compacted when your turn ends. ' +
      'If you are mid-task, call the compaction tool with action "hold" and a reason. Otherwise save a "note" of what must survive.',
  ])
  // idle, it goes on waiting: the coming turn is the agent's chance to hold
  await clock.advance(9_000)
  expect(seen.compacted).toEqual([])

  await $.turn.start(GO)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
  expect(seen.toasts).toContain('Context at 35%: auto compacting (Agent-timed from 30%)')
  expect(rows(seen)).toHaveLength(1)
})

test('told mid-turn on a tool result, once; then the turn end compacts', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)

  await into($, clock, percent, 35)
  expect(await bash($)).toEqual([expect.stringMatching(/^Agent-timed compaction: context is at 35% \(starts at 30%, cap 80%\)/)])
  expect(await bash($)).toEqual([])
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
  expect(rows(seen)).toEqual([])
})

test('a hold defers the start %, release lets it run, and the note goes to the summarizer and comes back once', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)

  await into($, clock, percent, 35)
  await bash($)
  expect(await tool($, { action: 'hold', reason: 'mid-refactor of auth' })).toStartWith('Hold set')
  await end($, clock)
  await clock.advance(9_000)
  expect(seen.compacted).toEqual([])

  await $.turn.start(GO)
  expect(await tool($, { action: 'release', note: 'next: run the tests' })).toStartWith('Released. Compaction can run when this turn ends. Handoff note saved')
  await end($, clock)
  expect(seen.compacted).toEqual([`${NOTE}next: run the tests`])
  expect(rows(seen)).toEqual(['Agent-timed compaction: the conversation was just compacted.\nHandoff note you left:\nnext: run the tests'])

  // used once: the next compaction carries no note
  await into($, clock, percent, 85)
  await end($, clock)
  expect(seen.compacted).toEqual([`${NOTE}next: run the tests`, undefined])
  expect(rows(seen)).toHaveLength(1)
})

test('no hold survives the cap: it ends there, and the agent is told so afterwards', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)

  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  await end($, clock)
  await into($, clock, percent, 82)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
  expect(seen.toasts).toContain("Context at 82%: Claude's hold ends at your 80%, auto compacting")
  expect(rows(seen).at(-1)).toBe(
    'Agent-timed compaction: the conversation was just compacted.\nYour hold (mid-refactor of auth) ended at the 80% cap. Hold again if the work is still fragile.',
  )
  expect(await tool($, { action: 'status' })).toStartWith('hold: none\nnote: none')
})

test('with Agent-timed off the cap compacts as ever, and the tool says it is off', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent, { isOn: true, at: 80 })
  await $.session.start(START)
  expect(seen.registered).toEqual([])

  await into($, clock, percent, 50)
  expect(await bash($)).toEqual([])
  expect(await tool($, { action: 'hold', reason: 'x' })).toBe('Agent-timed compaction is off in this chat. Nothing changed.')
  await end($, clock)
  expect(seen.compacted).toEqual([])
  await into($, clock, percent, 82)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
  expect(seen.toasts).toContain('Context at 82%: auto compacting (set at 80%)')
  expect(rows(seen)).toEqual([])
})

test('the agent asks to compact: it runs when the turn ends, below the start % too; an interrupted turn drops it', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)

  await into($, clock, percent, 22)
  expect(await tool($, { action: 'compact', note: 'the plan is in docs/plan.md' })).toStartWith('Compaction runs when this turn ends.')
  await end($, clock, { ...(TURN as object), reason: 'aborted', isAborted: true })
  expect(seen.compacted).toEqual([])

  await into($, clock, percent, 22)
  await tool($, { action: 'compact' })
  await end($, clock)
  expect(seen.compacted).toEqual([`${NOTE}the plan is in docs/plan.md`])
  expect(seen.toasts).toContain('Compacting as Claude asked')
})

test('a compaction that is skipped after the agent asked spends the request: nothing loops', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  seen.skip = 'nothing to compact'
  await $.session.start(START)

  await into($, clock, percent, 22)
  await tool($, { action: 'compact' })
  await end($, clock)
  await clock.advance(30_000)
  expect(seen.compacted).toEqual([undefined])
  expect(seen.toasts).toContain('Auto compact was skipped: nothing to compact')
})

test('a running subagent defers the start %, never the cap; its own calls change nothing and carry nothing', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  seen.agents = [{ id: 'a1', description: 'explore', type: 'Explore', status: 'running' }]
  await $.session.start(START)

  await into($, clock, percent, 35)
  expect(await bash($, 'ls', 'a1')).toEqual([])
  expect(await tool($, { action: 'hold', reason: 'mine', agentId: 'a1' })).toStartWith('Only the main agent can hold, release, compact or write notes')
  await bash($)
  await end($, clock)
  await $.turn.start(GO)
  await end($, clock)
  expect(seen.compacted).toEqual([])

  // the subagent is done: the next look compacts
  seen.agents = [{ id: 'a1', description: 'explore', type: 'Explore', status: 'completed' }]
  await clock.advance(3_000)
  await clock.advance(1_100)
  expect(seen.compacted).toEqual([undefined])

  seen.agents = [{ id: 'a2', description: 'explore', type: 'Explore', status: 'running' }]
  await into($, clock, percent, 82)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined, undefined])
})

test('an agent list that cannot be read holds nothing back', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  seen.agents = null
  await $.session.start(START)

  await into($, clock, percent, 35)
  await bash($)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
})

test('still past the start % after compacting: the start waits until it drops below, the cap still compacts', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  seen.after = 32
  await $.session.start(START)

  await into($, clock, percent, 35)
  await bash($)
  await end($, clock)
  expect(seen.compacted).toHaveLength(1)
  expect(seen.toasts).toContain('Context is still at 32% after compacting, past your 30% start: Agent-timed waits until it drops below')

  await into($, clock, percent, 40)
  await bash($)
  await end($, clock)
  expect(seen.compacted).toHaveLength(1)

  await into($, clock, percent, 82)
  await end($, clock)
  expect(seen.compacted).toHaveLength(2)
})

test('a saved start % at or above the cap reads as one below it', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent, { isOn: true, at: 40, isAgentTimed: true, startAt: 90 })
  await $.session.start(START)

  await into($, clock, percent, 39)
  await end($, clock)
  expect(rows(seen)[0]).toStartWith('Agent-timed compaction: context is at 39% (starts at 39%, cap 40%).')
})

test('while holding: a reminder from halfway, a warning near the cap that repeats, and one breakpoint hint', async ($, on) => {
  const percent = { value: 20 }
  const { clock } = world(on, percent)
  await $.session.start(START)

  await into($, clock, percent, 35)
  await bash($)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  expect(await bash($)).toEqual([])
  expect(await bash($, 'git add -A && git commit -m "auth: step 1"')).toEqual([
    'Agent-timed compaction: a commit just landed, a natural breakpoint. Consider "release" or "compact", with a note.',
  ])
  expect(await bash($, 'git commit -m "auth: step 2"')).toEqual([])

  percent.value = 56
  await clock.advance(3_000)
  expect(await bash($)).toEqual([
    'Agent-timed compaction: you are holding (mid-refactor of auth) well past the start. Finish the current step, save a note, and release.\n' +
      'Context 56%. Agent-timed compaction starts at 30%; at 80% it runs whatever is held.',
  ])
  expect(await bash($)).toEqual([])

  percent.value = 76
  await clock.advance(3_000)
  expect(await bash($)).toEqual([expect.stringMatching(/^Agent-timed compaction: the cap is close\. At 80% compaction runs when your turn ends/)])
  for (let i = 0; i < 9; i++) expect(await bash($)).toEqual([])
  expect(await bash($)).toEqual([expect.stringMatching(/the cap is close/)])
})

test('the tool needs no permission prompt', async ($, on) => {
  world(on, { value: 20 })
  await $.session.start(START)
  expect(await $.tool.check({ tool: TOOL, input: { action: 'status' } } as never)).toEqual({ decision: 'allow' })
})

test('a compaction from elsewhere carries the note too, and starts the cycle over', async ($, on) => {
  const percent: Percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)

  // the person's own /compact: the note joins what they asked for, once
  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  await tool($, { action: 'note', note: 'next: run the tests' })
  await end($, clock)
  await $.session.compact({ instructions: 'keep the plan', trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(seen.compacted).toEqual([`keep the plan\n\n${NOTE}next: run the tests`])
  expect(rows(seen).at(-1)).toBe('Agent-timed compaction: the conversation was just compacted.\nHandoff note you left:\nnext: run the tests')
  expect(await tool($, { action: 'status' })).toStartWith('hold: none\nnote: none')

  // one the mod only notices by the reply total going blank
  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'tasks 3 to 5' })
  await tool($, { action: 'note', note: 'task 4 is half done' })
  await end($, clock)
  percent.value = 6
  percent.isCompacted = true
  await clock.advance(3_000)
  expect(rows(seen).at(-1)).toBe('Agent-timed compaction: the conversation was just compacted.\nHandoff note you left:\ntask 4 is half done')
  expect(await tool($, { action: 'status' })).toStartWith('hold: none\nnote: none')
  // a subagent's own compaction is none of this
  await $.session.compact({ agentId: 'a1', trigger: 'auto', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(rows(seen)).toHaveLength(2)
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test .`
Expected: the 14 tests of `tests/agent-timed.test.tsx` fail (the first with `Expected: ["compaction"]`, `Received: []`); the rest unchanged.

- [ ] **Step 3: Import the policy, and the session state's type**

In `hooks/register.tsx`, replace:

```tsx
import type { AutoCompact, Category, Limit, PaceOf, Snapshot } from '../types'
```

with:

```tsx
import type { AgentTimed, AutoCompact, Category, Limit, PaceOf, Snapshot } from '../types'
import {
  AT_DEFAULT, EMPTY, TOOL, TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA,
  afterText, answerTool, breakpointOf, breakpointText, capOf, decide, isTimed, nudgeLevel, nudgeText, startOf, stepNudge, toldText, withNote,
} from './agent-policy'
import type { Stuck, ToolInput } from './agent-policy'
```

- [ ] **Step 4: Add the session state's atom, after the `autoCompact` atom**

In `hooks/register.tsx`, replace:

```tsx
const autoCompact = atom({ plugin: 'claude-code-usage-quota', key: 'autoCompact' } as const, { isOn: false, at: null } as AutoCompact)
```

with:

```tsx
const autoCompact = atom({ plugin: 'claude-code-usage-quota', key: 'autoCompact' } as const, { isOn: false, at: null } as AutoCompact)
// what Agent-timed holds for the session: the agent's hold, note and request, and what it has been told
const agentTimed = atom({ plugin: 'claude-code-usage-quota', key: 'agentTimed' } as const, EMPTY as AgentTimed)
```

- [ ] **Step 5: Replace the flags and their comment**

In `hooks/register.tsx`, replace the comment that begins `// Auto compact fires whenever the chat is idle` and the seven `let` lines under it (down to, not including, `function compactNow(`) with:

```tsx
// Auto compact acts whenever the chat is idle (no turn running): at the end of a turn,
// on opening a chat, on any refresh between turns. What it does then is `decide`'s
// (agent-policy.ts): at the cap (the %) it compacts; with Agent-timed on it also
// compacts from the start %, unless the agent holds or its subagents still run. Paused
// by `waitsForCompact` (the band is asking, or the person chose "after my next
// compact", which is also what an unanswered ask means: cleared only by a real
// compaction, never by the % flickering below) and by `isNewChatsOnly` ("only in new
// chats"). `stuck`: a compaction already ran and the context is still past a %, so it
// would only repeat; dropping below clears it, and stuck at the start never blocks the
// cap. The % is compared as the band shows it, rounded.
let waitsForCompact = false
// a reply has been seen since the chat opened or was last compacted
let hadReply = false
let stuck: Stuck = 'no'
let isNewChatsOnly = false
let isBusy = false
let isCompacting = false
let lastPercent = 0
// one look at a time: a look waits on the engine (the agents, a row told), and the 3s
// tick must not start a second meanwhile
let isWatching = false

// Agent-timed Auto compact, the part that touches the engine: what the agent holds for
// the session, its tool, what it is told, and what a compaction does to all of it. The
// decisions and the words are agent-policy.ts's; this stays in the hooks module's own
// file because the engine follows $ only into functions declared here.

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// A row for the agent between turns: a user-role row the person does not see as typed.
// The debug log has every one, appended or not (a test cannot see a plugin's rows).
async function tell($: EngineInterface, text: string): Promise<void> {
  let outcome = 'appended'
  try {
    const row = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    if (row.deny !== undefined) outcome = `not appended: ${row.deny}`
  } catch (error) {
    outcome = `not appended: ${reasonOf(error)}`
  }
  $.ui.log(`claude-code-usage-quota: agent-timed row (${outcome}): ${text}`, { to: 'debug' })
}

// The main agent is waiting on work whose results it must still take in. An agent list
// that cannot be read counts as none running: compaction is never held on a guess.
async function hasRunningAgents($: EngineInterface): Promise<boolean> {
  try {
    return (await $.agent.list()).some(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting')
  } catch {
    return false
  }
}

// the agent's tool, registered once, and only in a chat where Agent-timed is on (a tool
// in the list rides on every request, and the API has no way to take one out again)
let isToolRegistered = false
async function ensureTool($: EngineInterface): Promise<boolean> {
  if (isToolRegistered) return true
  try {
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    isToolRegistered = true
  } catch (error) {
    $.ui.log(`claude-code-usage-quota: the compaction tool could not be registered: ${reasonOf(error)}`, { to: 'debug' })
  }
  return isToolRegistered
}

// Three places notice a compaction of the main conversation (auto compact's own direct
// call, the session.compact hook, the reply total going blank): the first one handles
// it, and the others find it handled until a reply has been seen again.
let isCompactionHandled = false

// The main conversation was compacted: the cycle starts over, and the agent gets its
// note back, and word of a hold the cap ended, once.
async function afterCompaction($: EngineInterface): Promise<void> {
  isCompactionHandled = true
  const state = await read($, agentTimed)
  await update($, agentTimed, () => EMPTY)
  const text = afterText(state.note, state.overridden, capOf(await read($, autoCompact)))
  if (text !== null) await tell($, text)
}

// the request to compact is spent by one attempt, and dropped when the turn it was
// made in is interrupted
async function dropAsked($: EngineInterface): Promise<void> {
  if ((await read($, agentTimed)).isAsked) await update($, agentTimed, s => ({ ...s, isAsked: false }))
}

// What rides on a main-agent tool result: word that the start % is passed (once a
// cycle), the reminders of a hold growing old, and a breakpoint after a commit or a
// passing test run (`command`: a Bash command that succeeded, else null).
async function linesFor($: EngineInterface, command: string | null): Promise<string[]> {
  const auto = await read($, autoCompact)
  if (!isTimed(auto)) return []
  const startAt = startOf(auto)
  const cap = capOf(auto)
  const percent = lastPercent
  const shown = Math.round(percent)
  const state = await read($, agentTimed)
  const lines: string[] = []
  let told = state.told
  let nudge = state.nudge
  if (told !== 'yes' && shown >= startAt) {
    lines.push(toldText(percent, startAt, cap))
    told = 'yes'
  }
  if (state.hold) {
    const step = stepNudge(nudge, nudgeLevel(percent, startAt, cap, true))
    nudge = step.nudge
    if (step.isSaid) lines.push(nudgeText(nudge.level === 3 ? 3 : 2, percent, startAt, cap, state.hold.reason))
    const kind = command === null || shown < startAt || nudge.isBreakpointSaid ? null : breakpointOf(command)
    if (kind) {
      lines.push(breakpointText(kind))
      nudge = { ...nudge, isBreakpointSaid: true }
    }
  }
  if (told !== state.told || nudge !== state.nudge) await update($, agentTimed, s => ({ ...s, told, nudge }))
  return lines
}
```

- [ ] **Step 6: In `autoCompactNow`: pass the note, spend the request, start the cycle over, and keep stuck per threshold**

In `hooks/register.tsx`, replace:

```tsx
      // the desktop app (an SDK session) has no direct compaction: there /compact runs
      // as a turn of its own, so it is typed, as the Compact button does
      const result = canCompactDirectly
        ? await $.session.compact()
        : (await $.command.run({ command: 'compact' }), undefined)
      // held as stuck while the figures are read again, so no tick fires a second one
      isStuck = true
      isCompacting = false
      if (result && 'skip' in result && result.skip) $.ui.toast(`Auto compact was skipped: ${result.skip}`)
      lastSnapshot = ''
      const usage = await $.session.usage({ breakdown: 'summary' })
      const percent = usage.context.percent ?? 0
      // still past the % after compacting: say so once, and do not loop on it
      const auto = await read($, autoCompact)
      if (auto.at !== null && Math.round(percent) >= auto.at) {
        $.ui.toast(`Context is still at ${Math.round(percent)}% after compacting, past your ${auto.at}%: auto compact waits until it drops below`)
      } else isStuck = false
      await refresh($)
```

with:

```tsx
      // the agent's handoff note rides along as the summarizer's instructions (a typed
      // /compact gets it from the session.compact hook instead)
      const instructions = withNote(undefined, (await read($, agentTimed)).note)
      // the desktop app (an SDK session) has no direct compaction: there /compact runs
      // as a turn of its own, so it is typed, as the Compact button does
      const result = canCompactDirectly
        ? await $.session.compact(instructions === undefined ? undefined : { instructions })
        : (await $.command.run({ command: 'compact' }), undefined)
      // held as stuck while the figures are read again, so no tick fires a second one
      stuck = 'cap'
      isCompacting = false
      // the attempt spends the agent's request, skipped or not: a skip must not loop
      await dropAsked($)
      if (result && 'skip' in result && result.skip) $.ui.toast(`Auto compact was skipped: ${result.skip}`)
      else if (result) await afterCompaction($)
      lastSnapshot = ''
      const usage = await $.session.usage({ breakdown: 'summary' })
      const shown = Math.round(usage.context.percent ?? 0)
      // still past a % after compacting: say so once, and do not loop on it
      const auto = await read($, autoCompact)
      stuck = shown >= capOf(auto) ? 'cap' : isTimed(auto) && shown >= startOf(auto) ? 'start' : 'no'
      if (stuck === 'cap') $.ui.toast(`Context is still at ${shown}% after compacting, past your ${capOf(auto)}%: auto compact waits until it drops below`)
      if (stuck === 'start') $.ui.toast(`Context is still at ${shown}% after compacting, past your ${startOf(auto)}% start: Agent-timed waits until it drops below`)
      await refresh($)
```

- [ ] **Step 7: Replace `watchAuto`**

In `hooks/register.tsx`, replace the whole function `watchAuto`, with its one-line comment (down to, not including, `async function saveAuto(`) with:

```tsx
// called with the context % whenever it is read
async function watchAuto($: EngineInterface, percent: number): Promise<void> {
  lastPercent = percent
  if (isWatching) return
  isWatching = true
  try {
    const auto = await read($, autoCompact)
    if (!auto.isOn || auto.at === null) return
    const shown = Math.round(percent)
    const cap = auto.at
    const startAt = startOf(auto)
    const timed = isTimed(auto)
    // stuck eases as the context drops below what it was stuck past
    if (stuck === 'cap' && shown < cap) stuck = timed && shown >= startAt ? 'start' : 'no'
    if (stuck === 'start' && (!timed || shown < startAt)) stuck = 'no'
    if (isBusy || isCompacting) return
    const state = await read($, agentTimed)
    // the agents are asked after only where they can decide: in the zone, nothing else in the way
    const isOpenZone = timed && shown >= startAt && shown < cap && !state.hold && !state.isAsked
    const verdict = decide({
      percent, cap, startAt, isAgentTimed: timed, isPaused: waitsForCompact || isNewChatsOnly, stuck, state,
      hasRunningAgents: isOpenZone && (await hasRunningAgents($)),
    })
    // a turn may have started while the engine was asked
    if (isBusy || isCompacting) return
    if (verdict.action === 'tell') {
      await update($, agentTimed, s => ({ ...s, told: 'next' as const }))
      await tell($, toldText(percent, startAt, cap))
      return
    }
    if (verdict.action !== 'compact') return
    if (verdict.why === 'cap' && state.hold) {
      // no hold survives the cap: it ends here, and the row after the compaction says so
      const { reason } = state.hold
      await update($, agentTimed, s => ({ ...s, hold: null, overridden: { reason, percent: shown } }))
      $.ui.toast(`Context at ${shown}%: Claude's hold ends at your ${cap}%, auto compacting`)
    } else if (verdict.why === 'cap') $.ui.toast(`Context at ${shown}%: auto compacting (set at ${cap}%)`)
    else if (verdict.why === 'start') $.ui.toast(`Context at ${shown}%: auto compacting (Agent-timed from ${startAt}%)`)
    else $.ui.toast('Compacting as Claude asked')
    autoCompactNow($)
  } finally {
    isWatching = false
  }
}
```

- [ ] **Step 8: In `loadAuto`: another chat starts clean, and a chat saved with Agent-timed on gets the tool**

In `hooks/register.tsx`, replace:

```tsx
  isNewChatsOnly = false
  isStuck = false
  waitsForCompact = false
  await update($, autoCompact, () => (saved ? { ...saved, at: saved.at ?? AT_DEFAULT } : { isOn: false, at: AT_DEFAULT }))
  await update($, autoAsk, () => null)
```

with:

```tsx
  isNewChatsOnly = false
  stuck = 'no'
  waitsForCompact = false
  await update($, autoCompact, () => (saved ? { ...saved, at: saved.at ?? AT_DEFAULT } : { isOn: false, at: AT_DEFAULT }))
  await update($, autoAsk, () => null)
  // another chat: what the agent held, noted or asked for belonged to the last one
  await update($, agentTimed, () => EMPTY)
  if (saved && isTimed(saved)) await ensureTool($)
```

- [ ] **Step 9: Remove the local `AT_DEFAULT` (it is the policy's now)**

In `hooks/register.tsx`, delete:

```tsx
// the % whenever there is none: a blank field, a first switch-on
const AT_DEFAULT = 80
```

- [ ] **Step 10: In `askIfPast`: `stuck` in place of `isStuck`**

In `hooks/register.tsx`, replace:

```tsx
  isNewChatsOnly = false
  isStuck = false
  const isPast
```

with:

```tsx
  isNewChatsOnly = false
  stuck = 'no'
  const isPast
```

- [ ] **Step 11: In `refresh`: a compaction seen only by the reply total going blank starts the cycle over too**

In `hooks/register.tsx`, replace:

```tsx
    if (context.tokens !== undefined) hadReply = true
    else if (hadReply) {
      hadReply = false
      // an ask left unanswered meant "after my next compact": done with now
      if (waitsForCompact) await update($, autoAsk, () => null)
      waitsForCompact = false
    }
```

with:

```tsx
    if (context.tokens !== undefined) {
      hadReply = true
      // a reply since the last compaction: the next one is news again
      isCompactionHandled = false
    } else if (hadReply) {
      hadReply = false
      // an ask left unanswered meant "after my next compact": done with now
      if (waitsForCompact) await update($, autoAsk, () => null)
      waitsForCompact = false
      // a compaction nobody told Agent-timed of: its cycle starts over here
      if (!isCompactionHandled) await afterCompaction($)
    }
```

- [ ] **Step 12: Register the tool's hooks, the tool-result context and the `session.compact` hook, first in `register`**

In `hooks/register.tsx`, replace:

```tsx
export const register: Register = on => {
```

with:

```tsx
export const register: Register = on => {
  // the mod's own tool: no permission prompt stands between the agent and a hold
  on('tool.check', { tool: 'mcp__claude-code-usage-quota__compaction' }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: 'mcp__claude-code-usage-quota__compaction' }, async ($, e) => {
    const input = e as unknown as ToolInput & { agentId?: string }
    const auto = await read($, autoCompact)
    const before = await read($, agentTimed)
    const answer = answerTool(before, input, {
      isOn: isTimed(auto),
      isSubagent: input.agentId !== undefined,
      percent: lastPercent,
      startAt: startOf(auto),
      cap: capOf(auto),
      now: await $.clock.now(),
    })
    if (answer.state !== before) await update($, agentTimed, () => answer.state)
    return { result: answer.text }
  })

  // what the agent is told mid-turn rides on its own tool results; a subagent's carry
  // nothing. A hook that fails here is skipped and the tool's result stands as it was
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || String(e.tool) === TOOL || ran.deny !== undefined) return ran
    const isBashDone = String(e.tool) === 'Bash' && ran.isError !== true
    const lines = await linesFor($, isBashDone ? String((e as { command?: unknown }).command ?? '') : null)
    return lines.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...lines] }
  })

  // Any compaction of the main conversation: the agent's note goes to the summarizer
  // (added once, however many places add it), and afterwards the cycle starts over.
  // A subagent's own compaction, and one computed ahead of time, are none of this
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    const instructions = withNote(e.instructions, (await read($, agentTimed)).note)
    const done = await next(instructions === e.instructions ? e : { ...e, instructions })
    if (done.skip === undefined) await afterCompaction($)
    return done
  })
```

- [ ] **Step 13: In the `turn.start` hook: a row told at the last turn's end counts from here**

In `hooks/register.tsx`, replace:

```tsx
  on('turn.start', async ($, e, next) => {
    isBusy = true
```

with:

```tsx
  on('turn.start', async ($, e, next) => {
    isBusy = true
    // told at the end of the last turn: this turn is the agent's chance to hold
    if ((await read($, agentTimed)).told === 'next') await update($, agentTimed, s => ({ ...s, told: 'yes' as const }))
```

- [ ] **Step 14: In the `turn.complete` hook: an interrupted turn drops the agent's request**

In `hooks/register.tsx`, replace:

```tsx
    // the turn is over: auto compact may fire now, never mid-reply
    isBusy = false
```

with:

```tsx
    // the turn is over: auto compact may fire now, never mid-reply
    isBusy = false
    // interrupted or failed: what the agent asked for at this turn's end no longer stands
    if (e.reason !== 'answer') await dropAsked($)
```

- [ ] **Step 15: Check nothing of the old names is left**

Run: `grep -n "isStuck" hooks/register.tsx`
Expected: no output.

- [ ] **Step 16: Run the tests**

Run: `claude plugin test .`
Expected: `60 pass, 1 fail` (the baseline failure only).

- [ ] **Step 17: Validate**

Run: `claude plugin validate .`
Expected: the only errors are the two "reserved" name errors of the baseline. The hooks line now starts `tool.check{tool=mcp__claude-code-usage-quota__compaction}, tool.call{tool=mcp__claude-code-usage-quota__compaction}, tool.call, session.compact, session.start, …`; the calls line includes `$.agent.list (via hasRunningAgents)`, `$.session.append (via tell)` and `$.tool.register (via ensureTool)`; state writes include `claude-code-usage-quota.agentTimed`.

- [ ] **Step 18: Commit**

```bash
git add hooks/register.tsx tests/agent-timed.test.tsx
git commit -m "Agent-timed: the agent holds, releases or asks for compaction between a start % and the cap"
```

---

### Task 6: The band

The second switch and its % field, the hold row with **Compact now** and **Release**, and the "Compacting when this turn ends" row (§7).

**Files:**
- Modify: `hooks/register.tsx`
- Test: `tests/agent-timed.test.tsx` (append)

**Interfaces:**
- Consumes: Task 5's `agentTimed`, `ensureTool`, `watchAuto`, `stuck`; Task 4's `REASON_SHOWN`, `START_DEFAULT`, `START_MIN`, `capOf`, `isTimed`, `startOf`.
- Produces: atoms `startTick`, `startText`; `type FieldName = 'at' | 'startAt'`; `typedAt($, name, raw)`, `commitDraft($, only?)`, `commitAt($, name, value)`, `setThreshold($, at)`, `askIfPast($, at, armed?)`, `setAuto($, isOn)`, `setTimed($, isAgentTimed)`, `endHold($, isCompactNow)`; element keys `timed`, `startAt<tick>`, `holdCompact`, `holdRelease`.

The switch's press area is a Button whose label is three em spaces (U+2003). Write it as `'\u2003\u2003\u2003'`, as below, so it cannot turn into plain spaces.

- [ ] **Step 1: Append the failing tests**

Append to `tests/agent-timed.test.tsx`:

```tsx
// the band, on both surfaces it draws on
const SURFACES = ['terminal', 'desktop'] as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }

const startKey = async (ui: { findAll: (q: { type: 'Input' }) => Promise<{ props: { key?: string; value?: string } }[]> }) =>
  (await ui.findAll({ type: 'Input' })).find(i => String(i.props.key).startsWith('startAt'))
const capKey = async (ui: { findAll: (q: { type: 'Input' }) => Promise<{ props: { key?: string; value?: string } }[]> }) =>
  (await ui.findAll({ type: 'Input' })).find(i => String(i.props.key).startsWith('autoAt'))

for (const surface of SURFACES) {
  test(`the band (${surface}): Agent-timed shows beside auto compact, with its own % field kept between 10 and one below the cap`, async ($, on) => {
    const percent = { value: 16 }
    const { seen } = world(on, percent, null)
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface, component: 'AbovePrompt', props: PROPS })
    // auto compact off: no sign of it
    expect(await ui.find({ type: 'Text', text: /^Agent-timed/ })).toBeUndefined()
    await ui.press({ key: 'auto' })
    expect(await ui.find({ type: 'Text', text: 'Agent-timed' })).toBeDefined()
    expect(await startKey(ui)).toBeUndefined()
    expect(seen.registered).toEqual([])

    await ui.press({ key: 'timed' })
    expect(await ui.find({ type: 'Text', text: 'Agent-timed from' })).toBeDefined()
    expect((await startKey(ui))?.props.value).toBe('30')
    expect(seen.registered).toEqual(['compaction'])
    expect(seen.toasts).toContain('Agent-timed from 30% to 80% context')

    for (const [typed, shown] of [['5', '10'], ['95', '79'], ['80', '79'], ['', '30'], ['45', '45']]) {
      await ui.input({ key: String((await startKey(ui))?.props.key), text: typed })
      expect((await startKey(ui))?.props.value).toBe(shown)
    }
    expect(seen.toasts).toContain('Agent-timed: the least is 10% – set to 10%')
    expect(seen.toasts).toContain('Agent-timed starts below your 80% – set to 79%')

    // a cap set at or under the start % pulls it down
    await ui.input({ key: String((await capKey(ui))?.props.key), text: '40' })
    expect((await capKey(ui))?.props.value).toBe('40')
    expect((await startKey(ui))?.props.value).toBe('39')
    expect(seen.toasts).toContain('Agent-timed now starts at 39%, below your 40%')

    await ui.press({ key: 'timed' })
    expect(await startKey(ui)).toBeUndefined()
    expect(seen.toasts).toContain('Agent-timed off')
    await ui.unmount()
  })
}

test('the band: where the tool cannot be registered, Agent-timed says so and stays off', async ($, on) => {
  const percent = { value: 16 }
  const { seen } = world(on, percent, { isOn: true, at: 80 })
  seen.canRegister = false
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'timed' })
  expect(seen.toasts).toContain('Agent-timed could not start: its tool could not be registered')
  expect(await ui.find({ type: 'Svg', alt: 'Agent-timed off' })).toBeDefined()
  expect(await startKey(ui)).toBeUndefined()
  await ui.unmount()
})

test('the band: switched on past the start %, it asks first', async ($, on) => {
  const percent = { value: 45 }
  const { clock, seen } = world(on, percent, { isOn: true, at: 80 })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'timed' })
  expect(await ui.find({ type: 'Text', text: 'Context is already at 45%, past 30%. Auto compact:' })).toBeDefined()
  await $.turn.start(GO)
  await end($, clock)
  expect(seen.compacted).toEqual([])
  await ui.press({ key: 'askNow' })
  await clock.advance(1_100)
  expect(seen.compacted).toEqual([undefined])
  await ui.unmount()
})

test('the band: the hold shows with who, how long and why; Release and Compact now end it', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await into($, clock, percent, 35)
  await bash($)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  expect(await ui.find({ type: 'Text', text: 'Held by Claude 0m: mid-refactor of auth' })).toBeDefined()
  await end($, clock)
  await clock.advance(120_000)
  expect(await ui.find({ type: 'Text', text: 'Held by Claude 2m: mid-refactor of auth' })).toBeDefined()
  expect(seen.compacted).toEqual([])

  // Release: the hold goes, and the rule decides (idle and told: it compacts)
  await ui.press({ key: 'holdRelease' })
  expect(await ui.find({ type: 'Text', text: /^Held by Claude/ })).toBeUndefined()
  await clock.advance(1_100)
  expect(seen.compacted).toEqual([undefined])

  // Compact now, mid-turn: it waits for the turn's end, and says so
  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'x'.repeat(200) })
  expect((await ui.find({ type: 'Text', text: /^Held by Claude/ }))?.text).toBe(`Held by Claude 0m: ${'x'.repeat(79)}…`)
  await ui.press({ key: 'holdCompact' })
  expect(await ui.find({ type: 'Text', text: 'Compacting when this turn ends' })).toBeDefined()
  expect(seen.compacted).toHaveLength(1)
  await end($, clock)
  expect(seen.compacted).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'Compacting when this turn ends' })).toBeUndefined()
  await ui.unmount()
})

test('the band: the cap lowered under the context while the agent holds asks about the cap; "Now" compacts and ends the hold', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  await into($, clock, percent, 50)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  await end($, clock)
  await ui.input({ key: String((await capKey(ui))?.props.key), text: '45' })
  expect(await ui.find({ type: 'Text', text: 'Context is already at 50%, past 45%. Auto compact:' })).toBeDefined()
  expect(seen.compacted).toEqual([])
  await ui.press({ key: 'askNow' })
  await clock.advance(1_100)
  expect(seen.compacted).toEqual([undefined])
  expect(await ui.find({ type: 'Text', text: /^Held by Claude/ })).toBeUndefined()
  await ui.unmount()
})

test('the band: Agent-timed switched off while the agent holds: the hold goes and has no say', async ($, on) => {
  const percent = { value: 20 }
  const { clock, seen } = world(on, percent)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  await end($, clock)
  await ui.press({ key: 'timed' })
  expect(await ui.find({ type: 'Text', text: /^Held by Claude/ })).toBeUndefined()
  expect(await tool($, { action: 'status' })).toBe('Agent-timed compaction is off in this chat. Nothing changed.')
  // plain auto compact from here: nothing at 35%, the cap at 80%
  await $.turn.start(GO)
  await end($, clock)
  expect(seen.compacted).toEqual([])
  await into($, clock, percent, 81)
  await end($, clock)
  expect(seen.compacted).toEqual([undefined])
  await ui.unmount()
})

test('the band: a narrow chat keeps every control, wrapped', async ($, on) => {
  world(on, { value: 16 })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'claude-code-usage-quota', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 40 } })
    expect(await ui.find({ type: 'Text', text: 'Agent-timed from' })).toBeDefined()
    expect((await startKey(ui))?.props.value).toBe('30')
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  }
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test .`
Expected: 7 of the 8 new tests fail (no element has the key `timed`, no hold row); `61 pass, 8 fail`. The eighth, the cap lowered under the context while the agent holds, passes already: it is there to keep that true through this task's rewrite of `setThreshold`.

- [ ] **Step 3: Import the three constants the band needs**

In `hooks/register.tsx`, replace:

```tsx
  AT_DEFAULT, EMPTY, TOOL, TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA,
```

with:

```tsx
  AT_DEFAULT, EMPTY, REASON_SHOWN, START_DEFAULT, START_MIN, TOOL, TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA,
```

- [ ] **Step 4: Add the start % field's atoms, before the `theme` atom**

In `hooks/register.tsx`, replace:

```tsx
const theme = atom(
```

with:

```tsx
// the start % field's own tick and typed text, as fieldTick and fieldText are the cap's
const startTick = atom({ plugin: 'claude-code-usage-quota', key: 'startTick' } as const, 0)
const startText = atom({ plugin: 'claude-code-usage-quota', key: 'startText' } as const, null as string | null)
const theme = atom(
```

- [ ] **Step 5: Remove the cap field's own draft and timer (each field keeps its own from here)**

In `hooks/register.tsx`, replace:

```tsx
const AT_MAX = 99
let draftAt: string | null = null

// no event says a click landed outside the band, so a draft also sets itself once
// typing has rested a while, as if the person had clicked away
const AT_REST_MS = 2_000
let restTimer: { cancel(): void } | null = null
```

with:

```tsx
const AT_MAX = 99

// no event says a click landed outside the band, so a draft also sets itself once
// typing has rested a while, as if the person had clicked away
const AT_REST_MS = 2_000
```

- [ ] **Step 6: Replace the field functions, and add the switches' and the hold row's handlers**

In `hooks/register.tsx`, replace everything from the comment `// what the field shows comes from state, not a module variable` down to, not including, `type AskChoice =` (the functions `redrawField`, `typedAt`, `commitDraft`, `commitAt`, `setThreshold`, `askIfPast`) with:

```tsx
// The two % fields, the cap's and Agent-timed's start: each with its own draft while
// typed in and its rest timer. What a field shows comes from state, not a module
// variable: a press or a typing runs apart from the draw, so a value the draw kept
// would not be seen here
type FieldName = 'at' | 'startAt'
const FIELD_NAMES = ['at', 'startAt'] as const
const fields = {
  at: { draft: null as string | null, timer: null as { cancel(): void } | null },
  startAt: { draft: null as string | null, timer: null as { cancel(): void } | null },
}

// a field's text and tick, each written by its own name (a write names its state outright)
async function setFieldText($: EngineInterface, name: FieldName, next: (drawn: string | null) => string | null): Promise<void> {
  if (name === 'at') await update($, fieldText, next)
  else await update($, startText, next)
}
// a new field (its key changes), so it shows the set value whatever was typed
async function redrawNew($: EngineInterface, name: FieldName): Promise<void> {
  await setFieldText($, name, () => null)
  if (name === 'at') await update($, fieldTick, n => n + 1)
  else await update($, startTick, n => n + 1)
}

async function redrawField($: EngineInterface, name: FieldName, value: string): Promise<void> {
  const auto = await read($, autoCompact)
  const set = name === 'at' ? capOf(auto) : startOf(auto)
  await setFieldText($, name, drawn => (value === (drawn ?? `${set}`) ? value + NO_WIDTH : value))
}

function typedAt($: EngineInterface, name: FieldName, raw: string): void {
  const field = fields[name]
  const value = cleanAt(raw)
  if (value !== raw) void redrawField($, name, value)
  field.draft = value
  field.timer?.cancel()
  field.timer = $.clock.after(AT_REST_MS, () => {
    field.timer = null
    void commitDraft($, name)
  })
}

// sets what was typed and left unset: in one field, or in both
async function commitDraft($: EngineInterface, only?: FieldName): Promise<void> {
  for (const name of only ? [only] : FIELD_NAMES) {
    const { draft } = fields[name]
    if (draft !== null) await commitAt($, name, draft)
  }
}

async function commitAt($: EngineInterface, name: FieldName, value: string): Promise<void> {
  const field = fields[name]
  field.draft = null
  field.timer?.cancel()
  field.timer = null
  const text = cleanAt(value)
  if (name === 'at') {
    // only digits reach here: blank is the default, out of range is pulled in, every time
    const typed = text === '' ? AT_DEFAULT : Number(text)
    const at = Math.min(AT_MAX, Math.max(AT_MIN, typed))
    if (typed !== at) $.ui.toast(`Auto compact: ${typed < at ? 'the least' : 'the most'} is ${at}% – set to ${at}%`)
    await setThreshold($, at)
  } else {
    const auto = await read($, autoCompact)
    const cap = capOf(auto)
    const typed = text === '' ? START_DEFAULT : Number(text)
    const startAt = Math.min(cap - 1, Math.max(START_MIN, typed))
    if (typed < startAt) $.ui.toast(`Agent-timed: the least is ${startAt}% – set to ${startAt}%`)
    if (typed > startAt) $.ui.toast(`Agent-timed starts below your ${cap}% – set to ${startAt}%`)
    await saveAuto($, { ...auto, startAt })
    if (isTimed(auto)) await askIfPast($, startAt, `Agent-timed from ${startAt}% to ${cap}% context`)
  }
  await redrawNew($, name)
}

// a new cap: armed when the context is below it, else the band asks, in its own
// buttons (never the chat's question dialog, which runs through the chat). The start %
// stays below the cap: a cap set at or under it pulls it down
async function setThreshold($: EngineInterface, at: number): Promise<void> {
  const auto = await read($, autoCompact)
  const pulled = Math.min(startOf(auto), at - 1)
  if (isTimed(auto) && pulled !== startOf(auto)) {
    $.ui.toast(`Agent-timed now starts at ${pulled}%, below your ${at}%`)
    await redrawNew($, 'startAt')
  }
  await saveAuto($, { ...auto, isOn: true, at, ...(auto.startAt == null ? {} : { startAt: Math.min(auto.startAt, at - 1) }) })
  await askIfPast($, at)
}

// turning it on, or a new %, while the context is already past it: ask first
// (`armed`: what the toast says when it is not)
async function askIfPast($: EngineInterface, at: number | null, armed = `Auto compact at ${at}% context`): Promise<void> {
  isNewChatsOnly = false
  stuck = 'no'
  const isPast = at !== null && Math.round(lastPercent) >= at
  waitsForCompact = isPast
  await update($, autoAsk, () => (isPast ? { at: at!, percent: Math.round(lastPercent) } : null))
  if (!isPast && at !== null) $.ui.toast(armed)
}

// Auto compact on or off for this chat, read from the state, not a draw's own value
async function setAuto($: EngineInterface, isOn: boolean): Promise<void> {
  const auto = await read($, autoCompact)
  const next = { ...auto, isOn, at: capOf(auto) }
  await saveAuto($, next)
  if (!isOn) {
    await update($, autoAsk, () => null)
    return
  }
  if (isTimed(next)) await ensureTool($)
  await askIfPast($, isTimed(next) ? startOf(next) : next.at)
}

// Agent-timed on or off for this chat. On needs the agent's tool; off, what the agent
// held, noted or asked for has no say any more
async function setTimed($: EngineInterface, isAgentTimed: boolean): Promise<void> {
  const auto = await read($, autoCompact)
  if (isAgentTimed && !(await ensureTool($))) {
    $.ui.toast('Agent-timed could not start: its tool could not be registered')
    return
  }
  const next = { ...auto, isAgentTimed, startAt: startOf(auto) }
  await saveAuto($, next)
  if (isAgentTimed) {
    await askIfPast($, next.startAt, `Agent-timed from ${next.startAt}% to ${capOf(next)}% context`)
    return
  }
  await update($, agentTimed, () => EMPTY)
  await askIfPast($, capOf(next), 'Agent-timed off')
}

// the person ends the agent's hold from the band: compact now, or let the rule decide
async function endHold($: EngineInterface, isCompactNow: boolean): Promise<void> {
  await update($, agentTimed, s => ({ ...s, hold: null, isAsked: isCompactNow || s.isAsked }))
  await watchAuto($, lastPercent)
}
```

- [ ] **Step 7: In the `ui.focus` hook: the focus leaving either field sets what was typed in it**

In `hooks/register.tsx`, replace:

```tsx
    if (!e.element?.startsWith('autoAt')) await commitDraft($)
```

with:

```tsx
    if (!e.element?.startsWith('autoAt')) await commitDraft($, 'at')
    if (!e.element?.startsWith('startAt')) await commitDraft($, 'startAt')
```

- [ ] **Step 8: In the draw: read Agent-timed's state in place of the old closures**

In `hooks/register.tsx`, replace:

```tsx
    const drawnAt = (await read($, fieldText)) ?? `${auto.at ?? AT_DEFAULT}`
    const submitAt = (value: string) => commitAt($, value)
    const toggleAuto = () => {
      const flipped = { isOn: !auto.isOn, at: auto.at ?? AT_DEFAULT }
      void saveAuto($, flipped).then(() =>
        flipped.isOn ? askIfPast($, flipped.at) : update($, autoAsk, () => null),
      )
    }
```

with:

```tsx
    const drawnAt = (await read($, fieldText)) ?? `${auto.at ?? AT_DEFAULT}`
    const timed = isTimed(auto)
    const agent = await read($, agentTimed)
    const startTickNow = await read($, startTick)
    const drawnStart = (await read($, startText)) ?? `${startOf(auto)}`
```

- [ ] **Step 9: The controls are wider with Agent-timed in them**

In `hooks/register.tsx`, replace:

```tsx
    const CONTROLS = 40
```

with:

```tsx
    // (the Agent-timed switch and its name add 14 cells, its "from" and field 10 more)
    const CONTROLS = 40 + (auto.isOn ? (timed ? 24 : 14) : 0)
```

- [ ] **Step 10: Work out the hold row's words and whether they fit on one line, after `isAskLine`**

In `hooks/register.tsx`, replace:

```tsx
    const isAskLine = width >= askWords * (Svg ? 0.8 : 1) + ASK_LABELS.length * (Svg ? 3 : 4) + 3
```

with:

```tsx
    const isAskLine = width >= askWords * (Svg ? 0.8 : 1) + ASK_LABELS.length * (Svg ? 3 : 4) + 3
    // the agent's hold, while Agent-timed is on: who holds, how long, why (cut short)
    const held = timed ? agent.hold : null
    const holdWords = held
      ? `Held by Claude ${duration(now - held.since)}: ${held.reason.length > REASON_SHOWN ? `${held.reason.slice(0, REASON_SHOWN - 1)}…` : held.reason}`
      : ''
    const HOLD_LABELS = ['Compact now', 'Release']
    const isHoldLine = width >= (holdWords.length + HOLD_LABELS.join('').length) * (Svg ? 0.8 : 1) + HOLD_LABELS.length * (Svg ? 3 : 4) + 2
```

- [ ] **Step 11: Replace the controls**

In `hooks/register.tsx`, replace the whole `const controls = ( … )` (down to, not including, `const gap = Svg ? 0.5 : 1`) with:

```tsx
    // an iOS-style switch on the desktop, a dot on the terminal; `key` names its press
    const switchOf = (key: string, name: string, isOn: boolean, onPress: () => void) =>
      Svg ? (
        <Box key={`${key}Switch`} width={SWITCH_CELLS} height={1} overflow="hidden">
          {/* three layers, each the box's full size, so all share one centre: the
              rounded light (unlit: an invisible border), the pill, the press */}
          <Box position="absolute" top={0} left={0} width={SWITCH_CELLS} height={1} borderStyle="round" borderColor={CLEAR} hover={{ backgroundColor: SWITCH_LIT, borderColor: SWITCH_LIT }} />
          <Box position="absolute" top={0} left={0} width={SWITCH_CELLS} height={1} alignItems="center" justifyContent="center">
            <Svg alt={`${name} ${isOn ? 'on' : 'off'}`} source={switchSvg(isOn)} width={SWITCH_W} height={SWITCH_H} />
          </Box>
          {/* a chromeless button over all of it takes the click: three em spaces wide */}
          <Box position="absolute" top={0} left={0}>
            <Button key={key} label={'   '} plain hover={{ backgroundColor: CLEAR }} onPress={onPress} />
          </Box>
        </Box>
      ) : (
        <Button key={key} label={isOn ? '●' : '○'} plain onPress={onPress} />
      )
    // a % field (3 digits) that sets itself once typing pauses; a plain % right after it
    const fieldOf = (name: FieldName, key: string, drawn: string) => (
      <Box flexDirection="row" alignItems="center">
        {/* the field's Enter chip can't be turned off: the field is drawn wider than
            its box and the box clips the chip away */}
        <Box width={4} overflow="hidden">
          <Box width={6} flexShrink={0}>
            <Input
              key={key}
              value={drawn}
              submitLabel={NO_WIDTH}
              onInput={value => typedAt($, name, value)}
              onSubmit={value => commitAt($, name, value)}
            />
          </Box>
        </Box>
        <Text color={MUTED}>%</Text>
      </Box>
    )
    const controls = (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0} flexWrap="wrap">
        {/* auto compact: the switch (the press), its name, the % field beside it */}
        {switchOf('auto', 'Auto compact', auto.isOn, () => void setAuto($, !auto.isOn))}
        <Text color={auto.isOn ? undefined : MUTED}>Auto compact</Text>
        {auto.isOn ? (
          fieldOf('at', `autoAt${tick}`, drawnAt)
        ) : Svg ? (
          // off: the field's room is kept, unseen, so the switch sits at the very same
          // spot and draws pixel for pixel as when on
          <Box flexDirection="row" alignItems="center">
            <Box width={4} />
            <Text color={CLEAR}>%</Text>
          </Box>
        ) : null}
        {/* Agent-timed, a mode of auto compact: its switch, and where it starts */}
        {auto.isOn ? switchOf('timed', 'Agent-timed', timed, () => void setTimed($, !timed)) : null}
        {auto.isOn ? <Text color={timed ? undefined : MUTED}>{timed ? 'Agent-timed from' : 'Agent-timed'}</Text> : null}
        {timed ? fieldOf('startAt', `startAt${startTickNow}`, drawnStart) : null}
        {/* a wide gap, so the fields read as the switches', not Compact's */}
        <Box key="compactBox" marginLeft={isHeadBeside ? 2 : 0}>
          <Button key="compact" label="Compact" hover={{ backgroundColor: COMPACT_LIT }} onPress={() => compactNow($)} />
        </Box>
        <Button
          key="collapse"
          label={collapsed ? '▲' : '▼'}
          plain
          onPress={async () => {
            // from the state, not this closure's value (an older draw's); saved for
            // the other chats first, so the half-second read never undoes the press
            const now = !(await read($, isCollapsed))
            await storeSet($, 'collapsed', now)
            await update($, isCollapsed, () => now)
          }}
        />
      </Box>
    )
```

- [ ] **Step 12: Build the hold row, just before the draw's final `return (`**

In `hooks/register.tsx`, replace:

```tsx
    return (
      <Box flexDirection="column">
        {isHeadBeside ? (
```

with:

```tsx
    const holdText = held ? <Text color={AMBER} wrap="wrap">{holdWords}</Text> : null
    const holdButtons = (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap" flexShrink={0}>
        <Button key="holdCompact" label="Compact now" onPress={() => void endHold($, true)} />
        <Button key="holdRelease" label="Release" onPress={() => void endHold($, false)} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {isHeadBeside ? (
```

- [ ] **Step 13: Draw the hold row and the asked row above the bars, after the question row**

In `hooks/register.tsx`, replace:

```tsx
        {collapsed ? (
          collapsedBlock
        ) : isSplit ? (
```

with:

```tsx
        {holdText ? (
          isHoldLine ? (
            <Box flexDirection="row" alignItems="center" columnGap={1} marginBottom={gap}>
              <Box flexShrink={1}>{holdText}</Box>
              {holdButtons}
            </Box>
          ) : (
            <Box flexDirection="column" marginBottom={gap}>
              {holdText}
              <Box marginTop={gap}>{holdButtons}</Box>
            </Box>
          )
        ) : null}
        {timed && agent.isAsked ? (
          <Box marginBottom={gap}>
            <Text color={MUTED}>Compacting when this turn ends</Text>
          </Box>
        ) : null}

        {collapsed ? (
          collapsedBlock
        ) : isSplit ? (
```

- [ ] **Step 14: Check nothing of the old names is left**

Run: `grep -n "draftAt\|restTimer\|submitAt\|toggleAuto" hooks/register.tsx`
Expected: no output.

- [ ] **Step 15: Run the tests**

Run: `claude plugin test .`
Expected: `68 pass, 1 fail` (the baseline failure only).

- [ ] **Step 16: Validate**

Run: `claude plugin validate .`
Expected: the only errors are the two "reserved" name errors of the baseline; state reads and writes now include `claude-code-usage-quota.startText` and `claude-code-usage-quota.startTick`.

- [ ] **Step 17: Commit**

```bash
git add hooks/register.tsx tests/agent-timed.test.tsx
git commit -m "Agent-timed: its switch and start % in the band, and the agent's hold with Compact now and Release"
```

---

### Task 7: Docs, and seeing it live

**Files:**
- Create: `docs/badges/auto-compact-v3.svg`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-06-agent-timed-verification.md`

**Interfaces:**
- Consumes: the finished mod.
- Produces: nothing for other tasks.

- [ ] **Step 1: The badge for the new default**

Create `docs/badges/auto-compact-v3.svg` (the v2 file with `30%` made `80%`, twice in the labels and once in the text; leave v2 in place, older READMEs link to it):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="171" height="20" role="img" aria-label="Auto compact: 80% default"><title>Auto compact: 80% default</title><g shape-rendering="crispEdges"><rect width="90" height="20" fill="#555"/><rect x="90" width="81" height="20" fill="#4ade80"/></g><g text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="45.0" y="14" fill="#fff">Auto compact</text><text x="130.5" y="14" fill="#000">80% default</text></g></svg>
```

In `README.md` line 3, replace `![Auto compact: 30% default](docs/badges/auto-compact-v2.svg)` with `![Auto compact: 80% default](docs/badges/auto-compact-v3.svg)`.

- [ ] **Step 2: The tip block**

In `README.md`, replace the whole `> [!TIP]` block (from `> [!TIP]` to its last line, `> - **Everyday sessions?** …`) with:

```markdown
> [!TIP]
> **Never hit a full context again: Auto compact, on by one click.**
> With Auto compact on, the band compacts your session once the context reaches **80%** (the default; set **15 to 99**). Set it lower to compact sooner: a long context costs more on every reply, so compacting early keeps replies **cheaper** and your limits **lasting longer**. Auto compact never interrupts a reply. Want to compact right now? The **Compact** button runs `/compact` in one click.
>
> **Let Claude pick the moment: Agent-timed.** Switch on **Agent-timed** beside Auto compact and compaction starts sooner (from **30%** by default) but at a good moment: Claude can hold it through a debugging chain or a refactor, release it at a safe point, and leave itself a note that survives. Your Auto compact % stays the limit no hold can pass.
>
> **Each session keeps its own settings**, even after a restart, so you can run them differently side by side:
> - **Building something big?** Leave Auto compact at 80% or turn it off, so Claude keeps the whole picture. Press **Compact** yourself at a good stopping point. (With it off, Claude Code's built-in compaction still steps in when the context is nearly full.)
> - **Everyday sessions?** Set Auto compact lower (say 30%), or switch on Agent-timed. They stay lean, and your 5 Hour and Weekly limits last longer.
```

- [ ] **Step 3: The Compacting section**

In `README.md`, under `**Compacting**`, replace the line `- **Auto compact** runs at your % (30% by default, 15 to 99), never mid-reply. Each session keeps its own setting; a new session starts with it off.` with:

```markdown
- **Auto compact** runs at your % (80% by default, 15 to 99), never mid-reply. Each session keeps its own setting; a new session starts with it off.
- **Agent-timed** (optional, beside Auto compact) lets Claude choose the moment below that %. See [Agent-timed](#agent-timed).
```

Then add this section right before `## Where it works`:

```markdown
## Agent-timed

Auto compact fires at a fixed %, whatever Claude is doing. A compaction that lands mid-debugging throws away the context that mattered. With **Agent-timed** on, Claude chooses the moment, between two numbers you set:

- From the **start %** (30% by default, its own box in the band) the session is compacted when a turn ends, unless Claude holds it.
- At your **Auto compact %** it is compacted when the turn ends, whatever Claude holds. No hold passes it.

What Claude can do, through a small `compaction` tool the mod gives it:

- **Hold** compaction through fragile work, with a reason.
- **Release** it at a safe point, or **ask to compact** when the turn ends.
- Leave a **handoff note**. It goes to the summarizer and comes back to Claude after the compaction, once.

What you see and keep:

- While Claude holds, the band says so: *Held by Claude 12m: mid-refactor of auth*, with **Compact now** and **Release** to overrule it.
- Claude is told when the context passes the start %, so a compaction never comes unannounced.
- While subagents Claude is waiting on are still running, compaction waits for them, up to your Auto compact %.
- Only the main agent can hold. Subagents cannot.

Agent-timed is off until you switch it on, and each session keeps its own setting. Switching it on adds the tool to that session; switched off again, the tool stays listed until the session is reopened, and answers that the mode is off.
```

- [ ] **Step 4: Credit compactor**

In `README.md`, under `## Credits`, add after the existing paragraph:

```markdown
Agent-timed is inspired by [compactor](https://github.com/rhwendt/compactor) by rhwendt (MIT), which lets the agent hold and release Claude Code's own auto-compaction.
```

- [ ] **Step 5: Type-check, if the engine's types can be laid**

Run: `claude -p --plugin-dir . "Reply with OK."` (loading the mod from its folder lays `.claude-plugin/types/`, which is git-ignored), then `npx -y -p typescript@5 tsc -p . --noEmit`.
Expected: no errors in `hooks/` or `tests/`. If `.claude-plugin/types/tsconfig.json` was not laid, say so in the hand-off and skip; do not hand-write a tsconfig into the repo.

A type error in code this plan gave is fixed where it stands with the smallest change that keeps the tests passing (a cast at the call, as the file already does with `as never` in tests), never by loosening a type in `types/index.d.ts`.

- [ ] **Step 6: Run everything once more**

Run: `claude plugin test .`
Expected: `68 pass, 1 fail` (the baseline failure only).

Run: `claude plugin validate .`
Expected: only the two baseline "reserved" name errors.

- [ ] **Step 7: Hand the maintainer the live checklist**

The test kit proves the hooks; only a real session proves the feature. Give the maintainer this, and add what they report to `docs/superpowers/specs/2026-10-06-agent-timed-verification.md` under "The finished mod":

```text
In a terminal, from the repo:  claude --debug --plugin-dir .
1. In the band: switch Auto compact on (it shows 80), then Agent-timed on (it shows "from 30 %").
   Set the start % to 10.
2. Send: Call the compaction tool with action status and tell me what it says.
   -> the answer names the hold, the note and the three context figures. No permission prompt.
3. Send: Call the compaction tool with action hold and reason "smoke test". Then read two large files.
   -> the band shows "Held by Claude 0m: smoke test" with Compact now and Release.
   -> the session is not compacted when the turn ends, though the context is past 10%.
4. Send: Call the compaction tool with action release and note "the smoke note".
   -> when the turn ends: a toast "Context at N%: auto compacting (Agent-timed from 10%)", then the compaction.
5. Send: What handoff note did you leave before the compaction?
   -> Claude quotes "the smoke note".
6. Hold again, then press Release in the band while idle -> it compacts at once.
7. The same in the desktop app's Code tab (add "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<repo path>" } to
   ~/.claude/settings.json, quit and reopen the app; remove it afterwards).
```

- [ ] **Step 8: Commit**

```bash
git add README.md docs/badges/auto-compact-v3.svg docs/superpowers/specs/2026-10-06-agent-timed-verification.md
git commit -m "README: Auto compact defaults to 80%, and Agent-timed"
```

- [ ] **Step 9: Say what is left to the maintainer**

Report, and do none of it: the screenshots still show 30% and no Agent-timed controls; the version is unchanged (a feature release, 0.2.0, in `plugin.json`, `marketplace.json` and the version badge, on their word); the baseline test `says when a limit is reached` still fails; `claude plugin validate` still refuses the plugin's name.
