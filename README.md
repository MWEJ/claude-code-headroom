# Claude Code Usage Quota Mod with Auto Compact

[![Version: v0.1.3](docs/badges/version-v0.1.3.svg)](https://github.com/anantraghunath/claude-code-usage-quota-mod/releases/latest) ![Auto compact: 80% default](docs/badges/auto-compact-v3.svg) ![Compact: one click](docs/badges/compact-v2.svg) ![5 Hour + Weekly: whole account](docs/badges/limits-v2.svg) ![Forecast: before reset](docs/badges/forecast-v2.svg) ![Works in: Desktop + Terminal](docs/badges/works-in-v2.svg) ![License: MIT](docs/badges/license-v2.svg)

**Know your Claude limits before they hit you.** A live band above the Claude Code prompt that shows your plan limits, forecasts whether you'll run out before they reset, and shows how full your context window is. **Compact in one click, or let it compact automatically.**

The 5 Hour and Weekly limits are **your whole Claude account's**, including what you use in Claude chat and Cowork. The band itself shows in **Claude Code**: the desktop app and the terminal.

Type **`/quota`** to turn the band off and on.

## Expanded

![The band, expanded, above the prompt in the Claude desktop app](docs/expanded-desktop.png)

## Collapsed

One row that still shows the time left until each limit resets:

![The band, collapsed, above the prompt in the Claude desktop app](docs/collapsed-desktop.png)

> [!TIP]
> **Never hit a full context again: Auto compact, on by one click.**
> With Auto compact on, the band compacts your session once the context reaches **80%** (the default; set **15 to 99**). Set it lower to compact sooner: a long context costs more on every reply, so compacting early keeps replies **cheaper** and your limits **lasting longer**. Auto compact never interrupts a reply. Want to compact right now? The **Compact** button runs `/compact` in one click.
>
> **Let Claude pick the moment: Agent-timed.** Switch on **Agent-timed** beside Auto compact and compaction starts sooner (from **30%** by default) but at a good moment: Claude can hold it through a debugging chain or a refactor, release it at a safe point, and leave itself a note that survives. Your Auto compact % stays the limit no hold can pass.
>
> **Each session keeps its own settings**, even after a restart, so you can run them differently side by side:
> - **Building something big?** Leave Auto compact at 80% or turn it off, so Claude keeps the whole picture. Press **Compact** yourself at a good stopping point. (With it off, Claude Code's built-in compaction still steps in when the context is nearly full.)
> - **Everyday sessions?** Set Auto compact lower (say 30%), or switch on Agent-timed. They stay lean, and your 5 Hour and Weekly limits last longer.

## What it shows

**5 Hour and Weekly limits**
- The **% used**, matching the app's own *Plan usage limits* panel.
- A **forecast** of where you'll be at reset: a grey tick on the bar and a note, e.g. *On pace for about 87% by reset – resets in 23m*.
- A **headline** at a glance: *On track. You should reach Wednesday's reset with room to spare.*
- The forecast starts from **your usual pace** (learned from your past windows) and shifts to your actual pace as the window goes on, so an early burst doesn't set it off.
- Bars turn **amber at 75%** and **red at 90%**, or sooner if you're on course to run out.

On course to run out, it warns you and says **when you'll hit the limit**:

![The band, expanded, on course to run out before the 5 hour reset](docs/run-out-expanded-v2.png)

![The band, collapsed, on course to run out](docs/run-out-collapsed-v2.png)

**Context window**
- The % used and space free, as `/context` counts it, split into Messages, Tools and Other.
- **Amber at 50%**, **red at 80%**: the point to compact.

**Compacting**
- **Compact** runs `/compact` in one click.
- **Auto compact** runs at your % (80% by default, 15 to 99), never mid-reply. Each session keeps its own setting; a new session starts with it on, Agent-timed included.
- **Agent-timed** (optional, beside Auto compact) lets Claude choose the moment below that %. See [Agent-timed](#agent-timed).

**Prompt cache**
- Once the cache has expired, the band says what your next message costs to write it again, in your 5 Hour limit's %: *Cache expired 4m ago: your next message rewrites 48.2k tokens, about 0.9% of 5 Hour (warm: 0.05%)*. In the two minutes before, it says it is about to. The % is learned from how far your limit moves per dollar of replies; until a whole point has moved (and on an API key) it says dollars.
- **Keep cache warm** (optional, off by default) refreshes the cache before it expires, so the first message after a break reads it instead. See [Keep cache warm](#keep-cache-warm).

If the session is already past your % when you turn it on, it asks first:

![Auto compact asking what to do, with the context already at 72%](docs/auto-compact-ask.png)

![The same question with the band collapsed](docs/auto-compact-ask-collapsed.png)

- **Now** compacts straight away.
- **After my next compact** waits until the session is compacted some other way (Compact, `/compact`, or Claude Code's own), then takes over.
- **Only in new chats** leaves this session alone until it's next opened.

Works in **light and dark** themes and at **every width** down to the narrowest. Collapsed or expanded is shared across all sessions.

<details>
<summary><b>MORE SCREENSHOTS</b></summary>

Early in a 5 hour window:

![The band, expanded, early in a 5 hour window](docs/expanded-dark-early.png)

![The band, collapsed, early in a 5 hour window](docs/collapsed-dark-early.png)

Running out on the Weekly limit:

![The band, expanded, on course to run out before the weekly reset](docs/run-out-weekly-expanded.png)

![The band, collapsed, on course to run out before the weekly reset](docs/run-out-weekly-collapsed.png)

| Light theme | Narrowest window |
| --- | --- |
| ![Light, expanded](docs/expanded-light.png) | ![Narrow, expanded](docs/narrow-expanded.png) |
| ![Light, collapsed](docs/collapsed-light.png) | ![Narrow, collapsed](docs/narrow-collapsed.png) |

</details>

## Agent-timed

Auto compact fires at a fixed %, whatever Claude is doing. A compaction that lands mid-debugging throws away the context that mattered. With **Agent-timed** on, Claude chooses the moment, between two numbers you set:

- From the **start %** (30% by default, its own box in the band) the session is compacted when a turn ends, unless Claude holds it.
- At your **Auto compact %** it is compacted when the turn ends, whatever Claude holds. No hold passes it.

What Claude can do, through a small `compaction` tool the mod gives it:

- **Hold** compaction through fragile work, with a reason.
- **Release** it at a safe point, or **ask to compact** when the turn ends.
- Leave a **handoff note**. It goes to the summarizer and comes back to Claude after the compaction, once.

What you see and keep:

- While Claude holds, the band says so: *Held by Claude 12m: mid-refactor of auth*, with **Compact now** and **Release** to overrule it.
- Every **5 minutes** of a hold, Claude is asked where it stands: keep the hold with its current reason, release it, or leave a note.
- Claude is told when the context passes the start %, so a compaction never comes unannounced.
- While subagents Claude is waiting on are still running, compaction waits for them, up to your Auto compact %.
- Only the main agent can hold. Subagents cannot.

Agent-timed is on in a new session, from 30%, and each session keeps its own setting. Switching it on adds the tool to that session; switched off again, the tool stays listed until the session is reopened, and answers that the mode is off.

## Keep cache warm

Every message sends the whole conversation. The API keeps it in a **prompt cache** for 5 minutes or an hour; a message that reads the cache pays about a tenth of the input price, and one after the cache has expired writes it all again at 1.25× (5 minutes) or 2× (1 hour). After a break, the first message pays.

With **Keep cache warm** on, the mod sends one small request shortly before the cache would expire: a copy of the conversation's last request with one line asking for the word *ok*. It re-reads the cache, which keeps it alive, and never enters the conversation; a ☕ row in the transcript records each one with what it cost and saves.

- **It sends only when it pays.** A refresh goes out only when it is expected to save at least **$0.05**: always worth it while Claude is working, and at a 15% chance of your next message while you are away. A small conversation is below that, and is not warmed.
- **Two numbers bound it:** at most **5 refreshes** per lifetime while you are away (set 0 to 20, separately for 5m and 1h), and none while your 5 Hour or Weekly limit is at or past **85%**. Both are `/config` rows (`usage-quota.idle5m`, `usage-quota.idle1h`, `usage-quota.warmUntil`).
- **The lifetime follows Claude Code.** The **Cache** dropdown in the band's top row reads **auto** by default: 1 hour on a Claude subscription within its limits, 5 minutes on an API key or once in overage, as Claude Code chooses (and as `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H` or the `promptCacheTtl` setting say). Pick **5m** or **1h** to choose for this session, warming on or off. The first reply of a session writes the cache, so a choice made after it applies to new sessions. `usage-quota.cacheTtl` in `/config` sets what new chats start with.
- The band says what it is doing: *Cache warm · refresh in 38m · 3 refreshes this session, $0.04, saved $0.31*, or why it stopped. Compacting, `/clear`, a model switch or a failed refresh start it afresh with your next message.

> [!IMPORTANT]
> **Each refresh counts against your plan** like any other request: a cache read of the conversation and a few output tokens. That is why it is **off by default** and set per session. The expired-cache warning shows what the refreshes save, in the same 5 Hour %, warming on or off.

With this on, **disable [cache-warmer](https://github.com/paulbkim-dev/claude-code-cache-warmer) if you have it installed**: both would warm the same cache.

## Where it works

- **Claude desktop app**, Code tab
- **Claude Code in a terminal**

> [!NOTE]
> In the desktop app, the band appears once a session has started. The brand-new *Welcome back* screen has no session yet, so no mod can draw there. Send your first message and it appears.

In the terminal, **▲/▼** expands and collapses it. The `[-]` next to it is Claude Code's own control and hides the band; **ctrl+x ctrl+a** brings it back.

![The band in the terminal, expanded](docs/terminal-expanded.png)

<details>
<summary>Terminal, collapsed</summary>

![The band in the terminal, collapsed](docs/terminal-collapsed.png)

</details>

## Install

Needs a recent Claude Code, signed in with a **Pro or Max** plan.

**Desktop app:** in the **Code** tab, send this as a message, allow the `claude plugin` command if asked, then **quit and reopen** the app:

```text
Install the usage-quota plugin from the GitHub marketplace anantraghunath/claude-code-usage-quota-mod
```

**Terminal:** inside `claude`, run:

```text
/plugin install usage-quota --marketplace anantraghunath/claude-code-usage-quota-mod
```

Either way installs it for **both** the desktop app and the terminal.

**Update:** ask Claude, then restart:

```text
Update the usage-quota plugin from its marketplace
```

**Uninstall:** in the desktop app, ask Claude:

```text
Remove the claude-code-usage-quota-mod plugin marketplace
```

or in the terminal:

```text
/plugin marketplace remove claude-code-usage-quota-mod
```

then restart. This removes it from both. Just want it out of sight? **`/quota`** hides it without uninstalling.

<details>
<summary>From your own shell instead</summary>

```bash
claude plugin marketplace add anantraghunath/claude-code-usage-quota-mod; claude plugin install usage-quota@claude-code-usage-quota-mod
```

To update:

```bash
claude plugin marketplace update claude-code-usage-quota-mod; claude plugin update usage-quota@claude-code-usage-quota-mod
```

To uninstall:

```bash
claude plugin marketplace remove claude-code-usage-quota-mod
```

</details>

## Privacy

**Everything runs on your machine.** It reads what Claude Code already has (your context and the limits each reply carries), and about every 2 minutes asks Anthropic's usage service for your limits through your existing Claude login. It **never sees your credentials** and sends nothing anywhere else. In the desktop app it reads the app's theme setting to match light or dark.

## Feedback and contributing

First release: I'd love to hear how it works for you. [Open an issue](https://github.com/anantraghunath/claude-code-usage-quota-mod/issues) for bugs or ideas. Pull requests welcome.

To work on it, clone the repo, then load it from the folder, or run its tests:

```bash
claude --plugin-dir ./claude-code-usage-quota-mod
```

```bash
claude plugin test ./claude-code-usage-quota-mod
```

**If you find it useful, a ⭐ helps others find it.**

## Credits

Inspired by [I'm liking the new mods feature](https://www.reddit.com/r/ClaudeCode/comments/1wwjman/im_liking_the_new_mods_feature/) on r/ClaudeCode. Thanks to [u/itsxzy](https://www.reddit.com/user/itsxzy/) for sharing the original prompt that started this project.

Agent-timed is inspired by [compactor](https://github.com/rhwendt/compactor) by rhwendt (MIT), which lets the agent hold and release Claude Code's own auto-compaction.

Keep cache warm is ported from [cache-warmer](https://github.com/paulbkim-dev/claude-code-cache-warmer) by Paul B. Kim (MIT), itself a port of the cache warmer in [Pi](https://github.com/earendil-works/pi) by Mario Zechner, whose rule decides when a refresh pays.

## License

[MIT](LICENSE) © 2026 Anant Raghunath
