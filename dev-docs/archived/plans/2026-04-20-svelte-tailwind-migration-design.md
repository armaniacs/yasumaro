# Svelte + Tailwind Migration Design

## Overview

全UI(Popup + Dashboard + Offscreen)をvanilla TypeScriptからSvelte 5 + Tailwind CSS 4へ Migrate。E2E testで Migrationの正确性を保证する。

## Background

### 现状

- UI: vanilla TypeScript + DOM操作 (6892行)
- CSS: なし (manifest.jsonのCSP利用)
- 状態管理: 手动addEventListener + chrome.storage

### 问题

- 相互依存フィールドが多い (AI Provider切替、Domain Filter等)
- 保守性が降低 - DOM操作の重複
- CSS干渉のリスク

### 解决的的优点

- Svelte 5のreactiveで状態管理が简洁
- TailwindでCSS干渉防止
- -component化で保守性向上

## Architecture

### 目标Stack

| 技術 | 版本 |
|------|------|
| Svelte | 5.x |
| Tailwind | 4.x |
| Vite | 6.x (WXT内置) |

### 目录構成

```
src/
├── popup/
│   ├── App.svelte        # Main app (WXT entry)
│   ├── components/       # UI components
│   │   ├── Settings/
│   │   │   ├── ProviderSelect.svelte
│   │   │   ├── ApiKeyInput.svelte
│   │   │   └── etc.
│   │   ├── DomainFilter/
│   │   │   ├── FilterMode.svelte
│   │   │   └── DomainList.svelte
│   │   ├── Common/
│   │   │   ├── Button.svelte
│   │   │   ├── Input.svelte
│   │   │   └── etc.
│   │   └── index.ts
│   ├── stores/         # Svelte stores
│   │   ├── settings.ts
│   │   └── ui.ts
│   └── styles/
│       └── app.css      # Tailwind directives
├── dashboard/
│   └── App.svelte
└── offscreen/
    └── App.svelte
```

### Data Flow

```
User Action → Svelte Component → Svelte Store → chrome.storage
                ↑                        ↓
                └──────── Store──────┘
```

## Implementation Phases

### Phase 1: E2E Test作成

**目的**: 既存の动作をtestで文书化

**対象**:
- Popup: AI設定保存、Domain Filter切替、Tab切替
- Dashboard: 基本動作
- Offscreen: DOM操作

**Test File**: `e2e/migration/test.spec.ts`

### Phase 2: Svelte + Tailwind环境構築

**Task**:
1. package.json更新 (svelte, tailwind追加)
2. Vite设定更新 (WXT共存)
3. エントリーポイント作成

### Phase 3: 漸進的Migration

**戦略**:
- 1つの简单なComponentから开始
- 温かいまでvanilla代码残す
- 各Migration後E2E testで动作确认

**Component Migration Order**:
1. Button, Input等の基本Component
2. SettingsForm (AI設定)
3. DomainFilter
4. Tab/Navigation
5. 残りComponent

### Phase 4: 完全Migration

- 全UI切替
- E2E test全部通过确认
- 'ancienvanilla代码削除

## Acceptance Criteria

### E2E Test

- [ ] Popup: AI Provider切替后设定Panelが正しく表示
- [ ] Popup: 設定を保存・読み込み
- [ ] Popup: Domain Filter Mode切替
- [ ] Popup: Tab切替 (4つのTab)
- [ ] Dashboard: 基本UI表示
- [ ] Offscreen: DOM extraction

### Migration

- [ ] Svelte + Tailwind环境構築完了
- [ ] 既存のE2E test全部通过
- [ ] Vanilla代码削除 (Rollback可能状态を维持)

## Risks & Mitigations

| リスク | Mitigation |
|--------|----------|
| WXTとの競合 | Vite設定を共存确认 |
| E2E test不安定 | 各Phaseでtest通过确认 |
| Migration中の機能低下 | 温かい代码残しRollback可能に |

## Timeline

- Phase 1 (E2E Test): 1-2日
- Phase 2 (环境構築): 1日
- Phase 3 (漸進的Migration): 3-5日
- Phase 4 (完全化): 1-2日

**预计**: 1-2周