import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool as langchainTool } from '@langchain/core/tools';
import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import { DEFAULT_BUDGETS, emptySpent, enforceBudgets, type BudgetConfig, type Spent } from './budgets.js';
import { assembleContext, type RunContext } from './context.js';
import { ToolScopeError, UnknownToolError } from './errors.js';
import { isProviderFailure } from './router/providers.js';
import type { GateDecision, GatePayload } from './gates/interrupt.js';
import type { MaskRule } from './privacy/mask.js';
import type { Tier } from './router/policy.js';
import type { ModelRouter } from './router/router.js';
import { AgentState, type AcceptedProposal, type AgentStateType } from './state.js';
import { executeTool } from './tools/execute.js';
import type { ToolDefinition, ToolRegistry } from './tools/registry.js';
import { validateProposal } from './tools/validate.js';
import { addUsage, initialRunMeta, traceTags, type RunMeta } from './trace.js';

export interface HarnessConfig {
  role: string;
  registry: ToolRegistry;
  router: ModelRouter;
  systemPrompt: string;
  promptVersion: string;
  /** Explicit wiring. Defaults to every tool the registry scopes to the role. */
  toolNames?: readonly string[];
  budgets?: BudgetConfig;
  checkpointer?: BaseCheckpointSaver;
  maskRules?: readonly MaskRule[];
  recentTurns?: number;
  /** Returns a score in the range 0 to 1 for a final answer, or undefined when it cannot judge. */
  assessConfidence?: (answer: AIMessage) => number | undefined;
  now?: () => number;
}

export interface RunInput {
  input: string;
  context: RunContext;
}

export interface HarnessResult {
  status: 'completed' | 'interrupted';
  messages: BaseMessage[];
  finalText: string;
  runMeta: RunMeta;
  spent: Spent;
  pending?: GatePayload;
}

export interface Harness {
  run(request: RunInput): Promise<HarnessResult>;
  resume(context: RunContext, decision: GateDecision): Promise<HarnessResult>;
}

interface RunConfigurable {
  runContext: RunContext;
  startedAt: number;
}

const readConfigurable = (config: LangGraphRunnableConfig): RunConfigurable => {
  const configurable = config.configurable as Partial<RunConfigurable> | undefined;
  if (!configurable?.runContext || configurable.startedAt === undefined) {
    throw new Error('Run context missing from graph config. Start runs through the harness.');
  }
  return configurable as RunConfigurable;
};

const textOf = (message: BaseMessage | undefined): string => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => (part.type === 'text' && 'text' in part ? part.text : ''))
    .join('');
};

const wireTools = (config: HarnessConfig): ToolDefinition[] => {
  const names = config.toolNames ?? config.registry.for(config.role).map((tool) => tool.name);
  return names.map((name) => {
    const tool = config.registry.get(name);
    if (!tool.scope.includes(config.role)) throw new ToolScopeError(name, config.role);
    return tool;
  });
};

const toModelTools = (wired: readonly ToolDefinition[]) =>
  wired.map((definition) =>
    langchainTool(async () => '', {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
    }),
  );

