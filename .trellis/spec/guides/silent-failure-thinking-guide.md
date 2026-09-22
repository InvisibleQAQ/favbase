# Silent Failure Thinking Guide

> **Purpose**: Some changes fail in places `pnpm test` cannot look, with an error
> that names none of the files you touched. Recognize the shape before you ship.

This guide holds **triggers and symptoms only**. Every rule lives with its owner
(a directory `CLAUDE.md`) and its guard (a test); duplicating a rule here would
just give it a second place to rot.

---

## Gotcha 1: A new module reaches the Background Service Worker through a barrel

**Symptom**: `pnpm test` and `pnpm compile` are green. `pnpm build` fails with

```
Error: Background module graph contains PGlite markers: pglite.wasm (chunks/protocol-*.js), ...
```

The message names a bundler chunk. It names none of your files.

**Cause**: The Background SW runs Chat's tools and the Agent Bridge, so anything
they reach is in that graph. A barrel (`@/lib/collections`, `@/lib/database`)
re-exports far more than the symbol you wanted — one hop lands on drizzle and the
PGlite runtime, which must never enter the SW bundle.

**Trigger — ask this whenever**:

- a Knowledge Tool, `lib/chat/*` or `lib/agent-bridge/*` module gains an import
- a module those reach transitively gains one (the chain matters, not the file)
- you write `import type` from a barrel in such a module — erasure is what keeps
  it safe, so deleting one `type` keyword is a build break with no local signal

**Prevention checklist**:

- [ ] Import the leaf, not the barrel (`@/lib/database/db-state`, not `@/lib/database`)
- [ ] Run `pnpm build`, not just `pnpm test` — this class is invisible to vitest
- [ ] Extend `tests/agent-bridge-background-bundle-contract.test.ts` to cover the
      new link, so the next person gets a named failure in seconds
- [ ] Owners: `lib/collections/CLAUDE.md`, `lib/agent-bridge/CLAUDE.md`,
      `scripts/check-background-bundle.mjs`

---

## Gotcha 2: A tool's known limit lives only in prose

**Symptom**: Everything passes, and the model confidently gives advice that is
permanently wrong — "still processing, check back later" about work that will
never advance.

**Cause**: A limit written in a PRD, a JSDoc or a review comment is invisible to
the model. If the tool's returned fields imply one story and the limit tells
another, the model believes the fields. Worse, nothing reds when the limit
changes, because prose has no guard.

**Trigger — ask this whenever** a tool exposed to a model (Chat or Agent Bridge —
they carry the identical tool set) has a blind spot: a state it cannot read, a
capability it deliberately omits, a denominator it cannot know.

**Prevention checklist**:

- [ ] State the limit in the **model-facing** text — the `description`, the
      system prompt, `skills/favbase/SKILL.md` — not only in a code comment
- [ ] Say what the reader should *do* instead, or they will pick the wrong action
      themselves ("a static count means Settings, not try-again-later")
- [ ] Guard it by **deriving** the honest set from the same function the tool
      calls, then asserting the model-facing text names each member. A hand-written
      list of limits rots the moment the blind spot is fixed; a derived one reds.
      Pattern: `lib/chat/tools.test.ts`
- [ ] Owners: `lib/chat/CLAUDE.md`, `skills/favbase/CLAUDE.md`

---

## Gotcha 3: The id matches because it is an echo; the content is someone else's

**Symptom**: Stored content belongs to a different item — one video's transcript
is another video's subtitles — yet every id along the way agrees: the request,
the cache key, the response's `videoId`. Tests are green and a line-by-line
review of the chain finds nothing wrong.

**Cause**: The only identity the chain compares is one it carried itself. The
pipeline stamps the requested id onto the response, and a cache is keyed by
whatever id its writer claims. When the remote API returns another item's content
inside a correct envelope (Bilibili's non-wbi `x/player/v2`, docs/29 C1), a gate
on that id is a tautology — the 4dad4df gate says so in its own commit message.
A shared cache is only as trustworthy as its least trustworthy writer: one bad
writer poisons every reader that treats a hit as fact.

**Trigger — ask this whenever**:

- you add a gate that compares an id the pipeline carried along: what would it
  compare if the *content* were wrong?
- you persist or cache remote content under the id you *asked for*
- you add a writer to a cache another runtime reads as truth (`vc:*` via
  `CACHE_SUBTITLE`, read by the transcription pipeline's first step)

**Prevention checklist**:

- [ ] Find an owner marker inside the content and check it before trusting the
      content (Bilibili AI subtitle files are named `{aid}{cid}{md5}`); decide on
      purpose what happens when the marker is missing — `ownsSubtitleUrl` fails
      closed on a missing `aid` but passes URLs that name no owner (docs/29 §7)
- [ ] Take the comparison key from your own request, not the response, so a
      wholly foreign response still mismatches
- [ ] Lock it with a red-green test whose fixture is a real foreign response, not
      an invented one. Pattern: `lib/bilibili/bilibili-api.test.ts`
- [ ] Owners: `lib/bilibili/CLAUDE.md` (`fetchSubtitle` / `ownsSubtitleUrl`),
      docs/29 §2-§3
