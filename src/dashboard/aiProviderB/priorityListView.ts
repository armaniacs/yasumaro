import type { ProviderSlot } from '../../utils/storage/types.js';
import { getMessage } from '../../utils/i18n.js';

const PROVIDER_OPTIONS: { value: string; labelKey: string; fallback: string }[] = [
  { value: '', labelKey: 'providerPriorityNone', fallback: 'Not set' },
  { value: 'gemini', labelKey: 'googleGemini', fallback: 'Google Gemini' },
  { value: 'openai', labelKey: 'openaiCompatible', fallback: 'OpenAI Compatible (Groq, etc.)' },
  { value: 'openai2', labelKey: 'openaiCompatible2', fallback: 'OpenAI Compatible 2' },
  { value: 'lm-studio', labelKey: 'lmStudio', fallback: 'LM Studio' },
  { value: 'ollama', labelKey: 'ollama', fallback: 'Ollama' },
  { value: 'openai-compatible', labelKey: 'openaiCompatibleModelsDev', fallback: 'OpenAI Compatible (Models.dev)' },
  { value: 'built-in-ai', labelKey: 'builtInAi', fallback: 'Built-in AI' },
];

export interface BPriorityListView {
  container: HTMLElement;
  moveSlot(from: number, to: number): void;
  getSlots(): ProviderSlot[];
  setSlots(slots: ProviderSlot[]): void;
}

export function collectBProviderPrioritySlots(container: HTMLElement): ProviderSlot[] {
  const rows = container.querySelectorAll<HTMLElement>('.b-priority-row');
  const slots: ProviderSlot[] = [];
  rows.forEach(row => {
    const select = row.querySelector<HTMLSelectElement>('select');
    const input = row.querySelector<HTMLInputElement>('input.b-priority-model-input');
    const provider = (select?.value ?? '').trim();
    if (!provider) return;
    const modelRaw = (input?.value ?? '').trim();
    if (modelRaw) slots.push({ provider, model: modelRaw });
    else slots.push({ provider });
  });
  return slots;
}

export function validateBSlots(slots: ProviderSlot[]): { valid: boolean; duplicateIndices: number[] } {
  const seen = new Map<string, number>();
  const dup = new Set<number>();
  slots.forEach((s, i) => {
    const key = `${s.provider}::${s.model ?? ''}`;
    if (seen.has(key)) {
      dup.add(i);
      dup.add(seen.get(key)!);
    } else {
      seen.set(key, i);
    }
  });
  return { valid: dup.size === 0, duplicateIndices: [...dup].sort((a, b) => a - b) };
}

function createRow(index: number, slot: ProviderSlot | undefined): HTMLElement {
  const row = document.createElement('div');
  row.className = 'b-priority-row';
  row.draggable = true;
  row.dataset.index = String(index);

  const handle = document.createElement('span');
  handle.className = 'b-priority-handle';
  handle.textContent = '≡';
  handle.setAttribute('aria-hidden', 'true');

  const num = document.createElement('span');
  num.className = 'priority-number';
  num.textContent = String(index + 1);

  const select = document.createElement('select');
  select.setAttribute('aria-label', `Priority ${index + 1}`);
  PROVIDER_OPTIONS.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = getMessage(opt.labelKey) || opt.fallback;
    if (opt.value === (slot?.provider ?? '')) o.selected = true;
    select.appendChild(o);
  });

  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.className = 'b-priority-model-input';
  modelInput.placeholder = getMessage('providerPriorityModelPlaceholder') || 'Model Name (optional)';
  modelInput.value = slot?.model ?? '';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'small-btn';
  upBtn.textContent = '↑';
  upBtn.setAttribute('aria-label', `Move priority ${index + 1} up`);

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'small-btn';
  downBtn.textContent = '↓';
  downBtn.setAttribute('aria-label', `Move priority ${index + 1} down`);

  row.append(handle, num, select, modelInput, upBtn, downBtn);
  return row;
}

export function createBPriorityListView(
  container: HTMLElement,
  initialSlots: ProviderSlot[],
): BPriorityListView {
  container.innerHTML = '';
  // 3行固定、不足は空スロットで埋める
  const slots3: (ProviderSlot | undefined)[] = [0, 1, 2].map(i => initialSlots[i]);
  slots3.forEach((slot, i) => container.appendChild(createRow(i, slot)));

  const api: BPriorityListView = {
    container,
    moveSlot(from, to) {
      const rows = [...container.querySelectorAll<HTMLElement>('.b-priority-row')];
      if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return;
      const moving = rows[from]!;
      if (to === rows.length - 1) container.appendChild(moving);
      else {
        const target = rows[to]!;
        if (from < to) container.insertBefore(moving, rows[to + 1] ?? null);
        else container.insertBefore(moving, target);
      }
      // indexと表示番号を振り直し
      [...container.querySelectorAll<HTMLElement>('.b-priority-row')].forEach((r, idx) => {
        r.dataset.index = String(idx);
        const num = r.querySelector('.priority-number');
        if (num) num.textContent = String(idx + 1);
      });
    },
    getSlots() {
      return collectBProviderPrioritySlots(container);
    },
    setSlots(slots) {
      container.innerHTML = '';
      [0, 1, 2].forEach(i => container.appendChild(createRow(i, slots[i])));
    },
  };

  // up/down
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.textContent !== '↑' && target.textContent !== '↓') return;
    const row = target.closest<HTMLElement>('.b-priority-row');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (target.textContent === '↑' && idx > 0) api.moveSlot(idx, idx - 1);
    if (target.textContent === '↓' && idx < 2) api.moveSlot(idx, idx + 1);
  });

  // drag
  let dragIndex: number | null = null;
  container.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.b-priority-row');
    if (!row) return;
    dragIndex = Number(row.dataset.index);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (e) => e.preventDefault());
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>('.b-priority-row');
    if (row == null || dragIndex == null) return;
    const to = Number(row.dataset.index);
    if (to !== dragIndex) api.moveSlot(dragIndex, to);
    dragIndex = null;
  });

  // validation on change
  const validate = () => {
    const slots = collectBProviderPrioritySlots(container);
    const { valid, duplicateIndices } = validateBSlots(slots);
    container.querySelectorAll('.b-priority-row').forEach((r, i) => {
      r.classList.toggle('has-error', duplicateIndices.includes(i));
    });
    let warn = container.querySelector('.b-priority-warn');
    if (!valid) {
      if (!warn) {
        warn = document.createElement('div');
        warn.className = 'b-priority-warn field-error';
        warn.setAttribute('role', 'alert');
        container.appendChild(warn);
      }
      warn.textContent = getMessage('aiProviderPriorityDuplicateWarning') || 'Duplicate provider and model';
    } else {
      warn?.remove();
    }
    // P1 required: first row must have a provider
    const p1 = container.querySelector<HTMLElement>('.b-priority-row');
    const p1Select = p1?.querySelector<HTMLSelectElement>('select');
    let reqWarn = container.querySelector('.b-priority-req-warn');
    if (p1Select && !p1Select.value) {
      if (!reqWarn) {
        reqWarn = document.createElement('div');
        reqWarn.className = 'b-priority-req-warn field-error';
        reqWarn.setAttribute('role', 'alert');
        container.appendChild(reqWarn);
      }
      reqWarn.textContent = getMessage('aiProviderPriority1Required') || 'Priority 1 is required';
    } else {
      reqWarn?.remove();
    }
  };
  container.addEventListener('change', validate);
  container.addEventListener('input', validate);

  return api;
}
