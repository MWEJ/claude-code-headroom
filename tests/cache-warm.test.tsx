import { expect, mock, test } from 'claude-code/testing'
import type { ElementQuery, Engine } from 'claude-code/testing'
import type { ConfigRow, ModelForkResult, ModelUsage, On, SessionRateLimit } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const OPUS = 'claude-opus-5-5'
const START = { cwd: '.', surface: 'desktop', isInteractive: true } as const
const GO = { text: 'go', turnId: 't1' } as never
const ON = { isOn: true, ttl: 'auto' }
const FORK_PROMPT = '[headroom] Automated prompt cache refresh by the headroom plugin, not a message from the user. Reply with the single word ok.'

// the main conversation's last response: a 200k prompt, nearly all read from the cache
const API: ModelUsage = { input_tokens: 0, output_tokens: 300, cache_read_input_tokens: 199_000, cache_creation_input_tokens: 1_000 }
const ZERO: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
// a refresh that read the prefix warm, as cache-warmer's tests have it: $0.043852 at 5m
const WARMED: ModelForkResult = {
  isAnswered: true,
  text: 'ok',
  usage: { input_tokens: 16, output_tokens: 182, cache_read_input_tokens: 199_990, cache_creation_input_tokens: 30 },
}
const EXPIRED: ModelForkResult = {
  isAnswered: true,
  text: 'ok',
  usage: { input_tokens: 16, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 200_000 },
}

const iso = (ms: number) => new Date(NOW + ms).toISOString()
// a subscription's limits: the band reads them off every reply
const plan = (fiveHour: number, weekly = 20): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: fiveHour, resetsAt: iso(3 * HOUR) },
  { kind: 'seven_day', percentUsed: weekly, resetsAt: iso(3 * 24 * HOUR) },
]

type World = {
  env?: Record<string, string>
  config?: ConfigRow[]
  limits?: SessionRateLimit[]
  saved?: unknown
}

// The engine beneath the plugin. `seen` is what reached it: forks and their prompts,
// variables set, toasts, debug-log lines; `api` is the live window's last response (the
// test moves it as responses come), `limits` the plan's figures, `replies` what forks
// answer before WARMED. `stored` is the plugin's store.
function world(on: On, w: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, w.env ?? {})
  const stored = new Map<string, unknown>(w.saved === undefined ? [['warm:chat', ON]] : w.saved === null ? [] : [['warm:chat', w.saved]])
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  const seen = {
    forks: [] as string[],
    replies: [] as ModelForkResult[],
    envSets: [] as [string, string | undefined][],
    toasts: [] as string[],
    logs: [] as string[],
    api: null as ModelUsage | null,
    limits: w.limits ?? ([] as SessionRateLimit[]),
    registered: [] as string[],
    // while set, a fork waits for it: the band can be seen mid-refresh
    gate: null as Promise<void> | null,
  }
  on('session.usage', () => ({
    value: {
      startedAt: NOW - HOUR,
      context: {
        window: 1_000_000,
        tokens: seen.api ? 200_000 : undefined,
        percent: 20,
        breakdown: { categories: [], totalTokens: 200_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, percentage: 20, apiUsage: seen.api } as never,
      },
      rateLimits: seen.limits,
    },
  }))
  on('model.fork', async (_$, e) => {
    seen.forks.push(e.prompt)
    if (seen.gate) await seen.gate
    return { value: seen.replies.shift() ?? WARMED }
  })
  on('tool.register', (_$, e) => {
    seen.registered.push(e.name)
    return { value: { tool: `mcp__headroom__${e.name}` } }
  })
  on('env.set', (_$, e) => {
    seen.envSets.push([e.name, e.value])
    return { value: undefined }
  })
  on('config.list', () => ({ value: w.config ?? [] }))
  on('config.set', (_$, e) => ({ value: e.value }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.PostModelSwitch', () => ({}) as never)
  on('session.authorize', () => ({ value: null }))
  on('session.measure', () => ({ changed: [] }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as never)
  on('command.register', () => ({ value: { command: 'headroom' } }))
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
  return { clock, seen, stored }
}

type Clock = { advance: (ms: number) => Promise<void> }

// the notice rows the mod appended, as the debug log has them
const rows = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('headroom: cache row')).map(l => l.replace(/^headroom: cache row \([^)]*\): /, ''))
const stops = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('headroom: cache warming stopped: ')).map(l => l.replace('headroom: cache warming stopped: ', ''))

