export const TASK_KINDS = ['classify', 'draft', 'converse', 'judge', 'money'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TIERS = ['open', 'cheap', 'strong'] as const;
export type Tier = (typeof TIERS)[number];

export interface RouterPolicy {
  tiers: Readonly<Record<TaskKind, Tier>>;
  confidenceFloor: number;
}

export const DEFAULT_ROUTER_POLICY: RouterPolicy = {
  tiers: {
    classify: 'open',
    draft: 'cheap',
    converse: 'cheap',
    judge: 'strong',
    money: 'strong',
  },
  confidenceFloor: 0.7,
};

export const tierFor = (policy: RouterPolicy, kind: TaskKind, attempt: number): Tier => {
  if (kind === 'money') return 'strong';
  const base = TIERS.indexOf(policy.tiers[kind]);
  return TIERS[Math.min(base + attempt, TIERS.length - 1)] ?? 'strong';
};

export const shouldEscalate = (
  policy: RouterPolicy,
  pickedTier: Tier,
  confidence: number,
): boolean => confidence < policy.confidenceFloor && pickedTier !== 'strong';
