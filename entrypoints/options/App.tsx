import { useEffect, useState, type ReactNode } from 'react';
import { testApiKey } from '@/lib/claude';
import { DEFAULT_BLOCKLIST, DEFAULT_STANDING_RULES, loadSettings, saveSettings } from '@/lib/settings';
import { checkSubscription } from '@/lib/subscription';
import type { ModelChoice, Provider, Settings } from '@/lib/types';

export default function App() {
  const [settings, setSettings] = useState<Settings>();
  const [blocklistText, setBlocklistText] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string; from: 'check' | 'save' }>();

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setBlocklistText(s.blocklist.join('\n'));
    });
  }, []);

  if (!settings) return null;
  const update = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const parsedBlocklist = () =>
    blocklistText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const save = async () => {
    await saveSettings({ ...settings, apiKey: settings.apiKey.trim(), blocklist: parsedBlocklist() });
    setStatus({ kind: 'ok', text: 'Saved.', from: 'save' });
  };

  const test = async () => {
    setStatus(undefined);
    try {
      if (settings.provider === 'subscription') {
        const s = await checkSubscription();
        if (!s.loggedIn) {
          setStatus({
            from: 'check',
            kind: 'error',
            text: 'Claude Code is installed but not signed in. Run `claude` in a terminal and sign in.',
          });
        } else if (s.authMethod !== 'claude.ai') {
          setStatus({
            from: 'check',
            kind: 'error',
            text: `Claude Code is signed in with ${s.authMethod ?? 'another method'}, not a Claude subscription. Runs will be billed that way.`,
          });
        } else {
          setStatus({
            from: 'check',
            kind: 'ok',
            text: `Connected: Claude Code is signed in to your ${s.subscriptionType ?? 'Claude'} plan.`,
          });
        }
      } else {
        await testApiKey(settings.apiKey.trim(), settings.model);
        setStatus({ from: 'check', kind: 'ok', text: 'The key works with this model.' });
      }
    } catch (err) {
      setStatus({ from: 'check', kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 text-sm">
      <header>
        <h1 className="text-xl font-semibold">AI Tab Grouper settings</h1>
        <p className="mt-1 text-zinc-500">Settings are stored in this browser only and are not synced.</p>
      </header>

      <Field label="Connect to Claude with">
        <div className="flex flex-col gap-2">
          <ProviderOption
            value="api"
            current={settings.provider}
            title="Anthropic API key"
            detail="Pay per run from your Anthropic Console account. Works anywhere, with no extra setup."
            onSelect={(provider) => {
              update({ provider });
              setStatus(undefined);
            }}
          />
          <ProviderOption
            value="subscription"
            current={settings.provider}
            title="Claude subscription (via Claude Code)"
            detail="Uses your Pro, Max, Team or Enterprise plan through the Claude Code CLI on this computer. Runs count against your plan's usage limits."
            onSelect={(provider) => {
              update({ provider });
              setStatus(undefined);
            }}
          />
        </div>
      </Field>

      {settings.provider === 'subscription' ? (
        <Field
          label="Claude Code bridge"
          hint="The extension asks a small local helper to run `claude -p` with your own login, with tools, MCP servers and CLAUDE.md turned off. The extension never sees your Claude credentials."
        >
          <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p>One-time setup: install Claude Code and sign in, then in the project folder run</p>
            <code className="self-start rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">
              npm run install-host
            </code>
            <p className="text-xs text-zinc-500">Run it again if you move the project folder.</p>
            <button className={`${secondaryButton} self-start`} onClick={test}>
              Check connection
            </button>
            {status?.from === 'check' && <StatusText status={status} />}
          </div>
        </Field>
      ) : (
        <Field
          label="Anthropic API key"
          hint="Create one at console.anthropic.com. It is only sent to api.anthropic.com."
        >
          <div className="flex gap-2">
            <input
              className={inputClass}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <button className={secondaryButton} onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button className={secondaryButton} disabled={!settings.apiKey.trim()} onClick={test}>
              Test
            </button>
          </div>
          {status?.from === 'check' && <StatusText status={status} />}
        </Field>
      )}

      <Field label="Model">
        <select
          className={inputClass}
          value={settings.model}
          onChange={(e) => update({ model: e.target.value as ModelChoice })}
        >
          <option value="claude-sonnet-5-5">
            Claude Sonnet 5.5: better at telling features apart
            {settings.provider === 'api' ? ' (a few cents per run)' : ''}
          </option>
          <option value="claude-haiku-5-5">
            Claude Haiku 5.5: {settings.provider === 'api' ? 'cheaper and faster' : 'faster, uses less of your plan'}
          </option>
        </select>
      </Field>

      <Field
        label="Standing rules"
        hint="Sent with every run. Describe your features and what belongs to each. The defaults are only an example: replace them with your own features."
        action={
          <button className={linkButton} onClick={() => update({ standingRules: DEFAULT_STANDING_RULES })}>
            Reset
          </button>
        }
      >
        <textarea
          className={`${inputClass} min-h-64 font-mono text-xs`}
          value={settings.standingRules}
          onChange={(e) => update({ standingRules: e.target.value })}
        />
      </Field>

      <Field
        label="Privacy blocklist"
        hint="One host per line. *.example.com also matches subdomains. Page text is never read from these hosts; only the tab title and a cleaned URL are sent."
        action={
          <button className={linkButton} onClick={() => setBlocklistText(DEFAULT_BLOCKLIST.join('\n'))}>
            Reset
          </button>
        }
      >
        <textarea
          className={`${inputClass} min-h-40 font-mono text-xs`}
          value={blocklistText}
          onChange={(e) => setBlocklistText(e.target.value)}
        />
      </Field>

      <Field
        label="Page text per tab"
        hint="Characters of visible text read from each tab. More gives Claude more context but costs more."
      >
        <input
          className={`${inputClass} w-32`}
          type="number"
          min={0}
          max={5000}
          step={250}
          value={settings.maxTextChars}
          onChange={(e) => update({ maxTextChars: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          onClick={save}
        >
          Save
        </button>
        {status?.from === 'save' && <StatusText status={status} />}
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const secondaryButton =
  'shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';
const linkButton = 'text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200';

function StatusText({ status }: { status: { kind: 'ok' | 'error'; text: string } }) {
  return (
    <span className={status.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
      {status.text}
    </span>
  );
}

function ProviderOption({
  value,
  current,
  title,
  detail,
  onSelect,
}: {
  value: Provider;
  current: Provider;
  title: string;
  detail: string;
  onSelect: (p: Provider) => void;
}) {
  const selected = value === current;
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
        selected ? 'border-zinc-900 dark:border-zinc-200' : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800'
      }`}
    >
      <input type="radio" name="provider" className="mt-0.5" checked={selected} onChange={() => onSelect(value)} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-zinc-500">{detail}</span>
      </span>
    </label>
  );
}

function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">{label}</h2>
        {action}
      </div>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </section>
  );
}
