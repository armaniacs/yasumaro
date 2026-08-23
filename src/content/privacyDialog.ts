/**
 * privacyDialog.ts
 * プライバシー懸念ページの確認ダイアログを Shadow DOM で表示する。
 *
 * extractor.ts から抽出 (PBI-06): このモジュールが Shadow DOM + a11y の
 * 知識を隠蔽する。呼び出し側は statusCode + reasonLabel だけを知ればよい。
 */

export function showPrivacyConfirmDialog(statusCode: string, reasonLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    const title = chrome.i18n.getMessage('notifyPrivacyConfirmTitle') || 'Yasumaro';
    const bodyText =
      chrome.i18n.getMessage('privacyDialogBody', [reasonLabel]) ||
      `このページにはプライバシー懸念があります（${reasonLabel}）。それでも保存しますか？`;
    const saveLabel = chrome.i18n.getMessage('notifyPrivacyConfirmSave') || '保存する';
    const cancelLabel = chrome.i18n.getMessage('cancel') || 'キャンセル';
    const statusLabel = chrome.i18n.getMessage('privacyDialogStatusLabel') || '検出コード';

    const host = document.createElement('div');
    host.id = 'osh-privacy-confirm-host';
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '100%';
    host.style.height = '100%';
    const shadow = host.attachShadow({ mode: 'closed' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
            .overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.45);
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .dialog {
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.22);
                padding: 24px 28px 20px;
                max-width: 380px;
                width: 90vw;
                box-sizing: border-box;
            }
            .header {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 14px;
            }
            .header img { width: 28px; height: 28px; flex-shrink: 0; }
            .header span {
                font-size: 15px; font-weight: 700; color: #1a1a1a;
            }
            .body { font-size: 14px; color: #333; line-height: 1.6; margin-bottom: 14px; }
            .status {
                display: inline-flex; align-items: center; gap: 6px;
                background: #f3f4f6; border-radius: 6px;
                padding: 4px 10px; font-size: 12px; color: #555;
                margin-bottom: 18px;
            }
            .status-code { font-family: monospace; font-weight: 700; color: #d97706; }
            .buttons { display: flex; gap: 10px; justify-content: flex-end; }
            .btn {
                padding: 8px 18px; border-radius: 7px; font-size: 14px;
                cursor: pointer; border: none; font-weight: 600;
            }
            .btn-cancel { background: #f3f4f6; color: #555; }
            .btn-cancel:hover { background: #e5e7eb; }
            .btn-save { background: #4f46e5; color: #fff; }
            .btn-save:hover { background: #4338ca; }
        `);
    shadow.adoptedStyleSheets = [sheet];

    shadow.innerHTML = `
            <div class="overlay">
                <div class="dialog" role="dialog" aria-modal="true">
                    <div class="header">
                        <img src="${iconUrl}" alt="">
                        <span id="osh-title"></span>
                    </div>
                    <div class="body" id="osh-body"></div>
                    <div class="status">
                        <span id="osh-status-label"></span>
                        <span class="status-code" id="osh-status-code"></span>
                        <span id="osh-reason"></span>
                    </div>
                    <div class="buttons">
                        <button class="btn btn-cancel" id="osh-cancel"></button>
                        <button class="btn btn-save" id="osh-save"></button>
                    </div>
                </div>
            </div>
        `;

    const setText = (id: string, text: string) => {
      const el = shadow.getElementById(id);
      if (el) el.textContent = text;
    };
    setText('osh-title', title);
    setText('osh-body', bodyText);
    setText('osh-status-label', `${statusLabel}:`);
    setText('osh-status-code', statusCode);
    setText('osh-reason', `- ${reasonLabel}`);
    setText('osh-cancel', cancelLabel);
    setText('osh-save', saveLabel);

    const cleanup = (result: boolean) => {
      host.remove();
      resolve(result);
    };

    shadow.getElementById('osh-save')?.addEventListener('click', () => cleanup(true));
    shadow.getElementById('osh-cancel')?.addEventListener('click', () => cleanup(false));
    shadow.querySelector('.overlay')?.addEventListener('click', (e) => {
      if (e.target === shadow.querySelector('.overlay')) cleanup(false);
    });

    document.body.appendChild(host);
    setTimeout(() => (shadow.getElementById('osh-cancel') as HTMLElement)?.focus(), 0);
  });
}
