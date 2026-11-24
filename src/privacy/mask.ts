export interface MaskRule {
  kind: string;
  pattern: RegExp;
  replacement?: string;
}

export const DEFAULT_MASK_RULES: readonly MaskRule[] = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  { kind: 'account', pattern: /\bacct_[A-Za-z0-9]+\b/g },
  {
    kind: 'address',
    pattern:
      /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b\.?/g,
  },
  // Phone rules need a plus prefix or a grouped layout so ISO dates and stakes are left alone.
  { kind: 'phone', pattern: /\+\d[\d\s().-]{7,}\d/g },
  { kind: 'phone', pattern: /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
];

const withGlobalFlag = (pattern: RegExp): RegExp =>
  pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);

export const maskPII = (text: string, rules: readonly MaskRule[] = DEFAULT_MASK_RULES): string =>
  rules.reduce(
    (masked, rule) => masked.replace(withGlobalFlag(rule.pattern), rule.replacement ?? `[${rule.kind}]`),
    text,
  );
