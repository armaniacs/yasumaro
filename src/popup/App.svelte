<script lang="ts">
  import { onMount } from 'svelte';
  import Button from './components/Common/Button.svelte';
  import Input from './components/Common/Input.svelte';
  import ProviderSelect from './components/Settings/ProviderSelect.svelte';
  import TabList from './components/Navigation/TabList.svelte';
  import FilterMode from './components/DomainFilter/FilterMode.svelte';
  import DomainList from './components/DomainFilter/DomainList.svelte';

  // Storage imports
  import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
  import type { EncryptedData } from '../utils/typesCrypto.js';

  // Reactive state using Svelte 5 runes
  let activeTab = $state('general');
  let aiProvider = $state('gemini');
  
  // Obsidian connection settings
  let obsidianProtocol = $state('http');
  let obsidianPort = $state('27123');
  let obsidianApiKey = $state('');
  let obsidianDailyPath = $state('');
  
  // AI Provider settings - Gemini
  let geminiApiKey = $state('');
  let geminiModel = $state('gemini-2.0-flash');
  
  // AI Provider settings - OpenAI
  let openaiBaseUrl = $state('https://api.openai.com/');
  let openaiApiKey = $state('');
  let openaiModel = $state('gpt-4o-mini');
  
  // AI Provider settings - OpenAI Compatible (Ollama, etc.)
  let openai2BaseUrl = $state('http://localhost:11434/v1');
  let openai2ApiKey = $state('');
  let openai2Model = $state('');
  
  // Domain filter settings
  let filterMode = $state<'disabled' | 'whitelist' | 'blacklist'>('disabled');
  let whitelistDomains = $state('');
  let blacklistDomains = $state('');
  
  // Privacy settings
  let privacyMode = $state<'local_only' | 'full_pipeline' | 'masked_cloud'>('local_only');
  let piiConfirmation = $state(true);
  let piiSanitizeLogs = $state(true);
  
  // UI state
  let statusMessage = $state('');
  let statusType = $state<'success' | 'error' | ''>('');
  let isLoading = $state(true);

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'domain', label: 'Domain' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'privacy', label: 'Privacy' }
  ];

  // Provider configuration
  const providers = [
    { value: 'gemini', label: 'Gemini (Google AI)', baseUrl: 'https://generativelanguage.googleapis.com/' },
    { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/' },
    { value: 'openai2', label: 'OpenAI (Compatible)', baseUrl: '' }
  ];

  // Helper to extract string from encrypted data
  function toString(value: string | EncryptedData | undefined): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return '';
  }

  // Load settings from chrome.storage on mount
  onMount(async () => {
    try {
      const settings = await getSettings();
      
      // Obsidian settings
      obsidianProtocol = toString(settings[StorageKeys.OBSIDIAN_PROTOCOL]) || 'http';
      obsidianPort = toString(settings[StorageKeys.OBSIDIAN_PORT]) || '27123';
      obsidianApiKey = toString(settings[StorageKeys.OBSIDIAN_API_KEY]);
      obsidianDailyPath = toString(settings[StorageKeys.OBSIDIAN_DAILY_PATH]) || '';
      
      // AI Provider
      aiProvider = toString(settings[StorageKeys.AI_PROVIDER]) || 'gemini';
      
      // Gemini settings
      geminiApiKey = toString(settings[StorageKeys.GEMINI_API_KEY]);
      geminiModel = toString(settings[StorageKeys.GEMINI_MODEL]) || 'gemini-2.0-flash';
      
      // OpenAI settings
      openaiBaseUrl = toString(settings[StorageKeys.OPENAI_BASE_URL]) || 'https://api.openai.com/';
      openaiApiKey = toString(settings[StorageKeys.OPENAI_API_KEY]);
      openaiModel = toString(settings[StorageKeys.OPENAI_MODEL]) || 'gpt-4o-mini';
      
      // OpenAI2 settings
      openai2BaseUrl = toString(settings[StorageKeys.OPENAI_2_BASE_URL]) || 'http://localhost:11434/v1';
      openai2ApiKey = toString(settings[StorageKeys.OPENAI_2_API_KEY]);
      openai2Model = toString(settings[StorageKeys.OPENAI_2_MODEL]) || '';
      
      // Domain filter
      const storedFilterMode = toString(settings[StorageKeys.DOMAIN_FILTER_MODE]);
      if (storedFilterMode === 'whitelist' || storedFilterMode === 'blacklist' || storedFilterMode === 'disabled') {
        filterMode = storedFilterMode;
      }
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST];
      whitelistDomains = Array.isArray(whitelist) ? whitelist.join('\n') : '';
      const blacklist = settings[StorageKeys.DOMAIN_BLACKLIST];
      blacklistDomains = Array.isArray(blacklist) ? blacklist.join('\n') : '';
      
      // Privacy settings
      const storedPrivacyMode = toString(settings[StorageKeys.PRIVACY_MODE]);
      if (storedPrivacyMode === 'local_only' || storedPrivacyMode === 'full_pipeline' || storedPrivacyMode === 'masked_cloud') {
        privacyMode = storedPrivacyMode;
      }
      piiConfirmation = settings[StorageKeys.PII_CONFIRMATION_UI] !== false;
      piiSanitizeLogs = settings[StorageKeys.PII_SANITIZE_LOGS] !== false;
      
      isLoading = false;
    } catch (error) {
      console.error('[App] Failed to load settings:', error);
      statusMessage = 'Failed to load settings';
      statusType = 'error';
      isLoading = false;
    }
  });

  // Save settings to chrome.storage
  async function handleSave() {
    try {
      statusMessage = 'Saving...';
      statusType = '';
      
      const settings: Record<string, unknown> = {};
      
      // Obsidian settings
      settings[StorageKeys.OBSIDIAN_PROTOCOL] = obsidianProtocol;
      settings[StorageKeys.OBSIDIAN_PORT] = obsidianPort;
      settings[StorageKeys.OBSIDIAN_API_KEY] = obsidianApiKey;
      settings[StorageKeys.OBSIDIAN_DAILY_PATH] = obsidianDailyPath;
      
      // AI Provider
      settings[StorageKeys.AI_PROVIDER] = aiProvider;
      
      // Gemini
      settings[StorageKeys.GEMINI_API_KEY] = geminiApiKey;
      settings[StorageKeys.GEMINI_MODEL] = geminiModel;
      
      // OpenAI
      settings[StorageKeys.OPENAI_BASE_URL] = openaiBaseUrl;
      settings[StorageKeys.OPENAI_API_KEY] = openaiApiKey;
      settings[StorageKeys.OPENAI_MODEL] = openaiModel;
      
      // OpenAI2
      settings[StorageKeys.OPENAI_2_BASE_URL] = openai2BaseUrl;
      settings[StorageKeys.OPENAI_2_API_KEY] = openai2ApiKey;
      settings[StorageKeys.OPENAI_2_MODEL] = openai2Model;
      
      // Domain filter
      settings[StorageKeys.DOMAIN_FILTER_MODE] = filterMode;
      settings[StorageKeys.DOMAIN_WHITELIST] = whitelistDomains.split('\n').filter(d => d.trim());
      settings[StorageKeys.DOMAIN_BLACKLIST] = blacklistDomains.split('\n').filter(d => d.trim());
      
      // Privacy
      settings[StorageKeys.PRIVACY_MODE] = privacyMode;
      settings[StorageKeys.PII_CONFIRMATION_UI] = piiConfirmation;
      settings[StorageKeys.PII_SANITIZE_LOGS] = piiSanitizeLogs;
      
      await saveSettings(settings);
      
      statusMessage = 'Settings saved successfully';
      statusType = 'success';
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        if (statusMessage === 'Settings saved successfully') {
          statusMessage = '';
          statusType = '';
        }
      }, 3000);
    } catch (error) {
      console.error('[App] Failed to save settings:', error);
      statusMessage = 'Failed to save settings';
      statusType = 'error';
    }
  }

  // Handle Ollama preset
  function applyOllamaPreset() {
    openai2BaseUrl = 'http://localhost:11434/v1';
    statusMessage = 'Ollama preset applied';
    statusType = 'success';
  }

  function handleProviderChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    aiProvider = target.value;
  }

  function handleFilterModeChange(event: { detail: { value: 'disabled' | 'whitelist' | 'blacklist' } }) {
    filterMode = event.detail.value;
  }
