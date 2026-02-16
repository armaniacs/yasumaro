// src/utils/__tests__/dailyNotePathBuilder.test.ts
import { buildDailyNotePath } from '../dailyNotePathBuilder';

describe('buildDailyNotePath', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-04T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should build path with YYYY placeholders', () => {
    const result = buildDailyNotePath('notes/YYYY');
    expect(result).toBe('notes/2026');
  });

  it('should build path with YYYY-MM-DD format', () => {
    const result = buildDailyNotePath('092.Daily/YYYY-MM-DD');
    expect(result).toBe('092.Daily/2026-02-04');
  });

  it('should handle empty path', () => {
    const result = buildDailyNotePath('');
    expect(result).toBe('2026-02-04');
  });

  it('should handle individual placeholders', () => {
    expect(buildDailyNotePath('YYYY')).toBe('2026');
    expect(buildDailyNotePath('MM')).toBe('02');
    expect(buildDailyNotePath('DD')).toBe('04');
  });
});