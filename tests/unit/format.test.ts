import { describe, expect, it } from 'vitest';
import { compact, formatRate, parseRate } from '../../src/format';

describe('compact', () => {
  it.each([
    [0, '0'], [0.5, '0.5'], [12.34, '12.3'], [150, '150'], [1234, '1.23k'], [2_500_000, '2.5M'],
    [999.6, '1k'], [999_999, '1M'], [-999_999, '-1M'], [999_999_999, '1G'], [0.0034, '0.0034'], [1e-7, '0.0000001'],
  ])('%s -> %s', (n, out) => { expect(compact(n)).toBe(out); });

  it('never shows 1000 of a unit', () => {
    expect(formatRate(999_999_999.9, 'mB')).toBe('1M B/s');
  });
});

describe('parseRate', () => {
  it.each([
    ['1000', 1000], ['1,000', 1000], ['1,000,000.5', 1_000_000.5], ['.5', 0.5], ['20k', 20_000], ['30/min', 0.5],
  ])('reads %s as %s per second', (text, n) => { expect(parseRate(text, 'item')).toBeCloseTo(n, 9); });

  it('reads fluid units', () => {
    expect(parseRate('1.5B', 'mB')).toBe(1500);
    expect(parseRate('500mB', 'mB')).toBe(500);
  });

  it('reads EU/s as per tick', () => {
    expect(parseRate('2k EU/s', 'eu')).toBe(100);
  });

  it.each(['1.5.5', '1..2', '1,5', '1,50', ',', '.', '', 'abc', '500 mB', '2 B'])('rejects %j for an item rate', (text) => {
    expect(parseRate(text, 'item')).toBeNull();
  });
});
