import { MemorySaver } from '@langchain/langgraph';
import { money } from 'sportsbook-contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarness } from '../src/loop.js';
import { ToolRegistry, defineTool } from '../src/tools/registry.js';
import { idempotencyKeyFor } from '../src/tools/execute.js';
import { context, routerFor } from './helpers.js';
import { ScriptedModel, finalAnswer, toolCall } from './scripted-model.js';

const setup = () => {
  const placed: Array<{ stake: string; key: string | undefined; ref: string | undefined }> = [];
  const placeBet = defineTool({
    name: 'place_bet',
    description: 'Places a bet.',
    schema: z.object({ stake: money }),
    scope: ['concierge'],
    needsIdempotencyKey: true,
    gate: { kind: 'money', summary: (params) => `Stake ${params.stake.amount} ${params.stake.currency}` },
    handler: (params, ctx) => {
      placed.push({ stake: params.stake.amount, key: ctx.idempotencyKey, ref: ctx.confirmationRef });
      return { status: 'placed' };
    },
  });
  const model = new ScriptedModel([
    toolCall('call-7', 'place_bet', { stake: { currency: 'EUR', amount: '25' } }),
    finalAnswer('Bet handled.'),
  ]);
  const harness = createHarness({
    role: 'concierge',
    registry: new ToolRegistry([placeBet]),
    router: routerFor(model),
    systemPrompt: 's',
    promptVersion: 'p-1',
    checkpointer: new MemorySaver(),
  });
  return { harness, placed };
};

describe('interrupt gate', () => {
  it('pauses a money tool before it runs', async () => {
    const { harness, placed } = setup();
    const result = await harness.run({ input: 'bet 25', context });

    expect(result.status).toBe('interrupted');
    expect(result.pending).toMatchObject({ kind: 'money', toolName: 'place_bet', summary: 'Stake 25 EUR' });
    expect(placed).toHaveLength(0);
  });

  it('executes after approval with the confirmation reference', async () => {
    const { harness, placed } = setup();
    await harness.run({ input: 'bet 25', context });
    const result = await harness.resume(context, { approved: true, confirmationRef: 'conf-123' });

    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('Bet handled.');
    const proposed = result.messages.find((message) => message.getType() === 'ai');
    const callId = proposed && 'tool_calls' in proposed ? (proposed.tool_calls as Array<{ id: string }>)[0]?.id : undefined;
    expect(placed).toEqual([{ stake: '25', key: idempotencyKeyFor('thread-1', callId ?? ''), ref: 'conf-123' }]);
  });

  it('skips the tool when the decision is a decline', async () => {
    const { harness, placed } = setup();
    await harness.run({ input: 'bet 25', context });
    const result = await harness.resume(context, { approved: false });

    expect(result.status).toBe('completed');
    expect(placed).toHaveLength(0);
    const declined = result.messages.find((message) => message.getType() === 'tool');
    expect(String(declined?.content)).toContain('declined');
  });
});
