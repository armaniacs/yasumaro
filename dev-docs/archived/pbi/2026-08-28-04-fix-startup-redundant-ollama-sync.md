# PBI: handleStartupのOllama同期を起動時のみに限定しwarm wakeの冗長IPCを削減

## ユーザーストーリー
サービスワーカー開発者として、warm wake（キャッシュ初期化済みの起動）時に不要な `getSettings()` + `updateDynamicRules` を実行しないでほしい、なぜならサービスワーカーはtab event・alarm・messageで頻繁にwakeするため、毎回のIPC往復が蓄積してパフォーマンスに影響するから。

## 優先度
- 順位: 3 / 3
- RICEスコア: 340（Reach=全ユーザー / Impact=1=軽微IPC削減 / Confidence=85% / Effort=0.25人週）
- 根拠: Finding 2 の修正後、Observer が差分検知するため startup での強制同期の必要性が低減。ただし安全のため起動時1回は同期をおこなう設計を維持する。
- 依存: Finding 2（Observer差分検知）に依存。Observer が正しく動作すれば、startup の `syncOllamaOriginRuleFromSettings` は「保険」として残すかどうかの判断になる。

## BDD受け入れシナリオ

```gherkin
Scenario: Cold start（初回起動）ではOllamaルールが同期される
  Given キャッシュが未初期化である
  When  サービスワーカーが起動する
  Then  現在のOllama baseUrlでOrigin削除ルールが同期される

Scenario: Warm wake（キャッシュ初期化済み）ではOllamaルール同期がスキップされる
  Given キャッシュが初期化済みである
  When  サービスワーカーが再起動する
  Then  `getSettings()` + `updateDynamicRules` は呼ばれない
  And   Observer の差分検知により baseUrl 変更時のみルールが同期される
```

## 受け入れ基準
- [ ] `handleStartup` の `syncOllamaOriginRuleFromSettings('startup')` が `isCacheInitialized.value === true` の場合はスキップされる
- [ ] Cold start 時には `syncOllamaOriginRuleFromSettings` が呼ばれる
- [ ] `handleInstalled`（install/update）での同期は変更不要
- [ ] Observer（Finding 2修正済み）が baseUrl 変更を検知し、startup 後の変更にも対応
- [ ] 既存テスト（`lifecycleHandlers-ollamaOriginRule.test.ts`）に warm wake スキップのケースを追加

## テスト戦略
- 単体: `lifecycleHandlers-ollamaOriginRule.test.ts` に以下を追加
  - `isCacheInitialized.value = true` の warm wake で `mockSyncOllamaOriginRule` が呼ばれないこと
  - `isCacheInitialized.value = false` の cold start で呼ばれること

## 見積もり
0.5ポイント

## Definition of Done
- [ ] warm wake 時の `syncOllamaOriginRuleFromSettings` 呼び出しがスキップされる
- [ ] cold start 時には呼ばれる
- [ ] 既存テスト + 追加テストがパスする
- [ ] コードレビュー完了
