import type { ConfigValue, ModelForkResult, ModelUsage } from 'claude-code'

import type { CacheUsage, Limit, Ttl, TtlChoice, WarmAnchor, WarmRate, WarmStatus, WarmTotals } from '../types'

// Keep cache warm, the part with no engine in it: the prices, when a refresh pays,
// what one costs and saves, the lifetime Claude Code picks, and every word the band
// and the transcript show.
//
// Ported from cache-warmer 0.12.0 (github.com/paulbkim-dev/claude-code-cache-warmer),
// its hooks/warmer.ts, under the MIT licence:
//
//   Copyright (c) 2026 Paul B. Kim
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// The rule of when a refresh pays (`decide`) is the cache warmer's in Pi
// (github.com/earendil-works/pi) by Mario Zechner, which cache-warmer ports.

// the prices below were read on this day: a model added since gets no warming, never a wrong one
export const PRICES_AS_OF = '2026-10-04'

type Price = { input: number; cacheRead: number; output: number }

const price = (input: number, cacheRead: number, output: number): Price => ({ input, cacheRead, output })

// USD per million tokens at standard rates (platform.claude.com/docs/en/about-claude/pricing).
// A cache write costs 1.25x input for the 5-minute lifetime, 2x for the 1-hour one
const PRICES: Record<string, Price> = {
  'claude-fable-5-1': price(10, 0.25, 50),
  'claude-mythos-5-1': price(10, 0.25, 50),
  'claude-fable-5': price(10, 1, 50),
  'claude-mythos-5': price(10, 1, 50),
  'claude-opus-5-5': price(4, 0.2, 20),
  'claude-opus-5': price(5, 0.5, 25),
  'claude-opus-4-8': price(5, 0.5, 25),
  'claude-opus-4-7': price(5, 0.5, 25),
  'claude-opus-4-6': price(5, 0.5, 25),
  'claude-opus-4-5': price(5, 0.5, 25),
  'claude-sonnet-5-5': price(2, 0.2, 10),
  'claude-sonnet-5': price(2, 0.2, 10),
  'claude-sonnet-4-6': price(3, 0.3, 15),
  'claude-sonnet-4-5': price(3, 0.3, 15),
  'claude-haiku-4-5': price(1, 0.1, 5),
}

const WRITE_MULTIPLIER: Record<Ttl, number> = { '5m': 1.25, '1h': 2 }

export const TTL_MS: Record<Ttl, number> = { '5m': 300_000, '1h': 3_600_000 }

// Pi's rule: a refresh is sent only when it is expected to save this much
export const MIN_SAVINGS_USD = 0.05
// Pi's measured chance that a prompt comes before the cache expires while the session is idle
export const IDLE_CONTINUATION = 0.15
// a fork has no output cap; Opus 5.5 at high effort answered a refresh in 182 output tokens
export const DEFAULT_OUTPUT_TOKENS = 200
// the refreshes each lifetime may send while no turn runs, by default and at most
export const IDLE_LIMIT_DEFAULT = 5
export const IDLE_LIMIT_MAX = 20
// no refresh while either limit is at or past this %: a refresh spends the plan like any request
export const WARM_UNTIL_DEFAULT = 85
// the band warns this long before the cache expires
export const EXPIRING_MS = 2 * 60_000
// one window's reset time as two readings give it: a few minutes apart at most
const SAME_WINDOW_MS = 10 * 60_000

export const ZERO_TOTALS: WarmTotals = { refreshes: 0, costUsd: 0, wastedUsd: 0, kept: 0, keptUsd: 0 }

// the one user message a refresh appends to the fork: it says what it is, so a
// transcript reader (or the model) never takes it for the person
export const FORK_PROMPT =
  '[usage-quota] Automated prompt cache refresh by the usage-quota plugin, not a message from the user. Reply with the single word ok.'

const WINDOW_LABELS: Record<string, string> = { five_hour: '5 Hour', seven_day: 'Weekly' }

const isPriceKey = (id: string): boolean => Object.prototype.hasOwnProperty.call(PRICES, id)

