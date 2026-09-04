// src/utils/__tests__/dailyNotePathBuilder.test.ts
import { buildDailyNotePath } from '../dailyNotePathBuilder.js';

describe('buildDailyNotePath', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-02-04T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('should build path with YYYY-MM monthly subfolder', () => {
    const result = buildDailyNotePath('raw/YYYY-MM');
    expect(result).toBe('raw/2026-02');
  });

  it('should build path with nested YYYY/YYYY-MM subfolders', () => {
    const result = buildDailyNotePath('raw/YYYY/YYYY-MM');
    expect(result).toBe('raw/2026/2026-02');
  });

  it('should build path with YYYY/MM nested subfolders', () => {
    const result = buildDailyNotePath('raw/YYYY/MM');
    expect(result).toBe('raw/2026/02');
  });
});

describe('buildDailyNotePath - URLメタ文字エンコード', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-02-04T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('# を含むパスを %23 にエンコードする', () => {
    expect(buildDailyNotePath('notes#1/YYYY-MM-DD')).toBe('notes%231/2026-02-04');
  });

  it('? を含むパスを %3F にエンコードする', () => {
    expect(buildDailyNotePath('my?folder/YYYY-MM-DD')).toBe('my%3Ffolder/2026-02-04');
  });

  it('# と ? の両方を含むパスをエンコードする', () => {
    expect(buildDailyNotePath('a#b?c/YYYY')).toBe('a%23b%3Fc/2026');
  });

  it('スラッシュは区切りとして維持する', () => {
    expect(buildDailyNotePath('a/b#c/d?e/YYYY-MM-DD')).toBe('a/b%23c/d%3Fe/2026-02-04');
  });

  it('エンコード対象外の通常パスは変更しない', () => {
    expect(buildDailyNotePath('092.Daily/YYYY-MM-DD')).toBe('092.Daily/2026-02-04');
    expect(buildDailyNotePath('my folder/YYYY-MM-DD')).toBe('my folder/2026-02-04');
    expect(buildDailyNotePath('%2e%2e/%2f')).toBe('%2e%2e/%2f');
  });
});