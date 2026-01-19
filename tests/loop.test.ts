import { describe, expect, it } from 'vitest';
import { createHarness } from '../src/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { context, lookupTool, routerFor } from './helpers.js';
import { ScriptedModel, finalAnswer, toolCall } from './scripted-model.js';

describe('createHarness', () => {
  it('runs a proposed tool and ends on the final message', async () => {
    const calls: string[] = [];
    const registry = new ToolRegistry([
      lookupTool((params) => {
        calls.push(params.query);
        return { note: 'reach me at fan@example.com', account: 'acct_9981' };
      }),
    ]);
    const model = new ScriptedModel([
      toolCall('call-1', 'lookup', { query: 'my last bet' }),
      finalAnswer('All done.'),
    ]);

    const harness = createHarness({
      role: 'concierge',
      registry,
      router: routerFor(model),
      systemPrompt: 'You help VIP players.',
      promptVersion: 'p-1',
    });
    const result = await harness.run({ input: 'what was my last bet', context });

    expect(calls).toEqual(['my last bet']);
    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('All done.');
    const toolMessage = result.messages.find((message) => message.getType() === 'tool');
    expect(toolMessage?.content).toContain('[email]');
    expect(toolMessage?.content).toContain('[account]');
    expect(toolMessage?.content).not.toContain('fan@example.com');
    expect(result.runMeta).toMatchObject({ promptVersion: 'p-1', tier: 'cheap' });
    expect(result.spent).toEqual({ iterations: 2, tokens: 20 });
  });

  it('sends the system prompt and user turn to the model', async () => {
    const model = new ScriptedModel([finalAnswer('hi')]);
    const harness = createHarness({
      role: 'concierge',
      registry: new ToolRegistry([]),
      router: routerFor(model),
      systemPrompt: 'Be brief.',
      promptVersion: 'p-1',
    });
    await harness.run({ input: 'hello', context });

    const sent = model.seen[0] ?? [];
    expect(sent.map((message) => message.getType())).toEqual(['system', 'human']);
  });

  it('records the pinned model version of the tier that answered', async () => {
    const model = new ScriptedModel([finalAnswer('ok')]);
    const harness = createHarness({
      role: 'concierge',
      registry: new ToolRegistry([]),
      router: routerFor(model),
      systemPrompt: 's',
      promptVersion: 'p-2',
    });
    const result = await harness.run({ input: 'hello', context: { ...context, taskKind: 'money' } });
    expect(result.runMeta.tier).toBe('strong');
    expect(result.runMeta.modelVersion).toMatch(/^claude-/);
  });
});
