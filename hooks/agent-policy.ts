import type { AgentTimed, AutoCompact } from '../types'

// Agent-timed Auto compact, the part with no engine in it: when to compact, what the
// agent's tool answers, and every word the agent reads. The idea (the agent holds
// compaction through fragile work and releases it at a safe point, leaving a note that
// survives) is compactor's, github.com/rhwendt/compactor (MIT), as is the shape of the
// breakpoint patterns.

export const TOOL_NAME = 'compaction'
export const TOOL = 'mcp__usage-quota__compaction'
export const TOOL_DESCRIPTION =
  'Controls when this conversation is compacted. Compaction runs when your turn ends once context passes the start %. ' +
  '"hold" (with a reason) before fragile multi-step work whose state lives only in this conversation; "release" at a safe point; ' +
  '"compact" to compact when this turn ends; "note" to save what must survive (current hypothesis, next steps, file:line references). ' +
  'At the cap % compaction runs whatever is held.'
export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { enum: ['hold', 'release', 'compact', 'note', 'status'] },
    reason: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['action'],
}

// the cap (the auto compact %) whenever there is none: a blank field, a first switch-on
export const AT_DEFAULT = 80
// the start %: 10 at the least, always below the cap; 30 where none was set
export const START_MIN = 10
export const START_DEFAULT = 30
// a chat that never had a setting: Auto compact on at the cap, Agent-timed on from the start %
export const DEFAULT_AUTO: AutoCompact = { isOn: true, at: AT_DEFAULT, isAgentTimed: true, startAt: START_DEFAULT }
export const NOTE_MAX = 4_000
// a reason is kept to this, and drawn in the band to less
export const REASON_MAX = 500
export const REASON_SHOWN = 80
// "compact" under this context % is refused: there is nothing worth compacting
export const ASK_MIN = 10
// within this many points of the cap, a holding agent is told the cap is close
export const NEAR_CAP = 5
// main tool calls between repeats of that last warning
export const NUDGE_EVERY = 10
// while a hold lasts, the agent is asked this often to say where the hold stands
export const HOLD_REMIND_MS = 5 * 60_000

export const EMPTY: AgentTimed = {
  hold: null,
  note: null,
  isAsked: false,
  told: 'no',
  nudge: { level: 0, calls: 0, isBreakpointSaid: false },
  overridden: null,
}

// a chat's setting as it stands: the cap, whether Agent-timed is on (it needs auto
// compact on), and the start %: the saved one or the default, never under the least,
// always below the cap
export const capOf = (auto: AutoCompact): number => auto.at ?? AT_DEFAULT
export const isTimed = (auto: AutoCompact): boolean => auto.isOn && auto.isAgentTimed === true
export const startOf = (auto: AutoCompact): number => Math.min(Math.max(START_MIN, auto.startAt ?? START_DEFAULT), capOf(auto) - 1)

/** a compaction ran and the context is still past a %: `start` never blocks the cap */
export type Stuck = 'no' | 'start' | 'cap'

export type DecideInput = {
  percent: number
  cap: number
  startAt: number
  isAgentTimed: boolean
  /** the band is asking, "After my next compact", or "Only in new chats" */
  isPaused: boolean
  stuck: Stuck
  state: Pick<AgentTimed, 'hold' | 'isAsked' | 'told'>
  hasRunningAgents: boolean
}

export type Decision =
  | { action: 'compact'; why: 'asked' | 'cap' | 'start' }
  | { action: 'tell' }
  | { action: 'wait'; why: 'paused' | 'stuck' | 'below' | 'held' | 'agents' | 'told' }

// What auto compact does with an idle chat: the first rule that applies decides. The %
// is compared as the band shows it, rounded.
export function decide(i: DecideInput): Decision {
  const shown = Math.round(i.percent)
  // the agent's own request is as deliberate as the Compact button: no pause stops it
  if (i.state.isAsked) return { action: 'compact', why: 'asked' }
  if (i.isPaused) return { action: 'wait', why: 'paused' }
  // the cap: no hold, no subagent and no untold agent survives it
  if (shown >= i.cap) return i.stuck === 'cap' ? { action: 'wait', why: 'stuck' } : { action: 'compact', why: 'cap' }
  if (!i.isAgentTimed || shown < i.startAt) return { action: 'wait', why: 'below' }
  if (i.stuck !== 'no') return { action: 'wait', why: 'stuck' }
  if (i.state.hold) return { action: 'wait', why: 'held' }
  // the main agent is waiting on work whose results it must still take in
  if (i.hasRunningAgents) return { action: 'wait', why: 'agents' }
  // never compacted unawares: told first, and given the coming turn to hold
  if (i.state.told === 'no') return { action: 'tell' }
  if (i.state.told === 'next') return { action: 'wait', why: 'told' }
  return { action: 'compact', why: 'start' }
}

