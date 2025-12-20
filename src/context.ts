import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { Actor } from 'sportsbook-contracts';
import type { TaskKind } from './router/policy.js';

export interface RunContext {
  threadId: string;
  /** Identity comes from the authenticated session and is never read from model text. */
  sessionUserId: string;
  taskKind?: TaskKind;
  actor?: Actor;
}

export interface AssembleOptions {
  systemPrompt: string;
  summary?: string;
  messages: readonly BaseMessage[];
  recentTurns?: number;
  volatileTools?: ReadonlySet<string>;
}

const DEFAULT_RECENT_TURNS = 6;

const lastHumanIndex = (messages: readonly BaseMessage[]): number =>
  messages.findLastIndex((message) => message instanceof HumanMessage);

const splitTurns = (messages: readonly BaseMessage[]): BaseMessage[][] => {
  const turns: BaseMessage[][] = [];
  for (const message of messages) {
    const current = turns[turns.length - 1];
    if (message instanceof HumanMessage || !current) turns.push([message]);
    else current.push(message);
  }
  return turns;
};

/**
 * Drops volatile tool results (odds, balances) from turns before the current
 * one. The matching tool calls go with them, because a provider rejects a
 * tool call that has no answer.
 */
export const pruneVolatile = (
  messages: readonly BaseMessage[],
  volatileTools: ReadonlySet<string>,
): BaseMessage[] => {
  const currentTurnStart = lastHumanIndex(messages);
  if (currentTurnStart <= 0 || volatileTools.size === 0) return [...messages];

  const earlier = messages.slice(0, currentTurnStart);
  const droppedCallIds = new Set(
    earlier
      .filter((message): message is ToolMessage => message instanceof ToolMessage)
      .filter((message) => message.name !== undefined && volatileTools.has(message.name))
      .map((message) => message.tool_call_id),
  );
  if (droppedCallIds.size === 0) return [...messages];

  const kept = earlier.flatMap((message): BaseMessage[] => {
    if (message instanceof ToolMessage) return droppedCallIds.has(message.tool_call_id) ? [] : [message];
    if (message instanceof AIMessage && message.tool_calls?.some((call) => droppedCallIds.has(call.id ?? ''))) {
      const remaining = message.tool_calls.filter((call) => !droppedCallIds.has(call.id ?? ''));
      if (remaining.length === 0 && message.content === '') return [];
      return [new AIMessage({ content: message.content, tool_calls: remaining, ...(message.id ? { id: message.id } : {}) })];
    }
    return [message];
  });
  return [...kept, ...messages.slice(currentTurnStart)];
};

export const assembleContext = ({
  systemPrompt,
  summary = '',
  messages,
  recentTurns = DEFAULT_RECENT_TURNS,
  volatileTools = new Set<string>(),
}: AssembleOptions): BaseMessage[] => {
  const recent = splitTurns(messages).slice(-recentTurns).flat();
  const history = pruneVolatile(recent, volatileTools);
  const summarySlot = summary ? [new SystemMessage(`Summary of earlier conversation.\n${summary}`)] : [];
  return [new SystemMessage(systemPrompt), ...summarySlot, ...history];
};
