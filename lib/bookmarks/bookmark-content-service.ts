/**
 * Serial extraction worker for the bookmarks content pipeline: drains the
 * 'pending' queue (./bookmarks-sync-service.ts), fetches + extracts each page
 * (./bookmark-content.ts), and settles contentState per the failure taxonomy:
 *
 * - unfetchable URL / 4xx / non-HTML / oversized / below-threshold extraction
 *   → 'no_content' (permanent, never retried);
 * - 5xx / 429 / timeout / network → stays 'pending' (self-heals on the next
 *   run; an in-run attempted set prevents same-run re-picks);
 * - one item's failure never aborts the run.
 *
 * Strictly serial with an inter-request delay — bookmark collections cluster
 * by domain, so global-serial IS per-host-serial (the politeness that
 * matters). Orchestration + inert DOM extraction run in app.html; arbitrary
 * network fetches run in the background SW so response resource hints cannot
 * affect the page Document/CSP. Embedding / tagging / progress events are wired by
 * the caller against `chunkedItemIds` / `onProgress` — this module has zero
 * storage / AI / UI imports.
 */

import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { emitDomainEvent } from '@/lib/events';
import {
  countPendingExtractions,
  getPendingExtractionTargets,
  markItemNoContent,
  saveBookmarkContent,
} from './bookmarks-sync-service';
import {
  classifyUrl,
  extractMarkdown,
} from './bookmark-content';
import { fetchBookmarkPageInBackground } from './bookmark-page-client';
import type { FetchPageResult } from './bookmark-page-fetch';

export type BookmarkPageFetcher = (url: string) => Promise<FetchPageResult>;

/** Queue page size — one SELECT per batch, small enough to interleave with UI reads. */
const BATCH_SIZE = 50;
/** Default pause between network requests (politeness / anti-ban). */
const DEFAULT_DELAY_MS = 1000;

export interface ExtractionProgress {
  /** Items settled this run (all outcomes). */
  done: number;
  /** Pending backlog measured at run start. */
  total: number;
  /** Target currently being processed; absent until the first target starts. */
  current?: { url: string; title: string };
}

export interface ExtractPendingOptions {
  db?: FavbaseDb;
  /** Test seam returning structured results; production delegates to background. */
  fetchPage?: BookmarkPageFetcher;
  onProgress?: (p: ExtractionProgress) => void;
  /**
   * Fired right after each item flips to 'chunked' (content persisted) with
   * its platformItemId — the per-item embed/tag seam. Per-item (not run-end)
   * so a page close mid-run can't orphan already-chunked items: chunked items
   * are never re-picked by a later run. Listener errors are swallowed — they
   * must not break the run.
   */
  onItemExtracted?: (platformItemId: string) => void;
  /** Cooperative cancel — checked between items (the in-flight item finishes). */
  signal?: AbortSignal;
  /** Pause between network requests; default 1000ms. */
  delayMs?: number;
}

export interface ExtractionRunResult {
  /** Items attempted this run (all outcomes). */
  processed: number;
  /**
   * platformItemIds (normalized URLs) flipped to 'chunked' this run — the
   * embed/tag seam, same addressing as the platforms' `Sync*Result.newItemIds`
   * (`embedNewItems` / `tagNewItems` take platform + platformItemIds).
   */
  chunkedItemIds: string[];
  /** Items settled as permanent 'no_content' this run. */
  noContent: number;
  /** Items left 'pending' (transient failure — the next run retries them). */
  transient: number;
}

/**
 * Drain the extraction queue. Resumable by construction: successes and
 * permanent failures leave 'pending', so a fresh run (next page-open) picks up
 * exactly what's left — including items that failed transiently this run.
 */
export async function extractPendingBookmarks(
  opts: ExtractPendingOptions = {},
): Promise<ExtractionRunResult> {
  const db = opts.db ?? getDb();
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  const result: ExtractionRunResult = {
    processed: 0,
    chunkedItemIds: [],
    noContent: 0,
    transient: 0,
  };

  const total = await countPendingExtractions(db);
  if (total === 0) return result;
  opts.onProgress?.({ done: 0, total });

  /** itemIds already attempted this run — transient failures stay 'pending'
   *  in the DB and must not be re-picked until the next run. */
  const attempted = new Set<string>();
  let fetchedOnce = false; // delay only BETWEEN network requests

  while (!opts.signal?.aborted) {
    // Over-fetch by the attempted count so accumulated transient failures
    // (still 'pending', sorted first) can't pin the batch window — every
    // iteration is guaranteed to surface fresh targets if any exist.
    const batch = await getPendingExtractionTargets(attempted.size + BATCH_SIZE, db);
    const fresh = batch.filter((t) => !attempted.has(t.itemId));
    if (fresh.length === 0) break;

    for (const target of fresh) {
      if (opts.signal?.aborted) break;
      attempted.add(target.itemId);
      const current = { url: target.url, title: target.title };
      opts.onProgress?.({ done: result.processed, total, current });

      const settleNoContent = async () => {
        await markItemNoContent(target.itemId, db);
        result.noContent += 1;
        emitDomainEvent('item-content-updated', {
          platform: 'bookmarks',
          platformItemId: target.platformItemId,
        });
      };

      try {
        if (!classifyUrl(target.url)) {
          // Localhost / private IP / dotless host — settled without a request.
          await settleNoContent();
        } else {
          if (fetchedOnce && delayMs > 0) await sleep(delayMs);
          fetchedOnce = true;
          const page = await (opts.fetchPage ?? fetchBookmarkPageInBackground)(target.url);

          if (page.kind === 'transient') {
            result.transient += 1;
          } else if (page.kind === 'permanent') {
            await settleNoContent();
          } else {
            const extracted = extractMarkdown(page.html, target.url);
            if (extracted === null) {
              await settleNoContent();
            } else {
              await saveBookmarkContent(target.itemId, extracted.markdown, db);
              result.chunkedItemIds.push(target.platformItemId);
              emitDomainEvent('item-content-updated', {
                platform: 'bookmarks',
                platformItemId: target.platformItemId,
              });
              try {
                opts.onItemExtracted?.(target.platformItemId);
              } catch (err) {
                // Listener failure must not reclassify an already-chunked item.
                console.warn('[bookmark-content] onItemExtracted listener failed:', err);
              }
            }
          }
        }
      } catch (err) {
        // One item must never abort the run — leave it 'pending' (transient).
        console.warn('[bookmark-content] extraction failed for %s:', target.url, err);
        result.transient += 1;
      }

      result.processed += 1;
      opts.onProgress?.({ done: result.processed, total, current });
    }
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