// How firmly a holding agent is reminded: 2 from halfway between the start % and the
// cap, 3 from NEAR_CAP points under the cap.
export function nudgeLevel(percent: number, startAt: number, cap: number, isHolding: boolean): 0 | 2 | 3 {
  const shown = Math.round(percent)
  if (!isHolding || shown < startAt) return 0
  if (shown >= cap - NEAR_CAP) return 3
  if (shown >= startAt + (cap - startAt) / 2) return 2
  return 0
}

// One main tool call later: a level is said when first reached, and level 3 again
// every NUDGE_EVERY calls while it lasts.
export function stepNudge(nudge: AgentTimed['nudge'], level: 0 | 2 | 3): { isSaid: boolean; nudge: AgentTimed['nudge'] } {
  if (level === 0) return { isSaid: false, nudge }
  if (level > nudge.level) return { isSaid: true, nudge: { ...nudge, level, calls: 0 } }
  if (level < 3) return { isSaid: false, nudge }
  const calls = nudge.calls + 1
  return calls >= NUDGE_EVERY ? { isSaid: true, nudge: { ...nudge, calls: 0 } } : { isSaid: false, nudge: { ...nudge, calls } }
}

// a command word: at the start, or after a space or a shell separator
const SEP = String.raw`(?:^|[\s;&|(])`
const END = String.raw`(?=$|[\s;&|)])`
const COMMIT = new RegExp(SEP + String.raw`git(?:\s+-[Cc]\s+\S+)*\s+commit` + END)
const TESTS = new RegExp(
  SEP +
    '(?:' +
    String.raw`pytest|py\.test|python3?\s+-m\s+(?:pytest|unittest)` +
    String.raw`|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?` +
    String.raw`|go\s+test|cargo\s+test|make\s+(?:test|check)|mvn(?:\s+\S+)*?\s+test` +
    String.raw`|(?:\./)?gradlew?(?:\s+\S+)*?\s+test|rspec|(?:npx\s+)?(?:jest|vitest)|claude\s+plugin\s+test` +
    ')' +
    END,
)
const SEGMENTS = /&&|\|\||[;|&\n]/

// Which natural breakpoint a Bash command that succeeded was: read one shell segment
// at a time, so "echo git commit" and a --dry-run are not one.
export function breakpointOf(command: string): 'commit' | 'tests' | null {
  const segments = command.split(SEGMENTS).filter(s => s.trim() !== '')
  if (segments.some(s => COMMIT.test(s) && !s.includes('--dry-run'))) return 'commit'
  if (segments.some(s => TESTS.test(s))) return 'tests'
  return null
}

export function figures(percent: number, startAt: number, cap: number): string {
  return `Context ${Math.round(percent)}%. Agent-timed compaction starts at ${startAt}%; at ${cap}% it runs whatever is held.`
}

export function toldText(percent: number, startAt: number, cap: number): string {
  return (
    `Agent-timed compaction: context is at ${Math.round(percent)}% (starts at ${startAt}%, cap ${cap}%). ` +
    'This conversation will be compacted when your turn ends. ' +
    'If you are mid-task, call the compaction tool with action "hold" and a reason. Otherwise save a "note" of what must survive.'
  )
}

export function nudgeText(level: 2 | 3, percent: number, startAt: number, cap: number, reason: string): string {
  const body =
    level === 3
      ? `the cap is close. At ${cap}% compaction runs when your turn ends, whatever is held. Save a note now.`
      : `you are holding (${reason}) well past the start. Finish the current step, save a note, and release.`
  return `Agent-timed compaction: ${body}\n${figures(percent, startAt, cap)}`
}

// Every HOLD_REMIND_MS of a hold, on the next main tool result: the agent is asked to
// say where the hold stands (kept, released, or a note). `null` while none is due; the
// state handed back is due again HOLD_REMIND_MS on.
export function holdReminder(state: AgentTimed, now: number, percent: number, startAt: number, cap: number): { text: string; state: AgentTimed } | null {
  if (!state.hold || now < state.hold.remindAt) return null
  const held = Math.max(1, Math.round((now - state.hold.since) / 60_000))
  const text =
    `Agent-timed compaction: you have held compaction for ${held}m (${state.hold.reason}). ` +
    'Update the hold: call the compaction tool with action "hold" and the current reason to keep it, "release" if the fragile step is done, or "note" what must survive.\n' +
    figures(percent, startAt, cap)
  return { text, state: { ...state, hold: { ...state.hold, remindAt: now + HOLD_REMIND_MS } } }
}

export function breakpointText(kind: 'commit' | 'tests'): string {
  const what = kind === 'commit' ? 'a commit just landed' : 'tests just passed'
  return `Agent-timed compaction: ${what}, a natural breakpoint. Consider "release" or "compact", with a note.`
}

