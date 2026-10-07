import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_OUTPUT_TOKENS, EXPIRING_MS, FORK_PROMPT, IDLE_LIMIT_DEFAULT, PRICES_AS_OF, TTL_MS, ZERO_TOTALS,
  addRate, addTotals, cacheLineOf, costOf, deadlineOf, decide, delayOf, expiredText, expiringText, formatDuration, formatPercent,
  formatTokens, formatUsd, horizonOf, idleSpanOf, idleStopNotice, isEnvOn, jumpsOf, limitOf, missCostOf, nextChoice, noticeText,
  nudgeText, outcomeOf, pastLimitOf, percentPerUsd, planOf, promptTokensOf, readCostOf, spanOf, ttlOf, usageOf, viewOf,
  warmStatusText, warmUntilOf,
} from '../hooks/cache-policy'
import type { CacheLineInput, ForkReply, TtlInputs } from '../hooks/cache-policy'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const MIN = 60_000
const near = (actual: number | null | undefined, expected: number) => expect(Math.abs((actual ?? NaN) - expected)).toBeLessThan(1e-9)

// a refresh of a 200k Opus prompt, as cache-warmer's tests have it
const WARMED: ForkReply = {
  isAnswered: true,
  text: 'ok',
  usage: { input_tokens: 16, output_tokens: 182, cache_read_input_tokens: 199_990, cache_creation_input_tokens: 30 },
}

test("the refresh decision follows Pi: idle prompts need 15% odds to clear $0.05; running turns count fully", () => {
  // 200k Opus 5.5 tokens: read $0.04 + 200 output tokens $0.004; a 5m rewrite is $1.00, so a miss adds $0.96
  const idle = decide(OPUS, 200_000, '5m', 'idle', 200)
  near(idle?.warmUsd, 0.044)
  near(idle?.missUsd, 0.96)
  near(idle?.expectedUsd, 0.15 * 0.96 - 0.044)
  expect(idle?.isWarm).toBe(true)
  expect(idle?.reason).toBeUndefined()
  // the break-even sizes cache-warmer solved by hand
  expect(decide(OPUS, 50_000, '5m', 'idle', 200)?.reason).toBe('50.0k tokens is below the 103.8k break-even on claude-opus-5-5 at 5m (idle)')
  expect(decide(SONNET, 300_000, '5m', 'idle', 200)?.reason).toBe('300.0k tokens is below the 358.6k break-even on claude-sonnet-5-5 at 5m (idle)')
  near(decide(OPUS, 50_000, '5m', 'run', 200)?.expectedUsd, 0.226)
  // a 1h rewrite costs 2x input
  near(decide(OPUS, 200_000, '1h', 'idle', 200)?.missUsd, 1.56)
  // no price, no warming; a dated id and a gateway's name find their model
  expect(decide('claude-gateway/gpt-6-astra', 200_000, '5m', 'idle', 200)).toBeNull()
  expect(decide(OPUS, 0, '5m', 'idle', 200)).toBeNull()
  near(decide('claude-opus-5-5-20261001', 200_000, '5m', 'idle', 200)?.missUsd, 0.96)
  near(decide('anthropic/claude-opus-5-5[1m]', 200_000, '5m', 'idle', 200)?.missUsd, 0.96)
  expect(PRICES_AS_OF).toMatch(/^\d{4}-\d\d-\d\d$/)
})

test('what a request costs, what a miss adds, and what a warm read is', () => {
  const usage = usageOf(WARMED.usage)
  expect(usage).toEqual({ input: 16, output: 182, cacheRead: 199_990, cacheWrite: 30 })
  expect(promptTokensOf(usage)).toBe(200_036)
  // (16*4 + 30*5 + 199,990*0.2 + 182*20) / 1e6
  near(costOf(OPUS, usage, '5m'), 0.043852)
  // the write at 2x input on the 1h lifetime
  near(costOf(OPUS, usage, '1h'), 0.043852 + (30 * 8 - 30 * 5) / 1e6)
  expect(costOf('gpt-6', usage, '5m')).toBeNull()
  near(missCostOf(OPUS, 48_200, '1h'), 48_200 * 7.8 / 1e6)
  near(readCostOf(OPUS, 48_200), 48_200 * 0.2 / 1e6)
  expect(missCostOf('gpt-6', 1, '1h')).toBeNull()
})

