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
    }
  }
}
