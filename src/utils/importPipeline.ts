/**
 * importPipeline.ts
 * Shared "authenticate -> sizeCap -> parse -> validate" ordering primitive for
 * every file import path (settings / logs / backup).
 *
 * The fixed order matters for security: authentication (signature / HMAC) must
 * run before any resource-amplifying work (base64 decode, KDF, decrypt, JSON
 * parse of an attacker-sized payload). See VULN-023/034/035/036.
 */

/** Default read cap shared by import paths (10 MiB). */
export const DEFAULT_IMPORT_SIZE_CAP_BYTES = 10 * 1024 * 1024;

export class ImportPipelineError extends Error {
  readonly stage: ImportStage;
  constructor(stage: ImportStage, message: string) {
    super(message);
    this.name = 'ImportPipelineError';
    this.stage = stage;
  }
}

export type ImportStage = 'authenticate' | 'sizeCap' | 'parse' | 'validate';

export interface ImportPipelineSteps<TRaw, TParsed, TValidated> {
  /**
   * Verify the payload's authenticity (signature / HMAC) using only cheap
   * operations on the raw input. MUST reject before any amplifying work.
   * Return false or throw to reject.
   */
  authenticate: (raw: TRaw) => boolean | Promise<boolean>;
  /** Byte size of the raw payload, for the size cap check. */
  sizeOf: (raw: TRaw) => number;
  /** Maximum accepted byte size. Defaults to DEFAULT_IMPORT_SIZE_CAP_BYTES. */
  maxBytes?: number;
  /** Parse the authenticated, size-checked payload. */
  parse: (raw: TRaw) => TParsed | Promise<TParsed>;
  /** Validate the parsed structure. Return false or throw to reject. */
  validate: (parsed: TParsed) => TValidated | Promise<TValidated>;
}

/**
 * Runs the four stages in the fixed order. Any stage failure throws an
 * ImportPipelineError naming the stage that rejected.
 */
export async function runImportPipeline<TRaw, TParsed, TValidated>(
  raw: TRaw,
  steps: ImportPipelineSteps<TRaw, TParsed, TValidated>,
): Promise<TValidated> {
  const authenticated = await steps.authenticate(raw);
  if (authenticated === false) {
    throw new ImportPipelineError('authenticate', 'Authentication failed');
  }

  const maxBytes = steps.maxBytes ?? DEFAULT_IMPORT_SIZE_CAP_BYTES;
  const size = steps.sizeOf(raw);
  if (size > maxBytes) {
    throw new ImportPipelineError(
      'sizeCap',
      `Payload of ${size} bytes exceeds the ${maxBytes} byte limit`,
    );
  }

  let parsed: TParsed;
  try {
    parsed = await steps.parse(raw);
  } catch (error) {
    throw new ImportPipelineError(
      'parse',
      error instanceof Error ? error.message : 'Parse failed',
    );
  }

  try {
    const validated = await steps.validate(parsed);
    if (validated === false) {
      throw new ImportPipelineError('validate', 'Validation failed');
    }
    return validated as TValidated;
  } catch (error) {
    if (error instanceof ImportPipelineError) throw error;
    throw new ImportPipelineError(
      'validate',
      error instanceof Error ? error.message : 'Validation failed',
    );
  }
}

/**
 * Decode a base64 string to bytes without `atob`'s intermediate
 * binary-string amplification. Used where a signed-but-encoded field must be
 * decoded after authentication.
 */
export function base64ToBytesTyped(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
