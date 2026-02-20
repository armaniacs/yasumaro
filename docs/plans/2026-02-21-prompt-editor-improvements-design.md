# Prompt Editor Improvements Design

## 概要

プロンプトエディタに2つの機能を追加し、ユーザビリティを向上させる:

1. **デフォルトプロンプトの表示** - プロンプトリストにデフォルトプロンプトを表示し、いつでもデフォルトに戻せるようにする
2. **プロンプト複製機能** - 既存のプロンプト（デフォルト含む）を複製して、新しい名前で保存できるようにする

## 背景

現在のプロンプトエディタでは、ユーザーが作成したカスタムプロンプトのみが表示され、デフォルトプロンプトの内容がUI上で確認できません。また、既存のプロンプトをベースに新しいプロンプトを作成する際、手動でコピー&ペーストする必要があります。

この改善により、以下が可能になります:

- デフォルトプロンプトの内容を確認し、アクティブ化できる
- デフォルトプロンプトを複製してカスタマイズできる
- カスタムプロンプトを複製して派生バージョンを作成できる

## 要件

### 機能要件

1. **デフォルトプロンプトアイテムの表示**
   - プロンプトリストの先頭に「Default」という特別なアイテムを表示
   - アクティブ化可能（Activateボタン）
   - 複製可能（Duplicateボタン）
   - 編集・削除は不可（ボタンを表示しない）
   - カスタムプロンプトが全て非アクティブの場合、デフォルトが自動的にアクティブ

2. **プロンプト複製機能**
   - 全てのプロンプトアイテム（デフォルト含む）に「Duplicate」ボタンを追加
   - クリックでプロンプトの内容をエディターにコピー
   - プロンプト名に " (copy)" サフィックスを自動追加
   - エディターは新規作成モードになる

### 非機能要件

- 既存のプロンプト管理機能に影響を与えない
- デフォルトプロンプトは定数を参照し、バージョンアップ時に自動的に最新版が適用される
- ストレージ容量を増やさない（デフォルトはストレージに保存しない）

## アーキテクチャ

### コンポーネント構成

```
customPromptManager.ts
  ├─ renderPromptList()
  │   ├─ createDefaultPromptItem() (新規)
  │   └─ createPromptListItem() (既存)
  ├─ handleActivatePrompt() (拡張)
  ├─ handleDuplicatePrompt() (新規)
  ├─ isDefaultActive() (新規ヘルパー)
  └─ イベントリスナー登録

customPromptUtils.ts (変更なし)
  ├─ DEFAULT_USER_PROMPT
  └─ DEFAULT_SYSTEM_PROMPT
```

### データフロー

**レンダリングフロー:**
```
renderPromptList()
  → prompts配列取得
  → デフォルトアイテムを仮想生成
  → [デフォルト, ...カスタムプロンプト] の順でHTML生成
  → DOMに挿入
  → イベントリスナー登録
```

**複製フロー:**
```
Duplicateボタンクリック
  → handleDuplicatePrompt(promptId)
  → プロンプト取得（デフォルトなら定数から）
  → エディターに値をセット
    - name: 元の名前 + " (copy)"
    - provider: 元の値
    - systemPrompt: 元の値
    - prompt: 元の値
    - editingPromptId: "" (新規作成モード)
  → 保存ボタンテキスト: "Save Prompt"
  → キャンセルボタン表示
  → ステータスメッセージ: "Prompt copied to editor"
```

**デフォルトアクティブ化フロー:**
```
Activate (default) クリック
  → handleActivatePrompt('default', 'all')
  → 全カスタムプロンプトの isActive を false に設定
  → ストレージ保存
  → 再レンダリング（デフォルトが自動的にアクティブ表示）
```

## 実装詳細

### 1. デフォルトプロンプトアイテムの生成

**createDefaultPromptItem() 関数:**

