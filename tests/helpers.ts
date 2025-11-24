import { z } from 'zod';
import { ModelRouter } from '../src/router/router.js';
import { DEFAULT_ROUTER_POLICY } from '../src/router/policy.js';
import type { ProviderFactories } from '../src/router/providers.js';
import type { RunContext } from '../src/context.js';
import { defineTool } from '../src/tools/registry.js';
import type { ScriptedModel } from './scripted-model.js';

export const context: RunContext = {
  threadId: 'thread-1',
  sessionUserId: 'user-42',
  actor: { kind: 'player', id: 'user-42' },
};

export const routerFor = (model: ScriptedModel): ModelRouter => {
  const factories: ProviderFactories = { open: () => model, cheap: () => model, strong: () => model };
  return new ModelRouter(DEFAULT_ROUTER_POLICY, factories);
};

export const lookupTool = (handler: (params: { query: string }) => unknown = () => 'ok') =>
  defineTool({
    name: 'lookup',
    description: 'Looks something up.',
    schema: z.object({ query: z.string().min(1) }),
    scope: ['concierge'],
    handler: (params) => handler(params),
  });
