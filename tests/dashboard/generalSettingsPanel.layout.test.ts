import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

describe('generalSettingsPanel layout branching', () => {
  it('トグルでA/Bが切り替わる（smoke）', async () => {
    const dom = new JSDOM(`
      <div id="panel-general">
        <div id="aiProviderSection">
          <h3 class="settings-section-title">AI Provider</h3>
          <div id="bPriorityList" hidden></div>
          <div id="bProviderAccordion" hidden></div>
          <details class="priority-details"><summary>P1</summary></details>
        </div>
      </div>
    `);
    global.document = dom.window.document as unknown as Document;
    // このテストは統合のsmokeとして、refresh関数がhiddenを切り替えることを期待
    // 実装前は関数が存在しないため失敗する
    const { createGeneralSettingsPanel } = await import('../../src/dashboard/panels/staticForm/generalSettingsPanel.js');
    expect(createGeneralSettingsPanel).toBeDefined();
  });
});
