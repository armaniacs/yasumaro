import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { formatTimeAgo } from '../statusChecker.js';

describe('formatTimeAgo', () => {
  let originalNow: number;

  beforeEach(() => {
    originalNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(originalNow);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return "たった今" for timestamps within 1 minute', () => {
    const timestamp = originalNow - 30 * 1000; // 30秒前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('たった今');
  });

  it('should return "N分前" for timestamps within 1 hour', () => {
    const timestamp = originalNow - 5 * 60 * 1000; // 5分前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('5分前');
  });

  it('should return "N時間前" for timestamps within 24 hours', () => {
    const timestamp = originalNow - 3 * 60 * 60 * 1000; // 3時間前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('3時間前');
  });

  it('should return "昨日" for timestamps from yesterday', () => {
    const timestamp = originalNow - 25 * 60 * 60 * 1000; // 25時間前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('昨日');
  });

  it('should return "N日前" for timestamps within a week', () => {
    const timestamp = originalNow - 3 * 24 * 60 * 60 * 1000; // 3日前
    const result = formatTimeAgo(timestamp);
    expect(result.timeAgo).toBe('3日前');
  });

  it('should format time as "HH:MM" for today', () => {
    const today = new Date(originalNow);
    today.setHours(14, 32, 0, 0);
    const result = formatTimeAgo(today.getTime());
    expect(result.formatted).toBe('14:32');
  });

  it('should format time as "MM/DD HH:MM" for other days', () => {
    const otherDay = new Date(originalNow);
    otherDay.setDate(otherDay.getDate() - 5);
    otherDay.setHours(14, 32, 0, 0);
    const result = formatTimeAgo(otherDay.getTime());
    const month = String(otherDay.getMonth() + 1).padStart(2, '0');
    const day = String(otherDay.getDate()).padStart(2, '0');
    expect(result.formatted).toBe(`${month}/${day} 14:32`);
  });
});