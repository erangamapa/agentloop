import type { BaseMessage } from '@langchain/core/messages';
import type { Spent } from './budgets.js';
import type { Tier } from './router/policy.js';

export interface RunMeta {
  modelVersion: string;
  promptVersion: string;
  tier: Tier | 'none';
}

export const initialRunMeta = (promptVersion: string): RunMeta => ({
  modelVersion: 'none',
  promptVersion,
  tier: 'none',
});

export const tokensUsedBy = (message: BaseMessage): number => {
  const usage = (message as { usage_metadata?: { total_tokens?: number; input_tokens?: number; output_tokens?: number } })
    .usage_metadata;
  if (!usage) return 0;
  return usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
};

export const addUsage = (spent: Spent, message: BaseMessage): Spent => ({
  iterations: spent.iterations + 1,
  tokens: spent.tokens + tokensUsedBy(message),
});

/**
 * Tracing goes to LangSmith when the LangSmith tracing and API key variables are
 * set in the environment. The harness has no code path that needs them, and
 * runMeta travels in the graph state so it lands in every checkpoint either way.
 */
export const traceTags = (meta: RunMeta): string[] => [
  `model:${meta.modelVersion}`,
  `prompt:${meta.promptVersion}`,
  `tier:${meta.tier}`,
];