const NOTE_HEAD = 'The agent left this handoff note. Keep what it says matters:'

// The note as the summarizer's instructions, after whatever was asked for already.
// Adding it twice adds it once: a compaction may pass more than one place that adds it.
export function withNote(instructions: string | undefined, note: string | null): string | undefined {
  if (note === null) return instructions
  const block = `${NOTE_HEAD}\n${note}`
  if (instructions?.includes(block)) return instructions
  return instructions ? `${instructions}\n\n${block}` : block
}

// The row the agent reads after a compaction, or null with nothing to say.
export function afterText(note: string | null, overridden: AgentTimed['overridden'], cap: number): string | null {
  if (note === null && overridden === null) return null
  const lines = ['Agent-timed compaction: the conversation was just compacted.']
  if (overridden) lines.push(`Your hold (${overridden.reason}) ended at the ${cap}% cap. Hold again if the work is still fragile.`)
  if (note !== null) lines.push(`Handoff note you left:\n${note}`)
  return lines.join('\n')
}

export type ToolInput = { action?: unknown; reason?: unknown; note?: unknown }
export type ToolContext = {
  /** Agent-timed is on in this chat */
  isOn: boolean
  /** the call came from a subagent's or a teammate's loop */
  isSubagent: boolean
  percent: number
  startAt: number
  cap: number
  now: number
}

const ACTIONS = ['hold', 'release', 'compact', 'note', 'status']

function statusText(state: AgentTimed, now: number): string {
  const lines = [
    state.hold ? `hold: ${state.hold.reason} (${Math.max(0, Math.round((now - state.hold.since) / 60_000))}m)` : 'hold: none',
    state.note === null ? 'note: none' : `note: ${state.note}`,
  ]
  if (state.isAsked) lines.push('compaction asked for: when this turn ends')
  return lines.join('\n')
}

// What a call of the tool does and answers. A refusal says what was wrong and changes
// nothing: the state handed back is then the very one handed in.
export function answerTool(state: AgentTimed, input: ToolInput, ctx: ToolContext): { state: AgentTimed; text: string } {
  if (!ctx.isOn) return { state, text: 'Agent-timed compaction is off in this chat. Nothing changed.' }
  const say = (text: string, next: AgentTimed = state) => ({ state: next, text: `${text}\n${figures(ctx.percent, ctx.startAt, ctx.cap)}` })
  const { action } = input
  if (typeof action !== 'string' || !ACTIONS.includes(action)) {
    return say('Unknown action. Call it with action "hold" (and a reason), "release", "compact", "note" or "status". Nothing changed.')
  }
  if (action === 'status') return say(statusText(state, ctx.now))
  if (ctx.isSubagent) {
    return say('Only the main agent can hold, release, compact or write notes: the hold and the note are its own. Finish your task and report back. Nothing changed.')
  }
  if (action === 'hold') {
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, REASON_MAX) : ''
    if (reason === '') return say('A hold needs a reason: action "hold", reason "<what is fragile>". Nothing changed.')
    const hold = { reason, since: state.hold?.since ?? ctx.now, remindAt: ctx.now + HOLD_REMIND_MS }
    return say(`${state.hold ? 'Hold updated' : 'Hold set'}: compaction waits until you release, or until the cap. Reason: ${reason}.`, {
      ...state,
      hold,
      isAsked: false,
      nudge: { ...state.nudge, isBreakpointSaid: false },
    })
  }
  const note = typeof input.note === 'string' ? input.note : undefined
  if (note !== undefined && note.length > NOTE_MAX) return say(`The note is ${note.length} characters; the most is ${NOTE_MAX}. Nothing changed.`)
  const noted = (next: AgentTimed): AgentTimed => (note === undefined ? next : { ...next, note: note === '' ? null : note })
  const saved = note === undefined ? '' : note === '' ? ' Handoff note cleared.' : ' Handoff note saved; it comes back after the compaction.'
  if (action === 'release') {
    const when = Math.round(ctx.percent) >= ctx.startAt ? 'Compaction can run when this turn ends.' : `Compaction waits until context reaches ${ctx.startAt}%.`
    return say(`${state.hold ? 'Released.' : 'No hold was set.'} ${when}${saved}`, noted({ ...state, hold: null }))
  }
  if (action === 'compact') {
    if (Math.round(ctx.percent) < ASK_MIN) return say(`Context is under ${ASK_MIN}%: there is nothing worth compacting. Nothing changed.`)
    return say(`Compaction runs when this turn ends.${saved}`, noted({ ...state, hold: null, isAsked: true }))
  }
  if (note === undefined) return say('A note needs text: action "note", note "<what must survive>" (an empty note clears it). Nothing changed.')
  return say(note === '' ? 'Handoff note cleared.' : `Handoff note saved (${note.length} characters). It goes to the summarizer and comes back after the next compaction.`, noted(state))
}
