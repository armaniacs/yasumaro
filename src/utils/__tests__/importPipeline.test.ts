import { describe, it, expect, vi } from 'vitest';
import {
  runImportPipeline,
  ImportPipelineError,
  base64ToBytesTyped,
  DEFAULT_IMPORT_SIZE_CAP_BYTES,
} from '../importPipeline.js';

describe('runImportPipeline', () => {
  it('calls authenticate before parse (order contract)', async () => {
    const calls: string[] = [];
    await runImportPipeline('raw', {
      authenticate: () => {
        calls.push('authenticate');
        return true;
      },
      sizeOf: () => {
        calls.push('sizeOf');
        return 1;
      },
      parse: () => {
        calls.push('parse');
        return {};
      },
      validate: () => {
        calls.push('validate');
        return {};
      },
    });
    expect(calls).toEqual(['authenticate', 'sizeOf', 'parse', 'validate']);
  });

  it('rejects at authenticate stage without ever parsing', async () => {
    const parse = vi.fn();
    await expect(
      runImportPipeline('raw', {
        authenticate: () => false,
        sizeOf: () => 1,
        parse,
        validate: () => ({}),
      }),
    ).rejects.toMatchObject({ stage: 'authenticate' });
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before parse', async () => {
    const parse = vi.fn();
    await expect(
      runImportPipeline('raw', {
        authenticate: () => true,
        sizeOf: () => DEFAULT_IMPORT_SIZE_CAP_BYTES + 1,
        parse,
        validate: () => ({}),
      }),
    ).rejects.toMatchObject({ stage: 'sizeCap' });
    expect(parse).not.toHaveBeenCalled();
  });

  it('wraps validate failure as ImportPipelineError', async () => {
    await expect(
      runImportPipeline('raw', {
        authenticate: () => true,
        sizeOf: () => 1,
        parse: () => ({}),
        validate: () => false,
      }),
    ).rejects.toBeInstanceOf(ImportPipelineError);
  });

  it('base64ToBytesTyped decodes to a Uint8Array', () => {
    const bytes = base64ToBytesTyped(btoa('abc'));
    expect(Array.from(bytes)).toEqual([97, 98, 99]);
  });
});
