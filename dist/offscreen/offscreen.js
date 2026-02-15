/**
 * offscreen.ts
 * Handles interactions with the Chrome Prompt API (window.ai) in an offscreen document.
 */
let session = null;
// Helper to get the AI object
const getAI = () => {
    return window.ai || globalThis.ai || (typeof self !== 'undefined' ? self.ai : null);
};
// Check availability
async function checkAvailability() {
    const ai = getAI();
    if (!ai?.languageModel) {
        return 'unsupported';
    }
    try {
        const capabilities = await ai.languageModel.capabilities();
        return capabilities?.available || 'no';
    }
    catch (error) {
        console.error('Offscreen: Failed to check capabilities', error);
        return 'unsupported';
    }
}
// Create session if needed
async function ensureSession() {
    if (session)
        return true;
    const ai = getAI();
    if (!ai) {
        console.error("Offscreen: 'ai' object not found in window, globalThis, or self.");
        console.log("Offscreen: Scope dump:", {
            hasWindow: typeof window !== 'undefined',
            hasSelf: typeof self !== 'undefined',
            hasGlobalThis: typeof globalThis !== 'undefined',
            windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.includes('ai') || k.includes('model')) : []
        });
        return { success: false, error: "'ai' object not found (Prompt API missing). Check flags." };
    }
    if (!ai.languageModel) {
        console.error("Offscreen: ai.languageModel is undefined.");
        return { success: false, error: "ai.languageModel is undefined" };
    }
    const status = await checkAvailability();
    if (status !== 'readily' && status !== 'after-download') {
        console.warn(`Offscreen: AI status is '${status}', cannot create session.`);
        return { success: false, error: `AI capability status is '${status}'` };
    }
    try {
        session = await ai.languageModel.create({
            systemPrompt: `あなたはWebページ要約のエキスパートです。
与えられたテキストを日本語で1文または2文に要約してください。
重要なポイントのみを抽出し、個人情報や機密情報は含めないでください。
改行しないでください。`
        });
        console.log("Offscreen: Session created successfully.");
        return true;
    }
    catch (error) {
        console.error('Offscreen: Failed to create session', error);
        return { success: false, error: `Session creation failed: ${error.message}` };
    }
}
// Handle messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen')
        return;
    (async () => {
        try {
            if (message.type === 'CHECK_AVAILABILITY') {
                const result = await checkAvailability();
                sendResponse({ status: result });
            }
            else if (message.type === 'SUMMARIZE') {
                const { content } = message.payload;
                if (!content) {
                    sendResponse({ success: false, error: 'No content provided' });
                    return;
                }
                const sessionResult = await ensureSession();
                if (sessionResult !== true) {
                    // ensureSession returns object with error on failure
                    const errorMsg = sessionResult.error || 'Unknown session error';
                    sendResponse({ success: false, error: errorMsg });
                    return;
                }
                try {
                    // Truncate if necessary (though the model handles some length, keeping it safe is good)
                    const truncatedContent = content.substring(0, 10000);
                    if (session) {
                        const result = await session.prompt(truncatedContent);
                        sendResponse({ success: true, summary: result });
                    }
                    else {
                        throw new Error('Session is null');
                    }
                }
                catch (promptError) {
                    console.error('Offscreen: Prompt extraction failed', promptError);
                    // If the session is dead, clear it
                    session = null;
                    sendResponse({ success: false, error: `Prompt failed: ${promptError.message}` });
                }
            }
            else {
                console.warn(`Offscreen: Unknown message type ${message.type}`);
                sendResponse({ success: false, error: 'Unknown message type' });
            }
        }
        catch (err) {
            console.error('Offscreen: Unexpected error', err);
            sendResponse({ success: false, error: err.message });
        }
    })();
    return true; // Keep channel open for async response
});
export {};
//# sourceMappingURL=offscreen.js.map