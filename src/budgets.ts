import { BudgetExceededError } from './errors.js';

export interface BudgetConfig {
  maxIterations: number;
  maxTokens: number;
  maxWallMs: number;
}

export interface Spent {
  iterations: number;
  tokens: number;
}

export const DEFAULT_BUDGETS: BudgetConfig = {
  maxIterations: 8,
  maxTokens: 50_000,
  maxWallMs: 60_000,
};

export const emptySpent = (): Spent => ({ iterations: 0, tokens: 0 });

export const enforceBudgets = (
  budgets: BudgetConfig,
  spent: Spent,
  elapsedMs: number,
): void => {
  if (spent.iterations >= budgets.maxIterations) {
    throw new BudgetExceededError('iterations', budgets.maxIterations, spent.iterations);
  }
  if (spent.tokens >= budgets.maxTokens) {
    throw new BudgetExceededError('tokens', budgets.maxTokens, spent.tokens);
  }
  if (elapsedMs >= budgets.maxWallMs) {
    throw new BudgetExceededError('wallMs', budgets.maxWallMs, elapsedMs);
  }
};
