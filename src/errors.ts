export type BudgetReason = 'iterations' | 'tokens' | 'wallMs';

export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';

  constructor(
    readonly reason: BudgetReason,
    readonly limit: number,
    readonly spent: number,
  ) {
    super(`Budget exceeded (${reason}). Spent ${spent} of ${limit}.`);
  }
}

export class UnknownToolError extends Error {
  override readonly name = 'UnknownToolError';

  constructor(readonly toolName: string) {
    super(`Unknown tool "${toolName}".`);
  }
}

export class ToolScopeError extends Error {
  override readonly name = 'ToolScopeError';

  constructor(
    readonly toolName: string,
    readonly role: string,
  ) {
    super(`Tool "${toolName}" is not in scope for role "${role}".`);
  }
}

export class InvalidToolParamsError extends Error {
  override readonly name = 'InvalidToolParamsError';

  constructor(
    readonly toolName: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid parameters for tool "${toolName}". ${issues.join(' ')}`);
  }
}

export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';

  constructor(
    readonly tier: string,
    options?: { cause?: unknown },
  ) {
    super(`No model provider available for tier "${tier}".`, options);
  }
}