```typescript
function createDefaultPromptItem(isActive: boolean): string {
  const providerLabel = getMessage('promptProviderAll') || 'All Providers';
  const activeBadge = isActive
    ? `<span class="badge badge-active" data-i18n="activePrompt">Active</span>`
    : '';
  const defaultLabel = getMessage('defaultPrompt') || 'Default';

  return `
    <div class="prompt-item ${isActive ? 'active' : ''} default-prompt" data-prompt-id="default">
      <div class="prompt-item-header">
        <span class="prompt-name">${defaultLabel}</span>
        <span class="prompt-provider">(${providerLabel})</span>
        ${activeBadge}
      </div>
      <div class="prompt-item-content">
        ${escapeHtml(DEFAULT_USER_PROMPT.substring(0, 100))}${DEFAULT_USER_PROMPT.length > 100 ? '...' : ''}
      </div>
      <div class="prompt-item-actions">
        ${!isActive ? `<button id="activate-prompt-default" class="btn-sm btn-activate" data-i18n="activate">Activate</button>` : ''}
        <button id="duplicate-prompt-default" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
      </div>
    </div>
  `;
}
```

**isDefaultActive() ヘルパー関数:**

```typescript
function isDefaultActive(prompts: CustomPrompt[]): boolean {
  return prompts.length === 0 || prompts.every(p => !p.isActive);
}
```

### 2. renderPromptList() の拡張

```typescript
function renderPromptList(): void {
  if (!promptList || !noPromptsMessage || !currentSettings) return;

  const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];

  // デフォルトアイテムを常に表示
  const defaultIsActive = isDefaultActive(prompts);
  let html = createDefaultPromptItem(defaultIsActive);

  // カスタムプロンプトを追加
  html += prompts.map(prompt => createPromptListItem(prompt)).join('');

  promptList.innerHTML = html;
  noPromptsMessage.style.display = 'none'; // デフォルトがあるので常に非表示

  // イベントリスナー登録
  // デフォルトプロンプトのリスナー
  const defaultActivateBtn = document.getElementById('activate-prompt-default');
  const defaultDuplicateBtn = document.getElementById('duplicate-prompt-default');
  if (defaultActivateBtn) {
    defaultActivateBtn.addEventListener('click', () => handleActivatePrompt('default', 'all'));
  }
  if (defaultDuplicateBtn) {
    defaultDuplicateBtn.addEventListener('click', () => handleDuplicatePrompt('default'));
  }

  // カスタムプロンプトのリスナー（既存）
  prompts.forEach(prompt => {
    const editBtn = document.getElementById(`edit-prompt-${prompt.id}`);
    const deleteBtn = document.getElementById(`delete-prompt-${prompt.id}`);
    const activateBtn = document.getElementById(`activate-prompt-${prompt.id}`);
    const duplicateBtn = document.getElementById(`duplicate-prompt-${prompt.id}`); // 新規

    if (editBtn) {
      editBtn.addEventListener('click', () => handleEditPrompt(prompt.id));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => handleDeletePrompt(prompt.id));
    }
    if (activateBtn) {
      activateBtn.addEventListener('click', () => handleActivatePrompt(prompt.id, prompt.provider));
    }
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', () => handleDuplicatePrompt(prompt.id));
    }
  });
}
```

### 3. createPromptListItem() の拡張

既存の関数にDuplicateボタンを追加:

```typescript
function createPromptListItem(prompt: CustomPrompt): string {
  const providerLabel = getProviderLabel(prompt.provider);
  const activeBadge = prompt.isActive
    ? `<span class="badge badge-active" data-i18n="activePrompt">Active</span>`
    : '';

  return `
    <div class="prompt-item ${prompt.isActive ? 'active' : ''}" data-prompt-id="${prompt.id}">
      <div class="prompt-item-header">
        <span class="prompt-name">${escapeHtml(prompt.name)}</span>
        <span class="prompt-provider">(${providerLabel})</span>
        ${activeBadge}
      </div>
      <div class="prompt-item-content">
        ${escapeHtml(prompt.prompt.substring(0, 100))}${prompt.prompt.length > 100 ? '...' : ''}
      </div>
      <div class="prompt-item-actions">
        ${!prompt.isActive ? `<button id="activate-prompt-${prompt.id}" class="btn-sm btn-activate" data-i18n="activate">Activate</button>` : ''}
        <button id="edit-prompt-${prompt.id}" class="btn-sm btn-edit" data-i18n="edit">Edit</button>
        <button id="duplicate-prompt-${prompt.id}" class="btn-sm btn-duplicate" data-i18n="duplicate">Duplicate</button>
        <button id="delete-prompt-${prompt.id}" class="btn-sm btn-delete" data-i18n="delete">Delete</button>
      </div>
    </div>
  `;
}
```