// a gateway's prefix, a [1m] context suffix and a dated id all name the same prices
function rates(model: string): Price | undefined {
  const id = model.replace(/^(?:claude-gateway|anthropic)\//, '').replace(/\[\d+(?:k|m)\]$/, '')
  const key = isPriceKey(id) ? id : id.match(/^(claude-[a-z]+-\d{1,2}(?:-\d{1,2})?)-\d{8}$/)?.[1]
  return key !== undefined && isPriceKey(key) ? PRICES[key] : undefined
}

/** a fork that made a request; the other kind found nothing to fork */
export type ForkReply = Exclude<ModelForkResult, { reason: 'nothing-to-fork' }>

/** one refresh as it settled */
export type Refresh = {
  at: number
  model: string
  usage: CacheUsage | null
  costUsd: number | null
  /** the rewrite the next prompt avoids, less this refresh: earned only if a prompt follows in time */
  savesUsd: number | null
  result: 'warmed' | 'expired' | 'failed'
  detail?: string
}

export const isTtl = (value: unknown): value is Ttl => value === '5m' || value === '1h'
export const isTtlChoice = (value: unknown): value is TtlChoice => value === 'auto' || isTtl(value)

// the band's lifetime button goes round: auto, 5m, 1h, auto
export const nextChoice = (choice: TtlChoice): TtlChoice => (choice === 'auto' ? '5m' : choice === '5m' ? '1h' : 'auto')

export const usageOf = (usage: ModelUsage): CacheUsage => ({
  input: usage.input_tokens,
  output: usage.output_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheWrite: usage.cache_creation_input_tokens,
})

export const promptTokensOf = (usage: CacheUsage): number => usage.input + usage.cacheRead + usage.cacheWrite

// a refresh at 90% of the lifetime, at least ten seconds before it ends
export const delayOf = (ttl: Ttl): number => Math.floor(Math.min(TTL_MS[ttl] * 0.9, TTL_MS[ttl] - 10_000))

// Pi stops warming a running turn 60 minutes after its last request; the 1-hour
// lifetime stretches that to two lifetimes so that it warms at all
export const horizonOf = (ttl: Ttl): number => Math.max(60 * 60_000, 2 * TTL_MS[ttl])

// a /config value as an idle limit: a whole number from 0 to IDLE_LIMIT_MAX
export function limitOf(value: ConfigValue | undefined): number {
  const count = Math.round(Number(value))
  return value !== undefined && Number.isFinite(count) ? Math.min(IDLE_LIMIT_MAX, Math.max(0, count)) : IDLE_LIMIT_DEFAULT
}

// a /config value as the warmUntil %: a whole number from 1 to 100
export function warmUntilOf(value: ConfigValue | undefined): number {
  const percent = Math.round(Number(value))
  return value !== undefined && Number.isFinite(percent) ? Math.min(100, Math.max(1, percent)) : WARM_UNTIL_DEFAULT
}

// how long an idle cache stays warm: the limit's refreshes, then one lifetime
export const idleSpanOf = (count: number, ttl: Ttl): number => count * delayOf(ttl) + TTL_MS[ttl]

export const addTotals = <T extends WarmTotals>(base: T, delta: Partial<WarmTotals>): T => ({
  ...base,
  refreshes: base.refreshes + (delta.refreshes ?? 0),
  costUsd: base.costUsd + (delta.costUsd ?? 0),
  wastedUsd: base.wastedUsd + (delta.wastedUsd ?? 0),
  kept: base.kept + (delta.kept ?? 0),
  keptUsd: base.keptUsd + (delta.keptUsd ?? 0),
})

// a timer that fires this late would likely find the cache gone and pay a whole write
export const deadlineOf = (lastAt: number, ttl: Ttl): number => lastAt + delayOf(ttl) + Math.floor((TTL_MS[ttl] - delayOf(ttl)) / 2)

export function costOf(model: string, usage: CacheUsage, ttl: Ttl): number | null {
  const p = rates(model)
  if (!p) return null
  return (usage.input * p.input + usage.cacheWrite * p.input * WRITE_MULTIPLIER[ttl] + usage.cacheRead * p.cacheRead + usage.output * p.output) / 1_000_000
}

// what losing the cache adds to the next prompt: writing the prefix again instead of reading it
export function missCostOf(model: string, promptTokens: number, ttl: Ttl): number | null {
  const p = rates(model)
  if (!p) return null
  return Math.max(0, (promptTokens * (p.input * WRITE_MULTIPLIER[ttl] - p.cacheRead)) / 1_000_000)
}

// reading the prefix from a warm cache: what the next message pays for it while warm
export function readCostOf(model: string, promptTokens: number): number | null {
  const p = rates(model)
  return p ? (promptTokens * p.cacheRead) / 1_000_000 : null
}

export type Decision = {
  warmUsd: number
  missUsd: number
  probability: number
  expectedUsd: number
  isWarm: boolean
  /** why a refresh does not pay: the prompt is under the size where the expected saving reaches MIN_SAVINGS_USD */
  reason?: string
}

function breakEvenOf(p: Price, ttl: Ttl, probability: number, outputTokens: number): number | null {
  const savedPerToken = probability * (p.input * WRITE_MULTIPLIER[ttl] - p.cacheRead) - p.cacheRead
  if (savedPerToken <= 0) return null
  return Math.ceil((MIN_SAVINGS_USD * 1_000_000 + outputTokens * p.output) / savedPerToken)
}

// Pi's rule: chance of a prompt before expiry × the rewrite it avoids − the refresh ≥ $0.05.
// The chance is 1 while a turn runs, IDLE_CONTINUATION while idle. null: no price
export function decide(model: string, promptTokens: number, ttl: Ttl, phase: 'run' | 'idle', outputTokens: number): Decision | null {
  const p = rates(model)
  const missUsd = missCostOf(model, promptTokens, ttl)
  if (!p || missUsd === null || promptTokens <= 0) return null
  const warmUsd = (promptTokens * p.cacheRead + outputTokens * p.output) / 1_000_000
  const probability = phase === 'idle' ? IDLE_CONTINUATION : 1
  const expectedUsd = probability * missUsd - warmUsd
  const isWarm = expectedUsd >= MIN_SAVINGS_USD
  const breakEven = isWarm ? null : breakEvenOf(p, ttl, probability, outputTokens)
  const where = `${model} at ${ttl} (${phase})`
  const reason = isWarm
    ? undefined
    : breakEven === null
      ? `a refresh never saves on ${where}`
      : `${formatTokens(promptTokens)} tokens is below the ${formatTokens(breakEven)} break-even on ${where}`
  return { warmUsd, missUsd, probability, expectedUsd, isWarm, reason }
}

// a refresh that read under half the prefix found the cache gone and wrote it again
export function outcomeOf(reply: ForkReply, usage: CacheUsage, promptTokens: number): Pick<Refresh, 'result' | 'detail'> {
  if (usage.cacheRead >= promptTokens / 2) return { result: 'warmed' }
  if (reply.isAnswered) return { result: 'expired' }
  return {
    result: 'failed',
    detail: reply.reason === 'api-error' ? `${reply.error} ${reply.status ?? ''}`.trim() : reply.reason,
  }
}

// the transcript's record of a refresh: ☕ 1h · Cache warmed · read 48.2k · $0.01 · saves $0.09 vs rewrite
export function noticeText(ttl: Ttl, entry: Refresh): string {
  const cost = `${entry.usage ? `read ${formatTokens(entry.usage.cacheRead)} · ` : ''}${entry.costUsd === null ? 'cost unknown' : formatUsd(entry.costUsd)}`
  if (entry.result === 'expired') return `☕ ${ttl} · Cache had expired · the refresh rewrote it · ${cost}`
  if (entry.result === 'failed') return `☕ ${ttl} · Cache refresh failed · ${entry.detail ? `${entry.detail} · ${cost}` : cost}`
  return `☕ ${ttl} · Cache warmed · ${cost} · saves ${entry.savesUsd === null ? 'unknown' : formatUsd(entry.savesUsd)} vs rewrite`
}

// the last idle refresh has been sent: when the cache it warmed goes
export const idleStopReason = (limit: number, expiresAt: number): string =>
  `all ${limit} idle refreshes used, cache expires at ${clockOf(expiresAt)}`

export const idleStopNotice = (ttl: Ttl, limit: number, expiresAt: number): string =>
  `☕ ${ttl} · Warming stopped · all ${limit} idle refreshes used · cache expires at ${clockOf(expiresAt)}`

/** Claude Code's own choice of the main conversation's lifetime, and what it reads to make it */
export type TtlInputs = {
  /** FORCE_PROMPT_CACHING_5M set */
  force5m: boolean
  /** CLAUDE_CODE_PROMPT_CACHE_TTL */
  envTtl?: string
  /** the promptCacheTtl setting */
  settingTtl?: string
  /** ENABLE_PROMPT_CACHING_1H set */
  enable1h: boolean
  /** a Claude subscription: the snapshot has a 5 Hour or Weekly limit */
  isSubscription: boolean
  /** a limit at or past 100%: the subscription runs on overage */
  isOverage: boolean
}

// The lifetime in force, in Claude Code 2.1.291's order (read from its binary): the
// force switch, then the variable (which a chosen 5m or 1h sets), the setting, the 1h
// switch, and otherwise 1h on a subscription within its limits, 5m on an API key or in
// overage. `choice`: the lifetime this mod set in the variable, `auto` when it set none
export function ttlOf(i: TtlInputs, choice: TtlChoice = 'auto'): Ttl {
  if (i.force5m) return '5m'
  if (choice !== 'auto') return choice
  if (isTtl(i.envTtl)) return i.envTtl
  if (isTtl(i.settingTtl)) return i.settingTtl
  if (i.enable1h) return '1h'
  return i.isSubscription && !i.isOverage ? '1h' : '5m'
}

// a switch variable as Claude Code reads one: set, and not a word for off
export const isEnvOn = (value: string | undefined): boolean =>
  value !== undefined && !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())