test('the timing: 90% of the lifetime, a deadline halfway through the rest, the run horizon and the idle span', () => {
  expect(TTL_MS).toEqual({ '5m': 300_000, '1h': 3_600_000 })
  expect(delayOf('5m')).toBe(270_000)
  expect(delayOf('1h')).toBe(54 * MIN)
  expect(deadlineOf(1_000, '5m')).toBe(1_000 + 270_000 + 15_000)
  expect(horizonOf('5m')).toBe(60 * MIN)
  expect(horizonOf('1h')).toBe(120 * MIN)
  // five idle refreshes at 54m, then the last one's hour: 5h30m
  expect(idleSpanOf(5, '1h')).toBe(330 * MIN)
})

test('the /config rows: idle limits 0 to 20, warmUntil 1 to 100, defaults where unreadable', () => {
  const cases: [unknown, number, number][] = [
    [3, 3, 3], [-2, 0, 1], [25, 20, 25], [4.6, 5, 5], ['7', 7, 7], ['x', IDLE_LIMIT_DEFAULT, 85], [undefined, 5, 85], [150, 20, 100],
  ]
  for (const [value, idle, until] of cases) {
    expect(limitOf(value as never)).toBe(idle)
    expect(warmUntilOf(value as never)).toBe(until)
  }
})

test('a refresh warmed when it read half the prefix; else the cache had expired, or it failed and says why', () => {
  const read = (cacheRead: number) => ({ input: 0, output: 1, cacheRead, cacheWrite: 0 })
  expect(outcomeOf(WARMED, read(100_000), 200_000)).toEqual({ result: 'warmed' })
  expect(outcomeOf(WARMED, read(99_999), 200_000)).toEqual({ result: 'expired' })
  const refused: ForkReply = { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: WARMED.usage }
  expect(outcomeOf(refused, read(0), 200_000)).toEqual({ result: 'failed', detail: 'rate_limit 429' })
  const cut: ForkReply = { isAnswered: false, reason: 'aborted', usage: WARMED.usage }
  expect(outcomeOf(cut, read(0), 200_000)).toEqual({ result: 'failed', detail: 'aborted' })
})

test('the transcript notice of each outcome', () => {
  const usage = { input: 0, output: 180, cacheRead: 48_200, cacheWrite: 0 }
  const base = { at: 0, model: OPUS, usage, costUsd: 0.0136, savesUsd: 0.09 }
  expect(noticeText('1h', { ...base, result: 'warmed' })).toBe('☕ 1h · Cache warmed · read 48.2k · $0.01 · saves $0.09 vs rewrite')
  expect(noticeText('5m', { ...base, result: 'expired', savesUsd: null })).toBe('☕ 5m · Cache had expired · the refresh rewrote it · read 48.2k · $0.01')
  expect(noticeText('5m', { ...base, result: 'failed', detail: 'rate_limit 429', usage: null, costUsd: null, savesUsd: null })).toBe(
    '☕ 5m · Cache refresh failed · rate_limit 429 · cost unknown',
  )
  expect(idleStopNotice('1h', 5, Date.parse('2026-10-04T06:00:00Z'))).toMatch(/^☕ 1h · Warming stopped · all 5 idle refreshes used · cache expires at \d+:\d\d [AP]M$/)
  expect(FORK_PROMPT).toBe(
    '[usage-quota] Automated prompt cache refresh by the usage-quota plugin, not a message from the user. Reply with the single word ok.',
  )
})

