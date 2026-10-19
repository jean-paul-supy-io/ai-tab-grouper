export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** Everything we know about one tab, gathered before asking Claude. */
export interface TabInfo {
  /** Chrome tab id. */
  id: number;
  title: string;
  /** Original URL — stays in the browser, never sent to Claude. */
  rawUrl: string;
  favIconUrl?: string;
  /** Cleaned URL (tokens stripped) that is sent to Claude. */
  url: string;
  /** For login walls: the cleaned page the login redirects to. */
  destination?: string;
  isLoginWall: boolean;
  /** Why page text is missing, if it is. */
  contentSkipped?: 'blocked' | 'login' | 'unloaded' | 'restricted' | 'error';
  description?: string;
  headings?: string[];
  text?: string;
  dedupeKey: string;
}

/** A set of tabs showing the same page. */
export interface DuplicateSet {
  keepId: number;
  /** Tab ids proposed for closing (all except `keepId`). */
  duplicateIds: number[];
}

export interface DraftGroup {
  /** Local id for React keys and drag-and-drop targets. */
  key: string;
  name: string;
  color: GroupColor;
  reason: string;
  tabIds: number[];
}

/** The editable proposal shown in the side panel before applying. */
export interface Proposal {
  windowId: number;
  groups: DraftGroup[];
  ungrouped: number[];
  duplicates: DuplicateSet[];
  /** Tab ids the user ticked to close. */
  toClose: number[];
  tabs: Record<number, TabInfo>;
}

export type ModelChoice = 'claude-sonnet-5-5' | 'claude-haiku-5-5';

/** `api`: the user's Anthropic API key. `subscription`: their Claude plan, through the local Claude Code CLI. */
export type Provider = 'api' | 'subscription';

export interface Settings {
  provider: Provider;
  apiKey: string;
  model: ModelChoice;
  standingRules: string;
  blocklist: string[];
  maxTextChars: number;
}
