import { browser, type Browser } from 'wxt/browser';
import { findDuplicates } from './grouping';
import type { DuplicateSet, Settings, TabInfo } from './types';
import { cleanUrl, dedupeKey, isBlocked } from './url';

interface PageContext {
  description: string;
  headings: string[];
  text: string;
}

/**
 * Runs inside the page. Must be self-contained: it is serialized and injected,
 * so it cannot reference anything outside its own body.
 */
function extractPageContext(maxChars: number): PageContext {
  const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const meta = (name: string) =>
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content ?? '';
  const headings = Array.from(document.querySelectorAll('h1, h2'))
    .map((h) => squash(h.textContent))
    .filter((h) => h.length > 0 && h.length < 200)
    .slice(0, 8);
  const main = document.querySelector<HTMLElement>('main, article, [role="main"]') ?? document.body;
  return {
    description: squash(meta('description') || meta('og:description')).slice(0, 300),
    headings,
    text: squash(main?.innerText).slice(0, maxChars),
  };
}

const EXTRACT_TIMEOUT_MS = 3000;

async function readTab(tabId: number, maxChars: number): Promise<PageContext> {
  const run = browser.scripting.executeScript({
    target: { tabId },
    func: extractPageContext,
    args: [maxChars],
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), EXTRACT_TIMEOUT_MS);
  });
  try {
    const [result] = await Promise.race([run, timeout]);
    if (!result?.result) throw new Error('no result');
    return result.result as PageContext;
  } finally {
    clearTimeout(timer);
  }
}

function isScriptable(url: string): boolean {
  if (!/^https?:/.test(url)) return false;
  // Chrome blocks extensions from injecting into the Web Store.
  return !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

export interface GatherResult {
  /** Every unpinned tab in the window, keyed by id. */
  tabs: Record<number, TabInfo>;
  /** Tab order as it appears in the strip. */
  order: number[];
  duplicates: DuplicateSet[];
}

/** Collect context for every unpinned tab in `windowId`. */
export async function gatherTabs(
  windowId: number,
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<GatherResult> {
  const chromeTabs = (await browser.tabs.query({ windowId, pinned: false })).filter(
    (t): t is Browser.tabs.Tab & { id: number } => t.id !== undefined,
  );

  let done = 0;
  const infos = await Promise.all(
    chromeTabs.map(async (t): Promise<TabInfo> => {
      const rawUrl = t.url ?? t.pendingUrl ?? '';
      const cleaned = cleanUrl(rawUrl);
      const info: TabInfo = {
        id: t.id,
        title: (t.title ?? '').slice(0, 200),
        rawUrl,
        favIconUrl: t.favIconUrl,
        url: cleaned.url,
        destination: cleaned.destination,
        isLoginWall: cleaned.isLoginWall,
        dedupeKey: dedupeKey(rawUrl),
      };

      if (isBlocked(rawUrl, settings.blocklist)) info.contentSkipped = 'blocked';
      else if (cleaned.isLoginWall) info.contentSkipped = 'login';
      else if (t.discarded || t.status === 'unloaded') info.contentSkipped = 'unloaded';
      else if (!isScriptable(rawUrl)) info.contentSkipped = 'restricted';
      else {
        try {
          const ctx = await readTab(t.id, settings.maxTextChars);
          info.description = ctx.description || undefined;
          info.headings = ctx.headings.length ? ctx.headings : undefined;
          info.text = ctx.text || undefined;
        } catch {
          info.contentSkipped = 'error';
        }
      }
      onProgress?.(++done, chromeTabs.length);
      return info;
    }),
  );

  const tabs: Record<number, TabInfo> = {};
  for (const info of infos) tabs[info.id] = info;

  return {
    tabs,
    order: chromeTabs.map((t) => t.id),
    duplicates: findDuplicates(chromeTabs),
  };
}