// where each chain stands and when its refreshes are due, as the debug log has them
const anchors = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('headroom: cache anchor: ')).map(l => l.replace('headroom: cache anchor: ', ''))
const schedules = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('headroom: cache refresh in ')).map(l => l.replace('headroom: cache refresh in ', ''))

// A main turn of a second that ends on response `api`, the turn's usage naming the model
async function prompt($: Engine, clock: Clock, seen: { api: ModelUsage | null }, api: ModelUsage = API, model = OPUS) {
  await $.turn.start(GO)
  seen.api = api
  await clock.advance(1_000)
  await $.turn.complete({ answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...api, model } } as never)
}

test('warming switched off: a turn end anchors nothing that forks, and nothing is set', async ($, on) => {
  const { clock, seen } = world(on, { saved: { isOn: false, ttl: 'auto' } })
  await $.session.start(START)
  await prompt($, clock, seen)
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])
  expect(seen.envSets).toEqual([])
  expect(rows(seen)).toEqual([])
  // the anchor is there all the same: the band's warning reads it
  expect(anchors(seen)).toEqual(['200.0k tokens on claude-opus-5-5 at 5m'])
  expect(schedules(seen)).toEqual([])
})

test('a turn end anchors the chain; a refresh is forked at 90% of the lifetime from it, and again from each refresh', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  // no limits read (an API key): Claude Code's automatic lifetime is 5m
  await prompt($, clock, seen)
  await clock.advance(270_000 - 1)
  expect(seen.forks).toEqual([])
  await clock.advance(1)
  expect(seen.forks).toEqual([FORK_PROMPT])
  // (16*4 + 30*5 + 199,990*0.2 + 182*20) / 1e6 = $0.043852; a 5m rewrite of 200k adds $0.96
  expect(rows(seen)).toEqual(['☕ 5m · Cache warmed · read 200.0k · $0.04 · saves $0.92 vs rewrite'])
  await clock.advance(270_000)
  expect(seen.forks).toHaveLength(2)
  // the next prompt starts a new chain from its own response
  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 199_500 })
  await clock.advance(269_000)
  expect(seen.forks).toHaveLength(2)
  await clock.advance(1_000)
  expect(seen.forks).toHaveLength(3)
})

test('the idle limit: so many refreshes per lifetime while idle, then one warning row, and no more', { options: { idle5m: 2 } }, async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  await prompt($, clock, seen)
  await clock.advance(20 * MIN)
  expect(seen.forks).toHaveLength(2)
  const warnings = rows(seen).filter(r => r.includes('Warming stopped'))
  expect(warnings).toEqual([expect.stringMatching(/^☕ 5m · Warming stopped · all 2 idle refreshes used · cache expires at \d+:\d\d [AP]M$/)])
  expect(stops(seen)).toEqual([expect.stringMatching(/^all 2 idle refreshes used, cache expires at \d+:\d\d [AP]M$/)])
})

test('a refresh that finds a 1h cache gone stops the chain, and from then 5m is assumed for the session', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, seen } = world(on, { limits: plan(10) })
  await $.session.start(START)
  seen.replies.push(EXPIRED)
  await prompt($, clock, seen)
  await clock.advance(54 * MIN - 1)
  expect(seen.forks).toEqual([])
  await clock.advance(1)
  expect(seen.forks).toHaveLength(1)
  expect(rows(seen)).toEqual([expect.stringMatching(/^☕ 1h · Cache had expired · the refresh rewrote it · read 0 · \$/)])
  expect(stops(seen)).toEqual(['the cache had expired: 5m assumed for this session'])
  await clock.advance(5 * MIN)
  expect(seen.forks).toHaveLength(1)
  // the next chain runs at 5m: a refresh 4m30s after the turn
  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 0, cache_creation_input_tokens: 200_000 })
  await clock.advance(270_000)
  expect(seen.forks).toHaveLength(2)
  expect(anchors(seen).at(-1)).toBe('200.0k tokens on claude-opus-5-5 at 5m')
})

