import { describe, it, expect } from 'vitest';
import { buildExtractionOptions } from '../optionBuilder.js';
import { PageState } from '../../../content/pageState.js';

describe('buildExtractionOptions', () => {
  it('builds cleanseOptions with cleanseEnabled true when hard enabled', () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = true;
    config.contentStripKeywordEnabled = false;
    const { cleanseOptions } = buildExtractionOptions(config);
    expect(cleanseOptions.cleanseEnabled).toBe(true);
    expect(cleanseOptions.hardStripEnabled).toBe(true);
  });

  it('builds cleanseOptions with cleanseEnabled true when keyword enabled', () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = false;
    config.contentStripKeywordEnabled = true;
    const { cleanseOptions } = buildExtractionOptions(config);
    expect(cleanseOptions.cleanseEnabled).toBe(true);
    expect(cleanseOptions.keywordStripEnabled).toBe(true);
  });

  it('builds cleanseOptions with cleanseEnabled false when both disabled', () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = false;
    config.contentStripKeywordEnabled = false;
    const { cleanseOptions } = buildExtractionOptions(config);
    expect(cleanseOptions.cleanseEnabled).toBe(false);
    expect(cleanseOptions.hardStripEnabled).toBe(false);
    expect(cleanseOptions.keywordStripEnabled).toBe(false);
  });

  it('builds cleanseOptions with both enabled', () => {
    const config = new PageState().cleansingConfig;
    config.contentStripHardEnabled = true;
    config.contentStripKeywordEnabled = true;
    const { cleanseOptions } = buildExtractionOptions(config);
    expect(cleanseOptions.cleanseEnabled).toBe(true);
  });

  it('creates aiSummaryCleanseOptions with derived rule flags', () => {
    const config = new PageState().cleansingConfig;
    config.aiSummaryCleansingEnabled = true;
    const { aiSummaryCleanseOptions } = buildExtractionOptions(config);
    expect(aiSummaryCleanseOptions.aiSummaryCleanseEnabled).toBe(true);
    // at least one rule flag should be present
    expect(typeof aiSummaryCleanseOptions.linkDensityEnabled).toBe('boolean');
  });

  it('creates dedupOptions', () => {
    const config = new PageState().cleansingConfig;
    config.contentDedupEnabled = true;
    config.contentDedupThreshold = 0.9;
    const { dedupOptions } = buildExtractionOptions(config);
    expect(dedupOptions.dedupEnabled).toBe(true);
    expect(dedupOptions.dedupThreshold).toBe(0.9);
  });
});
