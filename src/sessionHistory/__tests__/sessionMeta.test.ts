import {
  EMPTY_SESSION_META,
  describeSessionMeta,
  hasSessionMeta,
  parsePositiveNumber,
  sessionMetaFilenameSuffix,
} from '../sessionMeta';

describe('sessionMeta helpers', () => {
  const tagged = { exercise: 'Hammer Curl', equipment: 'Rope', weightKg: 12.5, trueReps: 8, isWarmup: false };

  test('empty meta is not tagged and adds nothing to a filename', () => {
    expect(hasSessionMeta(EMPTY_SESSION_META)).toBe(false);
    expect(sessionMetaFilenameSuffix(EMPTY_SESSION_META)).toBe('');
    expect(sessionMetaFilenameSuffix(null)).toBe('');
  });

  test('filename suffix is lowercase, dashed and keeps the timestamp prefix untouched', () => {
    expect(sessionMetaFilenameSuffix(tagged)).toBe('_hammer-curl_rope_12.5kg');
    expect(sessionMetaFilenameSuffix({ ...tagged, isWarmup: true })).toBe('_warmup_hammer-curl_rope_12.5kg');
  });

  test('description reads naturally', () => {
    expect(describeSessionMeta(tagged)).toBe('Hammer Curl · Rope · 12.5 kg');
  });

  test('numbers: comma decimals accepted, junk and zero rejected', () => {
    expect(parsePositiveNumber('12,5')).toBe(12.5);
    expect(parsePositiveNumber('')).toBeNull();
    expect(parsePositiveNumber('abc')).toBeNull();
    expect(parsePositiveNumber('0')).toBeNull();
  });
});