test('a refresh the API refused stops the chain and names the error', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  seen.replies.push({ isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: ZERO })
  await prompt($, clock, seen)
  await clock.advance(270_000)
  expect(rows(seen)).toEqual(['☕ 5m · Cache refresh failed · rate_limit 429 · read 0 · $0.00'])
  expect(stops(seen)).toEqual(['refresh failed (rate_limit 429)'])
  await clock.advance(5 * MIN)
  expect(seen.forks).toHaveLength(1)
})

test('a prompt below the break-even is not worth a refresh, and the stop says why', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 19_000 })
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])
  expect(stops(seen)).toEqual(['20.0k tokens is below the 103.8k break-even on claude-opus-5-5 at 5m (idle)'])
})

test('no refresh while a limit is at or past warmUntil (85% by default)', async ($, on) => {
  const { clock, seen } = world(on, { limits: plan(87) })
  await $.session.start(START)
  await prompt($, clock, seen)
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])
  expect(stops(seen)).toEqual(['5 Hour at 87%, past your 85%'])
})

test('warmUntil set higher lets it warm', { options: { warmUntil: 90 } }, async ($, on) => {
  const { clock, seen } = world(on, { limits: plan(87) })
  await $.session.start(START)
  await prompt($, clock, seen)
  expect(schedules(seen)).toEqual([expect.stringMatching(/^54m \(1h, idle, expected saving \$/)])
  // the /config row, set from the menu, applies to the warming under way
  await $.config.set({ key: 'headroom.warmUntil', value: 80 } as never)
  expect(stops(seen)).toEqual(['5 Hour at 87%, past your 80%'])
})

const LIFETIMES: [string, World, '5m' | '1h'][] = [
  ['auto on a subscription within its limits: 1h', { limits: plan(10) }, '1h'],
  ['auto on an API key: 5m', {}, '5m'],
  ['auto on a subscription in overage: 5m', { limits: plan(100, 30) }, '5m'],
  ['FORCE_PROMPT_CACHING_5M on a subscription: 5m', { limits: plan(10), env: { FORCE_PROMPT_CACHING_5M: '1' } }, '5m'],
  ['ENABLE_PROMPT_CACHING_1H on an API key: 1h', { env: { ENABLE_PROMPT_CACHING_1H: '1' } }, '1h'],
  [
    'the promptCacheTtl setting on an API key: 1h',
    { config: [{ key: 'promptCacheTtl', label: 'Prompt cache TTL', kind: 'choice', value: '1h', provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as never] },
    '1h',
  ],
  ['a chosen 1h on an API key: 1h', { saved: { isOn: true, ttl: '1h' } }, '1h'],
  ['a chosen 5m on a subscription: 5m', { limits: plan(10), saved: { isOn: true, ttl: '5m' } }, '5m'],
]
for (const [name, w, ttl] of LIFETIMES) {
  test(`the lifetime: ${name}`, async ($, on) => {
    const { clock, seen } = world(on, w)
    await $.session.start(START)
    await prompt($, clock, seen)
    expect(anchors(seen)).toEqual([`200.0k tokens on claude-opus-5-5 at ${ttl}`])
    // the refresh is due 90% of that lifetime after the turn (none past warmUntil, in overage)
    if (schedules(seen).length > 0) expect(schedules(seen)[0]).toStartWith(ttl === '1h' ? '54m (1h, idle' : '4m30s (5m, idle')
  })
}


test('a chosen lifetime is set in the variable at once, warming on or off; auto sets nothing', async ($, on) => {
  const { seen } = world(on, { saved: { isOn: true, ttl: '1h' } })
  await $.session.start(START)
  expect(seen.envSets).toEqual([['CLAUDE_CODE_PROMPT_CACHE_TTL', '1h']])
})

test('a chosen lifetime is set with warming off too: the dropdown is the chat\'s, not the warmer\'s', async ($, on) => {
  const { seen } = world(on, { saved: { isOn: false, ttl: '5m' } })
  await $.session.start(START)
  expect(seen.envSets).toEqual([['CLAUDE_CODE_PROMPT_CACHE_TTL', '5m']])
})

test('the chain is forgotten by a compaction, a /clear, the session ending and a model switch', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  await prompt($, clock, seen)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])
  expect(stops(seen)).toEqual(['conversation compacted'])

  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 150_000 })
  await $.classic.PostModelSwitch({ from_model: OPUS, to_model: 'claude-sonnet-5-5', requested_model: 'sonnet' } as never)
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])

  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 160_000 })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await clock.advance(5 * MIN)
  expect(seen.forks).toEqual([])
  expect(stops(seen)).toEqual(['conversation compacted', 'model switched', 'conversation cleared'])
})

