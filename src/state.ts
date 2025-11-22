import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer, type Messages } from '@langchain/langgraph';
import { emptySpent, type Spent } from './budgets.js';
import type { Proposal } from './tools/validate.js';
import type { RunMeta } from './trace.js';

export type AcceptedProposal = Extract<Proposal, { ok: true }>;

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[], Messages>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  prompt: Annotation<BaseMessage[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  summary: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),
  runMeta: Annotation<RunMeta>({
    reducer: (previous, next) => ({ ...previous, ...next }),
    default: () => ({ modelVersion: 'none', promptVersion: 'unset', tier: 'none' }),
  }),
  spent: Annotation<Spent>({
    reducer: (_previous, next) => next,
    default: emptySpent,
  }),
  proposals: Annotation<AcceptedProposal[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