test('the formatters', () => {
  expect(formatUsd(0.31)).toBe('$0.31')
  expect(formatUsd(0.0042)).toBe('$0.0042')
  expect(formatUsd(-0.5)).toBe('-$0.50')
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatTokens(48_200)).toBe('48.2k')
  expect(formatTokens(1_250_000)).toBe('1.3M')
  expect(formatTokens(512)).toBe('512')
  expect(formatDuration(270_000)).toBe('4m30s')
  expect(formatDuration(54 * MIN)).toBe('54m')
  expect(formatDuration(2 * 3_600_000 + MIN)).toBe('2h1m')
  expect(spanOf(38 * MIN + 20_000)).toBe('38m')
  expect(spanOf(62 * MIN)).toBe('1h 2m')
  expect(spanOf(60 * MIN)).toBe('1h')
  expect(spanOf(30_000)).toBe('under a minute')
  expect(formatPercent(0.9)).toBe('0.9%')
  expect(formatPercent(12.34)).toBe('12.3%')
  expect(formatPercent(0.05)).toBe('0.05%')
  expect(formatPercent(0.0042)).toBe('0.004%')
  expect(formatPercent(0)).toBe('0%')
})

test("ttlOf: Claude Code's own order, and a chosen lifetime over the automatic one", () => {
  const AUTO: TtlInputs = { force5m: false, enable1h: false, isSubscription: true, isOverage: false }
  const cases: [string, Partial<TtlInputs>, 'auto' | '5m' | '1h', '5m' | '1h'][] = [
    ['a subscription within its limits: 1h', {}, 'auto', '1h'],
    ['a subscription in overage: 5m', { isOverage: true }, 'auto', '5m'],
    ['an API key: 5m', { isSubscription: false }, 'auto', '5m'],
    ['ENABLE_PROMPT_CACHING_1H on an API key: 1h', { isSubscription: false, enable1h: true }, 'auto', '1h'],
    ['the setting before the 1h switch', { settingTtl: '5m', enable1h: true }, 'auto', '5m'],
    ['the variable before the setting', { envTtl: '1h', settingTtl: '5m', isSubscription: false }, 'auto', '1h'],
    ['a value the variable does not take is passed over', { envTtl: '30m', isSubscription: false }, 'auto', '5m'],
    ['FORCE_PROMPT_CACHING_5M before everything', { force5m: true, envTtl: '1h' }, 'auto', '5m'],
    ['a chosen 1h on an API key', { isSubscription: false }, '1h', '1h'],
    ['a chosen 5m on a subscription', {}, '5m', '5m'],
    ['FORCE_PROMPT_CACHING_5M before a chosen 1h', { force5m: true }, '1h', '5m'],
  ]
  for (const [name, inputs, choice, ttl] of cases) expect([name, ttlOf({ ...AUTO, ...inputs }, choice)]).toEqual([name, ttl])
  expect(['1', 'true', 'yes'].map(isEnvOn)).toEqual([true, true, true])
  expect([undefined, '', '0', 'false', 'OFF'].map(isEnvOn)).toEqual([false, false, false, false, false])
  expect([nextChoice('auto'), nextChoice('5m'), nextChoice('1h')]).toEqual(['5m', '1h', 'auto'])
})

const RESET_5H = '2026-10-04T09:00:00.000Z'
const RESET_7D = '2026-10-08T09:00:00.000Z'
const limits = (fiveHour: number, weekly: number, fiveReset = RESET_5H) => [
  { kind: 'five_hour', percentUsed: fiveHour, resetsAt: fiveReset },
  { kind: 'seven_day', percentUsed: weekly, resetsAt: RESET_7D },
]

test('the plan, its overage and the warmUntil threshold, from the limits', () => {
  expect(planOf([])).toEqual({ isSubscription: false, isOverage: false })
  expect(planOf(limits(40, 10))).toEqual({ isSubscription: true, isOverage: false })
  expect(planOf(limits(100, 10))).toEqual({ isSubscription: true, isOverage: true })
  expect(pastLimitOf(limits(40, 10), 85)).toBeNull()
  expect(pastLimitOf(limits(87, 10), 85)).toBe('5 Hour at 87%, past your 85%')
  expect(pastLimitOf(limits(10, 84.6), 85)).toBe('Weekly at 85%, past your 85%')
})