### 4. handleDuplicatePrompt() 関数（新規）

```typescript
function handleDuplicatePrompt(promptId: string): void {
  if (!currentSettings || !promptNameInput || !promptProviderSelect || !promptTextInput) return;

  let sourcePrompt: { name: string; provider: string; systemPrompt?: string; prompt: string };

  if (promptId === 'default') {
    // デフォルトプロンプトの場合
    sourcePrompt = {
      name: getMessage('defaultPrompt') || 'Default',
      provider: 'all',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      prompt: DEFAULT_USER_PROMPT
    };
  } else {
    // カスタムプロンプトの場合
    const prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    const prompt = prompts.find(p => p.id === promptId);

    if (!prompt) return;

    sourcePrompt = {
      name: prompt.name,
      provider: prompt.provider,
      systemPrompt: prompt.systemPrompt,
      prompt: prompt.prompt
    };
  }

  // エディターに値をセット
  promptNameInput.value = sourcePrompt.name + ' (copy)';
  promptProviderSelect.value = sourcePrompt.provider;
  if (promptSystemInput) {
    promptSystemInput.value = sourcePrompt.systemPrompt || '';
  }
  promptTextInput.value = sourcePrompt.prompt;

  // 新規作成モードに設定
  if (editingPromptIdInput) {
    editingPromptIdInput.value = '';
  }

  // ボタンテキストを更新
  if (savePromptBtn) {
    savePromptBtn.textContent = getMessage('savePrompt') || 'Save Prompt';
  }
  if (cancelPromptBtn) {
    cancelPromptBtn.style.display = 'inline-block';
  }

  // ステータスメッセージ
  showStatus(getMessage('promptDuplicated') || 'Prompt copied to editor', 'success');

  // エディターエリアまでスクロール
  promptNameInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

### 5. handleActivatePrompt() の拡張

```typescript
async function handleActivatePrompt(promptId: string, provider: string): Promise<void> {
  if (!currentSettings) return;

  if (promptId === 'default') {
    // デフォルトをアクティブ化 = 全カスタムを非アクティブ化
    let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    prompts = prompts.map(p => ({ ...p, isActive: false, updatedAt: Date.now() }));
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);
  } else {
    // カスタムプロンプトをアクティブ化（既存ロジック）
    let prompts = (currentSettings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    prompts = setActivePrompt(prompts, promptId, provider);
    currentSettings[StorageKeys.CUSTOM_PROMPTS] = prompts;
    await saveSettings(currentSettings);
  }

  showStatus(getMessage('promptActivated') || 'Prompt activated', 'success');
  renderPromptList();
  applyI18n();
}
```

### 6. handleEditPrompt() と handleDeletePrompt() の保護

デフォルトプロンプトに対する誤操作を防止:

```typescript
function handleEditPrompt(promptId: string): void {
  // デフォルトプロンプトは編集不可
  if (promptId === 'default') return;

  // 既存のロジック...
}

