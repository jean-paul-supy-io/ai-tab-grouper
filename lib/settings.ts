import { browser } from 'wxt/browser';
import type { GroupColor, Settings } from './types';

export const DEFAULT_STANDING_RULES = `Group tabs by the feature or workstream they belong to, not by website.
For a pull request, issue or doc, decide the feature from its title and content, not from the repo or domain name.

Features I'm working on (replace these examples with your own):
- Checkout Redesign: the checkout-web repo and its PRs, the staging checkout app, payment provider docs I'm reading for it.
- Search: the search-service repo, search relevance dashboards, Elasticsearch docs.
- Dev Tooling: CI runs, preview environments, localhost apps.

Tabs that clearly don't belong to a feature (music, shopping, unrelated reading) stay ungrouped.`;

export const DEFAULT_BLOCKLIST = [
  // Mail, chat and accounts
  'mail.google.com',
  'outlook.office.com',
  'outlook.live.com',
  'app.slack.com',
  'web.whatsapp.com',
  'web.telegram.org',
  'accounts.google.com',
  // Password managers
  '*.1password.com',
  'vault.bitwarden.com',
  '*.lastpass.com',
  // Payments
  '*.paypal.com',
  // Add your bank, production dashboards and other sensitive hosts here:
  // only the tab title and a cleaned URL are sent for them.
];

export const DEFAULT_SETTINGS: Settings = {
  provider: 'api',
  apiKey: '',
  model: 'claude-sonnet-5-5',
  standingRules: DEFAULT_STANDING_RULES,
  blocklist: DEFAULT_BLOCKLIST,
  maxTextChars: 1500,
};

// The API key lives in local storage only (never synced to other devices).
export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}

/** Colors remembered per group name, so a feature keeps its color across runs. */
export async function loadGroupColors(): Promise<Record<string, GroupColor>> {
  const stored = await browser.storage.local.get('groupColors');
  return (stored.groupColors as Record<string, GroupColor> | undefined) ?? {};
}

export async function rememberGroupColors(groups: { name: string; color: GroupColor }[]): Promise<void> {
  const colors = await loadGroupColors();
  for (const g of groups) colors[g.name.trim().toLowerCase()] = g.color;
  await browser.storage.local.set({ groupColors: colors });
}
