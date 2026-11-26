# clauderot

A Claude Code plugin that plays YouTube Shorts in a small side window while Claude works.

- Opens about 3s after you submit a prompt, so quick answers don't open it.
- Moves to the next short automatically when the current one ends.
- Pauses with a "✋ Claude needs your input" banner on permission prompts and questions, and resumes once you answer.
- Pauses with a "✅ Claude is done" banner when Claude finishes.

## Requirements

- **Node 22+**, available as `node` on the `PATH` that Claude Code sees. If you use nvm, fnm or similar and launch Claude Code from a desktop app, make sure that app inherits your Node.
- **Chrome, Chromium, Brave or Edge.** It's found automatically. If yours lives somewhere else, set `CLAUDEROT_BROWSER`.
- A graphical desktop. The player is a real browser window, so it won't work over plain SSH or in a headless WSL shell.

There are no npm dependencies and no build step.

## Install

From GitHub, inside Claude Code:

```
/plugin marketplace add VaheHayrapetyan24/clauderot
/plugin install clauderot@clauderot
```

Or from a local clone:

```bash
git clone https://github.com/VaheHayrapetyan24/clauderot.git
```

```
/plugin marketplace add /path/to/clauderot
/plugin install clauderot@clauderot
```

Then restart Claude Code. The next prompt that takes longer than 3 seconds opens the player.

## Control

| Command | Effect |
|---|---|
| `/clauderot:shorts status` | Shows whether it's enabled, whether the player is open, and whether Claude is working (also the default with no argument) |
| `/clauderot:shorts off` | Disables the plugin and closes the window |
| `/clauderot:shorts on` | Re-enables it |
| `/clauderot:shorts close` | Closes the window for now. It reopens on the next prompt |

The player uses its own Chrome profile in `~/.clauderot/chrome-profile`, separate from your normal browser, so you can sign in to YouTube there once.

## Configuration

Set these in the environment Claude Code is launched from:

```bash
export CLAUDEROT_DELAY=5
```

Or put them in the `env` block of `~/.claude/settings.json` so they apply however Claude Code starts:

```json
{ "env": { "CLAUDEROT_DELAY": "5" } }
```

| Env var | Default | |
|---|---|---|
| `CLAUDEROT_DELAY` | `3` | Seconds before the window appears |
| `CLAUDEROT_ON_STOP` | `pause` | `pause` or `close` when Claude finishes |
| `CLAUDEROT_BROWSER` | auto | Path to a Chromium-based browser |
| `CLAUDEROT_PORT` | `9877` | DevTools port the player is controlled through |
| `CLAUDEROT_URL` | `https://www.youtube.com/shorts` | Start page |
| `CLAUDEROT_HOME` | `~/.clauderot` | Where the state, browser profile and log are kept |

## Troubleshooting

Logs go to `~/.clauderot/clauderot.log`.

- **The window never opens:** check the log. `no Chrome/Chromium found` means you need to set `CLAUDEROT_BROWSER`.
- **Another app is using port 9877:** set `CLAUDEROT_PORT` to a free port.
- **Nothing happens at all:** run `/clauderot:shorts status`. If it says `disabled`, run `/clauderot:shorts on`. Also check that `node --version` shows 22 or newer.

## Uninstall

```
/plugin uninstall clauderot@clauderot
```

To also delete the saved profile and logs:

```bash
rm -rf ~/.clauderot
```
