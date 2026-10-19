import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GroupingError } from './errors';
import { buildUserMessage, GroupingSchema, SYSTEM_PROMPT, type GroupingResult, type PromptInput } from './grouping';
import { requestGroupingViaSubscription } from './subscription';
import type { ModelChoice, Settings } from './types';

export { GroupingError };

/** Ask Claude for a grouping through whichever connection the user picked in Settings. */
export function requestGrouping(settings: Settings, input: PromptInput): Promise<GroupingResult> {
  return settings.provider === 'subscription'
    ? requestGroupingViaSubscription(settings.model, input)
    : requestGroupingViaApi(settings.apiKey, settings.model, input);
}

function client(apiKey: string): Anthropic {
  // The key is the user's own and stays in this browser; the extension calls
  // the API directly, which the SDK only allows with this explicit opt-in.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 120_000, maxRetries: 2 });
}

async function requestGroupingViaApi(
  apiKey: string,
  model: ModelChoice,
  input: PromptInput,
): Promise<GroupingResult> {
  const isSonnet = model === 'claude-sonnet-5-5';
  let response;
  try {
    response = await client(apiKey).beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(input) }],
      output_config: {
        effort: 'medium',
        format: betaZodOutputFormat(GroupingSchema),
      },
      // If Sonnet's safety classifiers decline (rare false positive on scraped
      // page text), the API retries on Anthropic's recommended fallback model.
      ...(isSonnet ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new GroupingError('The API key was rejected. Check it in Settings.', 'auth');
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new GroupingError('This API key is not allowed to use the selected model.', 'auth');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new GroupingError('Rate limited by the Anthropic API. Wait a moment and try again.', 'rate_limit');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new GroupingError('Could not reach the Anthropic API. Check your connection.', 'network');
    }
    if (err instanceof Anthropic.APIError) {
      throw new GroupingError(`Anthropic API error (${err.status ?? 'unknown'}): ${err.message}`, 'api');
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new GroupingError('Claude declined this request. Try again, or add sensitive hosts to the blocklist.', 'refusal');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new GroupingError('The answer was cut off. Try with fewer tabs.', 'truncated');
  }
  if (!response.parsed_output) {
    throw new GroupingError('Claude returned an answer that could not be read. Try again.', 'invalid');
  }
  return response.parsed_output;
}

/** Free call used by the Settings page to check a key without spending tokens. */
export async function testApiKey(apiKey: string, model: ModelChoice): Promise<void> {
  try {
    await client(apiKey).models.retrieve(model);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new GroupingError('The API key was rejected.', 'auth');
    if (err instanceof Anthropic.NotFoundError) throw new GroupingError(`Model ${model} is not available to this key.`, 'auth');
    if (err instanceof Anthropic.APIConnectionError) throw new GroupingError('Could not reach the Anthropic API.', 'network');
    throw err;
  }
}
