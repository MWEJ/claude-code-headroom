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
