import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ProviderUnavailableError } from '../errors.js';
import { TIERS, shouldEscalate, tierFor, type RouterPolicy, type TaskKind, type Tier } from './policy.js';
import { MODEL_VERSIONS, type ProviderFactories } from './providers.js';

export interface ModelPick {
  model: BaseChatModel;
  tier: Tier;
  modelVersion: string;
}

export class ModelRouter {
  private readonly cache = new Map<Tier, BaseChatModel>();

  constructor(
    readonly policy: RouterPolicy,
    private readonly providers: ProviderFactories,
    private readonly versions: Readonly<Record<Tier, string>> = MODEL_VERSIONS,
  ) {}

  /**
   * Walks up from the policy tier past any tier that is excluded or fails to
   * build. Only the strong tier is allowed to be the last stop, and if it is
   * down too the error reaches the caller.
   */
  pick(kind: TaskKind, attempt = 0, excluded: ReadonlySet<Tier> = new Set()): ModelPick {
    let index = TIERS.indexOf(tierFor(this.policy, kind, attempt));
    for (; index < TIERS.length; index += 1) {
      const tier = TIERS[index];
      if (!tier || excluded.has(tier)) continue;
      try {
        return { model: this.modelFor(tier), tier, modelVersion: this.versions[tier] };
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
      }
    }
    throw new ProviderUnavailableError('strong');
  }

  wantsEscalation(pickedTier: Tier, confidence: number): boolean {
    return shouldEscalate(this.policy, pickedTier, confidence);
  }

  private modelFor(tier: Tier): BaseChatModel {
    const cached = this.cache.get(tier);
    if (cached) return cached;
    const model = this.providers[tier]();
    this.cache.set(tier, model);
    return model;
  }
}
