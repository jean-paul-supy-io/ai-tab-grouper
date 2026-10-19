// "Claude subscription" connection: the extension asks a local native
// messaging host (native-host/host.mjs) to run the Claude Code CLI with the
// user's own login. The extension never sees or stores Claude credentials.
import { browser } from 'wxt/browser';
import { z } from 'zod';
import extension from '../extension.json';
import { GroupingError } from './errors';
import { buildUserMessage, GroupingSchema, SYSTEM_PROMPT, type GroupingResult, type PromptInput } from './grouping';
import type { ModelChoice } from './types';

const HOST = extension.nativeHostName;

type HostFailure = { ok: false; kind: GroupingError['kind']; error: string };
type HostReply<T> = ({ ok: true } & T) | HostFailure;

export interface SubscriptionStatus {
  loggedIn: boolean;
  authMethod: string | null;
  subscriptionType: string | null;
}

async function callHost<T>(message: Record<string, unknown>): Promise<T> {
  let reply: HostReply<T> | undefined;
  try {
    reply = (await browser.runtime.sendNativeMessage(HOST, message)) as HostReply<T> | undefined;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(text)) {
      throw new GroupingError('The Claude Code bridge is not installed. Run `npm run install-host` in the project folder, then reload the extension.', 'setup');
    }
    if (/forbidden/i.test(text)) {
      throw new GroupingError('The Claude Code bridge does not allow this extension. Re-run `npm run install-host`.', 'setup');
    }
    throw new GroupingError(`Could not reach the Claude Code bridge: ${text}`, 'setup');
  }
  if (!reply) throw new GroupingError('The Claude Code bridge returned nothing.', 'setup');
  if (!reply.ok) throw new GroupingError(reply.error, reply.kind);
  return reply;
}

/** JSON Schema for `claude -p --json-schema`, derived from the same Zod schema the API path uses. */
function groupingJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(GroupingSchema) as Record<string, unknown>;
  return schema;
}

export async function requestGroupingViaSubscription(model: ModelChoice, input: PromptInput): Promise<GroupingResult> {
  const reply = await callHost<{ output: unknown }>({
    type: 'group',
    model,
    effort: 'medium',
    system: SYSTEM_PROMPT,
    prompt: buildUserMessage(input),
    schema: groupingJsonSchema(),
  });
  const parsed = GroupingSchema.safeParse(reply.output);
  if (!parsed.success) {
    throw new GroupingError('Claude returned an answer that could not be read. Try again.', 'invalid');
  }
  return parsed.data;
}

/** Used by Settings: checks the bridge is installed and Claude Code is signed in. */
export function checkSubscription(): Promise<SubscriptionStatus> {
  return callHost<SubscriptionStatus>({ type: 'status' });
}
