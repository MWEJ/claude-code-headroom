# Agent-timed Auto compact: design spec

- **Date:** 2026-10-06
- **Status:** draft for review
- **Inspired by:** [compactor](https://github.com/rhwendt/compactor) (MIT), which lets the agent
  hold and release Claude Code's auto-compaction. This is a reimplementation of its ideas on
  the mod API, not a port of its code.

## 1. Goal

Auto compact fires at a fixed context %, whatever the agent is doing. A compaction that lands
mid-debugging or mid-refactor throws away the context that mattered.

**Agent-timed** is an optional mode of Auto compact, per chat, off by default. With it on, the
agent chooses the moment inside a band of context usage the person sets:

- From the **start %** (new, default 30) compaction is wanted: it runs when a turn ends, unless
  the agent holds it.
- At the **cap** (the existing Auto compact %, default raised from 30 to 80) compaction runs
  when the turn ends whatever the agent says. No hold survives the cap.

The agent can also ask for a compaction itself and leave a **handoff note** that survives it.

### What changes for everyone

- Auto compact's default % goes from **30 to 80** for chats that never had a setting. A chat
  with a saved % keeps it.
- A subagent finishing no longer counts as the main turn ending (bug fix, §9).

### Out of scope

- Vetoing Claude Code's built-in compaction. The cap sits below it in normal use, and it stays
  the backstop inside one long turn.
- Compacting mid-reply. Auto compact acts between turns only, as today.
- Holds or notes for subagents; holds or notes that outlive the session (an app restart).
- compactor's file tails on notes, its background-task list after compaction, its status line.
- Unregistering the tool (the API has no call for it, §4).

## 2. Terms

| Term | Meaning |
|---|---|
| cap | `autoCompact.at`: 15 to 99, default **80** |
| start % | `autoCompact.startAt`: 10 to cap − 1, default 30 |
| zone | start % ≤ context < cap, with Agent-timed on |
| hold | the agent's request to defer compaction in the zone: a reason and when it was set |
| note | the agent's handoff note, at most 4,000 characters, used by one compaction |
| asked | the agent called `compact`: compaction runs when this turn ends |
| cycle | the stretch between two compactions of the main conversation |
| told | whether the agent has been told, this cycle, that it is in the zone: `no`, `next`, `yes` |

The context % is compared rounded, as the band shows it, as today.

## 3. When it compacts

Auto compact still acts only while the chat is idle (no main turn running, no compaction under
way): at the end of a main turn and on the refreshes between turns.

### 3.1 The decision

`decide(input)` is a pure function. The first rule that applies decides.

| # | Condition | Result |
|---|---|---|
| 1 | asked | compact (`asked`) |
| 2 | paused: the band is asking, "After my next compact", or "Only in new chats" | wait |
| 3 | context ≥ cap | compact (`cap`), unless stuck at the cap; a hold, if set, ends |
| 4 | Agent-timed off, or context < start % | wait |
| 5 | stuck (at the start % or the cap) | wait |
| 6 | a hold is set | wait (`held`) |
| 7 | a subagent of this session is `pending`, `running` or `waiting` | wait (`agents`) |
| 8 | told is `no` | tell (§5.1), then wait |
| 9 | told is `next` | wait |
| 10 | otherwise | compact (`start`) |

Rule 1 passes the pauses: an agent's request is as deliberate as the Compact button.

**Stuck** is today's guard against compacting in a loop, now kept per threshold. After a
compaction the context is read again: still at or past the cap, it is stuck at the cap; else,
with Agent-timed on and still at or past the start %, stuck at the start. Stuck at the start
never blocks the cap. It eases as the context drops below what it was stuck past.

The band's question (Now / After my next compact / Only in new chats) is asked about the
number just set: the cap when the cap changes, the start % when the start % changes or
Agent-timed is switched on.

Rule 7 reads `$.agent.list()`. If the read fails, no agent counts as running.

### 3.2 A compaction, start to end

1. The note, if any, goes to the summarizer as instructions (§6).
2. The compaction runs through the existing `autoCompactNow` path (direct, or typed `/compact`
   where the session cannot compact directly).
3. Afterwards the cycle resets: hold cleared, asked cleared, told `no`, nudges reset. A row is
   appended for the agent when there is something to say (§6).

Every compaction of the main conversation resets the cycle, whoever started it: this mod, the
Compact button, a typed `/compact`, Claude Code's own. Three places notice one, and the reset
runs once: the mod's own direct call resolving, the `session.compact` hook on its way up, and
the band's existing check (the reply total going blank after a reply).

A compaction that was skipped resets nothing but `asked`: the request is spent by the attempt,
so a skip cannot loop. At the cap a hold ends the moment the compaction is started, skipped
or not.

A main turn that ends `aborted` or `error` drops `asked`: the person interrupted, so the
agent's request no longer stands.

### 3.3 Toasts

- Zone: `Context at 34%: auto compacting (Agent-timed from 30%)`
- Cap, no hold: as today, `Context at 80%: auto compacting (set at 80%)`
- Cap, hold overridden: `Context at 80%: Claude's hold ends at your 80%, auto compacting`
- Asked: `Compacting as Claude asked`

## 4. The agent's tool

One tool, registered with `$.tool.register` as `compaction` (the model sees
`mcp__claude-code-usage-quota__compaction`), served by a `tool.call` hook.

```json
{
  "type": "object",
  "properties": {
    "action": { "enum": ["hold", "release", "compact", "note", "status"] },
    "reason": { "type": "string" },
    "note": { "type": "string" }
  },
  "required": ["action"]
}
```

| Action | Effect |
|---|---|
| `hold` | Sets the hold. `reason` is required and non-empty. Holding again replaces the reason and keeps the start time. |
| `release` | Clears the hold. With `note`, also sets the note. |
| `compact` | Sets asked and clears the hold. With `note`, also sets the note. Refused below 10% context: there is nothing worth compacting. |
| `note` | Sets the note; an empty `note` clears it. The hold is untouched. |
| `status` | Changes nothing. |

Every answer is text and ends with the context line:
`Context 41%. Agent-timed compaction starts at 30%; at 80% it runs whatever is held.`

Rules:

- **Main agent only.** A call carrying `agentId` (a subagent, a teammate) is answered with a
  refusal that says the hold and note belong to the main agent. `status` is allowed.
- **No permission prompt.** A `tool.check` hook on the tool answers `{ decision: 'allow' }`.
- **A note over 4,000 characters** is refused with the limit in the answer; nothing is saved.
- **Registered only where the mode is on:** at `session.start` when the chat's saved setting
  has Agent-timed on, and when the switch is turned on. Registering mid-session changes the
  tool list, which costs one prompt-cache miss.
- **Mode off but still listed** (switched off mid-session; the API cannot unregister): every
  action answers `Agent-timed compaction is off in this chat. Nothing changed.`

The description the model reads, in full:

> Controls when this conversation is compacted. Compaction runs when your turn ends once
> context passes the start %. `hold` (with a reason) before fragile multi-step work whose state
> lives only in this conversation; `release` at a safe point; `compact` to compact when this
> turn ends; `note` to save what must survive (current hypothesis, next steps, file:line
> references). At the cap % compaction runs whatever is held.

## 5. What the agent is told

Text for the agent travels two ways: as `context` on the result of a main-agent tool call
(mid-turn), or as a row appended with `$.session.append` (between turns). Subagent tool calls
never carry any of it.

### 5.1 Entering the zone (told)

Once per cycle, when Agent-timed is on and context ≥ start %:

> Agent-timed compaction: context is at 31% (starts at 30%, cap 80%). This conversation will
> be compacted when your turn ends. If you are mid-task, call the compaction tool with
> `hold` and a reason. Otherwise save a `note` of what must survive.

- Mid-turn, on the next main-agent tool result: told becomes `yes`.
- At a turn end with told still `no` (rule 8): appended as a row, told becomes `next`, and
  that turn end does not compact. The next main `turn.start` makes it `yes`.
- If the append fails, told still becomes `next`: compaction comes one turn later either way.

Every row the mod appends is also written to the debug log, with whether the append took.

### 5.2 Nudges while holding

Each once per cycle, on a main-agent tool result, while a hold is set:

| Level | When | Gist |
|---|---|---|
| 2 | context ≥ halfway from start % to cap | "Well past the start. Finish the step, save a note, release." |
| 3 | context ≥ cap − 5 | "The cap is close: at 80% compaction runs when your turn ends. Save a note now." |

Level 3 repeats every 10 main-agent tool calls while it applies.

### 5.3 Breakpoints

Once per hold, while holding in the zone: after a successful Bash call whose command is a
`git commit` (not `--dry-run`) or a test run (`pytest`, `npm|pnpm|yarn|bun test`, `go test`,
`cargo test`, `make test`, `jest`, `vitest`, `rspec`, `mvn test`, `gradle test`):

> A commit just landed: a natural breakpoint. Consider `release` or `compact`, with a note.

## 6. The handoff note

- **To the summarizer.** Appended to the compaction's instructions:
  `The agent left this handoff note. Keep what it says matters:` and the note.
  - The mod's own direct compaction passes it as `$.session.compact({ instructions })`.
  - A `session.compact` hook (no `agentId`, trigger not `precompute`) adds it to
    `e.instructions` on the way down for every other compaction of the main conversation.
    Adding is idempotent, so a compaction that passes both places carries the note once.
- **Back to the agent.** After the compaction a row is appended with `$.session.append`
  (`type: "user"`, which the person does not see as typed):

  > Agent-timed compaction: the conversation was just compacted.
  > Your hold (mid-refactor of auth) ended at the 80% cap.
  > Handoff note you left: …

  The hold line appears only when a hold was overridden at the cap. With no note and no
  overridden hold, nothing is appended.
- **Used once.** The note is cleared when it has been appended. The agent writes a new one
  for the next cycle.

## 7. The band

### 7.1 Controls

While Auto compact is on, the header's controls gain, after the cap's field:

- desktop: a second switch, `Agent-timed`, and when on `from [30] %`
- terminal: `○ Agent-timed`, and when on `● Agent-timed from [30] %`

The controls already wrap; the check for "headline beside controls" uses the controls' real
width (40 cells today, 54 with the switch, 64 with its field).

### 7.2 The two % fields

The draft, rest-timer and redraw code that serves the cap's field today is generalised to a
field keyed `at` or `startAt`; each keeps its own draft, text and tick.

- Cap: 15 to 99, as today. Set at or below the start %, it pulls the start % down to
  cap − 1 with a toast.
- Start %: 10 to cap − 1; outside is pulled in with a toast, as the cap's field does today.
- Turning Agent-timed on, or a new start %, with the context already past it: the band asks
  the existing question (Now / After my next compact / Only in new chats).

### 7.3 Hold and asked rows

Shown expanded and collapsed, above the bars, where the question row sits:

- Holding: `Held by Claude 12m: mid-refactor of auth` (amber, the reason cut to 80
  characters), with **Compact now** and **Release**.
  - **Compact now**: sets asked and clears the hold; it runs at once when idle, else when the
    turn ends.
  - **Release**: clears the hold; §3.1 then decides.
- Asked: `Compacting when this turn ends` (muted).

## 8. State

**Per chat, kept across restarts** (store key `autoCompact:<chat id>`, as today):

```ts
type AutoCompact = { isOn: boolean; at: number | null; isAgentTimed?: boolean; startAt?: number | null }
```

Missing fields read as off and 30.

**Per session** (`$.state`, declared in `types/index.d.ts`):

```ts
type AgentTimed = {
  hold: { reason: string; since: number } | null
  note: string | null
  isAsked: boolean
  told: 'no' | 'next' | 'yes'
  /** the highest nudge level sent this cycle, and main tool calls since */
  nudge: { level: number; calls: number; isBreakpointSaid: boolean }
  /** set when the cap overrode a hold, until the row after compaction says so */
  overridden: { reason: string; percent: number } | null
}
```

A new chat id (a `/clear`) resets it, where `loadAuto` resets the rest today.

## 9. Code

| File | Change |
|---|---|
| `hooks/agent-policy.ts` (new) | Pure, no engine: a chat's settings as they stand, `decide`, nudge levels, breakpoint matching, the tool's answers, every text the agent reads |
| `hooks/register.tsx` | `AT_DEFAULT` 30 → 80; the session state; `watchAuto` asks `decide`; the tool's registration and its `tool.call` and `tool.check` hooks; what rides on tool results; the `session.compact` hook; the after-compaction row; the note on the direct compaction; the second switch and field; the hold and asked rows; the field code generalised |
| `types/index.d.ts` | `AutoCompact` extended; `AgentTimed`; the new state keys |
| `tests/agent-policy.test.ts`, `tests/agent-timed.test.tsx` (new) | §11 |
| `tests/band.test.tsx` | the 80% default; the subagent bug |

Everything that touches the engine stays in `hooks/register.tsx`: the engine follows `$` only
into functions declared in the hooks module's own file (found 2026-10-06, Claude Code 2.1.291),
so only the pure policy can live in a file of its own.

**Bug fix.** `turn.complete` fires for subagent turns too (`e.agentId` set), and today's hook
then marks the main turn as over. Mid-turn that can toast, try to compact, fail, and switch the
session to typed `/compact` for good. The hook returns `next(e)` for any turn with `agentId`.

**Rename.** The module variable `isHeld` ("Only in new chats") becomes `isNewChatsOnly`, so
"held" means the agent's hold everywhere.

## 10. Errors

The mode fails toward plain Auto compact: whatever goes wrong in Agent-timed code, compaction
still happens at the cap.

- A failed `$.agent.list()`: no agent counts as running.
- A failed `$.session.append`: logged to the debug log; told becomes `next` as usual (§5.1);
  the note is still cleared after its compaction (it reached the summarizer).
- A failed tool registration: a toast says Agent-timed could not start, and the switch goes
  back to off.
- A bad tool input (unknown action, missing reason, note too long): the answer says what was
  wrong and what a valid call looks like; nothing changes.

## 11. Tests

`claude plugin test`, each UI test on `terminal` and `desktop`.

- `decide`: one case per rule of §3.1, and the order between them.
- Default: a chat with no setting opens at 80%; a saved 30% stays 30%.
- Zone: told mid-turn, then compacts at the turn's end; a hold defers it; release lets it run.
- Told first: crossing on the final reply appends the row and skips that turn end; the next
  turn's end compacts.
- Cap: a hold is overridden, the toast says so, the row after compaction names the hold.
- Asked: `compact` below the start % compacts at the turn's end; refused below 10%; dropped
  when the turn is aborted.
- Subagents: a running subagent defers the zone, not the cap; a subagent's `turn.complete`
  does not end the main turn; a subagent's `hold` is refused.
- Note: passed as instructions on the direct path and through the `session.compact` hook;
  appended afterwards; cleared; a 4,001-character note refused.
- Nudges: levels 2 and 3 once each, level 3 repeating every 10 calls; a breakpoint said once.
- Fields: the start % clamps to 10 and cap − 1; lowering the cap pulls it down; the question
  is asked when switched on past the start %.
- Mode off: the tool answers that it is off; nothing in §5 is sent.
- Rows: the hold row and its two buttons; the asked row.

## 12. Verified live first

The plan opens with a spike in a throwaway mod, before any feature code. Each item is
documented by the API but untested here; the results go in
`docs/superpowers/specs/2026-10-06-agent-timed-verification.md`. Items 1, 2 and 5 run headless
(`claude -p --plugin-dir`); items 3 and 4 need an interactive session, since a headless one
cannot compact, and the desktop half of item 1 needs the app: the maintainer runs those from a
checklist.

The test kit cannot observe a row a plugin appends (probed 2026-10-06, Claude Code 2.1.291),
so the rows' texts are tested as pure functions, their sending through the debug-log line of
§5.1, and their arrival here.

1. A tool registered with `$.tool.register` is callable by the model in the terminal and in
   the desktop app, and `tool.check` suppresses its permission prompt.
2. `context` returned from a `tool.call` hook reaches the model.
3. A row appended with `$.session.append` right after a compaction is in the conversation the
   next turn reads.
4. Instructions added by a `session.compact` hook reach the summarizer on a typed `/compact`
   and on Claude Code's own compaction, and the hook fires for the typed `/compact` this mod
   runs on the desktop app.
5. `$.agent.list()` reports a running foreground and background subagent as §3.1 rule 5 reads
   them.

If an item fails, this spec is amended before the plan continues.

## 13. Docs and release

- README: the tip and the "Compacting" section rewritten for the 80% default; a new
  "Agent-timed" section (what it does, the two numbers, what the agent can do, the hold row);
  compactor credited under Credits.
- The "Auto compact: 30% default" badge redrawn for 80%.
- The screenshots show 30% and no Agent-timed controls; retaking them needs the app and is
  left to the maintainer.
- Version: a feature release (0.2.0) in `plugin.json`, `marketplace.json` and the version
  badge, as the last step and only on the maintainer's word.