</script>

<div class="min-h-screen bg-gray-50">
  <TabList {tabs} bind:activeTab />
  
  <main class="p-4">
    {#if isLoading}
      <div class="flex items-center justify-center py-8">
        <div class="text-gray-500">Loading...</div>
      </div>
    {:else if activeTab === 'general'}
      <div id="generalPanel" role="tabpanel" aria-labelledby="generalTab" class="space-y-4">
        <h2 class="text-lg font-semibold">Settings</h2>
        
        <!-- AI Provider -->
        <ProviderSelect bind:value={aiProvider} />
        
        <!-- Provider-specific settings -->
        {#if aiProvider === 'gemini'}
          <div id="geminiSettings" class="space-y-3 border rounded-lg p-3 bg-gray-100">
            <h3 class="font-medium text-sm text-gray-700">Gemini Settings</h3>
            <Input
              id="geminiApiKey"
              label="API Key"
              type="password"
              bind:value={geminiApiKey}
              placeholder="Enter Gemini API key"
            />
            <Input
              id="geminiModel"
              label="Model"
              bind:value={geminiModel}
              placeholder="gemini-2.0-flash"
            />
          </div>
        {:else if aiProvider === 'openai'}
          <div id="openaiSettings" class="space-y-3 border rounded-lg p-3 bg-gray-100">
            <h3 class="font-medium text-sm text-gray-700">OpenAI Settings</h3>
            <Input
              id="openaiBaseUrl"
              label="Base URL"
              bind:value={openaiBaseUrl}
              placeholder="https://api.openai.com/"
            />
            <Input
              id="openaiApiKey"
              label="API Key"
              type="password"
              bind:value={openaiApiKey}
              placeholder="sk-..."
            />
            <Input
              id="openaiModel"
              label="Model"
              bind:value={openaiModel}
              placeholder="gpt-4o-mini"
            />
          </div>
        {:else if aiProvider === 'openai2'}
          <div id="openai2Settings" class="space-y-3 border rounded-lg p-3 bg-gray-100">
            <h3 class="font-medium text-sm text-gray-700">OpenAI Compatible Settings</h3>
            <Input
              id="openai2BaseUrl"
              label="Base URL"
              bind:value={openai2BaseUrl}
              placeholder="http://localhost:11434/v1"
            />
            <Input
              id="openai2ApiKey"
              label="API Key (optional)"
              type="password"
              bind:value={openai2ApiKey}
              placeholder="Optional"
            />
            <Input
              id="openai2Model"
              label="Model"
              bind:value={openai2Model}
              placeholder="llama3"
            />
            <Button variant="secondary" onclick={applyOllamaPreset}>Apply Ollama Preset</Button>
          </div>
        {/if}
        
        <hr class="my-4" />
        
        <!-- Obsidian Connection -->
        <h3 class="font-medium text-gray-700">Obsidian Connection</h3>
        
        <Input
          id="protocol"
          label="Protocol"
          bind:value={obsidianProtocol}
          placeholder="http or https"
        />
        
        <Input
          id="port"
          label="Port"
          type="number"
          bind:value={obsidianPort}
          placeholder="27123"
        />
        
        <Input
          id="dailyPath"
          label="Daily Note Path"
          bind:value={obsidianDailyPath}
          placeholder="/notes/{'{date}'}/{'{title}'}"
        />
        
        <!-- Status message -->
        {#if statusMessage}
          <div class="p-3 rounded-lg {statusType === 'success' ? 'bg-green-100 text-green-800' : statusType === 'error' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}">
            {statusMessage}
          </div>
        {/if}
        
        <div class="pt-4">
          <Button variant="primary" onclick={handleSave}>Save</Button>
        </div>
      </div>
    {:else if activeTab === 'domain'}
      <div id="domainPanel" role="tabpanel" aria-labelledby="domainTab" class="space-y-4">
        <h2 class="text-lg font-semibold">Domain Filter</h2>
        
        <FilterMode bind:value={filterMode} onchange={handleFilterModeChange} />
        
        {#if filterMode === 'whitelist'}
          <div class="space-y-2">
            <label class="text-sm font-medium text-gray-700">Allowed Domains (one per line)</label>
            <DomainList
              bind:value={whitelistDomains}
              placeholder="example.com&#10;another.com"
            />
          </div>
        {:else if filterMode === 'blacklist'}
          <div class="space-y-2">
            <label class="text-sm font-medium text-gray-700">Blocked Domains (one per line)</label>
            <DomainList
              bind:value={blacklistDomains}
              placeholder="example.com&#10;another.com"
            />
          </div>
        {:else}
          <div class="p-4 bg-gray-100 rounded-lg text-center text-gray-500">
            Domain filter is disabled. Enable it above to configure domain filtering.
          </div>
        {/if}
      </div>
    {:else if activeTab === 'prompt'}
      <div id="promptPanel" role="tabpanel" aria-labelledby="promptTab" class="space-y-4">
        <h2 class="text-lg font-semibold">Custom Prompts</h2>
        
        <div class="p-4 bg-gray-100 rounded-lg text-center text-gray-500">
          Custom prompts feature coming soon...
        </div>
      </div>
    {:else if activeTab === 'privacy'}
      <div id="privacyPanel" role="tabpanel" aria-labelledby="privacyTab" class="space-y-4">
        <h2 class="text-lg font-semibold">Privacy Settings</h2>
        
        <!-- Privacy Mode -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-700">Privacy Mode</label>
          <select
            bind:value={privacyMode}
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="local_only">Local Only</option>
            <option value="full_pipeline">Full Pipeline</option>
            <option value="masked_cloud">Masked Cloud</option>
          </select>
        </div>
        
        <!-- PII Confirmation -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="piiConfirmation"
            bind:checked={piiConfirmation}
            class="w-4 h-4"
          />
          <label for="piiConfirmation" class="text-sm text-gray-700">
            Show PII confirmation dialog before saving
          </label>
        </div>
        
        <!-- PII Sanitize Logs -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="piiSanitizeLogs"
            bind:checked={piiSanitizeLogs}
            class="w-4 h-4"
          />
          <label for="piiSanitizeLogs" class="text-sm text-gray-700">
            Sanitize PII from logs
          </label>
        </div>
      </div>
    {/if}
  </main>
</div>