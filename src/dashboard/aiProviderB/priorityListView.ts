import type { ProviderSlot } from '../../utils/storage/types.js';
import { getMessage } from '../../utils/i18n.js';
import { getRegistryEntry } from '../../background/ai/providerCatalog.js';
import { renderProviderOptions } from '../aiProviderCatalogView.js';

/** Settings-like record for model resolution — keyed by StorageKeys values. */
export type ModelSettings = Readonly<Record<string, unknown>>;

/**
 * Resolve the model name displayed for a priority row:
 * explicit slot model → provider's stored setting → catalog defaultModel → ''.
 * Empty when the provider has no model setting at all (e.g. Built-in AI).
 */
export function resolveModelDisplayName(
  provider: string,
  explicitModel: string | undefined,
  settings: ModelSettings | undefined,
): string {
  if (!provider) return '';
  const explicit = (explicitModel ?? '').trim();
  if (explicit) return explicit;
  const entry = getRegistryEntry(provider);
  if (!entry) return '';
  if (entry.modelKey) {
    const stored = settings?.[entry.modelKey];
    if (typeof stored === 'string' && stored.trim()) return stored.trim();
  }
  return entry.defaultModel ?? '';
}

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
    // Auto-resolved display values (storage setting / catalog default) must NOT
    // be persisted as explicit models — omit them so the default keeps applying.
    const autoResolved = input?.dataset.resolved === 'true';
    if (modelRaw && !autoResolved) slots.push({ provider, model: modelRaw });
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

/**
 * Row-aware validation for B containers: returns duplicate row indices (not slot indices)
 * and P1 empty flag. Used by save pipeline to block saving correctly.
 */
export function validateBContainer(container: HTMLElement): { valid: boolean; duplicateRowIndices: number[]; p1Empty: boolean } {
  const rows = [...container.querySelectorAll<HTMLElement>('.b-priority-row')];
  const seen = new Map<string, number>();
  const dupSet = new Set<number>();
  rows.forEach((row, rowIdx) => {
    const select = row.querySelector<HTMLSelectElement>('select');
    const provider = (select?.value ?? '').trim();
    if (!provider) return;
    const input = row.querySelector<HTMLInputElement>('input.b-priority-model-input');
    const model = (input?.value ?? '').trim();
    const key = `${provider}::${model ?? ''}`;
    if (seen.has(key)) {
      dupSet.add(rowIdx);
      dupSet.add(seen.get(key)!);
    } else {
      seen.set(key, rowIdx);
    }
  });
  const p1 = rows[0]?.querySelector<HTMLSelectElement>('select');
  const p1Empty = !p1 || !p1.value.trim();
  return { valid: dupSet.size === 0, duplicateRowIndices: [...dupSet].sort((a, b) => a - b), p1Empty };
}

function createRow(index: number, slot: ProviderSlot | undefined, settings?: ModelSettings): HTMLElement {
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
  renderProviderOptions(select, { includeNone: true });
  select.value = slot?.provider ?? '';

  const modelInput = document.createElement('input');
  modelInput.type = 'text';
  modelInput.className = 'b-priority-model-input';
  modelInput.placeholder = getMessage('providerPriorityModelPlaceholder') || 'Model Name (optional)';
  const resolved = resolveModelDisplayName(slot?.provider ?? '', slot?.model, settings);
  if (slot?.model) {
    modelInput.value = slot.model;
  } else if (resolved) {
    // Show the resolved model (stored setting or catalog default) so the user
    // can see what will actually be used. Flagged so save omits it.
    modelInput.value = resolved;
    modelInput.dataset.resolved = 'true';
  }

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
  settings?: ModelSettings,
): BPriorityListView {
  container.innerHTML = '';
  // 3行固定、不足は空スロットで埋める
  const slots3: (ProviderSlot | undefined)[] = [0, 1, 2].map(i => initialSlots[i]);
  slots3.forEach((slot, i) => container.appendChild(createRow(i, slot, settings)));

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
      [0, 1, 2].forEach(i => container.appendChild(createRow(i, slots[i], settings)));
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

  // validation on change — row-aware duplicate detection (fixes indexずれ when empty rows exist)
  const validate = () => {
    const rows = [...container.querySelectorAll<HTMLElement>('.b-priority-row')];
    const seen = new Map<string, number>();
    const dupSet = new Set<number>();
    rows.forEach((row, rowIdx) => {
      const select = row.querySelector<HTMLSelectElement>('select');
      const provider = (select?.value ?? '').trim();
      if (!provider) return;
      const input = row.querySelector<HTMLInputElement>('input.b-priority-model-input');
      const model = (input?.value ?? '').trim();
      const key = `${provider}::${model ?? ''}`;
      if (seen.has(key)) {
        dupSet.add(rowIdx);
        dupSet.add(seen.get(key)!);
      } else {
        seen.set(key, rowIdx);
      }
    });
    const duplicateRowIndices = [...dupSet].sort((a, b) => a - b);
    const valid = dupSet.size === 0;
    rows.forEach((r, i) => {
      r.classList.toggle('has-error', duplicateRowIndices.includes(i));
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

  // Track user edits to the model input — a user-typed value wins over the
  // auto-resolved display and is saved as an explicit model.
  container.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains('b-priority-model-input')) {
      delete target.dataset.resolved;
    }
  });

  // Re-resolve the model display when the provider changes. User-typed values
  // (no `resolved` flag, non-empty) are preserved; auto-resolved or empty
  // inputs follow the newly selected provider's resolved name.
  container.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLSelectElement)) return;
    const row = target.closest<HTMLElement>('.b-priority-row');
    if (!row) return;
    const input = row.querySelector<HTMLInputElement>('input.b-priority-model-input');
    if (!input) return;
    const userEdited = input.dataset.resolved !== 'true' && input.value !== '';
    if (userEdited) return;
    const resolved = resolveModelDisplayName(target.value, undefined, settings);
    input.value = resolved;
    if (resolved) input.dataset.resolved = 'true';
    else delete input.dataset.resolved;
  });

  return api;
}
