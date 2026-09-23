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
      content (a Bilibili original AI subtitle file is named `{aid}{cid}{md5}`).
      A marker has three states — names us, names someone else, names nobody —
      and "names nobody" is not "someone else". `ownsSubtitleUrl` passes uploader
      CC and B站's machine translations (a bare md5), and fails closed only on a
      claim it cannot verify (missing `aid`). Reading a bare name as foreign
      refused every translated zh track (docs/29 Step 1b; URL-shape drift, §7)
- [ ] Judge the marker over everything one response returned, not just the item
      you picked: the picked item may name nobody while its sibling names someone
      else. Pattern: the whole-list check in `fetchSubtitle`. Then write down the
      flip side: when nothing in the response names an owner, there is nothing to
      compare and it passes — decide that on purpose (docs/29 Step 1b「残留」)
- [ ] When a probe applies your rule, its labels are the rule's verdicts, not
      ground truth. Before acting on "FOREIGN", check whether the item is the same
      across requests and endpoints and appears in a known-good response — that is
      how docs/29 E1's five "foreign" tracks turned out to be the video's own
- [ ] Take the comparison key from your own request, not the response, so a
      wholly foreign response still mismatches
- [ ] Lock it with a red-green test whose fixture is a real foreign response, not
      an invented one. Pattern: `lib/bilibili/bilibili-api.test.ts`
- [ ] Owners: `lib/bilibili/CLAUDE.md` (`fetchSubtitle` / `ownsSubtitleUrl`),
      docs/29 §2-§3

---

## Gotcha 4: The check that cannot fail, and the gate that looks dead

**Symptom**: A test named after a rule stays green when the rule is broken; or
a logged-out user can still browse, and the UI says they are logged in.

**Cause**: Two shapes met in docs/29 Step 4, both found only by trellis-check:

- **Vacuous assertion.** "No `Cookie` header" was asserted with
  `Object.keys(init.headers)`. `RequestInit.headers` also takes a
  `[name, value][]` array (keys read as `'0'`) and a `Headers` instance (keys
  read as `[]`), so a Cookie written either way passed. The assertion only
  covered the shape the current code happened to use.
- **Gate that looks dead.** Once `fetchFavVideos` stopped taking `auth`, its
  callers' `await checkAuth()` produced no used value — it reads as dead code.
  But it is the only thing that turns "logged out" into `BiliAuthError` before a
  request, and a public folder's `resource/list` answers anonymously, so
  deleting it fails nothing: the page loads and the hook reports `logged_in`.

docs/27 Step 6 turned up two more, again found only by trellis-check:

- **Vacuous presence.** The rule was "the `item_exists=false` clause names
  `searchKnowledgeBase` as the next step", and the test asserted it with
  `toContain('searchKnowledgeBase')` over the whole description. The first
  sentence already says that word, so deleting the clause's instruction left
  the test 19/19 green.
- **The copy that looks alive**, the mirror image of the dead-looking gate.
  `AliasFlag.help` held `1-20 (default 8)` and was treated as a visible
  second copy of the `top_k` range. A user decision was argued from it and a
  guard was written for it. Nothing had ever rendered it (`usage()` only calls
  `aliasUsageLine`, which prints `[--limit <top_k>]`). The guard protected
  text that no one could see, and the premise behind the decision was false.

**Trigger — ask this whenever**:

- you assert the *absence* of something: does the reader see every shape the
  input type allows?
- you assert that a text *contains* a token the text may already contain
  somewhere else
- you are about to sync, guard or argue from a "copy" of a fact: which code
  path shows it to someone?
- a call's result stops being used after a refactor, but the call has to stay

**Prevention checklist**:

- [ ] Before trusting a new assertion, break the code on purpose in every
      allowed input shape and watch it go red. Pattern: `writtenHeaderNames` in
      `lib/bilibili/bilibili-api.test.ts`
- [ ] When a test asserts a refusal, also assert *what* the refusal names, or
      it stays green while the code refuses for the wrong reason. docs/29 Step 1b's
      case C was predicted green on the old code (it did refuse — the wrong track);
      only "the log names the foreign track" made it red. Pattern: the
      `with machine-translated tracks` cases in `lib/bilibili/bilibili-api.test.ts`
- [ ] Scope a presence assertion to the clause the rule is about (for example,
      split on `。` and search only the sentence that introduces the state), then
      delete the instruction and watch it go red. Pattern: the "next step"
      cases in `lib/chat/tools.test.ts`
- [ ] Before treating a field or string as a copy someone reads, grep for its
      *reads*, not its definition, and run the surface that supposedly shows it
      (`favbase --help`). An unread copy gets deleted, not guarded (docs/27 D9)
- [ ] Give a kept-for-its-effect call a one-line comment saying it is a gate, a
      test per caller that deletes-it-and-goes-red, and a line in the owner's
      `CLAUDE.md`. Pattern: the two「refuses to … without a Bilibili login」cases
      in `lib/bilibili/bili-sync-service.test.ts`; owner `lib/bilibili/CLAUDE.md`
      「B 站认证」

---

## Gotcha 5: An error changes exit code, and the agent gets different advice

**Symptom**: The fix is correct and every test passes. The agent, though, now
tells the user to run `favbase setup` because of a typo in the agent's own
command.

**Cause**: SKILL.md's exit-code table *is* the agent's error handling. It maps
each code to an action. docs/27 Step 6 moved `--limit 0` from exit 3 ("read the
stderr message and adjust the arguments") to exit 1, a code shared by usage
errors and missing config. Exit 1's row only knew about missing config ("the
user must run `favbase setup`"), so the moved error picked up that advice.
No test checks what the table *tells the agent to do*.

**Trigger — ask this whenever**:

- an error moves to a different exit code, or a new error lands in a code that
  already has a meaning
- a code starts to cover more than one kind of error

**Prevention checklist**:

- [ ] Reread the destination row in `skills/favbase/SKILL.md` as the agent
      would: does its action fit the error that just arrived?
- [ ] If a code covers several kinds of error, give the row a way to tell them
      apart using something the agent can see in the output (usage errors end
      with `Run favbase --help for usage.`)
- [ ] Lock that marker by quoting the CLI's *actual* output into SKILL.md in a
      test, rather than a hand-typed copy. Pattern: the `--limit 0` case in
      `packages/favbase/cli-main.test.ts`
- [ ] Owners: `skills/favbase/CLAUDE.md`, `packages/favbase/CLAUDE.md`
