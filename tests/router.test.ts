import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../src/errors.js';
import { createHarness } from '../src/loop.js';
import { DEFAULT_ROUTER_POLICY, tierFor } from '../src/router/policy.js';
import { MODEL_VERSIONS, providersFromEnv, type ProviderFactories } from '../src/router/providers.js';
import { ModelRouter } from '../src/router/router.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { context } from './helpers.js';
import { ScriptedModel, finalAnswer } from './scripted-model.js';

const tiered = () => {
  const models = {
    open: new ScriptedModel([finalAnswer('open says hi')]),
    cheap: new ScriptedModel([finalAnswer('cheap says hi')]),
    strong: new ScriptedModel([finalAnswer('strong says hi')]),
  };
  const factories: ProviderFactories = {
    open: () => models.open,
    cheap: () => models.cheap,
    strong: () => models.strong,
  };
  return { models, factories };
};

describe('router policy', () => {
  it('picks open for classify and strong for money', () => {
    const router = new ModelRouter(DEFAULT_ROUTER_POLICY, tiered().factories);
    expect(router.pick('classify').tier).toBe('open');
    expect(router.pick('money').tier).toBe('strong');
    expect(router.pick('money').modelVersion).toBe(MODEL_VERSIONS.strong);
  });

  it('keeps money on strong whatever the attempt', () => {
    expect(tierFor(DEFAULT_ROUTER_POLICY, 'money', 0)).toBe('strong');
    expect(tierFor(DEFAULT_ROUTER_POLICY, 'classify', 1)).toBe('cheap');
    expect(tierFor(DEFAULT_ROUTER_POLICY, 'classify', 9)).toBe('strong');
  });

  it('escalates one tier up on low confidence', () => {
    const router = new ModelRouter(DEFAULT_ROUTER_POLICY, tiered().factories);
    expect(router.wantsEscalation('open', 0.4)).toBe(true);
    expect(router.wantsEscalation('open', 0.9)).toBe(false);
    expect(router.wantsEscalation('strong', 0.1)).toBe(false);
    expect(router.pick('classify', 1).tier).toBe('cheap');
  });

  it('re-runs the step on the next tier when confidence is below the floor', async () => {
    const { models, factories } = tiered();
    const harness = createHarness({
      role: 'persona',
      registry: new ToolRegistry([]),
      router: new ModelRouter(DEFAULT_ROUTER_POLICY, factories),
      systemPrompt: 's',
      promptVersion: 'p-1',
      assessConfidence: (answer) => (String(answer.content).startsWith('open') ? 0.2 : 0.95),
    });
    const result = await harness.run({ input: 'tag this', context: { ...context, taskKind: 'classify' } });

    expect(models.open.calls).toBe(1);
    expect(models.cheap.calls).toBe(1);
    expect(models.strong.calls).toBe(0);
    expect(result.finalText).toBe('cheap says hi');
    expect(result.runMeta.tier).toBe('cheap');
    expect(result.spent.iterations).toBe(2);
  });

  it('falls to strong when the open factory reports unavailable', () => {
    const { factories } = tiered();
    const router = new ModelRouter(DEFAULT_ROUTER_POLICY, {
      ...factories,
      open: () => {
        throw new ProviderUnavailableError('open');
      },
    });
    expect(router.pick('classify').tier).toBe('cheap');
    const noCheap = new ModelRouter(DEFAULT_ROUTER_POLICY, {
      ...factories,
      open: () => {
        throw new ProviderUnavailableError('open');
      },
      cheap: () => {
        throw new ProviderUnavailableError('cheap');
      },
    });
    expect(noCheap.pick('classify').tier).toBe('strong');
  });

  it('treats a raw network error from a real client as the tier being down', async () => {
    const { factories } = tiered();
    const dead = new ScriptedModel([], { failWith: Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }) });
    const harness = createHarness({
      role: 'persona',
      registry: new ToolRegistry([]),
      router: new ModelRouter(
        { ...DEFAULT_ROUTER_POLICY, tiers: { ...DEFAULT_ROUTER_POLICY.tiers, classify: 'open' } },
        { ...factories, open: () => dead },
      ),
      systemPrompt: 's',
      promptVersion: 'p-1',
    });
    const result = await harness.run({ input: 'x', context: { ...context, taskKind: 'classify' } });
    expect(result.runMeta.tier).not.toBe('open');
  });

  it('falls to strong when the open model fails during the call', async () => {
    const { models, factories } = tiered();
    const dead = new ScriptedModel([], { failWith: new ProviderUnavailableError('open') });
    const harness = createHarness({
      role: 'persona',
      registry: new ToolRegistry([]),
      router: new ModelRouter(
        { ...DEFAULT_ROUTER_POLICY, tiers: { ...DEFAULT_ROUTER_POLICY.tiers, classify: 'open' } },
        { ...factories, open: () => dead, cheap: () => { throw new ProviderUnavailableError('cheap'); } },
      ),
      systemPrompt: 's',
      promptVersion: 'p-1',
    });
    const result = await harness.run({ input: 'tag this', context: { ...context, taskKind: 'classify' } });

    expect(result.finalText).toBe('strong says hi');
    expect(result.runMeta.tier).toBe('strong');
    expect(models.strong.calls).toBe(1);
  });

  it('marks a tier unavailable when its environment is not configured', () => {
    const providers = providersFromEnv({});
    expect(() => providers.open()).toThrow(ProviderUnavailableError);
    expect(() => providers.strong()).toThrow(ProviderUnavailableError);
  });
});
