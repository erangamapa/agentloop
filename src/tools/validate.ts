import type { ToolCall } from '@langchain/core/messages/tool';
import { InvalidToolParamsError, UnknownToolError } from '../errors.js';
import type { ToolDefinition } from './registry.js';

export type Proposal =
  | { ok: true; toolName: string; callId: string; params: unknown }
  | { ok: false; callId: string; toolName: string; error: UnknownToolError | InvalidToolParamsError };

/**
 * The model's claim about a tool never counts. Only the wired set decides
 * what exists, and only the tool's own schema decides what a valid call is.
 */
export const validateProposal = (
  wired: readonly ToolDefinition[],
  call: Pick<ToolCall, 'name' | 'args'> & { id?: string | undefined },
): Proposal => {
  const callId = call.id ?? '';
  const tool = wired.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return { ok: false, callId, toolName: call.name, error: new UnknownToolError(call.name) };
  }
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'params'} ${issue.message}.`);
    return { ok: false, callId, toolName: call.name, error: new InvalidToolParamsError(call.name, issues) };
  }
  return { ok: true, toolName: tool.name, callId, params: parsed.data };
};
