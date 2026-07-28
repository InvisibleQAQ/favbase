<p align="right">
  <strong>English</strong> · <a href="./README_zh_CN.md">简体中文</a>
</p>

<img src="./assets/readme/hero.svg" alt="favbase brings favorites from Bilibili, GitHub, browser bookmarks, X, Zhihu, and YouTube into one local knowledge base" width="100%">

favbase is a local-first Chromium extension for people whose useful links are scattered across platforms. It collects saved content into a browser-local library, makes it searchable, and lets you ask questions with links back to the originals.

> [!IMPORTANT]
> favbase is under active development. There is no browser-store package or GitHub Release yet, so trying it currently requires a [source build](#install-from-source).

## What you can do

- **Bring six libraries together.** Browse favorites, stars, bookmarks, and playlists without jumping between platform UIs.
- **Turn saved content into knowledge.** Extract text, split it into searchable chunks, create tags, and build embeddings in a local PGlite database.
- **Find more than exact words.** Combine keyword and semantic retrieval across the collection.
- **Ask with evidence.** Chat over collected content and open the cited saved item behind each answer.
- **Recover useful video text.** Use official Bilibili subtitles when available, with configurable ASR as a fallback.
- **Keep an exit path.** Export a JSON or CSV backup, or generate an Obsidian-ready ZIP.

## How it works

<img src="./assets/readme/workflow.svg" alt="Conceptual flow from collecting saved content, through local organization, to search and cited answers" width="100%">

The diagram is a product-flow explanation, not a screenshot. A collected favorite becomes a **Collection Item** with its source URL and metadata. When content is available, favbase can chunk, tag, and embed it for retrieval. Search and Chat keep results tied to the original item so you can verify the context yourself.

## Supported sources

| Source | What favbase collects | Connection |
| --- | --- | --- |
| Bilibili | Favorite folders, videos, and available subtitle text | Your existing Bilibili browser session |
| GitHub | Starred repositories and repository details | A GitHub personal access token |
| Browser Bookmarks | Bookmark folders, links, and extractable page text | Local browser bookmark access |
| X | Bookmarks and post metadata | Your existing X browser session |
| Zhihu | Favorite collections, answers, and articles | Your existing Zhihu browser session |
| YouTube | Playlists, videos, and available metadata | A YouTube Data API key |

GitHub and YouTube must be configured under **Settings → Connections** before their first sync. Bilibili, X, and Zhihu reuse the login already present in the browser; favbase does not ask you to paste those account passwords.

## Privacy boundaries

“Local-first” describes where the knowledge database lives by default: favbase stores it in browser-local PGlite backed by IndexedDB. It does **not** mean every operation is offline or remains on-device.

- Collecting from a platform sends requests to that platform using the connection described above.
- LLM, embedding, ASR, and compatible AI features send the relevant query, text, or media to the provider you configure.
- Experimental WebDAV support currently synchronizes the whole app configuration and locale, **not the knowledge-base database**. That configuration can include API keys or tokens, so only use a WebDAV endpoint you trust.
- Export files contain your library data. Store and share them accordingly.

You can import and browse collected items without configuring every AI service. Semantic retrieval, AI tagging, Chat, and transcription fallbacks require their corresponding provider settings.

## Install from source

### Requirements

- A Chromium-based browser
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### Build and load

```bash
git clone https://github.com/InvisibleQAQ/favbase.git
cd favbase
pnpm install
pnpm build
```

1. Open your browser's extensions page, such as `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `.output/chrome-mv3` directory.

After installation, open favbase, choose a source, and run its first sync. Configure GitHub or YouTube credentials first if either is your starting source. Configure an embedding provider for semantic retrieval and an LLM provider for Chat or AI-generated tags.

## Development

favbase is built with WXT, React, TypeScript, PGlite/pgvector, and Vitest.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the extension development build |
| `pnpm build` | Create a production Chromium build |
| `pnpm compile` | Run TypeScript checks without emitting files |
| `pnpm test` | Run the test suite |

Architecture notes and implementation specifications live in [`docs/`](./docs/). Some documents record historical decisions; current source and tests remain authoritative when an older plan disagrees with the implementation.

## Project status and license

favbase is pre-release software. Expect incomplete flows and migration risk; keep backups of data you care about. Issues and focused pull requests are welcome.

Licensed under the [GNU General Public License v3.0](./LICENSE).
