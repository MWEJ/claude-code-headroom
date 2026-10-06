# Agent-timed Auto compact: live verification

What the spike of the design spec's §12 showed, item by item, before any feature code was
written. The spike is a throwaway mod (`agent-timed-spike`, three files: `plugin.json`,
`hooks/hooks.json`, `hooks/register.ts`), exactly as the plan's Task 1 gives it, placed in a
scratch folder outside the repo. Nothing from it ships.

- **Claude Code version:** `claude --version` → `2.1.291 (Claude Code)`
- **Where:** a headless cloud session (Linux), `claude -p --plugin-dir <SPIKE>`, with the repo
  root as the working directory
- **Date:** 2026-10-06

`claude plugin validate <SPIKE>` listed the hooks `session.start`,
`tool.check{tool=mcp__agent-timed-spike__compaction}`,
`tool.call{tool=mcp__agent-timed-spike__compaction}`, `tool.call`, `session.compact`, four
"gating hook without .catch" notes, and `Validation passed with warnings` (the one warning:
no author).

A note on the command line: `--allowedTools` takes every following word as a tool name, so the
prompt must come before it (`claude -p "<prompt>" --plugin-dir <SPIKE> --allowedTools Bash`).
The plan's step 4 and 5 commands, with the prompt after the flag, fail with
`Input must be provided either through stdin or as a prompt argument when using --print`.

## Item 1: a registered tool is callable, with no permission prompt

Terminal half.

Command:

```
claude -p --plugin-dir <SPIKE> "Call the tool mcp__agent-timed-spike__compaction with action hold. Reply with exactly what it returned and nothing else."
```

Output seen:

```
SPIKE-TOOL-4410 action=hold loop=main
```

The reply carries the tool's exact answer; no permission prompt stopped a headless session,
which would otherwise have refused the call. **Pass** (terminal).

Desktop half: **open**. It needs the desktop app, which a cloud session has not. The
maintainer's check is item 4 of the checklist below.

## Item 2: `context` on a tool result reaches the model

Command:

```
claude -p "Run the bash command: echo hi. Then reply with any SPIKE code you were shown, or NONE." --plugin-dir <SPIKE> --allowedTools Bash
```

Output seen:

```
The command printed `hi`.

The SPIKE code I was shown is `SPIKE-CONTEXT-7391`.
```

**Pass.**

## Item 3: a row appended with `$.session.append` after a compaction is read next turn

**Open.** A headless session cannot compact, so this needs the maintainer in an interactive
session (checklist below, item 3). The plan's fallback if it fails: add the row to the
`messages` the `session.compact` hook hands up, or deliver it as `context` on the first main
tool result after the compaction.

## Item 4: instructions added by a `session.compact` hook reach the summarizer

**Open.** As item 3: it needs a real compaction (checklist below, item 3). The plan's fallback
if it fails: pass the note only on the mod's own direct compaction, and say so in the README.

## Item 5: `$.agent.list()` while a subagent runs

Command:

```
claude -p "Use the Agent tool to start one general-purpose subagent whose whole task is to run the bash command: sleep 10; echo done. Wait for it and reply DONE." --plugin-dir <SPIKE> --allowedTools Bash Agent
```

Output seen (the reply):

```
DONE

The subagent ran `sleep 10; echo done` and it printed `done`.
```

`<SPIKE>/agents.json`, written by the mod four seconds after the Agent call:

```json
[
  {
    "id": "aaf84ebc3183750b2",
    "description": "Run sleep command",
    "type": "general-purpose",
    "status": "running"
  }
]
```

The status word is `running`, one of the three §3.1 rule 7 reads. **Pass.**

## The maintainer's interactive checklist (items 3 and 4, and the desktop half of item 1)

Not yet run. Set `SPIKE` to a folder holding the plan's Task 1 spike mod.

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

## What the test kit does (probed on Claude Code 2.1.291)

Facts the plan's code and tests rely on, carried over from the plan:

- `$` is followed only into a function declared in the hooks module's own file. Passing `$` to
  an imported function, or through an object, stops the module loading. Pure helpers that take
  no `$` may be imported.
- `read($, x)` and `update($, x, fn)` take an atom named outright (a `const` of the file made
  by `atom(...)`). `update($, table[key].text, fn)` stops the module loading.
- A test file may import a plugin file: `import { decide } from '../hooks/agent-policy'`.
- `$.tool.call({ tool, …args, agentId })` from a test reaches the plugin's `tool.call` hooks
  with `agentId` intact, and resolves to what the hook answered, `context` included.
- `$.tool.check({ tool, input })` resolves to the plugin's `{ decision }`.
- `$.session.compact(args)` from a test runs the plugin's `session.compact` hook only when
  `args` carries `messages` (a list); without it the hook's `next` is refused and the hook is
  skipped.
- The plugin's own `$.session.compact()` made from a timer goes straight to the test's hook;
  the test reads `e.instructions` there. A compaction that stands must answer at least one
  message.
- A row the plugin appends with `$.session.append` reaches no test hook and the call rejects
  (`no implementation for session.append`). So rows are asserted through the debug-log line
  `tell` writes (hook `ui.log`), and their texts as pure functions.
- Operations are answered as `on('<noun>.<method>', () => ({ value }))`: `tool.register`,
  `agent.list`, `session.usage`, `command.register`.

## Baseline in this environment

`claude plugin test .` on the branch before any change: **34 pass, 0 fail**. The handoff
expected 33 pass, 1 fail (`says when a limit is reached`); that test passed here. It is not
this work's, either way.

## The finished mod

Not yet run: the live checklist of the plan's Task 7, step 7, is the maintainer's.
