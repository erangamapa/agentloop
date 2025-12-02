import { describe, expect, it, vi } from 'vitest';
import { InvalidToolParamsError, ToolScopeError, UnknownToolError } from '../src/errors.js';
import { createHarness } from '../src/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { executeTool, idempotencyKeyFor } from '../src/tools/execute.js';
import { validateProposal } from '../src/tools/validate.js';
import { defineTool } from '../src/tools/registry.js';
import { z } from 'zod';
import { context, lookupTool, routerFor } from './helpers.js';
import { ScriptedModel, finalAnswer, toolCall } from './scripted-model.js';

const baseConfig = (registry: ToolRegistry, model: ScriptedModel) => ({
  registry,
  router: routerFor(model),
  systemPrompt: 's',
  promptVersion: 'p-1',
});

describe('tool scopes', () => {
  it('returns only the tools in a role scope', () => {
    const admin = defineTool({ name: 'admin', description: 'd', schema: z.object({}), scope: ['ops'], handler: () => 1 });
    const registry = new ToolRegistry([lookupTool(), admin]);
    expect(registry.for('concierge').map((tool) => tool.name)).toEqual(['lookup']);
  });

  it('throws at construction when a config wires a tool outside its scope', () => {
    const registry = new ToolRegistry([lookupTool()]);
    const model = new ScriptedModel([]);
    expect(() =>
      createHarness({ role: 'persona', toolNames: ['lookup'], ...baseConfig(registry, model) }),
    ).toThrow(ToolScopeError);
  });

  it('throws at construction when a wired tool does not exist', () => {
    const registry = new ToolRegistry([lookupTool()]);
    expect(() =>
      createHarness({ role: 'concierge', toolNames: ['ghost'], ...baseConfig(registry, new ScriptedModel([])) }),
    ).toThrow(UnknownToolError);
  });
});

describe('proposal validation', () => {
  it('rejects an unknown tool whatever the model claims about it', () => {
    const result = validateProposal([lookupTool()], { id: 'c1', name: 'wire_funds', args: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(UnknownToolError);
  });

  it('never calls the handler when params fail the schema', async () => {
    const handler = vi.fn(() => 'ok');
    const registry = new ToolRegistry([lookupTool(handler)]);
    const model = new ScriptedModel([
      toolCall('call-1', 'lookup', { query: '' }),
      toolCall('call-2', 'ghost', {}),
      finalAnswer('gave up'),
    ]);
    const harness = createHarness({ role: 'concierge', ...baseConfig(registry, model) });
    const result = await harness.run({ input: 'go', context });

    expect(handler).not.toHaveBeenCalled();
    expect(result.finalText).toBe('gave up');
    const errors = result.messages.filter((message) => message.getType() === 'tool');
    expect(errors).toHaveLength(2);
    expect(String(errors[0]?.content)).toContain('Invalid parameters');
    expect(String(errors[1]?.content)).toContain('Unknown tool');
  });

  it('reports schema issues as a typed error', () => {
    const result = validateProposal([lookupTool()], { id: 'c1', name: 'lookup', args: { query: 3 } });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidToolParamsError);
  });
});

describe('executeTool', () => {
  it('takes identity from the run context and derives a stable idempotency key', async () => {
    const seen: Array<{ user: string; key: string | undefined }> = [];
    const tool = defineTool({
      name: 'place',
      description: 'd',
      schema: z.object({ userId: z.string() }),
      scope: ['concierge'],
      needsIdempotencyKey: true,
      handler: (_params, ctx) => {
        seen.push({ user: ctx.sessionUserId, key: ctx.idempotencyKey });
        return 'placed';
      },
    });
    const run = () => executeTool({ tool, params: { userId: 'attacker-7' }, callId: 'call-9', runContext: context });
    await run();
    await run();

    expect(seen[0]?.user).toBe('user-42');
    expect(seen[0]?.key).toBe(idempotencyKeyFor('thread-1', 'call-9'));
    expect(seen[1]?.key).toBe(seen[0]?.key);
    expect(seen[0]?.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not hand a key to handlers that did not ask for one', async () => {
    let key: string | undefined = 'unset';
    const tool = defineTool({
      name: 'peek',
      description: 'd',
      schema: z.object({}),
      scope: ['concierge'],
      handler: (_params, ctx) => {
        key = ctx.idempotencyKey;
        return 1;
      },
    });
    await executeTool({ tool, params: {}, callId: 'c', runContext: context });
    expect(key).toBeUndefined();
  });
});
