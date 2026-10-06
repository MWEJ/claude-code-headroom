# Handoff: implement Agent-timed Auto compact

For a new Claude Code session opened in this repo. You have none of the context of the session that designed this. Everything you need is in the repo:

| File | What it is |
|---|---|
| `docs/superpowers/specs/2026-10-06-agent-timed-auto-compact-design.md` | The approved design. Read it first. |
| `docs/superpowers/plans/2026-10-06-agent-timed-auto-compact.md` | The implementation plan: every edit and every test, as code. |
| this file | How the maintainer wants it carried out. |

## What is being built

An optional, per-chat **Agent-timed** mode for the band's Auto compact. From a start % (default 30) the session is compacted when a turn ends unless the agent holds it; at the Auto compact % (the cap, default raised from 30 to 80) it is compacted whatever the agent holds. The agent gets one tool, `compaction` (hold, release, compact, note, status), and a handoff note that survives the compaction.

## How the maintainer wants it done

**One Opus subagent implements the plan. You, the main session, review its work at the end.** This replaces the sub-skill line at the top of the plan: no per-task reviewers, and you do not implement the tasks yourself.

## Where things stand

- Repo: `/Users/martinjoergensen/code/claude-code-usage-quota-mod`. Remote `origin` is `MWEJ/claude-code-usage-quota-mod` on GitHub, a public fork of `anantraghunath/claude-code-usage-quota-mod`.
- Branch `agent-timed-auto-compact` is pushed and holds only these three documents. **No feature code exists yet.** `main` is untouched and stays that way.
- The plan's code is proven: every code block of Tasks 2 to 6 was applied in order to a scratch copy and run with `claude plugin test` after each task (34, 46, 60 and 68 passing), and the tests caught ten deliberate breaks. That scratch copy is gone; the plan is the source.
- Baseline before any change: `claude plugin test .` gives 33 pass, 1 fail (`says when a limit is reached`, not ours); `claude plugin validate .` fails only on the plugin's reserved name. Neither is this work's to fix.

## Your steps

### 1. Start

Do the plan's Task 0: switch to the branch, record the baseline.

### 2. Run the live spike yourself (plan Task 1)

Do steps 1 to 5 (the throwaway mod and the three headless checks). Then give the maintainer the checklist of step 6 and **wait for their answers to items 3 and 4**: a headless session cannot compact, so only a person can check them. Write the verification file (step 7), act on any failure as step 8 says, commit (step 9).

If the maintainer tells you to go on without waiting, do, and record items 3 and 4 as open in the verification file.

### 3. Dispatch one Opus subagent for Tasks 2 to 7

Use the Agent tool with `model: "opus"` and a general-purpose agent. It starts with no context, so its prompt must carry all of this:

- The repo path and the branch. It works on that branch and never on `main`.
- Read the spec, then the plan, in full before the first edit.
- Implement Tasks 2, 3, 4, 5, 6 and 7 in order, step by step, exactly as written, including each "run to see it fail" step. In Task 7 it does steps 1 to 6 and 8; steps 7 and 9 are yours.
- Commit after each task with the plan's message.
- The plan's code is already proven. If a step's result differs from the "Expected" line, it stops and reports what it saw. It does not improvise a different design.
- The plan's section "What the engine and the test kit do" and the three rules at the top of Task 5 are binding.
- Not to do: bump the version, touch the screenshots, merge, push, open a PR, or fix the baseline test or the plugin's name.
- Its final report: per task, the commit hash and the pass/fail counts it saw; every place it departed from the plan and why; anything it could not do.

### 4. Review the whole branch yourself

When the subagent reports, do not take its word. Check:

1. `claude plugin test .` gives **68 pass, 1 fail** (the baseline failure only), and `claude plugin validate .` shows only the two baseline "reserved" name errors.
2. Read `git diff main...agent-timed-auto-compact` in full.
3. The code matches the plan's code. Every departure the subagent reported is justified; any it did not report is a finding.
4. The spec, section by section: can you point to the code and the test for each requirement of §3 to §10?
5. The plan's five Review Focus items each have their test, and the test would fail if the behaviour broke.
6. Nothing outside the scope changed: no version bump, no screenshot, nothing on `main`.
7. The README reads correctly for someone who has never seen the feature.

Send findings back to the same subagent to fix (SendMessage), then check again. Fix nothing silently yourself beyond a typo.

### 5. See it live (plan Task 7, step 7)

Give the maintainer the live checklist, and add what they report to the verification file. Commit that.

### 6. Finish

Push the branch to `origin`. Report to the maintainer: what was built, the test and validate results you saw yourself, what the live checks showed, and what is left to them (plan Task 7, step 9: screenshots, the 0.2.0 version, the baseline test, the plugin's name). Do not merge and do not open a pull request unless they ask.

## What will bite

- **`$` goes only into functions declared in `hooks/register.tsx`.** Passing it to an imported function, or through an object, stops the module loading. That is why all engine code is in that one file and only `hooks/agent-policy.ts` is separate.
- **`read` and `update` take an atom named outright**, never `table[key]`.
- **`hooks/register.tsx` holds invisible characters**: `NO_WIDTH` is U+200B, `NB` is U+00A0, and the desktop switch's Button label is three em spaces (U+2003). Edit around them with exact-string edits; never retype those lines. The plan writes the label as `'   '` for this reason.
- **A test cannot see a row the mod appends** (`$.session.append`). Rows are asserted through the debug-log line `tell` writes, so the tests hook `ui.log`.
- **A test's `$.session.compact` reaches the mod's hook only when it carries `messages`.**
- **A headless session (`claude -p`) cannot compact.** Anything about a real compaction needs the maintainer in an interactive session.
- The suite takes about two seconds. Run it after every task.
