# Tranco リスト更新の通知・同意機構追加

## Context

Tranco リスト更新でドメインの信頼状態が突然変化しても、ユーザーへの通知がありません。

**現状:**
- presetDomains.ts に静的な Tranco リストが定義
- リスト更新時の変更通知なし
- ユーザーにとって、信頼ドメインが突然信頼できなくなる可能性がある
- 同意なしで信頼状態が変更される

**レビュー指摘:**
- **指摘者**: Compliance & Privacy Guard、Ethics & Bias Auditor（2名が重複指摘）
- **場所**: `src/utils/trustDb/presetDomains.ts`
- **優先度**: Medium
- **影響**: Tranco リスト更新でドメインの信頼状態が突然変化しても、ユーザーへの通知がない

## Decision

### 実装方針

1. **バージョン追跡**: Tranco リストのバージョンを追跡
2. **更新検知**: リスト更新時にバージョン変化を検知
3. **通知表示**: 使用頻度の高いドメインの信頼状態変化を通知
4. **同意確認**: 重大な変更の場合、ユーザーの同意を確認

### 実装フェーズ

#### Phase 1: バージョン追跡追加（将来実装）
- presetDomains.ts にバージョン情報を追加
- storage.ts に Tranco リストバージョンの保存場所を追加
- マイグレーションで初期バージョンを記録

#### Phase 2: 通知表示（将来実装）
- Tranco リスト更新時に変更点を分析
- 信頼度が低下したドメインを特定
- 通知を表示

#### Phase 3: 同意確認（将来実装）
- 重大な変更の場合、ユーザー同意を確認
- 同意なしでは旧リストを使用するオプション

## Consequences

### Positive

- ユーザーが信頼ドメインの変更を認識できる
- 予期せぬ動作変化を防止
-透明性向上

### Negative

- 通知が頻繁に表示される可能性（リスト更新頻度による）
- ユーザー体験への影響

### Mitigation

- 変更の程度に応じて通知レベルを調整
- 使用頻度の低いドメインの変更は通知しない
- 通知頻度の上限を設定

## Implementation Steps

### Phase 1: バージョン追跡（✅ 完了）
- [x] ADR作成
- [x] 仕様確定（/dig:dig による要件定義）
- [x] presetDomains.ts にバージョン情報追加（TRANCO_VERSION 定数）
- [x] storage.ts に Tranco バージョン保存場所追加（TRANCO_VERSION, TRANCO_DOMAINS, etc.）
- [x] StorageKeyValues に型定義追加
- [x] DEFAULT_SETTINGS に初期値追加
- [x] SavedUrlEntry に isTrancoDomain フラグ追加
- [x] trustDb.ts に Tranco バージョン追跡メソッド追加
- [x] migration.ts に initializeTrancoVersion 関数追加
- [x] storage.ts からマイグレーション呼び出し追加
- [x] TypeScript type-check パス

### Phase 2: 通知表示（✅ 完了）
- [x] 変更検出ロジック実装
- [x] 通知表示実装
- [x] テスト追加
- [x] 日英双语メッセージ実装
- [x] 7日抑制ルール実装

### Phase 3: 同意確認（✅ 完了）
- [x] ユーザー同意UI実装（i18nメッセージ追加）
- [x] 旧リスト保持機能実装
- [x] 30日再確認ルール実装
- [x] 同意状態管理実装
- [x] UI統合（Popup: popup.ts initTrancoUpdateNotification()、Dashboard: dashboard.ts:2634）

## Status

- **Proposed**: 2026-03-24
- **Approved**: 2026-03-26
- **Implemented**: Phase 1 ✅ 完了（2026-03-26）、Phase 2 ✅ 完了（2026-03-26）、Phase 3 ✅ 完了（2026-03-26）
- **Superseded By** -
- **Note**: 全フェーズ実装完了。実装ファイル: trancoChangeDetector.ts、trancoConsentManager.ts、i18nメッセージ37件追加。UI統合（Popup: popup.ts:963、Dashboard: dashboard.ts:2634）実装済み。

---

## 設計決定事項（/dig:dig による要件定義）

| 項目 | 決定 | 理由 | Notes |
|------|------|------|-------|
| 実装範囲 | 全フェーズ実装（Phase 1 + 2 + 3） | 包括的な機能実装 | 同意確認機能も含む |
| バージョン管理 | ISO 日時（現行） | 既存データ活用 | 2026-03-14T23:48:30.010Z 形式 |
| 通知対象 | 除外ドメインのみ | ユーザー影響の大きい変更のみ | 信頼ドメイン→信頼できない |
| 同意確認 | 同時実装 | フル実装アプローチ | 古いリスト保持オプション含む |
| 変化閾値 | 1つ以上の変更 | ただし訪問中のドメインのみ | 過去に訪問したドメインのみ対象 |
| 通知場所 | Popup + Dashboard | メインUIに統合 | 両方で表示 |
| 旧リスト保持 | storage.local | 保存して継続使用可能 | 同意なしの場合 |
| i18n | 日英双语 | プロジェクト方針に従う | _locales/* に37件追加（各言語） |
| 訪問履歴管理 | SavedUrlEntries にフラグ追加 | 既存構造との統合 | 信頼ドメイン使用フラグ |
| 通知頻度 | 1週間以内は抑制 | UXと重要通知のバランス | 再通知タイミング調整可能 |
| 同意無効挙動 | 定期的再確認（30日ごと） | ユーザー意志尊重＋見直しの機会 | 30日ルール最小実装 |
| UI詳細 | 独立セクションを作成 | 「Tranco信任ドメイン」セクション | History表示＋配置確認＋Consent UI |