test('the rate: the meter jump per dollar, per window, shown once a whole point has moved', () => {
  // the first turn end has nothing to measure from; a window that reset says nothing
  expect(jumpsOf(null, limits(4, 10))).toEqual({})
  expect(jumpsOf(limits(4, 10), limits(5, 10))).toEqual({ five_hour: 1, seven_day: 0 })
  expect(jumpsOf(limits(40, 10), limits(1, 10, '2026-10-04T14:00:00.000Z'))).toEqual({ seven_day: 0 })
  // a reading below the last (a stale reply figure) is no jump back
  expect(jumpsOf(limits(5, 10), limits(4, 10))).toEqual({ five_hour: 0, seven_day: 0 })
  let rate = addRate({}, { five_hour: 0.4, seven_day: 0 }, 0.3)
  expect(percentPerUsd(rate.five_hour)).toBeNull()
  rate = addRate(rate, { five_hour: 0.6, seven_day: 0.1 }, 0.2)
  near(rate.five_hour?.jump, 1)
  near(rate.five_hour?.usd, 0.5)
  near(percentPerUsd(rate.five_hour), 2)
  expect(percentPerUsd(rate.seven_day)).toBeNull()
  expect(viewOf(rate, limits(5, 10))).toEqual({ label: '5 Hour', perUsd: 2 })
  // an API key has no window to show it in
  expect(viewOf(rate, [])).toBeNull()
  expect(viewOf({ seven_day: { jump: 2, usd: 4 } }, limits(5, 10))).toEqual({ label: 'Weekly', perUsd: 0.5 })
})

test("the warmer's status line", () => {
  const now = 1_000_000
  const totals = { ...ZERO_TOTALS, refreshes: 3, costUsd: 0.04, keptUsd: 0.31 }
  const scheduled = { state: 'scheduled' as const, nextAt: now + 38 * MIN, phase: 'idle' as const, expectedUsd: 0.1 }
  expect(warmStatusText(scheduled, totals, now)?.text).toBe('Cache warm · refresh in 38m · 3 refreshes this session, $0.04, saved $0.31')
  expect(warmStatusText(scheduled, ZERO_TOTALS, now)).toEqual({ text: 'Cache warm · refresh in 38m', tone: 'muted' })
  expect(warmStatusText(scheduled, addTotals(ZERO_TOTALS, { refreshes: 1, costUsd: 0.01 }), now, '5m')?.text).toBe(
    'Cache warm · refresh in 38m · 5m assumed · 1 refresh this session, $0.01',
  )
  expect(warmStatusText({ state: 'refreshing' }, totals, now)).toEqual({ text: 'Refreshing the cache…', tone: 'amber' })
  expect(warmStatusText({ state: 'stopped', reason: 'cache had expired' }, totals, now)).toEqual({ text: 'Warming stopped: cache had expired', tone: 'muted' })
  expect(warmStatusText({ state: 'stopped', reason: '5 Hour at 87%, past your 85%', isPaused: true }, totals, now)?.text).toBe(
    'Warming paused: 5 Hour at 87%, past your 85%',
  )
  expect(warmStatusText({ state: 'waiting' }, totals, now)).toBeNull()
})

