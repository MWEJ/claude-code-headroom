import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigRow, ModelForkResult, ModelUsage, On, SessionRateLimit } from 'claude-code'

const NOW = Date.parse('2026-10-04T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const OPUS = 'claude-opus-5-5'
const START = { cwd: '.', surface: 'desktop', isInteractive: true } as const
const GO = { text: 'go', turnId: 't1' } as never
const ON = { isOn: true, ttl: 'auto' }
const FORK_PROMPT = '[usage-quota] Automated prompt cache refresh by the usage-quota plugin, not a message from the user. Reply with the single word ok.'

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
  on('model.fork', (_$, e) => {
    seen.forks.push(e.prompt)
    return { value: seen.replies.shift() ?? WARMED }
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
  on('command.register', () => ({ value: { command: 'quota' } }))
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
  seen.logs.filter(l => l.startsWith('usage-quota: cache row')).map(l => l.replace(/^usage-quota: cache row \([^)]*\): /, ''))
const stops = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('usage-quota: cache warming stopped: ')).map(l => l.replace('usage-quota: cache warming stopped: ', ''))

// where each chain stands and when its refreshes are due, as the debug log has them
const anchors = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('usage-quota: cache anchor: ')).map(l => l.replace('usage-quota: cache anchor: ', ''))
const schedules = (seen: { logs: string[] }) =>
  seen.logs.filter(l => l.startsWith('usage-quota: cache refresh in ')).map(l => l.replace('usage-quota: cache refresh in ', ''))

// A main turn of a second that ends on response `api`, the turn's usage naming the model
async function prompt($: Engine, clock: Clock, seen: { api: ModelUsage | null }, api: ModelUsage = API, model = OPUS) {
  await $.turn.start(GO)
  seen.api = api
  await clock.advance(1_000)
  await $.turn.complete({ answer: 'done', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...api, model } } as never)
}

test('warming is off until switched on: a turn end anchors nothing that forks, and nothing is set', async ($, on) => {
  const { clock, seen } = world(on, { saved: null })
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
  await $.config.set({ key: 'usage-quota.warmUntil', value: 80 } as never)
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


test('a chosen lifetime is set in the variable at once; auto, or warming off, sets nothing', async ($, on) => {
  const { seen } = world(on, { saved: { isOn: true, ttl: '1h' } })
  await $.session.start(START)
  expect(seen.envSets).toEqual([['CLAUDE_CODE_PROMPT_CACHE_TTL', '1h']])
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
  expect(seen.logs).toContain('usage-quota: cache rate: nothing measured (no earlier reading of the same window)')
  seen.limits = plan(11)
  await prompt($, clock, seen)
  // at 1h: (1,000 * 8 + 199,000 * 0.2 + 300 * 20) / 1e6 = $0.0538
  expect(seen.logs).toContain(
    'usage-quota: cache rate: five_hour +1.0%, seven_day +0.0% for $0.05 (claude-opus-5-5); sums five_hour 1.0% / $0.05, seven_day 0.0% / $0.05',
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
