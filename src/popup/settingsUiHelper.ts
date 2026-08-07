export {
  loadSettingsToInputs,
  extractSettingsFromInputs,
} from '../utils/settingsFormBinding.js';

export function showStatus(elementOrId: string | HTMLElement, message: string, type: 'success' | 'error'): void {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el) return;

  el.textContent = message;
  el.className = type;

  const timeout = type === 'error' ? 5000 : 3000;
  setTimeout(() => {
    if (el) {
      el.textContent = '';
      el.className = '';
    }
  }, timeout);
}
