import type { Settings } from '../utils/storage/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { MessageSenderLike, RateLimiter } from './rateLimiter.js';
import { visitRateLimiter } from './visitRateLimiter.js';

/** The recording kinds the admission pre-stage serves. */
export type RecordAdmissionKind = 'valid-visit' | 'manual' | 'save' | 'regenerate';

/** One rejection shape for every admission stage, owned by this module. */
export interface AdmissionRejected {
  success: false;
  reason: string;
  error?: string;
}

export type AdmissionOutcome = { settings: Settings } | { rejected: AdmissionRejected };

/** The narrowed admit seam handlers receive from the router. */
export type RecordingAdmit = (
  kind: RecordAdmissionKind,
  sender: chrome.runtime.MessageSender,
) => Promise<AdmissionOutcome>;

export interface RecordingAdmissionDeps {
  isRecordingAllowed: () => Promise<boolean>;
  getSettings: () => Promise<Settings>;
  /** Internal adapter: the shared RateLimiter counter. Handlers never see it. */
  rateLimiter: Pick<RateLimiter, 'check'>;
}

/**
 * kind → counter bucket. Bucket names are derived here so handlers hold no
 * bucket knowledge: regenerate keeps its own bucket so dashboard bursts never
 * starve popup manual records (Ask N3-B); manual keeps the legacy default
 * `origin:…` key (undefined bucket); null means the kind is not
 * counter-limited (SAVE_RECORD is an explicit user action); VALID_VISIT is
 * flood-guarded by the per-URL visitRateLimiter instead.
 */
const KIND_RATE_BUCKET: Record<Exclude<RecordAdmissionKind, 'valid-visit'>, string | null | undefined> = {
  manual: undefined,
  save: null,
  regenerate: 'regenerate',
};

function toSenderLike(sender: chrome.runtime.MessageSender): MessageSenderLike {
  return {
    ...pickDefined({
      url: sender.url,
      tab: sender.tab ? pickDefined({ id: sender.tab.id }) : undefined,
    }),
  };
}

/**
 * RecordingAdmission — the pre-stage every recording handler shares:
 * consent → settings → sender narrowing → rate decision, behind one
 * `admit(kind, sender) → { settings } | { rejected }` seam.
 *
 * The three handler factories used to hand-copy this prelude with per-stage
 * drift (regenerate threaded `reason:'rate_limited'`, manual did not; consent
 * rejections diverged between `reason` and `error` fields), so a stage-order
 * fix needed three synchronized edits. One module owns the order and the
 * rejection shapes; handlers keep only request assembly and their own gates
 * (fetch, recovery claim, force opt-in, URL validation).
 */
export class RecordingAdmission {
  constructor(private readonly deps: RecordingAdmissionDeps) {}

  async admit(kind: RecordAdmissionKind, sender: chrome.runtime.MessageSender): Promise<AdmissionOutcome> {
    // VALID_VISIT keeps its pre-counter order: the per-URL flood guard needs
    // no storage and runs before the consent read (visits are the hottest
    // path).
    if (kind === 'valid-visit') {
      const url = sender.tab?.url;
      if (url && isRateLimitedVisit(url)) {
        return { rejected: { success: false, reason: 'rate_limited' } };
      }
      if (!(await this.deps.isRecordingAllowed())) {
        return { rejected: { success: false, reason: 'privacy_consent_required' } };
      }
      return { settings: await this.deps.getSettings() };
    }

    if (!(await this.deps.isRecordingAllowed())) {
      return { rejected: { success: false, reason: 'privacy_consent_required' } };
    }
    const settings = await this.deps.getSettings();
    const bucket = KIND_RATE_BUCKET[kind];
    if (bucket !== null) {
      const rate = await this.deps.rateLimiter.check(toSenderLike(sender), settings, bucket ? { bucket } : undefined);
      if (!rate.allowed) {
        return { rejected: { success: false, reason: 'rate_limited', error: rate.error ?? 'rate_limited' } };
      }
    }
    return { settings };
  }
}

/** Exported for unit tests; used internally by the valid-visit admission. */
export function isRateLimitedVisit(url: string): boolean {
  return visitRateLimiter.isRateLimited(url);
}

/** Clear all tracked rate-limit entries (used by tests). */
export function resetVisitRateLimiter(): void {
  visitRateLimiter.reset();
}