test('the expired-cache warning: in the window\'s % with a rate, in dollars without, tokens alone with no price', () => {
  const view = { label: '5 Hour', perUsd: 2 }
  const cost = { promptTokens: 48_200, missUsd: 0.37596, readUsd: 0.00964, view }
  expect(expiredText(4 * MIN, cost)).toBe('Cache expired 4m ago: your next message rewrites 48.2k tokens, about 0.8% of 5 Hour (warm: 0.02%)')
  expect(expiredText(4 * MIN, { ...cost, view: null })).toBe('Cache expired 4m ago: your next message rewrites 48.2k tokens, about $0.38 (warm: $0.0096)')
  expect(expiredText(30_000, { ...cost, missUsd: null, readUsd: null })).toBe('Cache expired under a minute ago: your next message rewrites 48.2k tokens')
  expect(expiringText(2 * MIN, cost)).toBe('Cache expires in 2m: the next message after that rewrites 48.2k tokens, about 0.8% of 5 Hour')
  expect(nudgeText(0.02, view, true)).toBe(' · Keep cache warm would have kept it for about 0.04%')
  expect(nudgeText(0.01, null, false)).toBe(' · Keep cache warm would keep it for about $0.01')
  expect(nudgeText(null, view, true)).toBe('')
})

test('the band\'s cache line: the status while warming, the warning when off or once a stopped warmer\'s cache is gone', () => {
  const lastAt = 1_000_000
  const anchor = { at: lastAt, lastAt, model: OPUS, promptTokens: 48_200, ttl: '1h' as const, refreshes: 0, idleRefreshes: 0, feeUsd: 0, isStopped: false }
  const base: CacheLineInput = {
    isOn: false, anchor, status: { state: 'waiting' }, totals: ZERO_TOTALS, assumed: null,
    rate: { five_hour: { jump: 2, usd: 1 } }, limits: limits(10, 10), outputTokens: DEFAULT_OUTPUT_TOKENS, now: lastAt + 10 * MIN,
  }
  const expiresAt = lastAt + 3_600_000
  expect(cacheLineOf({ ...base, anchor: null })).toBeNull()
  // a while to go: nothing
  expect(cacheLineOf(base)).toBeNull()
  expect(cacheLineOf({ ...base, now: expiresAt - EXPIRING_MS - 1 })).toBeNull()
  expect(cacheLineOf({ ...base, now: expiresAt - EXPIRING_MS })).toEqual({
    text: 'Cache expires in 2m: the next message after that rewrites 48.2k tokens, about 0.8% of 5 Hour · Keep cache warm would keep it for about 0.03%',
    tone: 'muted',
  })
  expect(cacheLineOf({ ...base, now: expiresAt + 4 * MIN })).toEqual({
    text: 'Cache expired 4m ago: your next message rewrites 48.2k tokens, about 0.8% of 5 Hour (warm: 0.02%) · Keep cache warm would have kept it for about 0.03%',
    tone: 'amber',
  })
  // no whole point learned yet: tokens and dollars; an API key (no limits): the same
  expect(cacheLineOf({ ...base, rate: { five_hour: { jump: 0.5, usd: 1 } }, now: expiresAt + 4 * MIN })?.text).toBe(
    'Cache expired 4m ago: your next message rewrites 48.2k tokens, about $0.38 (warm: $0.0096) · Keep cache warm would have kept it for about $0.01',
  )
  expect(cacheLineOf({ ...base, limits: [], now: expiresAt + 4 * MIN })?.text).toMatch(/about \$0\.38 \(warm: \$0\.0096\)/)
  // warming on: its status, also past the lifetime while it is scheduled
  const scheduled = { state: 'scheduled' as const, nextAt: lastAt + 54 * MIN, phase: 'idle' as const, expectedUsd: 0.1 }
  expect(cacheLineOf({ ...base, isOn: true, status: scheduled })?.text).toBe('Cache warm · refresh in 44m')
  // stopped: its reason until the cache is gone, then the warning without the nudge
  const stopped = { state: 'stopped' as const, reason: 'all 5 idle refreshes used, cache expires at 2:32 PM' }
  expect(cacheLineOf({ ...base, isOn: true, status: stopped, now: expiresAt - MIN })?.text).toBe(`Warming stopped: ${stopped.reason}`)
  expect(cacheLineOf({ ...base, isOn: true, status: stopped, now: expiresAt + 4 * MIN })?.text).toBe(
    'Cache expired 4m ago: your next message rewrites 48.2k tokens, about 0.8% of 5 Hour (warm: 0.02%)',
  )
})
