import type { z } from 'zod';
import type { Actor } from 'sportsbook-contracts';
import { UnknownToolError } from '../errors.js';
import type { GateKind } from '../gates/interrupt.js';

export interface ToolContext {
  sessionUserId: string;
  threadId: string;
  toolCallId: string;
  actor?: Actor;
  idempotencyKey?: string;
  confirmationRef?: string;
}

export interface GateSpec<P> {
  kind: GateKind;
  summary: (params: P) => string;
}

export type ToolSchema = z.AnyZodObject;

export interface ToolSpec<S extends ToolSchema> {
  name: string;
  description: string;
  schema: S;
  handler: (params: z.infer<S>, context: ToolContext) => unknown;
  scope: readonly string[];
  volatile?: boolean;
  needsIdempotencyKey?: boolean;
  gate?: GateSpec<z.infer<S>>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  handler: (params: unknown, context: ToolContext) => unknown;
  scope: readonly string[];
  volatile: boolean;
  needsIdempotencyKey: boolean;
  gate?: GateSpec<unknown>;
}

/**
 * Handlers only ever see params that passed the schema, so the casts here
 * are the single place where the erased type is restored.
 */
export const defineTool = <S extends ToolSchema>(spec: ToolSpec<S>): ToolDefinition => {
  const { gate } = spec;
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    handler: (params, context) => spec.handler(params as z.infer<S>, context),
    scope: spec.scope,
    volatile: spec.volatile ?? false,
    needsIdempotencyKey: spec.needsIdempotencyKey ?? false,
    ...(gate
      ? {
          gate: {
            kind: gate.kind,
            summary: (params: unknown) => gate.summary(params as z.infer<S>),
          },
        }
      : {}),
  };
};

export class ToolRegistry {
  private readonly byName: ReadonlyMap<string, ToolDefinition>;

  constructor(tools: readonly ToolDefinition[]) {
    const byName = new Map<string, ToolDefinition>();
    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new Error(`Duplicate tool name "${tool.name}".`);
      }
      byName.set(tool.name, tool);
    }
    this.byName = byName;
  }

  get(name: string): ToolDefinition {
    const tool = this.byName.get(name);
    if (!tool) throw new UnknownToolError(name);
    return tool;
  }

  for(role: string): ToolDefinition[] {
    return [...this.byName.values()].filter((tool) => tool.scope.includes(role));
  }

  volatileNames(): ReadonlySet<string> {
    return new Set([...this.byName.values()].filter((tool) => tool.volatile).map((tool) => tool.name));
  }
}
