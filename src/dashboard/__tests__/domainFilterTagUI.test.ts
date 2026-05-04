// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key: string) => {
    const messages: Record<string, string> = {
      'domainBlacklistDesc': 'Blacklist description',
      'domainWhitelistDesc': 'Whitelist description',
      'domainTagInvalidError': 'Invalid domain',
      'domainTagDuplicateError': 'Duplicate domain',
      'domainTagCount': '{count} items',
    };
    return messages[key] || key;
  }),
}));

vi.mock('../../popup/domainFilter.js', () => ({
  loadDomainSettings: vi.fn().mockResolvedValue(undefined),
}));

function setupFullDOM() {
  document.body.innerHTML = `
    <input type="radio" id="filterBlacklist" name="filter_mode" />
    <input type="radio" id="filterWhitelist" name="filter_mode" checked />
    <input type="radio" id="filterDisabled" name="filter_mode" />
    <textarea id="blacklistTextarea">bad.com</textarea>
    <textarea id="whitelistTextarea">good.com</textarea>
    <textarea id="domainList"></textarea>
    <button id="saveDomainSettings"></button>
    <div id="domainStatus"></div>
    <input type="checkbox" id="domainFilterToggle" />
    <div id="domainModeTabBar"></div>
    <div id="domainTagArea"></div>
    <button id="domainModeTab-blacklist"></button>
    <button id="domainModeTab-whitelist"></button>
    <div id="domainModeDesc"></div>
    <div id="domainTagCount"></div>
    <div id="domainTagList"></div>
    <input id="domainTagInput" />
    <button id="domainTagAddBtn"></button>
    <div id="domainTagError"></div>
    <button id="domainSaveBtn"></button>
    <div id="domainSaveStatus"></div>
  `;
}

