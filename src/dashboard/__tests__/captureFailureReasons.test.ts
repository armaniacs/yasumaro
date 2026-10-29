/**
 * captureFailureReasons.test.ts
 * PBI 2026-10-22-06 ― 取り込み拡大 (失敗可視化の語彙).
 * Pins: every known code classifies into its display category (権限・CSP・
 * 種別・同意・保存・重複), unknown codes fail closed as internal/unknown,
 * and the scope lists carry the PBI's explicit in/out targets.
 */
import { describe, it, expect } from 'vitest';
import {
  CAPTURE_FAILURE_REASONS,
  CAPTURE_SCOPE,
  classifyCaptureFailure,
} from '../captureFailureReasons.js';

describe('classifyCaptureFailure (対象外の理由表示: 沈黙の失敗にしない)', () => {
  it('classifies the permission denials', () => {
    expect(classifyCaptureFailure('PRIVATE_PAGE_DETECTED')).toEqual({
      code: 'PRIVATE_PAGE_DETECTED',
      category: 'permission',
      known: true,
    });
    expect(classifyCaptureFailure('domain_excluded').category).toBe('permission');
    // PBI 2026-10-22-06: the worker's domain-filter refusal joined the table
    // (E2E evidence). Listed means the diagnostics panel renders the
    // permission category without the unlisted-reason suffix.
    expect(classifyCaptureFailure('DOMAIN_BLOCKED')).toEqual({
      code: 'DOMAIN_BLOCKED',
      category: 'permission',
      known: true,
    });
  });

  it('classifies the CSP / kind / consent / storage / duplicate codes', () => {
    expect(classifyCaptureFailure('csp_blocked').category).toBe('csp');
    expect(classifyCaptureFailure('non-html').category).toBe('kind');
    expect(classifyCaptureFailure('unsupported-kind').category).toBe('kind');
    expect(classifyCaptureFailure('privacy_consent_required').category).toBe('consent');
    expect(classifyCaptureFailure('rate_limited').category).toBe('consent');
    expect(classifyCaptureFailure('paused').category).toBe('consent');
    expect(classifyCaptureFailure('sqlite-client-absent').category).toBe('storage');
    expect(classifyCaptureFailure('pipeline-error').category).toBe('storage');
    expect(classifyCaptureFailure('same_day').category).toBe('duplicate');
  });

  it('fails closed on unknown codes (縮退の出口: 例外なし・欠落なし)', () => {
    expect(classifyCaptureFailure('future-code')).toEqual({
      code: 'future-code',
      category: 'internal',
      known: false,
    });
    expect(classifyCaptureFailure('').known).toBe(false);
    expect(classifyCaptureFailure(undefined).known).toBe(false);
    expect(classifyCaptureFailure(null).category).toBe('internal');
  });

  it('keeps the code table free of duplicates', () => {
    const codes = CAPTURE_FAILURE_REASONS.map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('CAPTURE_SCOPE (DoD: 対応範囲と対象外一覧)', () => {
  it('lists the PBI-explicit out-of-scope targets as excluded', () => {
    const byTarget = new Map(CAPTURE_SCOPE.map((row) => [row.target, row.status]));
    expect(byTarget.get('file:// pages')).toBe('excluded');
    expect(byTarget.get('auth-walled pages')).toBe('excluded');
    expect(byTarget.get('paywalled pages')).toBe('excluded');
    expect(byTarget.get('canvas-rendered pages')).toBe('excluded');
  });

  it('marks the staged expansion targets as planned, not done', () => {
    const byTarget = new Map(CAPTURE_SCOPE.map((row) => [row.target, row.status]));
    expect(byTarget.get('article pages (valid-visit auto recording)')).toBe('done');
    expect(byTarget.get('PDF viewer')).toBe('planned');
    expect(byTarget.get('video captions')).toBe('planned');
  });

  it('marks the SPA late-content re-scan done once slice 2 ships', () => {
    const byTarget = new Map(CAPTURE_SCOPE.map((row) => [row.target, row.status]));
    expect(byTarget.get('SPA late-loaded content')).toBe('done');
  });
});
