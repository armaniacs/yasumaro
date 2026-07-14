export {
  loadSettingsToInputs,
  extractSettingsFromInputs,
} from '../utils/settingsFormBinding.js';

export function showStatus(elementId: string, message: string, type: 'success' | 'error'): void {
  const el = document.getElementById(elementId);
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
