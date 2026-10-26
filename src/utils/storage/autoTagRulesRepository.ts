/**
 * autoTagRulesRepository.ts
 *
 * Repository seam for auto-tag rules (PBI 2026-10-23-06). Thin functions
 * over SettingsRepository, mirroring savedCollectionsRepository.ts: the
 * read normalizes the stored map, writes run the pure upsert/remove, and a
 * corrupted store degrades to "no rules" instead of failing the save path.
 *
 * The application log is provenance for the rule undo (dashboard side): the
 * recording step appends { ruleId, tag, url, at } per applied tag, capped so
 * the log cannot grow with history.
 */

import { StorageKeys } from './types.js';
import { settingsRepository, type SettingsRepository } from './SettingsRepository.js';
import {
  appendAutoTagApplications,
  normalizeAutoTagApplication,
  normalizeAutoTagRules,
  removeAutoTagRule,
  upsertAutoTagRule,
  type AutoTagApplication,
  type AutoTagRule,
} from './autoTagRules.js';
import { errorMessage } from '../errorUtils.js';
import { logError } from '../logger/api.js';
import { ErrorCode } from '../logger/types.js';

export type AutoTagRulesStore = Pick<SettingsRepository, 'get' | 'set'>;

export async function getAutoTagRules(
  repo: AutoTagRulesStore = settingsRepository,
): Promise<Record<string, AutoTagRule>> {
  try {
    const stored = await repo.get(StorageKeys.AUTO_TAG_RULES);
    return normalizeAutoTagRules(stored);
  } catch (error) {
    void logError('[AutoTagRules] read failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'autoTagRulesRepository');
    return {};
  }
}

export async function upsertAutoTagRuleById(
  rule: AutoTagRule,
  repo: AutoTagRulesStore = settingsRepository,
): Promise<void> {
  const normalized = normalizeAutoTagRules({ [rule.id]: rule });
  if (!normalized[rule.id]) throw new Error(`Invalid auto-tag rule ${rule.id}`);
  const current = await getAutoTagRules(repo);
  await repo.set(StorageKeys.AUTO_TAG_RULES, upsertAutoTagRule(current, normalized[rule.id] as AutoTagRule));
}

export async function removeAutoTagRuleById(
  id: string,
  repo: AutoTagRulesStore = settingsRepository,
): Promise<void> {
  const current = await getAutoTagRules(repo);
  await repo.set(StorageKeys.AUTO_TAG_RULES, removeAutoTagRule(current, id));
}

export async function getAutoTagApplications(
  repo: AutoTagRulesStore = settingsRepository,
): Promise<AutoTagApplication[]> {
  try {
    const stored = await repo.get(StorageKeys.AUTO_TAG_APPLICATIONS);
    if (!Array.isArray(stored)) return [];
    return stored
      .map((entry) => normalizeAutoTagApplication(entry))
      .filter((entry): entry is AutoTagApplication => entry !== null);
  } catch (error) {
    void logError('[AutoTagRules] application log read failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'autoTagRulesRepository');
    return [];
  }
}

export async function appendAutoTagApplicationsById(
  entries: AutoTagApplication[],
  repo: AutoTagRulesStore = settingsRepository,
): Promise<void> {
  if (entries.length === 0) return;
  const current = await getAutoTagApplications(repo);
  await repo.set(StorageKeys.AUTO_TAG_APPLICATIONS, appendAutoTagApplications(current, entries));
}

export async function pruneAutoTagApplications(
  keep: (entry: AutoTagApplication) => boolean,
  repo: AutoTagRulesStore = settingsRepository,
): Promise<void> {
  const current = await getAutoTagApplications(repo);
  await repo.set(StorageKeys.AUTO_TAG_APPLICATIONS, current.filter(keep));
}
