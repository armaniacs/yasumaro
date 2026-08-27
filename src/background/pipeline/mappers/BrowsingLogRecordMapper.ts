import type { RecordingContext } from '../types.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { extractCommonStorageFields } from './commonStorageFields.js';

export function mapToBrowsingLogRecord(context: RecordingContext): BrowsingLogRecord {
  const common = extractCommonStorageFields(context);
  const settings = context.settings as Record<string, unknown>;
  const contentStorageEnabled = settings[StorageKeys.CONTENT_STORAGE_ENABLED] === true;

  return common.toBrowsingLogRecord(contentStorageEnabled);
}