test("a long turn's own responses keep the cache warm: a refresh comes only 90% of the lifetime after the last", async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  await prompt($, clock, seen)
  await $.turn.start(GO)
  // a response a minute into the turn, then a long tool call
  await clock.advance(MIN)
  seen.api = { ...API, cache_read_input_tokens: 199_300 }
  await clock.advance(3_000)
  await clock.advance(270_000 - 4_000)
  expect(seen.forks).toEqual([])
  await clock.advance(4_000)
  expect(seen.forks).toHaveLength(1)
})

test('the rate: the meter jump per dollar is learned at each turn end, logged, and kept in the store', async ($, on) => {
  const { clock, seen, stored } = world(on, { saved: null, limits: plan(10) })
  await $.session.start(START)
  await prompt($, clock, seen)
  expect(seen.logs).toContain('headroom: cache rate: nothing measured (no earlier reading of the same window)')
  seen.limits = plan(11)
  await prompt($, clock, seen)
  // at 1h: (1,000 * 8 + 199,000 * 0.2 + 300 * 20) / 1e6 = $0.0538
  expect(seen.logs).toContain(
    'headroom: cache rate: five_hour +1.0%, seven_day +0.0% for $0.05 (claude-opus-5-5); sums five_hour 1.0% / $0.05, seven_day 0.0% / $0.05',
  )
  const rate = stored.get('warmRate') as Record<string, { jump: number; usd: number }>
  expect(rate.five_hour?.jump).toBe(1)
  expect(Math.abs((rate.five_hour?.usd ?? 0) - 0.0538)).toBeLessThan(1e-9)
})

test('the totals: this session and all time, refreshes and what they cost', async ($, on) => {
  const { clock, seen, stored } = world(on)
  await $.session.start(START)
  await prompt($, clock, seen)
  await clock.advance(270_000)
  await clock.advance(270_000)
  const allTime = stored.get('warmAllTime') as { refreshes: number; costUsd: number }
  expect(allTime.refreshes).toBe(2)
  expect(Math.abs(allTime.costUsd - 2 * 0.043852)).toBeLessThan(1e-9)
})

// the band, on both surfaces it draws on
const SURFACES = ['terminal', 'desktop'] as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
// the kit matches any prop (a Button's label, an Svg's alt); its query type names only a few
const by = (query: ElementQuery & { label?: string; alt?: string }): ElementQuery => query
type Ui = { find: (q: ElementQuery) => Promise<{ text?: string; props: Record<string, unknown> } | undefined> }
// the lifetime dropdown's value, drawn warming on or off
const ttlValue = async (ui: Ui) => (await ui.find({ key: 'cacheTtl' }))?.props.value
const cacheText = async (ui: Ui) => (await ui.find({ type: 'Text', text: /^(Cache |Refreshing|Warming )/ }))?.text

