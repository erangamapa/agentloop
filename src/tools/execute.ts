import { createHash } from 'node:crypto';
import { ToolMessage } from '@langchain/core/messages';
import { isGraphInterrupt } from '@langchain/langgraph';
import { interruptGate } from '../gates/interrupt.js';
import { maskPII, type MaskRule } from '../privacy/mask.js';
import type { RunContext } from '../context.js';
import type { ToolContext, ToolDefinition } from './registry.js';

export const idempotencyKeyFor = (threadId: string, toolCallId: string): string =>
  createHash('sha256').update(`${threadId}:${toolCallId}`).digest('hex');

const serialize = (result: unknown): string =>
  typeof result === 'string' ? result : (JSON.stringify(result) ?? 'null');

export interface ExecuteInput {
  tool: ToolDefinition;
  params: unknown;
  callId: string;
  runContext: RunContext;
  maskRules?: readonly MaskRule[] | undefined;
}

export const executeTool = async ({
  tool,
  params,
  callId,
  runContext,
  maskRules,
}: ExecuteInput): Promise<ToolMessage> => {
  const respond = (content: string, status: 'success' | 'error') =>
    new ToolMessage({
      content: maskPII(content, maskRules),
      tool_call_id: callId,
      name: tool.name,
      status,
    });

  const context: ToolContext = {
    sessionUserId: runContext.sessionUserId,
    threadId: runContext.threadId,
    toolCallId: callId,
    ...(runContext.actor ? { actor: runContext.actor } : {}),
    ...(tool.needsIdempotencyKey
      ? { idempotencyKey: idempotencyKeyFor(runContext.threadId, callId) }
      : {}),
  };

  if (tool.gate) {
    const decision = interruptGate({
      kind: tool.gate.kind,
      toolName: tool.name,
      summary: tool.gate.summary(params),
      args: params,
    });
    if (!decision.approved) {
      return respond('The account holder declined this action. Nothing was executed.', 'error');
    }
    if (decision.confirmationRef) context.confirmationRef = decision.confirmationRef;
  }

  try {
    return respond(serialize(await tool.handler(params, context)), 'success');
  } catch (error) {
    if (isGraphInterrupt(error)) throw error;
    const reason = error instanceof Error ? error.message : 'unknown failure';
    return respond(`Tool "${tool.name}" failed. ${reason}`, 'error');
  }
};