const WINDOW_KINDS = ['five_hour', 'seven_day']

// a subscription has the 5 Hour or Weekly limit; an API key has none
export function planOf(limits: readonly Limit[]): { isSubscription: boolean; isOverage: boolean } {
  const windows = limits.filter(l => WINDOW_KINDS.includes(l.kind))
  return { isSubscription: windows.length > 0, isOverage: windows.some(l => l.percentUsed >= 100) }
}

// the first limit at or past warmUntil: no refresh then, as the status line says
export function pastLimitOf(limits: readonly Limit[], warmUntil: number): string | null {
  for (const kind of WINDOW_KINDS) {
    const l = limits.find(x => x.kind === kind)
    if (l && Math.round(l.percentUsed) >= warmUntil) return `${WINDOW_LABELS[kind]} at ${Math.round(l.percentUsed)}%, past your ${warmUntil}%`
  }
  return null
}

const sameWindow = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_WINDOW_MS

// How far each window's meter moved between two turn ends, in one window (by its
// reset): a window that reset meanwhile, or has no reset, says nothing. A window that
// did not move is a jump of 0, so the dollars it took still count against the rate
export function jumpsOf(before: readonly Limit[] | null, now: readonly Limit[]): Record<string, number> {
  const jumps: Record<string, number> = {}
  if (!before) return jumps
  for (const kind of WINDOW_KINDS) {
    const b = before.find(l => l.kind === kind)
    const n = now.find(l => l.kind === kind)
    if (b && n && sameWindow(b.resetsAt, n.resetsAt)) jumps[kind] = Math.max(0, n.percentUsed - b.percentUsed)
  }
  return jumps
}