export const createHarness = (config: HarnessConfig): Harness => {
  const wired = wireTools(config);
  const budgets = config.budgets ?? DEFAULT_BUDGETS;
  const now = config.now ?? Date.now;
  const volatileTools = config.registry.volatileNames();
  const modelTools = toModelTools(wired);

  const assemble = (state: AgentStateType, runnable: LangGraphRunnableConfig) => {
    const { startedAt } = readConfigurable(runnable);
    enforceBudgets(budgets, state.spent, now() - startedAt);
    return {
      prompt: assembleContext({
        systemPrompt: config.systemPrompt,
        summary: state.summary,
        messages: state.messages,
        volatileTools,
        ...(config.recentTurns !== undefined ? { recentTurns: config.recentTurns } : {}),
      }),
    };
  };

  const callModel = async (state: AgentStateType, runnable: LangGraphRunnableConfig) => {
    const { runContext, startedAt } = readConfigurable(runnable);
    const taskKind = runContext.taskKind ?? 'converse';
    const excluded = new Set<Tier>();
    let attempt = 0;
    let spent = state.spent;
    let runMeta = state.runMeta;

    for (;;) {
      enforceBudgets(budgets, spent, now() - startedAt);
      const pick = config.router.pick(taskKind, attempt, excluded);
      const bound = pick.model.bindTools ? pick.model.bindTools(modelTools) : pick.model;
      runMeta = { ...runMeta, modelVersion: pick.modelVersion, tier: pick.tier };

      let response: BaseMessage;
      try {
        response = await bound.invoke(state.prompt, { tags: traceTags(runMeta) });
      } catch (error) {
        if (isProviderFailure(error) && pick.tier !== 'strong') {
          excluded.add(pick.tier);
          continue;
        }
        throw error;
      }

      spent = addUsage(spent, response);
      const proposesTools = response instanceof AIMessage && (response.tool_calls?.length ?? 0) > 0;
      const confidence = proposesTools || !(response instanceof AIMessage)
        ? undefined
        : config.assessConfidence?.(response);
      if (confidence !== undefined && config.router.wantsEscalation(pick.tier, confidence)) {
        // escalation means one tier up from the tier that actually answered
        excluded.add(pick.tier);
        attempt += 1;
        continue;
      }
      return { messages: [response], spent, runMeta };
    }
  };

  const validate = (state: AgentStateType) => {
    const last = state.messages[state.messages.length - 1];
    const calls = last instanceof AIMessage ? (last.tool_calls ?? []) : [];
    const accepted: AcceptedProposal[] = [];
    const rejections: ToolMessage[] = [];
    for (const call of calls) {
      const proposal = validateProposal(wired, call);
      if (proposal.ok) {
        accepted.push(proposal);
      } else {
        rejections.push(
          new ToolMessage({
            content: proposal.error.message,
            tool_call_id: proposal.callId,
            name: proposal.toolName,
            status: 'error',
          }),
        );
      }
    }
    return { messages: rejections, proposals: accepted };
  };

  const execute = async (state: AgentStateType, runnable: LangGraphRunnableConfig) => {
    const { runContext } = readConfigurable(runnable);
    const results: ToolMessage[] = [];
    for (const proposal of state.proposals) {
      const tool = wired.find((candidate) => candidate.name === proposal.toolName);
      if (!tool) throw new UnknownToolError(proposal.toolName);
      results.push(
        await executeTool({
          tool,
          params: proposal.params,
          callId: proposal.callId,
          runContext,
          maskRules: config.maskRules,
        }),
      );
    }
    return { messages: results, proposals: [] };
  };

  const afterModel = (state: AgentStateType) => {
    const last = state.messages[state.messages.length - 1];
    return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0 ? 'validate' : END;
  };

  const afterValidate = (state: AgentStateType) => (state.proposals.length > 0 ? 'execute' : 'assemble');

  const graph = new StateGraph(AgentState)
    .addNode('assemble', assemble)
    .addNode('model', callModel)
    .addNode('validate', validate)
    .addNode('execute', execute)
    .addEdge(START, 'assemble')
    .addEdge('assemble', 'model')
    .addConditionalEdges('model', afterModel, ['validate', END])
    .addConditionalEdges('validate', afterValidate, ['execute', 'assemble'])
    .addEdge('execute', 'assemble')
    .compile({ checkpointer: config.checkpointer ?? new MemorySaver() });

  // The graph step limit must sit above the iteration budget so the budget is what stops a runaway loop.
  const recursionLimit = budgets.maxIterations * 5 + 10;

  const runnableConfig = (context: RunContext) => ({
    recursionLimit,
    configurable: { thread_id: context.threadId, runContext: context, startedAt: now() },
  });

  const toResult = async (
    context: RunContext,
    values: AgentStateType,
  ): Promise<HarnessResult> => {
    const snapshot = await graph.getState({ configurable: { thread_id: context.threadId } });
    const pending = snapshot.tasks.flatMap((task) => task.interrupts).at(0)?.value as GatePayload | undefined;
    const last = values.messages[values.messages.length - 1];
    return {
      status: pending ? 'interrupted' : 'completed',
      messages: values.messages,
      finalText: pending ? '' : textOf(last),
      runMeta: values.runMeta,
      spent: values.spent,
      ...(pending ? { pending } : {}),
    };
  };

  return {
    async run({ input, context }) {
      const values = await graph.invoke(
        {
          messages: [new HumanMessage(input)],
          runMeta: initialRunMeta(config.promptVersion),
          // budgets are per run, a long lived thread must not inherit old spend
          spent: emptySpent(),
        },
        runnableConfig(context),
      );
      return toResult(context, values);
    },
    async resume(context, decision) {
      const values = await graph.invoke(new Command({ resume: decision }), runnableConfig(context));
      return toResult(context, values);
    },
  };
};
