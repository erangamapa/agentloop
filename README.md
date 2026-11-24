# agentloop

A small TypeScript harness for running LLM agents, built on LangGraph.js. It is the loop the rest of my sportsbook agent platform runs inside.

## What this is

The idea is simple. The model is a stateless, rented reasoning step. It does not own the loop. The platform owns it. State, budgets, validation, identity and safety all live in code. A prompt rule is a suggestion. A code gate is a wall.

So agentloop never asks the model to behave. It checks what the model proposes, and it stops the run itself. Two exits always exist. The model finishes, or a budget trips. I never trust the model to stop on its own.

Consumers import `createHarness`, pass in their own tools and policies, and run it. The persona fleet and the VIP concierge service both work this way.

## The loop

Every cycle runs the same five steps.

```
  +-----------+     +---------+     +----------+     +---------+
  | assemble  | --> |  model  | --> | validate | --> | execute |
  +-----------+     +---------+     +----------+     +---------+
        ^                |                                |
        |                | no tool calls                  |
        |                v                                |
        |              done                               |
        |                                                 |
        +------------------ checkpoint -------------------+
```

1. Assemble. Check budgets, then build the prompt. That is a static prefix, a rolling summary slot, and the last N turns verbatim. Volatile tool results (odds, balances) from earlier turns are pruned, so a stale price never sits next to a fresh one.
2. Model. The router picks a tier and the model proposes a reply or tool calls.
3. Validate. Every proposed call is checked against the tools wired for this role. Unknown names are rejected. Params are parsed with the tool's zod schema before anything runs.
4. Execute. Approved calls run. Identity comes from the session context, never from model text. Results are masked for PII before they enter state.
5. Checkpoint. The injected checkpointer saves state after every step, which is what makes pauses and restarts safe.

## The trust model

Scopes. Each tool declares the roles that may use it. If a harness config wires a tool outside its role, `createHarness` throws `ToolScopeError` at construction. That is a crash on boot, not an incident in production.

Gates. A tool can declare a gate for money moves or irreversible actions. The run pauses with `interruptGate` and waits for `{ approved, confirmationRef }`. The pause is stored by the checkpointer. With a durable saver, a restart between the pause and the answer loses nothing. A declined gate means the handler never runs.

Idempotency. Tools that ask for it get a key, the sha256 of the thread id and the tool call id. A node that re-runs after a resume sends the same key, so a payment backend can dedupe.

Budgets. `maxIterations`, `maxTokens` and `maxWallMs` are checked every cycle. Tripping one throws `BudgetExceededError` with the reason. The graph step limit is set above the iteration budget so the budget is always what stops a runaway loop.

Privacy. Tool results pass through `maskPII` first. Default rules cover emails, phone numbers, account ids with the acct prefix, and street addresses. Rules are injectable.

## The router

The router maps a task kind to a tier, and each tier to a pinned model.

| Task kind | Tier | Model |
| --- | --- | --- |
| classify | open | vLLM, OpenAI compatible endpoint |
| draft | cheap | small paid OpenAI model |
| converse | cheap | small paid OpenAI model |
| judge | strong | Anthropic frontier model |
| money | strong, always | Anthropic frontier model |

If a result scores below the confidence floor, the step re-runs one tier up. Scoring is a function the consumer supplies, since only they know what a good answer looks like. Money tasks never leave the strong tier. If the open tier is unavailable, the router falls up to the next tier that works, ending at strong.

Exact model names live in one exported constant, `MODEL_VERSIONS`. Every run records the model version, the prompt version, the tier and the budget spend in `runMeta`, so a trace tells you what really ran.

For tracing, set the usual LangSmith variables and nothing else changes.

```
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<langsmith-api-key>
```

## How consumers use it

```ts
import { z } from 'zod';
import { MemorySaver } from '@langchain/langgraph';
import {
  DEFAULT_ROUTER_POLICY,
  ModelRouter,
  ToolRegistry,
  createHarness,
  defineTool,
  providersFromEnv,
} from 'agentloop';

const getBalance = defineTool({
  name: 'get_balance',
  description: 'Reads the current balance of the signed-in player.',
  schema: z.object({}),
  scope: ['concierge'],
  volatile: true,
  handler: (_params, ctx) => balances.read(ctx.sessionUserId),
});

const harness = createHarness({
  role: 'concierge',
  registry: new ToolRegistry([getBalance]),
  router: new ModelRouter(DEFAULT_ROUTER_POLICY, providersFromEnv(process.env)),
  systemPrompt: 'You are a concierge for VIP players.',
  promptVersion: 'concierge-2025-01',
  budgets: { maxIterations: 6, maxTokens: 30_000, maxWallMs: 45_000 },
  checkpointer: new MemorySaver(),
});

const context = { threadId: 'chat-881', sessionUserId: 'user-42', taskKind: 'converse' } as const;
const result = await harness.run({ input: 'What is my balance?', context });

if (result.status === 'interrupted') {
  await harness.resume(context, { approved: true, confirmationRef: 'conf-123' });
}
```

The default checkpointer is in memory. Pass a durable one in production.

## Testing approach

Tests run with no network and no keys. Model clients are injected, and the tests use `ScriptedModel`, a fake chat model that replays a list of messages with tool calls. The deterministic parts are covered directly. That means scope enforcement, proposal validation, budgets (with an injected clock), the interrupt gate with a `MemorySaver`, router policy and fallback, PII masking and context pruning.

The contracts package is a sibling file dependency, so clone sportsbook-contracts next to this repo before installing. Tests and typecheck read its source directly, so it does not need a build step.

```
git clone https://github.com/erangamapa/sportsbook-contracts ../sportsbook-contracts
npm install
npm run typecheck
npm test
```