// the turn's dollars go to every window that measured a jump
export function addRate(rate: WarmRate, jumps: Record<string, number>, usd: number): WarmRate {
  const next = { ...rate }
  for (const [kind, jump] of Object.entries(jumps)) {
    const r = next[kind] ?? { jump: 0, usd: 0 }
    next[kind] = { jump: r.jump + jump, usd: r.usd + usd }
  }
  return next
}

// How much of a window a dollar moves: Σjump / Σusd. The meter has one decimal at best
// (whole points from the replies), so a rate is trusted only once a whole point has moved
export function percentPerUsd(r: { jump: number; usd: number } | undefined): number | null {
  return r && r.jump >= 1 && r.usd > 0 ? r.jump / r.usd : null
}

/** the window a cost is shown in, and how much of it a dollar moves */
export type CostView = { label: string; perUsd: number }

// the 5 Hour window when it has a rate (the session's own limit), else Weekly; none on an API key
export function viewOf(rate: WarmRate, limits: readonly Limit[]): CostView | null {
  for (const kind of WINDOW_KINDS) {
    const perUsd = percentPerUsd(rate[kind])
    if (perUsd !== null && limits.some(l => l.kind === kind)) return { label: WINDOW_LABELS[kind]!, perUsd }
  }
  return null
}

export const formatPercent = (p: number): string => `${p >= 0.1 ? p.toFixed(1) : p > 0 ? p.toPrecision(1) : '0'}%`

export function formatUsd(usd: number): string {
  const sign = usd < 0 ? '-' : ''
  const value = Math.abs(usd)
  return `${sign}$${value > 0 && value < 0.01 ? value.toPrecision(2) : value.toFixed(2)}`
}

