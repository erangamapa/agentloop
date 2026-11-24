import { describe, expect, it } from 'vitest';
import { BudgetExceededError } from '../src/errors.js';
import { createHarness, type HarnessConfig } from '../src/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { context, lookupTool, routerFor } from './helpers.js';
import { ScriptedModel, finalAnswer, toolCall } from './scripted-model.js';

const neverFinishes = (tokens = 10) =>
  new ScriptedModel([toolCall('call-1', 'lookup', { query: 'again' }, tokens)], { repeatLast: true });

const build = (model: ScriptedModel, overrides: Partial<HarnessConfig>) =>
  createHarness({
    role: 'concierge',
    registry: new ToolRegistry([lookupTool()]),
    router: routerFor(model),
    systemPrompt: 's',
    promptVersion: 'p-1',
    ...overrides,
  });

const reasonOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof BudgetExceededError) return error.reason;
    throw error;
  }
  return undefined;
};

describe('budgets', () => {
  it('trips maxIterations on a model that never finishes', async () => {
    const model = neverFinishes();
    const harness = build(model, { budgets: { maxIterations: 3, maxTokens: 1_000_000, maxWallMs: 60_000 } });
    expect(await reasonOf(harness.run({ input: 'go', context }))).toBe('iterations');
    expect(model.calls).toBe(3);
  });

  it('trips the token ceiling', async () => {
    const model = neverFinishes(400);
    const harness = build(model, { budgets: { maxIterations: 50, maxTokens: 1_000, maxWallMs: 60_000 } });
    expect(await reasonOf(harness.run({ input: 'go', context }))).toBe('tokens');
    expect(model.calls).toBe(3);
  });

  it('trips the wall clock', async () => {
    let clock = 0;
    const model = neverFinishes();
    const harness = build(model, {
      budgets: { maxIterations: 50, maxTokens: 1_000_000, maxWallMs: 1_000 },
      now: () => {
        clock += 400;
        return clock;
      },
    });
    expect(await reasonOf(harness.run({ input: 'go', context }))).toBe('wallMs');
  });
});

  it('resets spend per run so a long lived thread never bricks', async () => {
    const model = new ScriptedModel(
      [finalAnswer('one'), finalAnswer('two'), finalAnswer('three')],
    );
    const harness = build(model, { budgets: { maxIterations: 2, maxTokens: 1_000_000, maxWallMs: 60_000 } });
    const first = await harness.run({ input: 'a', context });
    const second = await harness.run({ input: 'b', context });
    const third = await harness.run({ input: 'c', context });
    expect(first.spent.iterations).toBe(1);
    expect(second.spent.iterations).toBe(1);
    expect(third.spent.iterations).toBe(1);
  });
