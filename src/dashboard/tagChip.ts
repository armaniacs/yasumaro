/**
 * tagChip.ts — dashboard 層の共有タグチップ工場.
 *
 * WHY a factory: tagsPanel の 3 render と trustSettings の 2 render が
 * 「div 作製→label textContent→×削除ボタン→aria-label→append→addEventListener」
 * の同型骨格を複製していた。文言・クラス・削除挙動の変更を 1 箇所に寄せる。
 *
 * 純粋 DOM 工場: クリア (innerHTML/textContent)・hidden 切替・i18n 文言解決は
 * 呼び出し側が行い、ここでは渡された文字列を textContent に載せるだけ
 * (innerHTML 不使用のため XSS-safe)。onRemove が無いときは label button
 * 単体 (デフォルトカテゴリ用) を返す。
 */

export interface TagChipOptions {
  /** Label text (already resolved; assigned via textContent, never HTML). */
  label: string;
  /** Root class when removable, button class when standalone. */
  containerClass: string;
  /** Label element class (removable chips only). */
  labelClass?: string;
  /** Label element tag (removable chips only). Defaults to 'span'. */
  labelTag?: 'span' | 'button';
  /** Remove button class (required when onRemove is set). */
  removeClass?: string;
  /** Remove button aria-label (already resolved i18n text). */
  removeAriaLabel?: string;
  /** Remove button dataset entries (e.g. { tld } or { domain }). */
  removeDataset?: Record<string, string>;
  /** Label button title / tooltip. */
  labelTitle?: string;
  /** Label click handler (e.g. navigate to history). Attached before onRemove. */
  onLabelClick?: () => void;
  /** Remove click handler. Absent => standalone label button, no × button. */
  onRemove?: () => void;
}

/**
 * Build one tag chip. Event order matches the pre-factory renders:
 * label listener first, then remove listener; label appended before ×.
 */
export function createTagChip(options: TagChipOptions): HTMLElement {
  const { label, containerClass, onRemove } = options;

  if (!onRemove) {
    const button = document.createElement('button');
    button.className = containerClass;
    button.textContent = label;
    if (options.labelTitle) button.title = options.labelTitle;
    if (options.onLabelClick) button.addEventListener('click', options.onLabelClick);
    return button;
  }

  const item = document.createElement('div');
  item.className = containerClass;

  const labelEl = document.createElement(options.labelTag ?? 'span');
  if (options.labelClass) labelEl.className = options.labelClass;
  labelEl.textContent = label;
  if (options.labelTitle) labelEl.title = options.labelTitle;
  if (options.onLabelClick) labelEl.addEventListener('click', options.onLabelClick);
  item.appendChild(labelEl);

  const removeBtn = document.createElement('button');
  if (options.removeClass) removeBtn.className = options.removeClass;
  removeBtn.textContent = '×';
  if (options.removeAriaLabel) removeBtn.setAttribute('aria-label', options.removeAriaLabel);
  if (options.removeDataset) {
    for (const [key, value] of Object.entries(options.removeDataset)) {
      removeBtn.dataset[key] = value;
    }
  }
  removeBtn.addEventListener('click', onRemove);
  item.appendChild(removeBtn);

  return item;
}
