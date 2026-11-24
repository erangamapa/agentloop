import { describe, expect, it } from 'vitest';
import { maskPII } from '../src/privacy/mask.js';

describe('maskPII', () => {
  it('masks emails and account ids by default', () => {
    const masked = maskPII('Mail jo.doe+vip@example.com about acct_77ab12 today.');
    expect(masked).toBe('Mail [email] about [account] today.');
  });

  it('masks phone numbers and street addresses', () => {
    expect(maskPII('Call +44 20 7946 0958 or 555-123-4567.')).toBe('Call [phone] or [phone].');
    expect(maskPII('Lives at 42 Baker Street.')).toBe('Lives at [address]');
  });

  it('leaves dates, odds and stakes alone', () => {
    const text = 'Settled 2025-03-14 at 1.85 for 25.00 EUR.';
    expect(maskPII(text)).toBe(text);
  });

  it('accepts injected rules', () => {
    const rules = [{ kind: 'ticket', pattern: /TKT-\d+/ }];
    expect(maskPII('See TKT-1001 and TKT-1002', rules)).toBe('See [ticket] and [ticket]');
    expect(maskPII('a@b.co', rules)).toBe('a@b.co');
  });
});
