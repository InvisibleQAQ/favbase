# Set up favbase for this agent

You are reading this because the user asked you to connect them to **favbase**,
a local-first browser extension that turns what they save on social media
(Bilibili favorites, GitHub stars, browser bookmarks, X bookmarks, Zhihu
favorites, YouTube playlists) into a searchable knowledge base that never
leaves their machine.

This document is a one-time setup guide, not the skill itself. Follow it once,
end to end, then discard it: step 3 installs the actual favbase skill, and that
skill is what you use from then on.

**Read all five steps before you start.** Step 3 requires the user to fetch a
value you cannot obtain yourself, so plan to pause there.

## What you are setting up

- `favbase`, a small Node CLI, installed globally.
- A pairing between that CLI and the user's running Chrome extension. The
  extension answers queries; the CLI only asks. Every command is read-only —
  there is no way to write to their library through it.
- The favbase skill, written into `~/.claude/skills/favbase/` (Claude Code) and
  `~/.agents/skills/favbase/` (Codex). Step 3's command does this for you.

## Step 1 — check Node.js

```bash
node --version
```

Node.js 20 or newer is required. If it is older or missing, stop and tell the
user to install Node.js 20+ first; do not try to install or upgrade Node
yourself.

## Step 2 — install the CLI

```bash
npm install -g favbase
```

Then confirm it is on `PATH`:

```bash
favbase --version
```

If the shell cannot find `favbase`, the global npm bin directory is not on
`PATH`. Report that to the user rather than guessing at a path — the fix
differs per platform and per Node version manager.

## Step 3 — ask the user for the pairing command (stop here)

Pairing needs a token that exists **only inside the user's running extension**.
You cannot read it, derive it or guess it. Ask for it, in these words or close
to them:

> In Chrome, open the favbase extension and go to **Settings → Connections →
> Agent Skills**. Switch it on, then click **Copy setup command** and paste the
> result here.

What they paste back looks like this — one line, with a real token and port
already filled in:

```
favbase setup --token <their token> --port <their port>
```

Treat that token as a secret: it grants read access to everything they saved.
Do not echo it back, do not write it into a file of your own, and do not put it
in a commit message or an issue.

If the user cannot find the extension: it is loaded in Chrome, and its Settings
page opens from the toolbar icon. The default port is `17836`, but use whatever
their command says — the extension and the CLI must agree.

## Step 4 — run what they pasted

Run that command exactly as given. Do not retype it, do not substitute a
placeholder token, and do not proceed with an invented value if the user has
not answered yet.

It writes `~/.favbase/config.json` and installs the favbase skill for Claude
Code and Codex. Add `--no-skill` only if the user explicitly asks you not to
install the skill; `favbase install-skill` can do it later on its own.

## Step 5 — verify

```bash
favbase doctor
```

`doctor` checks three things separately: the config file, the background daemon
and the link to the extension. Read its output rather than assuming success
from a zero exit code.

Then try one real query:

```bash
favbase search "test"
```

A `count` of `0` is a valid answer, not a failure — it means nothing they saved
matches that word.

## When something is wrong

| Symptom | What it means |
|---|---|
| exit code 1 | usage error, or the config is missing/invalid — re-run step 4 |
| exit code 2 | the daemon or the extension is unreachable — Chrome closed, or Agent Skills switched off |
| exit code 3 | the query itself failed inside the extension |
| a token mismatch | the extension's token was reset after pairing; ask for a fresh setup command, then run `favbase daemon restart` |

The extension reconnects on a periodic alarm, so the **first** call after Chrome
starts can wait roughly 30 seconds on Chrome 120+, or 60 seconds on Chrome
116–119. One slow first call is not a broken install.

## Rules

- Never fabricate the pairing token, the port or the setup command. If the user
  has not supplied them, stop and ask again.
- Chrome must stay open with the extension loaded while you query. There is no
  copy of the library outside it.
- After setup, use the installed skill. Do not keep following this file, and do
  not treat it as documentation of the commands — `favbase --help` is
  authoritative.
