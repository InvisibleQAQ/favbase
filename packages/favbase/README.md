# favbase

Read-only command line access to your own [favbase](https://github.com/InvisibleQAQ/favbase) library, for AI coding agents on the same machine.

favbase is a local-first browser extension that turns the things you save on social media — favorites, stars, bookmarks, playlists — into a searchable knowledge base built in your browser. This package is the Node half of its **Agent Bridge**: a thin `favbase` CLI plus a loopback daemon that lets Claude Code, Codex or any other agent query that library.

**Nothing leaves your machine.** The daemon listens only on `127.0.0.1`, the running extension connects out to it, and retrieval happens inside the extension. This CLI holds no data, no API keys and no credentials beyond the pairing token you paste in once. Every command is read-only; there is no way to write to your library through it.

Requires Node.js 20+ and the favbase extension running in Chrome.

## Install and pair

```bash
npm install -g favbase
```

In the extension open **Settings > Connections > Agent Skills**, switch it on, and copy the pairing token and port. Then pair once:

```bash
favbase setup --token <pairing token> --port <port>
```

That writes `~/.favbase/config.json` and installs the Agent Skill for Claude Code (`~/.claude/skills/favbase/`) and Codex (`~/.agents/skills/favbase/`), so an agent learns the commands on its own. Pass `--no-skill` to skip that, or install only the skill later with `favbase install-skill`.

```bash
favbase doctor
```

`doctor` checks the config, the background daemon and the link to the extension. It also reports whether this CLI is the latest release (`cli`) and whether each installed copy of the Agent Skill matches the one this CLI ships (`skills`: `current`, `stale` or `missing`); neither changes its exit code. A copy installed with `install-skill --dir` is outside the two default locations and invisible to it. Chrome must be running with the extension loaded for queries to work.

## Commands

Data commands print JSON to stdout; every diagnostic goes to stderr.

```
favbase search "<query>" [--platform <platform>] [--tag <tag_id>] [--limit <top_k>]
favbase tags [--platform <platform>]
favbase get <item-id>
favbase coverage [--platform <platform>]

favbase tools                            # the Knowledge Tools the extension advertises, with JSON Schemas
favbase call <tool> [--args '<json>']    # call any advertised tool directly
favbase call <tool> --args-file <path>   # the same, with the JSON object in a UTF-8 file

favbase setup --token <token> [--port <port>] [--no-skill]
favbase install-skill [--agent claude|codex|all] [--dir <path>]
favbase doctor
favbase daemon [run|start|stop|restart]
```

`search` runs hybrid retrieval (vector + keyword) inside the extension and answers with `{ count, results: [{ item_id, title, url, platform, chunk_text, score }] }`. A `count` of `0` means nothing you saved matches — not that the search failed. When a `chunk_text` snippet is too short to answer from, `favbase get <item_id>` returns `{ found, item_exists, item_id, content }`, with the full extracted text in `content` when `found` is true. `item_exists: false` means no saved item has that id — the id is wrong, not the library empty. `item_exists: true` with `found: false` means the item is saved but its text has not been extracted (yet); `coverage` shows how far processing has got.

`coverage` answers the question a `count` of `0` raises next: per platform it reports how many items have been fetched and how far each processing stage (content, embedding, tags) has got, plus `blockers` — a stage whose AI provider is not configured and so will never advance on its own. That is the difference between "you saved nothing about this", "it is still being processed" and "it will never be processed until you configure a provider". The fetched count has no denominator on purpose: the remote total is not knowable, so nothing here claims your library is fully synced.

For the accepted `--platform` values run `favbase tools` — the tool schemas are generated from whatever the installed extension actually supports, so they are always current. `favbase --help` is authoritative if this file and the CLI ever disagree.

`search`, `tags`, `get` and `coverage` are ergonomic aliases over the extension's Knowledge Tools. `tools` and `call` are the zero-knowledge channel: anything the extension advertises is reachable without a CLI update.

`call` takes the tool's arguments as one JSON object, inline with `--args` or from a file with `--args-file`. Windows PowerShell 5.1 strips the double quotes out of an inline argument, so use the file there; a path survives every shell. The file must be UTF-8 (a byte order mark is fine): PowerShell 5.1's `>` writes UTF-16, so save it with `Set-Content -Encoding utf8` instead.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | usage error, or missing/invalid configuration |
| 2 | the daemon or the extension is unreachable |
| 3 | the Knowledge Tool itself returned an error |

Exit code 2 usually means Chrome is closed or Agent Skills is switched off. The extension reconnects on a periodic alarm, so the first call after Chrome starts can wait roughly 30 seconds on Chrome 120+, or 60 seconds on Chrome 116–119. `favbase doctor` reports which half of the link is missing.

## The daemon

The first data command starts a background daemon automatically (detached, logging to `~/.favbase/daemon.log`). It serves the extension's WebSocket and the CLI's HTTP routes on one loopback port, and exits on its own once no authenticated extension is connected and no CLI request has arrived for a while. `favbase daemon run|start|stop|restart` controls it explicitly.

After an upgrade, the first command that talks to the daemon replaces one still running the older version (it says so on stderr). A daemon newer than the CLI that reaches it is kept, so two installed versions never take turns restarting it.

## Update check

Chrome updates the extension on its own; a global npm install never updates itself. So the CLI checks whether a newer `favbase` has been published and, if so, ends its stderr with one line:

```
[favbase] favbase <latest> is available (installed <version>). Upgrade with npm install -g favbase@latest, then run favbase doctor.
```

It never changes stdout or the exit code, and nothing is installed for you. After upgrading, `favbase doctor` tells you which skill copies to refresh with `favbase install-skill --agent <agent>`.

This is the only request the CLI sends off your machine; everything else stays on loopback between the CLI, its daemon and the extension. It sends a plain `GET /favbase/latest` to `registry.npmjs.org` and `registry.npmmirror.com` at the same time and takes the highest version either reports; the mirror is there because the official registry is often unreachable from mainland China. The request carries no pairing token, no query and nothing from your library. It uses Node's built-in `fetch`, which by default does not read `HTTP(S)_PROXY`. The answer (or the failure to get one) is cached in `~/.favbase/update-check.json` for 24 hours, and the check gives up after 1.5 seconds. Data commands, `setup` and `install-skill` use the cache; `doctor` always asks. `--version`, `--help` and `daemon` commands never check. Set `FAVBASE_NO_UPDATE_CHECK=1` to turn it off entirely.

CLI requests must carry the pairing token as a bearer token, and any request arriving with an `Origin` header is rejected before authentication — so a web page cannot reach the daemon by fetching `127.0.0.1`.

## Configuration

| Variable | Effect |
|---|---|
| `FAVBASE_TOKEN` | pairing token, overrides the config file |
| `FAVBASE_BRIDGE_PORT` | port, overrides the config file |
| `FAVBASE_HOME` | config/log root, default `~/.favbase` |
| `FAVBASE_DAEMON_IDLE_MINUTES` | idle timeout, default `120`; `0` never exits |
| `FAVBASE_NO_UPDATE_CHECK` | any value but `0` turns off the update check and its cache |

Resolution order is environment variable, then `~/.favbase/config.json`, then the shared default port.

## Links

- Extension, source and issues: [github.com/InvisibleQAQ/favbase](https://github.com/InvisibleQAQ/favbase)
- The Agent Skill this package installs: [`skills/favbase/SKILL.md`](https://github.com/InvisibleQAQ/favbase/blob/main/skills/favbase/SKILL.md)

## License

GPL-3.0-only. See [LICENSE](./LICENSE).
