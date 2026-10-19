// Native messaging host for AI Tab Grouper.
//
// Chrome starts this script when the extension is set to "Claude subscription".
// It runs the official Claude Code CLI (`claude -p`) as you, with your own
// login, and hands the structured result back to the extension. It never reads
// or forwards your Claude credentials: the CLI handles authentication itself.
//
// Protocol: Chrome writes one message (4-byte little-endian length + JSON) to
// stdin and waits for one reply in the same framing on stdout.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MODELS = new Set(['claude-sonnet-5-5', 'claude-haiku-5-5']);
const EFFORTS = new Set(['low', 'medium', 'high']);
const RUN_TIMEOUT_MS = 180_000;

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const claudePath = loadConfig().claudePath || 'claude';

function readMessage() {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    process.stdin.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      try {
        resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('end', () => reject(new Error('stdin closed before a full message arrived')));
  });
}

function reply(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

/** Run the CLI with an argument array (no shell), optionally feeding stdin. */
function runClaude(args, input) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    // In print mode an API key in the environment wins over the subscription
    // login, so remove it to make sure the run uses your plan.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    let child;
    try {
      child = spawn(claudePath, args, { cwd: here, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), spawnError: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, spawnError: true });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: signal !== null });
    });
    child.stdin.end(input ?? '');
  });
}

function classify(text) {
  if (/not logged in|please run \/login|claude auth login|invalid api key|authentication/i.test(text)) return 'auth';
  if (/usage limit|rate limit|limit reached|too many requests/i.test(text)) return 'rate_limit';
  return 'api';
}

async function status() {
  const run = await runClaude(['auth', 'status']);
  if (run.spawnError) {
    return { ok: false, kind: 'setup', error: `Could not start Claude Code (${claudePath}). Is it installed? Re-run npm run install-host.` };
  }
  try {
    const s = JSON.parse(run.stdout);
    return { ok: true, loggedIn: Boolean(s.loggedIn), authMethod: s.authMethod ?? null, subscriptionType: s.subscriptionType ?? null };
  } catch {
    return { ok: false, kind: 'api', error: (run.stderr || run.stdout).trim().slice(0, 500) || 'Unexpected output from claude auth status.' };
  }
}

async function group(msg) {
  if (!MODELS.has(msg.model)) return { ok: false, kind: 'invalid', error: `Unsupported model: ${msg.model}` };
  const effort = EFFORTS.has(msg.effort) ? msg.effort : 'medium';
  if (typeof msg.system !== 'string' || typeof msg.prompt !== 'string' || typeof msg.schema !== 'object') {
    return { ok: false, kind: 'invalid', error: 'Malformed request from the extension.' };
  }

  const args = [
    '-p',
    'Group the browser tabs described on stdin, following the system prompt. Reply only with the structured output.',
    '--model', msg.model,
    '--effort', effort,
    '--system-prompt', msg.system,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(msg.schema),
    // No tools, no MCP servers, no CLAUDE.md, plugins or hooks: this run only reads text and answers.
    '--tools', '',
    '--disallowedTools', 'mcp__*',
    '--safe-mode',
    '--no-session-persistence',
    '--max-turns', '4',
  ];
  const run = await runClaude(args, msg.prompt);

  if (run.spawnError) {
    return { ok: false, kind: 'setup', error: `Could not start Claude Code (${claudePath}). Is it installed? Re-run npm run install-host.` };
  }
  if (run.timedOut) return { ok: false, kind: 'network', error: 'Claude Code took too long to answer.' };

  let result;
  try {
    result = JSON.parse(run.stdout.trim());
  } catch {
    const text = (run.stderr || run.stdout).trim().slice(0, 500);
    return { ok: false, kind: classify(text), error: text || `Claude Code exited with code ${run.code}.` };
  }

  if (result.is_error || result.subtype !== 'success') {
    const text = [result.result, ...(result.errors ?? [])].filter(Boolean).join(' ').slice(0, 500) || result.subtype;
    return { ok: false, kind: classify(text), error: `Claude Code: ${text}` };
  }
  if (!result.structured_output) {
    return { ok: false, kind: 'invalid', error: 'Claude Code returned no structured output.' };
  }
  return { ok: true, output: result.structured_output, costUsd: result.total_cost_usd ?? null };
}

try {
  const msg = await readMessage();
  if (msg?.type === 'status') reply(await status());
  else if (msg?.type === 'group') reply(await group(msg));
  else reply({ ok: false, kind: 'invalid', error: `Unknown request type: ${msg?.type}` });
} catch (err) {
  reply({ ok: false, kind: 'api', error: `Native host error: ${err instanceof Error ? err.message : String(err)}` });
}