async function handleDeletePrompt(promptId: string): Promise<void> {
  // デフォルトプロンプトは削除不可
  if (promptId === 'default') return;

  // 既存のロジック...
}
```

## i18n対応

### _locales/en/messages.json

```json
{
  "defaultPrompt": {
    "message": "Default"
  },
  "duplicate": {
    "message": "Duplicate"
  },
  "promptDuplicated": {
    "message": "Prompt copied to editor"
  }
}
```

### _locales/ja/messages.json

```json
{
  "defaultPrompt": {
    "message": "デフォルト"
  },
  "duplicate": {
    "message": "複製"
  },
  "promptDuplicated": {
    "message": "プロンプトをエディターにコピーしました"
  }
}
```

## エラーハンドリング

### エッジケース対応

1. **デフォルトプロンプトの削除試行**
   - `handleDeletePrompt()` で `id === 'default'` をチェックして早期リターン
   - UI上でDeleteボタンを表示しないため、通常は発生しない

2. **デフォルトプロンプトの編集試行**
   - `handleEditPrompt()` で `id === 'default'` をチェックして早期リターン
   - UI上でEditボタンを表示しないため、通常は発生しない

3. **複製時の名前重複**
   - " (copy)" サフィックスを追加するだけで、重複チェックはしない
   - ユーザーが保存時に手動で名前を変更可能
   - 同名のプロンプトが複数存在しても問題なし（IDで識別）

4. **カスタムプロンプトが存在しない場合**
   - デフォルトプロンプトのみが表示される
   - デフォルトは自動的にアクティブ状態で表示
   - `noPromptsMessage` は非表示（デフォルトアイテムがあるため）

5. **複数プロバイダーのプロンプトが混在する場合**
   - デフォルトは常に `provider: 'all'` として表示
   - アクティブ判定は全プロバイダーを考慮（すべて非アクティブならデフォルトがアクティブ）

## CSS スタイル

既存のスタイルをそのまま使用。新しいクラスは不要。

`.btn-duplicate` は既存の `.btn-sm` スタイルを継承:

```css
.btn-duplicate {
  /* 既存の .btn-sm スタイルを使用 */
}

.default-prompt {
  /* 特別なスタイルは不要。既存の .prompt-item を使用 */
}
```

## テスト戦略

### 手動テスト

1. **デフォルトプロンプトの表示**
   - プロンプトリストの先頭に「Default」が表示されることを確認
   - カスタムプロンプトがない場合、デフォルトがアクティブ表示されることを確認
   - デフォルトプロンプトにEditボタンとDeleteボタンが表示されないことを確認

2. **デフォルトプロンプトのアクティブ化**
   - カスタムプロンプトがアクティブな状態で、デフォルトの「Activate」をクリック
   - デフォルトがアクティブになり、カスタムプロンプトが非アクティブになることを確認

3. **デフォルトプロンプトの複製**
   - デフォルトの「Duplicate」をクリック
   - エディターにデフォルトプロンプトの内容がコピーされることを確認
   - プロンプト名が "Default (copy)" になることを確認
   - 保存ボタンが "Save Prompt" になることを確認

4. **カスタムプロンプトの複製**
   - カスタムプロンプトの「Duplicate」をクリック
   - エディターにプロンプトの内容がコピーされることを確認
   - プロンプト名に " (copy)" が追加されることを確認

5. **複製後の保存**
   - 複製したプロンプトを編集して保存
   - 新しいプロンプトとして保存されることを確認
   - 元のプロンプトが変更されていないことを確認

6. **i18n**
   - 英語環境で "Default", "Duplicate", "Prompt copied to editor" が表示されることを確認
   - 日本語環境で "デフォルト", "複製", "プロンプトをエディターにコピーしました" が表示されることを確認

## パフォーマンス考慮

- デフォルトプロンプトは仮想アイテムとしてレンダリング時のみ生成され、ストレージには保存されない
- プロンプト配列に要素が追加されるわけではないため、メモリ使用量の増加は無視できるレベル
- レンダリングのオーバーヘッドは1アイテム分のみ（約50-100バイトのHTML文字列）

## 将来の拡張

1. **複数のデフォルトプロンプトテンプレート**
   - 「Short Summary」「Detailed Summary」「Bullet Points」など、複数のテンプレートを提供
   - ユーザーが用途に応じて選択可能

2. **プロンプトのインポート/エクスポート**
   - プロンプトをJSONファイルとしてエクスポート
   - 他のユーザーと共有可能

3. **プロンプトのバージョン管理**
   - プロンプトの編集履歴を保存
   - 以前のバージョンに戻せるようにする

## まとめ

この設計により、プロンプトエディタの使いやすさが大幅に向上します:

- デフォルトプロンプトが常に見える状態になり、いつでも戻せる
- プロンプトの複製機能により、カスタマイズの起点として活用できる
- 既存の機能に影響を与えず、後方互換性を維持
- ストレージ容量やパフォーマンスへの影響は最小限
