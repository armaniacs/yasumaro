// src/background/privacyPipeline.ts
import { addLog, LogType } from '../utils/logger.js';
import { StorageKeys } from '../utils/storage.js';
export class PrivacyPipeline {
    settings;
    aiClient;
    sanitizers;
    mode;
    constructor(settings, aiClient, sanitizers) {
        this.settings = settings;
        this.aiClient = aiClient;
        this.sanitizers = sanitizers;
        this.mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
    }
    async process(content, options = {}) {
        const { previewOnly = false, alreadyProcessed = false } = options;
        if (!content) {
            return { summary: 'Summary not available.' };
        }
        const sanitizedSettings = {
            useLocalAi: (this.mode === 'local_only' || this.mode === 'full_pipeline') && !alreadyProcessed,
            useMasking: (this.mode === 'full_pipeline' || this.mode === 'masked_cloud') && !alreadyProcessed,
            useCloudAi: this.mode !== 'local_only'
        };
        let processingText = content;
        let maskedCount = 0;
        let maskedItems = [];
        // L1: Local Summarization
        if (sanitizedSettings.useLocalAi) {
            const localStatus = await this.aiClient.getLocalAvailability();
            if (localStatus === 'readily' || this.mode === 'local_only') {
                const localResult = await this.aiClient.summarizeLocally(content);
                if (localResult.success) {
                    processingText = localResult.summary;
                    if (this.mode === 'local_only') {
                        return { summary: localResult.summary };
                    }
                }
            }
        }
        // L2: PII Masking
        if (sanitizedSettings.useMasking) {
            const sanitizeResult = await this.sanitizers.sanitizeRegex(processingText);
            processingText = sanitizeResult.text;
            maskedItems = sanitizeResult.maskedItems;
            maskedCount = maskedItems.length;
            this._logMasking(sanitizeResult);
        }
        if (previewOnly) {
            return {
                success: true,
                preview: true,
                processedContent: processingText,
                mode: this.mode,
                maskedCount,
                maskedItems
            };
        }
        // L3: Cloud Summarization
        if (sanitizedSettings.useCloudAi) {
            const summary = await this.aiClient.generateSummary(processingText);
            return { summary, maskedCount };
        }
        return { summary: 'Summary not available.' };
    }
    _logMasking(sanitizeResult) {
        if (this.settings[StorageKeys.PII_SANITIZE_LOGS] !== false) {
            const count = sanitizeResult.maskedItems.length;
            if (count > 0) {
                addLog(LogType.SANITIZE, `Masked ${count} PII items`, {
                    items: sanitizeResult.maskedItems.map(i => i.type)
                });
            }
        }
    }
}
//# sourceMappingURL=privacyPipeline.js.map