for (const surface of SURFACES) {
  test(`the band (${surface}): the switch turns warming on for this chat and registers nothing of its own; the lifetime dropdown picks auto, 5m or 1h`, async ($, on) => {
    const { seen, stored } = world(on, { saved: { isOn: false, ttl: 'auto' } })
    await $.session.start(START)
    // Agent-timed, on by default, registered its tool at the start; the warmer adds none
    expect(seen.registered).toEqual(['compaction'])
    const ui = await $.ui.mount({ plugin: 'headroom', surface, component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ type: 'Text', text: 'Keep cache warm' }))?.props.color).toBe('#8b90a0')
    // the dropdown is drawn with warming off too
    expect(await ttlValue(ui)).toBe('auto')
    if (surface === 'desktop') expect(await ui.find(by({ type: 'Svg', alt: 'Keep cache warm off' }))).toBeDefined()
    else expect(await ui.find(by({ type: 'Button', label: '○' }))).toBeDefined()

    await ui.press({ key: 'warm' })
    expect(stored.get('warm:chat')).toEqual({ isOn: true, ttl: 'auto' })
    expect(seen.registered).toEqual(['compaction'])
    expect(seen.envSets).toEqual([])
    expect((await ui.find({ type: 'Text', text: 'Keep cache warm' }))?.props.color).toBeUndefined()
    if (surface === 'desktop') expect(await ui.find(by({ type: 'Svg', alt: 'Keep cache warm on' }))).toBeDefined()
    expect(await ttlValue(ui)).toBe('auto')

    // a chosen lifetime is set in the variable while no response has written the cache
    for (const [value, set] of [['5m', '5m'], ['1h', '1h'], ['auto', undefined]] as const) {
      await ui.select({ key: 'cacheTtl', value })
      expect(await ttlValue(ui)).toBe(value)
      expect(seen.envSets.at(-1)).toEqual(['CLAUDE_CODE_PROMPT_CACHE_TTL', set])
    }
    expect(stored.get('warm:chat')).toEqual({ isOn: true, ttl: 'auto' })

    await ui.press({ key: 'warm' })
    expect(await ttlValue(ui)).toBe('auto')
    expect(stored.get('warm:chat')).toEqual({ isOn: false, ttl: 'auto' })
    // the pick holds with warming off
    await ui.select({ key: 'cacheTtl', value: '1h' })
    expect(seen.envSets.at(-1)).toEqual(['CLAUDE_CODE_PROMPT_CACHE_TTL', '1h'])
    expect(stored.get('warm:chat')).toEqual({ isOn: false, ttl: '1h' })
    await ui.unmount()
  })
}

test('the band: after the first response the lifetime holds for the session; a pick says so, and a /clear frees it', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'headroom', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await prompt($, clock, seen)
  await ui.select({ key: 'cacheTtl', value: '5m' })
  expect(await ttlValue(ui)).toBe('5m')
  expect(seen.envSets).toEqual([])
  expect(seen.toasts).toContain("Cache lifetime 5m applies to new sessions: this one's cache is written at 5m")
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await ui.select({ key: 'cacheTtl', value: '1h' })
  expect(seen.envSets).toEqual([['CLAUDE_CODE_PROMPT_CACHE_TTL', '1h']])
  await ui.unmount()
})

