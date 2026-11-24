import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';

export const gateKind = z.enum(['money', 'irreversible']);
export type GateKind = z.infer<typeof gateKind>;

export interface GatePayload {
  kind: GateKind;
  toolName: string;
  summary: string;
  args: unknown;
}

export const gateDecision = z.object({
  approved: z.boolean(),
  confirmationRef: z.string().min(1).optional(),
});
export type GateDecision = z.infer<typeof gateDecision>;

/**
 * Pauses the run until a human decision arrives. The pause is stored by the
 * checkpointer, so with a durable saver (Postgres, SQLite) a process restart
 * between the pause and the resume loses nothing. The node re-executes from its
 * start on resume, which is why tool calls carry a stable idempotency key.
 */
export const interruptGate = (payload: GatePayload): GateDecision =>
  gateDecision.parse(interrupt(payload));
