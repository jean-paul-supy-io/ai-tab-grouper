import { describe, expect, it } from 'vitest';
import { buildUserMessage, findDuplicates, normalizeGrouping, placeDuplicates } from '../lib/grouping';
import type { TabInfo } from '../lib/types';

const tab = (id: number, title: string, url: string, extra: Partial<TabInfo> = {}): TabInfo => ({
  id,
  title,
  rawUrl: url,
  url,
  isLoginWall: false,
  dedupeKey: url,
  ...extra,
});

describe('normalizeGrouping', () => {
  const ids = [101, 102, 103, 104];

  it('maps tab numbers to tab ids and leaves unmentioned tabs ungrouped', () => {
    const out = normalizeGrouping(
      { groups: [{ name: 'Checkout Redesign', color: 'blue', reason: 'r', tabs: [1, 3] }], ungrouped: [2] },
      ids,
    );
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.tabIds).toEqual([101, 103]);
    expect(out.ungrouped).toEqual([102, 104]);
  });

  it('drops unknown numbers, keeps a tab in its first group, merges same-named groups', () => {
    const out = normalizeGrouping(
      {
        groups: [
          { name: 'Search', color: 'green', reason: '', tabs: [1, 9] },
          { name: 'Orders', color: 'red', reason: '', tabs: [1, 2] },
          { name: 'search ', color: 'pink', reason: '', tabs: [3] },
        ],
        ungrouped: [],
      },
      ids,
    );
    expect(out.groups.map((g) => [g.name, g.tabIds])).toEqual([
      ['Search', [101, 103]],
      ['Orders', [102]],
    ]);
    expect(out.ungrouped).toEqual([104]);
  });

  it('reuses a remembered color for a known group name', () => {
    const out = normalizeGrouping(
      { groups: [{ name: 'Orders', color: 'red', reason: '', tabs: [1, 2] }], ungrouped: [] },
      ids,
      { orders: 'cyan' },
    );
    expect(out.groups[0]!.color).toBe('cyan');
  });

  it('drops groups that end up empty', () => {
    const out = normalizeGrouping({ groups: [{ name: 'Ghost', color: 'grey', reason: '', tabs: [42] }], ungrouped: [] }, ids);
    expect(out.groups).toEqual([]);
  });
});

describe('duplicates', () => {
  const login = 'https://auth.acme.dev/login/email?clientId=web&redirectTo=https%253A%252F%252Fapp.acme.dev';

  it('finds sets and keeps the active tab', () => {
    const sets = findDuplicates([
      { id: 1, url: login },
      { id: 2, url: login, active: true },
      { id: 3, url: login },
      { id: 4, url: 'https://github.com/acme/inventory-service/pull/2160' },
      { id: 5, url: 'https://github.com/acme/inventory-service/pull/2160' },
      { id: 6, url: 'https://github.com/acme/inventory-service/pull/2160/changes' },
    ]);
    expect(sets).toEqual([
      { keepId: 2, duplicateIds: [1, 3] },
      { keepId: 4, duplicateIds: [5] },
    ]);
  });

  it('places duplicates next to the tab they copy', () => {
    const out = placeDuplicates(
      [{ key: 'g1', name: 'Inventory', color: 'blue', reason: '', tabIds: [4, 6] }],
      [2],
      [
        { keepId: 2, duplicateIds: [1, 3] },
        { keepId: 4, duplicateIds: [5] },
      ],
    );
    expect(out.groups[0]!.tabIds).toEqual([4, 5, 6]);
    expect(out.ungrouped).toEqual([2, 1, 3]);
  });
});

describe('buildUserMessage', () => {
  it('numbers tabs, includes context, and never includes the raw URL', () => {
    const msg = buildUserMessage({
      tabs: [
        tab(10, 'feat: new checkout flow #3', 'https://github.com/acme/checkout-web/pull/3', {
          rawUrl: 'https://github.com/acme/checkout-web/pull/3?token=SECRET',
          text: 'Adds broadcast state',
        }),
        tab(11, 'Sign in', 'https://auth.acme.dev/login/email', {
          destination: 'https://app.acme.dev/',
          isLoginWall: true,
          contentSkipped: 'login',
        }),
      ],
      duplicateCounts: { 11: 4 },
      standingRules: 'Checkout Redesign: checkout-web',
      runPrompt: '',
    });
    expect(msg).toContain('"tab":1');
    expect(msg).toContain('"page_text":"Adds broadcast state"');
    expect(msg).toContain('"login_page_destination":"https://app.acme.dev/"');
    expect(msg).toContain('"open_copies":5');
    expect(msg).toContain('<standing_rules>\nCheckout Redesign: checkout-web');
    expect(msg).not.toContain('SECRET');
  });
});

describe('normalizeGrouping repairs', () => {
  it('maps unknown colors to grey and accepts "gray"', () => {
    const out = normalizeGrouping(
      {
        groups: [
          { name: 'A', color: 'magenta', reason: '', tabs: [1] },
          { name: 'B', color: 'Gray', reason: '', tabs: [2] },
        ],
        ungrouped: [],
      },
      [1, 2],
    );
    expect(out.groups.map((g) => g.color)).toEqual(['grey', 'grey']);
  });

  it('ignores non-integer tab numbers', () => {
    const out = normalizeGrouping({ groups: [{ name: 'A', color: 'blue', reason: '', tabs: [1.5, 2] }], ungrouped: [] }, [1, 2]);
    expect(out.groups[0]!.tabIds).toEqual([2]);
    expect(out.ungrouped).toEqual([1]);
  });
});