describe('initDomainFilterTagUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('early return', () => {
    it('returns early when radio elements are missing from DOM', async () => {
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
      const { loadDomainSettings } = await import('../../popup/domainFilter.js');
      expect(loadDomainSettings).not.toHaveBeenCalled();
    });
  });

  describe('initialization with full DOM', () => {
    beforeEach(() => {
      setupFullDOM();
    });

    it('loads domain settings via loadDomainSettings', async () => {
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
      const { loadDomainSettings } = await import('../../popup/domainFilter.js');
      expect(loadDomainSettings).toHaveBeenCalledTimes(1);
    });

    it('toggle is checked when radioDisabled is not checked', async () => {
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
      const toggle = document.getElementById('domainFilterToggle') as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it('whitelist tab is active when whitelist radio is checked', async () => {
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
      const tabWhitelist = document.getElementById('domainModeTab-whitelist') as HTMLButtonElement;
      expect(tabWhitelist.classList.contains('active')).toBe(true);
      expect(tabWhitelist.getAttribute('aria-selected')).toBe('true');
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      expect(tabBlacklist.classList.contains('active')).toBe(false);
      expect(tabBlacklist.getAttribute('aria-selected')).toBe('false');
    });

    it('tab and tag areas are not hidden when enabled', async () => {
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
      const tabBar = document.getElementById('domainModeTabBar')!;
      const tagArea = document.getElementById('domainTagArea')!;
      expect(tabBar.hasAttribute('hidden')).toBe(false);
      expect(tagArea.hasAttribute('hidden')).toBe(false);
    });
  });

  describe('addDomain', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('adds a valid domain to the textarea via tagAddBtn click', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;

      tagInput.value = 'example.com';
      tagAddBtn.click();

      expect(whitelistTA.value).toBe('good.com\nexample.com');
    });

    it('strips https:// prefix from input', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;

      tagInput.value = 'https://example.com';
      tagAddBtn.click();

      expect(whitelistTA.value).toBe('good.com\nexample.com');
    });

    it('strips path from input', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;

      tagInput.value = 'example.com/path/to/page';
      tagAddBtn.click();

      expect(whitelistTA.value).toBe('good.com\nexample.com');
    });

    it('empty input does nothing', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;
      const tagError = document.getElementById('domainTagError')!;

      tagError.textContent = 'previous error';
      tagInput.value = '';
      tagAddBtn.click();

      expect(whitelistTA.value).toBe('good.com');
      expect(tagError.textContent).toBe('');
    });

    it('invalid domain format shows error in tagError', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const tagError = document.getElementById('domainTagError')!;

      tagInput.value = 'invalid domain!';
      tagAddBtn.click();

      expect(tagError.textContent).toBe('Invalid domain');
    });

    it('duplicate domain shows error in tagError', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const tagError = document.getElementById('domainTagError')!;

      tagInput.value = 'good.com';
      tagAddBtn.click();

      expect(tagError.textContent).toBe('Duplicate domain');
    });

    it('multiple domains can be added sequentially', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;

      tagInput.value = 'example.com';
      tagAddBtn.click();

      tagInput.value = 'test.org';
      tagAddBtn.click();

      expect(whitelistTA.value).toBe('good.com\nexample.com\ntest.org');
    });

    it('domainListTA is synced after adding a domain', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagAddBtn = document.getElementById('domainTagAddBtn') as HTMLButtonElement;
      const domainListTA = document.getElementById('domainList') as HTMLTextAreaElement;

      tagInput.value = 'newexample.com';
      tagAddBtn.click();

      expect(domainListTA.value).toContain('newexample.com');
    });
  });

  describe('removeDomain', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('remove button has aria-label with domain name', () => {
      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      expect(removeBtn).not.toBeNull();
      expect(removeBtn.getAttribute('aria-label')).toBe('good.com を削除');
    });

    it('clicking remove deletes the domain from textarea', () => {
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;
      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;

      removeBtn.click();

      expect(whitelistTA.value).toBe('');
    });

    it('domainListTA is synced after removing a domain', () => {
      const domainListTA = document.getElementById('domainList') as HTMLTextAreaElement;
      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;

      removeBtn.click();

      expect(domainListTA.value).toBe('');
    });
  });

  describe('renderTags', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('renders tags with mode-specific class', () => {
      const tags = document.querySelectorAll('.domain-tag');
      expect(tags.length).toBe(1);
      expect(tags[0].classList.contains('domain-tag-whitelist')).toBe(true);
    });

    it('tagCount shows count for non-empty list', () => {
      const tagCount = document.getElementById('domainTagCount')!;
      expect(tagCount.textContent).toBe('1 items');
    });

    it('tagCount is empty for empty list after removing all domains', () => {
      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      const tagCount = document.getElementById('domainTagCount')!;

      removeBtn.click();

      expect(tagCount.textContent).toBe('');
    });
  });

  describe('switchTab', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('clicking blacklist tab switches radio and sets active class', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;
      const radioWhitelist = document.getElementById('filterWhitelist') as HTMLInputElement;

      tabBlacklist.click();

      expect(radioBlacklist.checked).toBe(true);
      expect(radioWhitelist.checked).toBe(false);
      expect(tabBlacklist.classList.contains('active')).toBe(true);
      expect(tabBlacklist.getAttribute('aria-selected')).toBe('true');
    });

    it('clicking whitelist tab switches radio and sets active class', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const tabWhitelist = document.getElementById('domainModeTab-whitelist') as HTMLButtonElement;
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;
      const radioWhitelist = document.getElementById('filterWhitelist') as HTMLInputElement;

      tabBlacklist.click();
      tabWhitelist.click();

      expect(radioWhitelist.checked).toBe(true);
      expect(radioBlacklist.checked).toBe(false);
      expect(tabWhitelist.classList.contains('active')).toBe(true);
      expect(tabWhitelist.getAttribute('aria-selected')).toBe('true');
    });

    it('domainListTA syncs to the current mode textarea', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const domainListTA = document.getElementById('domainList') as HTMLTextAreaElement;

      tabBlacklist.click();

      expect(domainListTA.value).toBe('bad.com');

      const tabWhitelist = document.getElementById('domainModeTab-whitelist') as HTMLButtonElement;
      tabWhitelist.click();

      expect(domainListTA.value).toBe('good.com');
    });

    it('modeDesc is updated when switching tabs', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const modeDesc = document.getElementById('domainModeDesc')!;

      tabBlacklist.click();

      expect(modeDesc.textContent).toBe('Blacklist description');

      const tabWhitelist = document.getElementById('domainModeTab-whitelist') as HTMLButtonElement;
      tabWhitelist.click();

      expect(modeDesc.textContent).toBe('Whitelist description');
    });

    it('tagError is cleared on tab switch', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const tagError = document.getElementById('domainTagError')!;

      tagError.textContent = 'some error';
      tabBlacklist.click();

      expect(tagError.textContent).toBe('');
    });
  });

  describe('setEnabled', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('disabling hides tab and tag areas, checks disabled radio', () => {
      const toggle = document.getElementById('domainFilterToggle') as HTMLInputElement;
      const radioDisabled = document.getElementById('filterDisabled') as HTMLInputElement;
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;
      const radioWhitelist = document.getElementById('filterWhitelist') as HTMLInputElement;
      const tabBar = document.getElementById('domainModeTabBar')!;
      const tagArea = document.getElementById('domainTagArea')!;

      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(radioDisabled.checked).toBe(true);
      expect(radioBlacklist.checked).toBe(false);
      expect(radioWhitelist.checked).toBe(false);
      expect(tabBar.hasAttribute('hidden')).toBe(true);
      expect(tagArea.hasAttribute('hidden')).toBe(true);
    });

    it('re-enabling restores visibility and defaults to blacklist when no radio selected', () => {
      const toggle = document.getElementById('domainFilterToggle') as HTMLInputElement;
      const radioDisabled = document.getElementById('filterDisabled') as HTMLInputElement;
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;
      const tabBar = document.getElementById('domainModeTabBar')!;
      const tagArea = document.getElementById('domainTagArea')!;

      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));

      expect(radioDisabled.checked).toBe(false);
      expect(radioBlacklist.checked).toBe(true);
      expect(tabBar.hasAttribute('hidden')).toBe(false);
      expect(tagArea.hasAttribute('hidden')).toBe(false);
    });

    it('toggle aria-checked is kept in sync', () => {
      const toggle = document.getElementById('domainFilterToggle') as HTMLInputElement;

      expect(toggle.getAttribute('aria-checked')).toBe('true');

      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('event listeners', () => {
    beforeEach(async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();
    });

    it('toggle change event calls setEnabled', () => {
      const toggle = document.getElementById('domainFilterToggle') as HTMLInputElement;
      const tabBar = document.getElementById('domainModeTabBar')!;

      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(tabBar.hasAttribute('hidden')).toBe(true);
    });

    it('tab button click triggers switchTab', () => {
      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;

      tabBlacklist.click();

      expect(radioBlacklist.checked).toBe(true);
    });

    it('Enter key on tagInput calls addDomain with preventDefault', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const whitelistTA = document.getElementById('whitelistTextarea') as HTMLTextAreaElement;

      tagInput.value = 'example.com';
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      tagInput.dispatchEvent(event);

      expect(whitelistTA.value).toBe('good.com\nexample.com');
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('tagInput input event clears tagError', () => {
      const tagInput = document.getElementById('domainTagInput') as HTMLInputElement;
      const tagError = document.getElementById('domainTagError')!;

      tagError.textContent = 'some error';
      tagInput.dispatchEvent(new Event('input'));

      expect(tagError.textContent).toBe('');
    });

    it('save button clears saveStatus and clicks real save button', () => {
      const saveBtn = document.getElementById('domainSaveBtn') as HTMLButtonElement;
      const saveStatus = document.getElementById('domainSaveStatus')!;
      const realSaveBtn = document.getElementById('saveDomainSettings') as HTMLButtonElement;

      saveStatus.textContent = 'previous status';
      let realSaveClicked = false;
      realSaveBtn.addEventListener('click', () => { realSaveClicked = true; });

      saveBtn.click();

      expect(saveStatus.textContent).toBe('');
      expect(realSaveClicked).toBe(true);
    });
  });

  describe('MutationObserver', () => {
    it('updates saveStatus when realStatus changes', async () => {
      setupFullDOM();
      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();

      const realStatus = document.getElementById('domainStatus')!;
      const saveStatus = document.getElementById('domainSaveStatus')!;

      realStatus.textContent = 'saved successfully';
      realStatus.className = 'success';

      await new Promise(r => setTimeout(r, 0));

      expect(saveStatus.textContent).toBe('saved successfully');
      expect(saveStatus.className).toBe('status-message success');
    });
  });

  describe('blacklist default when no filter selected', () => {
    it('defaults to blacklist when no radio is checked and enabling', async () => {
      setupFullDOM();
      const radioBlacklist = document.getElementById('filterBlacklist') as HTMLInputElement;
      const radioWhitelist = document.getElementById('filterWhitelist') as HTMLInputElement;
      radioBlacklist.checked = false;
      radioWhitelist.checked = false;

      const { initDomainFilterTagUI } = await import('../domainFilterTagUI.js');
      await initDomainFilterTagUI();

      const tabBlacklist = document.getElementById('domainModeTab-blacklist') as HTMLButtonElement;
      expect(radioBlacklist.checked).toBe(true);
      expect(tabBlacklist.classList.contains('active')).toBe(true);
      expect(tabBlacklist.getAttribute('aria-selected')).toBe('true');
    });
  });
});
