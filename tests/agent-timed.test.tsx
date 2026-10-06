import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const HOUR = 3_600_000
const TOOL = 'mcp__usage-quota__compaction'
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
    return { value: { tool: `mcp__usage-quota__${e.name}` } }
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
  seen.logs.filter(l => l.startsWith('usage-quota: agent-timed row')).map(l => l.replace(/^[^)]*\): /, ''))

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
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: PROPS })
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
      await ui.input({ key: String((await startKey(ui))?.props.key), text: typed as string })
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
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'timed' })
  expect(seen.toasts).toContain('Agent-timed could not start: its tool could not be registered')
  expect(await ui.find({ type: 'Svg', alt: 'Agent-timed off' } as never)).toBeDefined()
  expect(await startKey(ui)).toBeUndefined()
  await ui.unmount()
})

test('the band: switched on past the start %, it asks first', async ($, on) => {
  const percent = { value: 45 }
  const { clock, seen } = world(on, percent, { isOn: true, at: 80 })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
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
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

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
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

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
  const ui = await $.ui.mount({ plugin: 'usage-quota', surface: 'desktop', component: 'AbovePrompt', props: PROPS })

  await into($, clock, percent, 35)
  await tool($, { action: 'hold', reason: 'mid-refactor of auth' })
  await end($, clock)
  await ui.press({ key: 'timed' })
  expect(await ui.find({ type: 'Text', text: /^Held by Claude/ })).toBeUndefined()
  expect(await tool($, { action: 'status' })).toBe('Agent-timed compaction is off in this chat. Nothing changed.')
  // switched on again, the hold it dropped does not come back; then off once more
  await ui.press({ key: 'timed' })
  expect(await tool($, { action: 'status' })).toStartWith('hold: none\nnote: none')
  await ui.press({ key: 'timed' })
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
    const ui = await $.ui.mount({ plugin: 'usage-quota', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 40 } })
    expect(await ui.find({ type: 'Text', text: 'Agent-timed from' })).toBeDefined()
    expect((await startKey(ui))?.props.value).toBe('30')
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  }
})
