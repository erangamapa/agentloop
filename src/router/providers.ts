import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ProviderUnavailableError } from '../errors.js';
import type { Tier } from './policy.js';

export const MODEL_VERSIONS: Readonly<Record<Tier, string>> = {
  open: 'Qwen/Qwen2.5-32B-Instruct',
  cheap: 'gpt-4o-mini-2024-07-18',
  strong: 'claude-sonnet-4-5-20250929',
};

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

/**
 * Real provider clients throw their own connection and API errors, never our
 * ProviderUnavailableError. Anything that smells like the provider being down
 * (network failure, timeout, 5xx, rate exhaustion) counts as unavailable so the
 * router can fall up a tier instead of crashing the run.
 */
export const isProviderFailure = (error: unknown): boolean => {
  if (error instanceof ProviderUnavailableError) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && NETWORK_CODES.has(code)) return true;
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (causeCode && NETWORK_CODES.has(causeCode)) return true;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  return /fetch failed|socket hang up|timed? ?out/i.test(error.message);
};

export type ModelFactory = () => BaseChatModel;
export type ProviderFactories = Readonly<Record<Tier, ModelFactory>>;

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  VLLM_BASE_URL?: string | undefined;
}

const requireValue = (tier: Tier, value: string | undefined): string => {
  if (!value) throw new ProviderUnavailableError(tier);
  return value;
};

/**
 * Real clients are built lazily so a missing key only fails the tier that
 * needs it. Tests never call this, they hand the router their own factories.
 */
export const providersFromEnv = (
  env: ProviderEnv,
  versions: Readonly<Record<Tier, string>> = MODEL_VERSIONS,
): ProviderFactories => ({
  strong: () =>
    new ChatAnthropic({
      model: versions.strong,
      apiKey: requireValue('strong', env.ANTHROPIC_API_KEY),
    }),
  cheap: () =>
    new ChatOpenAI({
      model: versions.cheap,
      apiKey: requireValue('cheap', env.OPENAI_API_KEY),
    }),
  open: () =>
    new ChatOpenAI({
      model: versions.open,
      apiKey: 'not-needed',
      configuration: { baseURL: requireValue('open', env.VLLM_BASE_URL) },
    }),
});
