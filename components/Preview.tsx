import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { COLOR_HEX } from '@/lib/colors';
import { GROUP_COLORS, type DraftGroup, type GroupColor, type Proposal, type TabInfo } from '@/lib/types';

const UNGROUPED = 'ungrouped';

interface PreviewProps {
  proposal: Proposal;
  onChange: (next: Proposal) => void;
}

/** Editable preview: rename and recolor groups, drag tabs between them, tick duplicates to close. */
export function Preview({ proposal, onChange }: PreviewProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const duplicateIds = new Set(proposal.duplicates.flatMap((d) => d.duplicateIds));
  const closing = new Set(proposal.toClose);

  const updateGroup = (key: string, patch: Partial<DraftGroup>) =>
    onChange({ ...proposal, groups: proposal.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) });

  const removeGroup = (key: string) => {
    const group = proposal.groups.find((g) => g.key === key);
    onChange({
      ...proposal,
      groups: proposal.groups.filter((g) => g.key !== key),
      ungrouped: [...proposal.ungrouped, ...(group?.tabIds ?? [])],
    });
  };

  const addGroup = () => {
    const used = new Set(proposal.groups.map((g) => g.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) ?? 'grey';
    const key = `new${Date.now()}`;
    onChange({ ...proposal, groups: [...proposal.groups, { key, name: 'New group', color, reason: '', tabIds: [] }] });
  };

  const toggleClose = (id: number) =>
    onChange({ ...proposal, toClose: closing.has(id) ? proposal.toClose.filter((t) => t !== id) : [...proposal.toClose, id] });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const tabId = Number(active.id);
    const target = String(over.id);
    const groups = proposal.groups.map((g) => ({ ...g, tabIds: g.tabIds.filter((id) => id !== tabId) }));
    let ungrouped = proposal.ungrouped.filter((id) => id !== tabId);
    if (target === UNGROUPED) ungrouped = [...ungrouped, tabId];
    else {
      const g = groups.find((x) => x.key === target);
      if (!g) return;
      g.tabIds.push(tabId);
    }
    onChange({ ...proposal, groups, ungrouped });
  };

  const rowProps = (id: number) => ({
    tab: proposal.tabs[id],
    isDuplicate: duplicateIds.has(id),
    closing: closing.has(id),
    onToggleClose: () => toggleClose(id),
  });

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-3">
        {proposal.groups.map((g) => (
          <Bucket key={g.key} id={g.key} accent={COLOR_HEX[g.color]}>
            <div className="flex items-center gap-2">
              <ColorPicker value={g.color} onChange={(color) => updateGroup(g.key, { color })} />
              <input
                className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none focus:bg-zinc-100 dark:focus:bg-zinc-800"
                value={g.name}
                maxLength={40}
                aria-label="Group name"
                onChange={(e) => updateGroup(g.key, { name: e.target.value })}
              />
              <span className="text-xs text-zinc-500">{g.tabIds.length}</span>
              <button
                className="rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="Remove group (tabs become ungrouped)"
                onClick={() => removeGroup(g.key)}
              >
                ×
              </button>
            </div>
            {g.reason && <p className="mt-0.5 px-1 text-xs text-zinc-500">{g.reason}</p>}
            <ul className="mt-1.5 flex flex-col">
              {g.tabIds.map((id) => (
                <TabRow key={id} {...rowProps(id)} />
              ))}
              {g.tabIds.length === 0 && <EmptyHint />}
            </ul>
          </Bucket>
        ))}

        <button
          className="self-start rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={addGroup}
        >
          + New group
        </button>

        <Bucket id={UNGROUPED} accent="transparent" dashed>
          <div className="px-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            Ungrouped <span className="font-normal text-zinc-500">· {proposal.ungrouped.length}</span>
          </div>
          <ul className="mt-1.5 flex flex-col">
            {proposal.ungrouped.map((id) => (
              <TabRow key={id} {...rowProps(id)} />
            ))}
            {proposal.ungrouped.length === 0 && <EmptyHint />}
          </ul>
        </Bucket>
      </div>
    </DndContext>
  );
}

function Bucket({ id, accent, dashed, children }: { id: string; accent: string; dashed?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-lg border p-2 transition-colors ${dashed ? 'border-dashed' : ''} ${
        isOver ? 'border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/60' : 'border-zinc-200 dark:border-zinc-700'
      }`}
      style={{ borderLeftWidth: dashed ? undefined : 4, borderLeftColor: dashed ? undefined : accent }}
    >
      {children}
    </section>
  );
}

function EmptyHint() {
  return <li className="px-1 py-1 text-xs text-zinc-400">Drag tabs here</li>;
}

interface TabRowProps {
  tab: TabInfo | undefined;
  isDuplicate: boolean;
  closing: boolean;
  onToggleClose: () => void;
}

function TabRow({ tab, isDuplicate, closing, onToggleClose }: TabRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(tab?.id ?? -1) });
  if (!tab) return null;
  const host = hostOf(tab.rawUrl);
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex cursor-grab items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-100 active:cursor-grabbing dark:hover:bg-zinc-800 ${
        isDragging ? 'relative z-10 bg-white shadow-md dark:bg-zinc-800' : ''
      }`}
    >
      <Favicon url={tab.favIconUrl} host={host} />
      <button
        className={`min-w-0 flex-1 text-left ${closing ? 'text-zinc-400 line-through' : ''}`}
        title={`${tab.title}\n${tab.rawUrl}`}
        onClick={() => browser.tabs.update(tab.id, { active: true })}
      >
        <span className="block truncate">{tab.title || host}</span>
        <span className="block truncate text-xs text-zinc-500">
          {tab.destination ? `login → ${hostOf(tab.destination)}` : host}
          {tab.contentSkipped === 'blocked' && ' · title only'}
        </span>
      </button>
      {isDuplicate && (
        <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-500" title="This tab is a duplicate">
          <input type="checkbox" checked={closing} onChange={onToggleClose} />
          close
        </label>
      )}
    </li>
  );
}

function Favicon({ url, host }: { url?: string; host: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed || url.startsWith('chrome://')) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
        {host.replace(/^www\./, '').charAt(0)}
      </span>
    );
  }
  return <img src={url} alt="" className="h-4 w-4 shrink-0" onError={() => setFailed(true)} />;
}

function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="block h-4 w-4 rounded-full ring-offset-1 hover:ring-2 hover:ring-zinc-300"
        style={{ background: COLOR_HEX[value] }}
        title="Change color"
        aria-label={`Color: ${value}`}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="absolute left-0 top-6 z-20 flex gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              className={`h-5 w-5 rounded-full ${c === value ? 'ring-2 ring-zinc-500 ring-offset-1' : ''}`}
              style={{ background: COLOR_HEX[c] }}
              title={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host || u.protocol;
  } catch {
    return url;
  }
}
