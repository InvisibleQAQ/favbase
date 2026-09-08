---
name: favbase
description: Search the user's own saved collections (Bilibili favorites, GitHub stars, browser bookmarks, X bookmarks, Zhihu favorites, YouTube playlists) through the local favbase browser extension. Use whenever the user asks what they saved, bookmarked, starred or favorited, or wants an answer grounded in their own collection. Read-only; runs the `favbase` CLI.
allowed-tools: Bash(favbase:*)
---

# favbase

favbase is a local-first browser extension that turns the user's social-media
favorites into a searchable knowledge base. The `favbase` CLI queries that
library through the running Chrome extension. Nothing leaves the machine and
nothing is ever written to the library.

## When to use

- The user asks what they saved / bookmarked / starred / favorited, or asks a
  question that their own collection could answer ("what did I save about
  Rust async?", "find that video on sourdough I favorited").
- Never answer such questions from memory: run a search first and cite what it
  returns.

## Prerequisites

- Chrome is running with favbase installed and **Settings > Connections >
  Agent Bridge** switched on.
- `favbase` is on `PATH`. If it is not, stop and ask the user to run
  `npm install -g favbase` (Node.js 20+). This skill may only run the
  `favbase` command itself: you cannot install it, and no other runner will be
  permitted.
- One-time pairing (the user does this once, values come from that settings
  card): `favbase setup --token <Bridge Token> --port <port>`.
- `favbase doctor` verifies config, background daemon and extension link.

## Commands

All data commands print JSON to stdout; diagnostics go to stderr.

```
favbase tags [--platform <platform>]
favbase search "<query>" [--platform <platform>] [--tag <tag-id>] [--limit <1-20>]
favbase get <item-id>
favbase coverage [--platform <platform>]
favbase tools                       # Knowledge Tools the extension advertises, with JSON Schemas
favbase call <tool> --args '<json>' # call any advertised tool directly
favbase doctor                      # config + daemon + extension status
```

`<platform>` is one of `bilibili`, `github`, `bookmarks`, `x`, `zhihu`,
`youtube`. Omit it to search everything. `favbase --help` is authoritative if
this file and the CLI disagree.

## Workflow

1. Not sure how the user organizes things? `favbase tags` lists tags with item
   counts; pass a tag id to `search --tag` to narrow.
2. `favbase search "<query>"` runs hybrid retrieval (vector + keyword; Chinese
   and English both work). Output:
   `{ "count": n, "results": [{ "item_id", "title", "url", "platform", "chunk_text", "score" }] }`.
   A `count: 0`, or a result set that looks suspiciously thin, is **not** by
   itself evidence that the user saved nothing — go to step 3 before saying so.
3. `favbase coverage` reports each platform's processing progress:
   `{ "platforms": [{ "platform", "acquisition", "content", "embedding",
   "tagging", "blockers" }] }`, each stage as `done`/`total`. It separates the
   three causes of an empty search, which need three different answers:
   - `acquisition.done` is 0 — that platform was never fetched. Ask the user to
     open favbase and fetch it; do not report an empty topic.
   - a later stage is behind (`embedding.done` < `embedding.total`) — the items
     are saved but not searchable yet. Say what is still being processed.
   - `blockers` is non-empty — that stage has no provider configured and will
     **never** advance on its own. Point the user at the extension's Settings
     page; do **not** tell them to try again later.
   Each blocker is `{ "capability", "pending" }`, and `capability` is only ever
   `embedding` or `llm`. The content stage has no blocker entry — its provider
   readiness is not visible to this command — so an empty `blockers` does **not**
   prove content is advancing. If `content.done` sits at the same number across
   calls, treat it like a blocker: send the user to Settings instead of telling
   them to wait.
   Report progress in the platform's own vocabulary: `content.kind` names what
   "content" means there, so a `transcript` platform is "1100 transcribed", not
   "1100 content acquisitions". `acquisition.total` is always `null` because the
   remote total is not knowable — say "1100 fetched so far", never "fully
   synced".
4. When a `chunk_text` snippet is too short, `favbase get <item_id>` returns
   `{ "found", "item_id", "content" }` with the full extracted text.
5. Answer from the returned text and cite each source by `title` and `url`.

## Errors and exit codes

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | success | use the JSON on stdout |
| 1 | usage or missing config | show the stderr message; the user must run `favbase setup` |
| 2 | daemon or extension unreachable | run `favbase doctor`; fix the reported Chrome, Agent Bridge, port, or Bridge Token check |
| 3 | Knowledge Tool error (bad argument, tool failure) | read the stderr message and adjust the arguments |

An already connected bridge has no alarm wait and uses local RPC. After Chrome
or the daemon starts, reconnection can take one alarm period: about 30 seconds
on Chrome 120+ or about 60 seconds on Chrome 116-119. If it takes longer, run
`favbase doctor`.

The background daemon starts automatically on the first data command. Once no
extension is connected, it exits after two hours without a CLI request;
`favbase daemon stop` ends it early.
