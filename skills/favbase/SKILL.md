---
name: favbase
description: Search the user's own saved collections (Bilibili favorites, GitHub stars, browser bookmarks, X bookmarks, Zhihu collections, YouTube playlists) through the local favbase browser extension. Use whenever the user asks what they saved, bookmarked, starred or favorited, or wants an answer grounded in their own collection. Read-only; runs the `favbase` CLI.
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
- `favbase` is on `PATH` (`npm install -g favbase-cli`), or prefix every
  command with `npx -y favbase-cli`.
- One-time pairing (the user does this once, values come from that settings
  card): `favbase setup --token <Bridge Token> --port <port>`.
- `favbase doctor` verifies config, background daemon and extension link.

## Commands

All data commands print JSON to stdout; diagnostics go to stderr.

```
favbase tags [--platform <platform>]
favbase search "<query>" [--platform <platform>] [--tag <tag-id>] [--limit <1-20>]
favbase get <item-id>
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
   `count: 0` means the user saved nothing on that topic; say so instead of
   guessing.
3. When a `chunk_text` snippet is too short, `favbase get <item_id>` returns
   `{ "found", "item_id", "content" }` with the full extracted text.
4. Answer from the returned text and cite each source by `title` and `url`.

## Errors and exit codes

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | success | use the JSON on stdout |
| 1 | usage or missing config | show the stderr message; the user must run `favbase setup` |
| 2 | daemon or extension unreachable | ask the user to open Chrome and enable Agent Bridge; the first call after Chrome starts can wait up to ~35 s |
| 3 | Knowledge Tool error (bad argument, tool failure) | read the stderr message and adjust the arguments |

The background daemon starts automatically on the first data command and exits
after two idle hours; `favbase daemon stop` ends it early.
