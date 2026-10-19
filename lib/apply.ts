import { browser } from 'wxt/browser';
import { rememberGroupColors } from './settings';
import type { GroupColor, Proposal } from './types';

interface SnapshotTab {
  id: number;
  url: string;
  index: number;
  groupId: number;
  pinned: boolean;
}

interface SnapshotGroup {
  id: number;
  title?: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface Snapshot {
  windowId: number;
  takenAt: number;
  tabs: SnapshotTab[];
  groups: SnapshotGroup[];
}

const UNDO_KEY = 'undoSnapshot';
const NO_GROUP = -1;

async function takeSnapshot(windowId: number): Promise<Snapshot> {
  const tabs = await browser.tabs.query({ windowId });
  const groups = await browser.tabGroups.query({ windowId });
  return {
    windowId,
    takenAt: Date.now(),
    tabs: tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({ id: t.id!, url: t.url ?? t.pendingUrl ?? '', index: t.index, groupId: t.groupId, pinned: t.pinned })),
    groups: groups.map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed })),
  };
}

export async function getUndoSnapshot(windowId: number): Promise<Snapshot | undefined> {
  const stored = await browser.storage.session.get(UNDO_KEY);
  const snap = stored[UNDO_KEY] as Snapshot | undefined;
  return snap?.windowId === windowId ? snap : undefined;
}

/** Apply a proposal to the window: close ticked tabs, rebuild groups, ungrouped tabs at the end. */
export async function applyProposal(proposal: Proposal): Promise<void> {
  const { windowId } = proposal;
  const snapshot = await takeSnapshot(windowId);
  await browser.storage.session.set({ [UNDO_KEY]: snapshot });

  // Tabs may have been closed or moved since the preview was built.
  const live = new Set(
    (await browser.tabs.query({ windowId, pinned: false })).map((t) => t.id).filter((id) => id !== undefined),
  );
  const toClose = new Set(proposal.toClose.filter((id) => live.has(id)));
  const keep = (ids: number[]) => ids.filter((id) => live.has(id) && !toClose.has(id));

  const grouped = snapshot.tabs.filter((t) => !t.pinned && t.groupId !== NO_GROUP && live.has(t.id)).map((t) => t.id);
  if (grouped.length) await browser.tabs.ungroup(grouped as [number, ...number[]]);
  if (toClose.size) await browser.tabs.remove([...toClose]);

  for (const group of proposal.groups) {
    const tabIds = keep(group.tabIds);
    if (!tabIds.length) continue;
    const groupId = await browser.tabs.group({
      tabIds: tabIds as [number, ...number[]],
      createProperties: { windowId },
    });
    await browser.tabGroups.update(groupId, { title: group.name, color: group.color, collapsed: false });
    await browser.tabGroups.move(groupId, { index: -1 });
  }

  const loose = keep(proposal.ungrouped);
  if (loose.length) await browser.tabs.move(loose, { index: -1 });

  await rememberGroupColors(proposal.groups);
}

/** Put the window back the way it was before the last apply, reopening closed tabs. */
export async function undoLastApply(windowId: number): Promise<void> {
  const snapshot = await getUndoSnapshot(windowId);
  if (!snapshot) return;

  const current = await browser.tabs.query({ windowId });
  const currentIds = new Set(current.map((t) => t.id));

  // Map snapshot tab ids to live ids, reopening tabs that were closed.
  const idMap = new Map<number, number>();
  for (const t of snapshot.tabs) {
    if (currentIds.has(t.id)) {
      idMap.set(t.id, t.id);
    } else if (t.url && !t.pinned) {
      const reopened = await browser.tabs.create({ windowId, url: t.url, active: false });
      if (reopened.id !== undefined) idMap.set(t.id, reopened.id);
    }
  }

  const unpinnedNow = current.filter((t) => !t.pinned && t.groupId !== NO_GROUP && t.id !== undefined).map((t) => t.id!);
  if (unpinnedNow.length) await browser.tabs.ungroup(unpinnedNow as [number, ...number[]]);

  // Restore order first, then groups: grouped tabs were contiguous originally,
  // so after reordering each group can be rebuilt in place.
  const ordered = [...snapshot.tabs].sort((a, b) => a.index - b.index);
  for (const [i, t] of ordered.entries()) {
    const id = idMap.get(t.id);
    if (id !== undefined && !t.pinned) await browser.tabs.move(id, { index: i });
  }

  for (const g of snapshot.groups) {
    const members = ordered
      .filter((t) => t.groupId === g.id)
      .map((t) => idMap.get(t.id))
      .filter((id): id is number => id !== undefined);
    if (!members.length) continue;
    const groupId = await browser.tabs.group({ tabIds: members as [number, ...number[]], createProperties: { windowId } });
    await browser.tabGroups.update(groupId, { title: g.title, color: g.color, collapsed: g.collapsed });
  }

  await browser.storage.session.remove(UNDO_KEY);
}
