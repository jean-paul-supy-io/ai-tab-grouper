import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Preview } from '@/components/Preview';
import { applyProposal, getUndoSnapshot, undoLastApply } from '@/lib/apply';
import { GroupingError, requestGrouping } from '@/lib/claude';
import { gatherTabs } from '@/lib/gather';
import { normalizeGrouping, placeDuplicates } from '@/lib/grouping';
import { loadGroupColors, loadSettings } from '@/lib/settings';
import type { Proposal, TabInfo } from '@/lib/types';

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; done: number; total: number }
  | { name: 'thinking'; count: number }
  | { name: 'preview' }
  | { name: 'applying' }
  | { name: 'applied' };

const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};

export default function App() {
  const [windowId, setWindowId] = useState<number>();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState<{ message: string; settings?: boolean }>();
  const [canUndo, setCanUndo] = useState(false);
  const [tabCount, setTabCount] = useState(0);
  const [model, setModel] = useState('');

  const refresh = useCallback(async (win: number) => {
    const [tabs, snap, settings] = await Promise.all([
      browser.tabs.query({ windowId: win, pinned: false }),
      getUndoSnapshot(win),
      loadSettings(),
    ]);
    setTabCount(tabs.length);
    setCanUndo(Boolean(snap));
    const label = MODEL_LABEL[settings.model] ?? settings.model;
    setModel(settings.provider === 'subscription' ? `${label} · subscription` : label);
  }, []);

  useEffect(() => {
    browser.windows.getCurrent().then((w) => {
      if (w.id === undefined) return;
      setWindowId(w.id);
      refresh(w.id);
    });
    browser.storage.local.get('lastPrompt').then((s) => setPrompt((s.lastPrompt as string | undefined) ?? ''));
  }, [refresh]);

  // Keep the tab count and model label current while the panel is open.
  useEffect(() => {
    if (windowId === undefined) return;
    const update = () => refresh(windowId);
    browser.tabs.onCreated.addListener(update);
    browser.tabs.onRemoved.addListener(update);
    browser.storage.onChanged.addListener(update);
    return () => {
      browser.tabs.onCreated.removeListener(update);
      browser.tabs.onRemoved.removeListener(update);
      browser.storage.onChanged.removeListener(update);
    };
  }, [windowId, refresh]);

  const run = async () => {
    if (windowId === undefined) return;
    setError(undefined);
    browser.storage.local.set({ lastPrompt: prompt });
    const settings = await loadSettings();
    if (settings.provider === 'api' && !settings.apiKey) {
      setError({ message: 'Add your Anthropic API key in Settings first.', settings: true });
      return;
    }

    try {
      setPhase({ name: 'reading', done: 0, total: tabCount });
      const gathered = await gatherTabs(windowId, settings, (done, total) => setPhase({ name: 'reading', done, total }));
      if (gathered.order.length === 0) {
        setError({ message: 'There are no unpinned tabs in this window.' });
        setPhase({ name: 'idle' });
        return;
      }

      const duplicateIds = new Set(gathered.duplicates.flatMap((d) => d.duplicateIds));
      const unique: TabInfo[] = gathered.order.filter((id) => !duplicateIds.has(id)).map((id) => gathered.tabs[id])
        .filter((t): t is TabInfo => t !== undefined);
      const duplicateCounts = Object.fromEntries(gathered.duplicates.map((d) => [d.keepId, d.duplicateIds.length]));

      setPhase({ name: 'thinking', count: unique.length });
      const result = await requestGrouping(settings, {
        tabs: unique,
        duplicateCounts,
        standingRules: settings.standingRules,
        runPrompt: prompt,
      });

      const normalized = normalizeGrouping(result, unique.map((t) => t.id), await loadGroupColors());
      const placed = placeDuplicates(normalized.groups, normalized.ungrouped, gathered.duplicates);
      setProposal({
        windowId,
        ...placed,
        duplicates: gathered.duplicates,
        toClose: [...duplicateIds],
        tabs: gathered.tabs,
      });
      setPhase({ name: 'preview' });
    } catch (err) {
      setPhase({ name: 'idle' });
      setError({
        message: err instanceof Error ? err.message : String(err),
        settings: err instanceof GroupingError && (err.kind === 'auth' || err.kind === 'setup'),
      });
    }
  };

  const apply = async () => {
    if (!proposal) return;
    setPhase({ name: 'applying' });
    try {
      await applyProposal(proposal);
      setPhase({ name: 'applied' });
      setProposal(undefined);
      setCanUndo(true);
    } catch (err) {
      setPhase({ name: 'preview' });
      setError({ message: `Could not apply the groups: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const undo = async () => {
    if (windowId === undefined) return;
    setError(undefined);
    try {
      await undoLastApply(windowId);
      setCanUndo(false);
      setPhase({ name: 'idle' });
    } catch (err) {
      setError({ message: `Undo failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const busy = phase.name === 'reading' || phase.name === 'thinking' || phase.name === 'applying';
  const skipped = proposal ? Object.values(proposal.tabs).filter((t) => t.contentSkipped === 'blocked').length : 0;

  return (
    <div className="flex min-h-screen flex-col text-sm">
      <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div>
          <h1 className="text-sm font-semibold">AI Tab Grouper</h1>
          <p className="text-xs text-zinc-500">
            {tabCount} tabs in this window{model && ` · ${model}`}
          </p>
        </div>
        <button
          className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {phase.name !== 'preview' && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Instructions for this run (optional)</span>
              <textarea
                className="min-h-20 resize-y rounded-md border border-zinc-300 bg-white p-2 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                placeholder="e.g. Split Orders into dev and prod. Put all Flink docs with Production Planning."
                value={prompt}
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run();
                }}
              />
            </label>
            <button
              className="rounded-md bg-zinc-900 px-3 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              disabled={busy || windowId === undefined}
              onClick={run}
            >
              {phase.name === 'reading'
                ? `Reading tabs… ${phase.done}/${phase.total}`
                : phase.name === 'thinking'
                  ? `Asking Claude about ${phase.count} tabs…`
                  : phase.name === 'applying'
                    ? 'Applying…'
                    : 'Group tabs'}
            </button>
            {phase.name === 'applied' && <p className="text-xs text-zinc-500">Groups applied.</p>}
            {canUndo && !busy && (
              <button className="self-start text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300" onClick={undo}>
                Undo last grouping
              </button>
            )}
          </>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error.message}
            {error.settings && (
              <button className="ml-1 underline" onClick={() => browser.runtime.openOptionsPage()}>
                Open Settings
              </button>
            )}
          </div>
        )}

        {phase.name === 'preview' && proposal && (
          <>
            <p className="text-xs text-zinc-500">
              {proposal.groups.length} groups, {proposal.ungrouped.length} ungrouped
              {proposal.toClose.length > 0 && `, ${proposal.toClose.length} ${proposal.toClose.length === 1 ? 'duplicate' : 'duplicates'} to close`}
              {skipped > 0 && ` · ${skipped} ${skipped === 1 ? 'tab' : 'tabs'} sent as title only`}. Rename groups, drag tabs between them, then apply.
            </p>
            <Preview proposal={proposal} onChange={setProposal} />
          </>
        )}
      </main>

      {phase.name === 'preview' && proposal && (
        <footer className="sticky bottom-0 flex gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            className="flex-1 rounded-md bg-zinc-900 px-3 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            onClick={apply}
          >
            Apply
          </button>
          <button
            className="rounded-md border border-zinc-300 px-3 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={() => {
              setProposal(undefined);
              setPhase({ name: 'idle' });
            }}
          >
            Discard
          </button>
        </footer>
      )}
    </div>
  );
}