test('a /clear keeps the settings: Auto compact and the cache lifetime follow the chat to the id it goes on under', async ($, on) => {
  const { clock, seen, stored } = world(on, { saved: null })
  // the chat's id, as the session answers it: a /clear goes on under a new one
  let chat = 'chat'
  on('session.id', () => ({ value: chat }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'headroom', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await prompt($, clock, seen)
  await ui.press({ key: 'auto' })
  expect(await ui.find(by({ type: 'Svg', alt: 'Auto compact off' }))).toBeDefined()
  await ui.select({ key: 'cacheTtl', value: '5m' })
  expect(await ttlValue(ui)).toBe('5m')

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  chat = 'next'
  await clock.advance(3_000)
  expect(await ui.find(by({ type: 'Svg', alt: 'Auto compact off' }))).toBeDefined()
  expect(await ttlValue(ui)).toBe('5m')
  // saved under the new id: reopened, the chat gets them back
  expect(stored.get('autoCompact:next')).toMatchObject({ isOn: false })
  expect(stored.get('warm:next')).toEqual({ isOn: true, ttl: '5m' })
  // and a chat of its own, opened later, still starts from the defaults
  chat = 'fresh'
  await clock.advance(3_000)
  expect(await ui.find(by({ type: 'Svg', alt: 'Auto compact on' }))).toBeDefined()
  expect(await ttlValue(ui)).toBe('auto')
  await ui.unmount()
})

test("the band: the warmer's status, scheduled, refreshing, with its totals and what kept prompts saved", async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'headroom', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await cacheText(ui)).toBeUndefined()
  await prompt($, clock, seen)
  expect(await cacheText(ui)).toBe('Cache warm · refresh in 4m')

  let open = () => {}
  seen.gate = new Promise<void>(resolve => {
    open = resolve
  })
  await clock.advance(270_000)
  expect(seen.forks).toHaveLength(1)
  const refreshing = await ui.find({ type: 'Text', text: 'Refreshing the cache…' })
  expect(refreshing?.props.color).toBe('#fbbf24')
  seen.gate = null
  open()
  await clock.advance(3_000)
  expect(await cacheText(ui)).toBe('Cache warm · refresh in 4m · 1 refresh this session, $0.04')

  // a prompt past the lifetime that read the warm cache: kept, a 5m rewrite of 199.5k avoided
  await clock.advance(60_000)
  await prompt($, clock, seen, { ...API, cache_read_input_tokens: 199_500 })
  expect(await cacheText(ui)).toBe('Cache warm · refresh in 4m · 1 refresh this session, $0.04, saved $0.96')
  await ui.unmount()
})

test('the band: a failed refresh shows warming stopped, and why', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'headroom', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  seen.replies.push({ isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: ZERO })
  await prompt($, clock, seen)
  await clock.advance(270_000)
  expect((await ui.find({ type: 'Text', text: 'Warming stopped: refresh failed (rate_limit 429)' }))?.props.color).toBe('#8b90a0')
  await ui.unmount()
})

test("the band: with warming off it warns before and after the cache expires, in the 5 Hour limit's % once a rate is learned", async ($, on) => {
  // a subscription held to 5m, so the lifetime passes quickly
  const { clock, seen } = world(on, { saved: { isOn: false, ttl: 'auto' }, limits: plan(10), env: { FORCE_PROMPT_CACHING_5M: '1' } })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'headroom', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await prompt($, clock, seen)
  // no rate yet: the dollars (the band redraws its ages each minute)
  await clock.advance(7 * MIN)
  expect(await cacheText(ui)).toBe(
    'Cache expired 1m ago: your next message rewrites 200.0k tokens, about $0.96 (warm: $0.04) · Keep cache warm would have kept it for about $0.04',
  )
  // the second turn moved 5 Hour by a point for (1,000 * 5 + 199,000 * 0.2 + 300 * 20) / 1e6 = $0.0508
  seen.limits = plan(11)
  await prompt($, clock, seen)
  expect(await cacheText(ui)).toBeUndefined()
  await clock.advance(4 * MIN)
  const expiring = await ui.find({ type: 'Text', text: /^Cache expires/ })
  expect(expiring?.text).toBe('Cache expires in 1m: the next message after that rewrites 200.0k tokens, about 18.9% of 5 Hour · Keep cache warm would keep it for about 0.9%')
  expect(expiring?.props.color).toBe('#8b90a0')
  await clock.advance(6 * MIN)
  const expired = await ui.find({ type: 'Text', text: /^Cache expired/ })
  expect(expired?.text).toBe(
    'Cache expired 4m ago: your next message rewrites 200.0k tokens, about 18.9% of 5 Hour (warm: 0.8%) · Keep cache warm would have kept it for about 0.9%',
  )
  expect(expired?.props.color).toBe('#fbbf24')
  await ui.unmount()
})
