export type Category = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type PaceOf = { typical: number; skip: number }
export type Snapshot = {
  window: number
  tokens: number
  percent: number
  total: number
  categories: Category[]
  limits: Limit[]
  /** when the limit figures were read */
  limitsAt?: number
  /** why the usage service last refused, while it is backed off */
  limitsError?: string
  /** per window kind: the usual final % and the one-off % left out of the pace */
  pace?: Record<string, PaceOf>
  /** the minute it was taken in: redraws countdowns at least once a minute */
  minute?: number
}

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

/** Keep cache warm: the prompt cache's lifetime, and the chat's choice of it (`auto`: Claude Code's own) */
export type Ttl = '5m' | '1h'
export type TtlChoice = 'auto' | Ttl
/** a request's four token counts, in the policy's spelling */
export type CacheUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type WarmTotals = {
  refreshes: number
  costUsd: number
  /** the fees of refresh chains no kept prompt followed */
  wastedUsd: number
  kept: number
  /** the rewrites kept prompts avoided */
  keptUsd: number
}
/** the main conversation's last request: the prefix a fork replays and keeps warm */
export type WarmAnchor = {
  at: number
  lastAt: number
  model: string
  promptTokens: number
  ttl: Ttl
  refreshes: number
  /** refreshes sent while no turn ran: the idle limit counts these */
  idleRefreshes: number
  /** what this chain's refreshes cost: wasted unless the next prompt is kept */
  feeUsd: number
  isStopped: boolean
}
export type WarmStatus =
  | { state: 'waiting' }
  | { state: 'scheduled'; nextAt: number; phase: 'run' | 'idle'; expectedUsd: number }
  | { state: 'refreshing' }
  /** `isPaused`: stopped by the warmUntil threshold, which the band words as a pause */
  | { state: 'stopped'; reason: string; isPaused?: boolean }
/** per window kind: the % the meter moved and the dollars spent meanwhile, summed */
export type WarmRate = Record<string, { jump: number; usd: number }>
/** Keep cache warm, the session's side: the chain, the lifetime in force, the totals, the learned rate */
export type Warm = {
  anchor: WarmAnchor | null
  status: WarmStatus
  isRunning: boolean
  outputTokens: number
  /** the first main response wrote the cache: its lifetime holds for the session */
  isLocked: boolean
  /** the lifetime in force */
  ttl: Ttl
  /** set when a refresh found a 1h cache gone: 5m from then, for the session */
  assumed: Ttl | null
  totals: WarmTotals
  allTime: WarmTotals & { since: number }
  rate: WarmRate
  /** the limits at the last main turn's end: the jump is measured from them */
  lastLimits: Limit[] | null
}
/** Keep cache warm, the chat's setting (kept for every chat): on or off, and the lifetime */
export type WarmSetting = { isOn: boolean; ttl: TtlChoice }

declare module 'claude-code' {
  interface PluginState {
    'usage-quota': {
      snapshot: Snapshot | null
      isOn: boolean
      isCollapsed: boolean
      autoCompact: AutoCompact
      /** the choice the band is asking for: the context was already past a new % */
      autoAsk: { at: number; percent: number } | null
      /** bumped on every % set: draws the field afresh even when the value is unchanged */
      fieldTick: number
      fieldText: string | null
      agentTimed: AgentTimed
      /** the start % field's own tick and typed text, as fieldTick and fieldText are the cap's */
      startTick: number
      startText: string | null
      /** the desktop app's theme, as its settings (or the OS) have it */
      theme: 'dark' | 'light'
      /** Keep cache warm: the chain, the lifetime, the totals and the learned rate */
      warm: Warm
      /** Keep cache warm, this chat's switch and lifetime */
      warmSetting: WarmSetting
    }
  }
}