export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m${s % 60 ? `${s % 60}s` : ''}`
  return `${s}s`
}

// a span in the band's own words, to the minute: 38m, 1h 2m; under a minute said so
export function spanOf(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'under a minute'
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0) return min > 0 ? `${h}h ${min}m` : `${h}h`
  return `${min}m`
}

// a time as the band says one elsewhere: 2:32 PM
const clockOf = (t: number): string => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** a line of the band: what it says, and whether it calls for attention */
export type CacheLine = { text: string; tone: 'muted' | 'amber' }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// the warmer's own line while it is on: scheduled, refreshing, or stopped and why
export function warmStatusText(status: WarmStatus, totals: WarmTotals, now: number, assumed: Ttl | null = null): CacheLine | null {
  if (status.state === 'refreshing') return { text: 'Refreshing the cache…', tone: 'amber' }
  if (status.state === 'stopped') return { text: `Warming ${status.isPaused ? 'paused' : 'stopped'}: ${status.reason}`, tone: 'muted' }
  if (status.state !== 'scheduled') return null
  const parts = [`Cache warm`, `refresh in ${spanOf(status.nextAt - now)}`]
  if (assumed) parts.push(`${assumed} assumed`)
  if (totals.refreshes > 0) {
    parts.push(`${plural(totals.refreshes, 'refresh', 'refreshes')} this session, ${formatUsd(totals.costUsd)}${totals.keptUsd > 0 ? `, saved ${formatUsd(totals.keptUsd)}` : ''}`)
  }
  return { text: parts.join(' · '), tone: 'muted' }
}

/** what the warning needs: the prefix, its dollars, and the window to show them in */
export type CostOfNext = {
  promptTokens: number
  /** the rewrite over the warm read (missCostOf); null: no price */
  missUsd: number | null
  /** the warm read alone */
  readUsd: number | null
  view: CostView | null
}

// a dollar figure in the window's % when a rate is known, else in dollars
const amountOf = (usd: number, view: CostView | null): string => (view ? formatPercent(usd * view.perUsd) : formatUsd(usd))

function rewriteOf(c: CostOfNext, isWarmShown: boolean): string {
  const tokens = `${formatTokens(c.promptTokens)} tokens`
  if (c.missUsd === null) return tokens
  const about = `${tokens}, about ${amountOf(c.missUsd, c.view)}${c.view ? ` of ${c.view.label}` : ''}`
  return isWarmShown && c.readUsd !== null ? `${about} (warm: ${amountOf(c.readUsd, c.view)})` : about
}

export const expiredText = (agoMs: number, c: CostOfNext): string =>
  `Cache expired ${spanOf(agoMs)} ago: your next message rewrites ${rewriteOf(c, true)}`

export const expiringText = (inMs: number, c: CostOfNext): string =>
  `Cache expires in ${spanOf(inMs)}: the next message after that rewrites ${rewriteOf(c, false)}`

// with warming off, what a refresh would have cost instead
export function nudgeText(refreshUsd: number | null, view: CostView | null, isExpired: boolean): string {
  if (refreshUsd === null) return ''
  return ` · Keep cache warm ${isExpired ? 'would have kept' : 'would keep'} it for about ${amountOf(refreshUsd, view)}`
}

export type CacheLineInput = {
  isOn: boolean
  anchor: WarmAnchor | null
  status: WarmStatus
  totals: WarmTotals
  assumed: Ttl | null
  rate: WarmRate
  limits: readonly Limit[]
  outputTokens: number
  now: number
}

// The band's cache line, above the bars: the warmer's status while it is on; else, and
// once a stopped warmer's cache has gone, what the next message costs (amber once
// expired, muted in the minutes before). Nothing before the first reply.
export function cacheLineOf(i: CacheLineInput): CacheLine | null {
  const a = i.anchor
  if (!a) return null
  const expiresAt = a.lastAt + TTL_MS[a.ttl]
  const isExpired = i.now >= expiresAt
  if (i.isOn) {
    const line = warmStatusText(i.status, i.totals, i.now, i.assumed)
    if (line && !(i.status.state === 'stopped' && isExpired)) return line
  }
  const view = viewOf(i.rate, i.limits)
  const cost: CostOfNext = {
    promptTokens: a.promptTokens,
    missUsd: missCostOf(a.model, a.promptTokens, a.ttl),
    readUsd: readCostOf(a.model, a.promptTokens),
    view,
  }
  const refreshUsd = decide(a.model, a.promptTokens, a.ttl, 'idle', i.outputTokens)?.warmUsd ?? null
  if (isExpired) {
    return { text: expiredText(i.now - expiresAt, cost) + (i.isOn ? '' : nudgeText(refreshUsd, view, true)), tone: 'amber' }
  }
  if (!i.isOn && expiresAt - i.now <= EXPIRING_MS) {
    return { text: expiringText(expiresAt - i.now, cost) + nudgeText(refreshUsd, view, false), tone: 'muted' }
  }
  return null
}
