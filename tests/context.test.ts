import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { assembleContext, pruneVolatile } from '../src/context.js';

const oddsTurn = (id: string, price: string) => [
  new AIMessage({ content: '', tool_calls: [{ id, name: 'get_odds', args: {}, type: 'tool_call' }] }),
  new ToolMessage({ content: price, tool_call_id: id, name: 'get_odds' }),
];

const historyTurn = () => [
  new HumanMessage('odds on the final?'),
  ...oddsTurn('old-odds', '1.80'),
  new AIMessage({ content: '', tool_calls: [{ id: 'old-note', name: 'get_notes', args: {}, type: 'tool_call' }] }),
  new ToolMessage({ content: 'prefers football', tool_call_id: 'old-note', name: 'get_notes' }),
  new AIMessage('It was 1.80.'),
];

const volatile = new Set(['get_odds']);

describe('pruneVolatile', () => {
  it('drops stale volatile results and their calls, keeps the rest', () => {
    const pruned = pruneVolatile([...historyTurn(), new HumanMessage('and now?')], volatile);
    const contents = pruned.map((message) => String(message.content));

    expect(contents).not.toContain('1.80 ');
    expect(pruned.some((message) => message instanceof ToolMessage && message.name === 'get_odds')).toBe(false);
    expect(pruned.some((message) => message instanceof AIMessage && message.tool_calls?.some((c) => c.name === 'get_odds'))).toBe(false);
    expect(contents).toContain('prefers football');
    expect(contents).toContain('It was 1.80.');
  });

  it('keeps volatile results from the current turn', () => {
    const current = [new HumanMessage('and now?'), ...oddsTurn('new-odds', '1.95')];
    const pruned = pruneVolatile([...historyTurn(), ...current], volatile);
    const odds = pruned.filter((message) => message instanceof ToolMessage && message.name === 'get_odds');

    expect(odds.map((message) => message.content)).toEqual(['1.95']);
  });
});

describe('assembleContext', () => {
  it('puts the static prefix and summary first and keeps only recent turns', () => {
    const turns = [1, 2, 3].flatMap((n) => [new HumanMessage(`q${n}`), new AIMessage(`a${n}`)]);
    const assembled = assembleContext({
      systemPrompt: 'You are terse.',
      summary: 'Player likes football.',
      messages: turns,
      recentTurns: 2,
    });
    const contents = assembled.map((message) => String(message.content));

    expect(contents[0]).toBe('You are terse.');
    expect(contents[1]).toContain('Player likes football.');
    expect(contents.slice(2)).toEqual(['q2', 'a2', 'q3', 'a3']);
  });

  it('omits the summary slot when there is no summary', () => {
    const assembled = assembleContext({ systemPrompt: 'sys', messages: [new HumanMessage('hi')] });
    expect(assembled).toHaveLength(2);
  });
});
