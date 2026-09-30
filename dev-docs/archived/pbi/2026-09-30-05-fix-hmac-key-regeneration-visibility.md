# PBI: HMAC キー再生時にユーザー可視の通知と consent 取り扱いを用意する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

記録機能を使っているユーザーとして、HMAC キーの再生(再生成)が起きたときに黙って consent が無効化され記録が止まるのではなく、何が起きたかを検知でき再同意へ誘導されたい。なぜなら、IndexedDB 喪失後に unwrap が失敗するとキーが無条件で再生成され、旧 envelope は上書きされて consent 署名の検証が恒久的に失敗し、記録ゲートが理由不明のまま停止するから。

## 優先度

- 順位: 5 / 13
- RICE スコア: 8.0(Reach=5 / Impact=1 / Confidence=0.8 / Effort=0.5)
- 根拠: 全ユーザーが consent を持つため影響層は広いが、トリガー(durable 喪失+再起動の同時成立)は稀。fail-open 自体は明示仕様のため、本 PBI は「沈黙」の解消が主眼。

## 証拠(レビュー由来・反証済み)

- `src/utils/crypto/durableKeyStore.ts:110-118` — `saveDurableWrappingKey` は失敗時 `false` を返す
- `src/utils/crypto/hmacKeyStore.ts:225` — 呼び出し側が戻り値を無視(`await saveDurableWrappingKey(key);` のみ)
- `src/utils/crypto/hmacKeyStore.ts:306-312` — unwrap 失敗は `console.warn` のみで fall-through
- `:331-337` — 新キーを生成し旧 envelope を `chrome.storage.local.set` で上書き破壊(取り返し不可)
- `src/utils/storage/privacyConsent.ts:94-103` — 署名検証失敗で `hasConsented: false` を返す(再署名・migration なし)
- `src/background/compositionManifest.ts:214` — `isRecordingAllowed: () => hasPrivacyConsent()` により記録ゲートが停止
- トリガー: IndexedDB の site data 消去・プロファイル破損 + 再起動(session キャッシュの消失)

## BDD 受け入れシナリオ

```gherkin
  Scenario: キー再生時に旧 envelope が隔離される
    Given wrapped HMAC キーが保存されている
    When unwrap に失敗してキーが再生成される
    Then 旧 envelope は削除されず隔離キーへ退避される
    And 再生イベントがエラーコード付きでログに記録される

  Scenario: consent 無効化が UI から検知できる
    Given キー再生により consent 署名の検証が失敗している
    When ユーザーが dashboard または popup を開く
    Then 再同意を促す表示が出る
```

## 受け入れ基準

- [x] `saveDurableWrappingKey` の戻り値を検査し、失敗時は warn 以上でログに残る
- [x] unwrap 失敗時の再生成前に、旧 envelope を隔離キーへ退避する(1 世代)
- [x] 再生イベントを `logError` + ErrorCode 付きで記録する
- [x] consent 検証失敗の状態を UI が検知できる手段(ストレージフラグまたは既存の状態取得経路)を用意し、再同意を促す
- [x] 通知・監査経路(`urlNotificationHandlers` の旧通知 ID 無効)への影響をドキュメント化する

## テスト戦略

### 単体
- unwrap 失敗 → 隔離 → 再生成の順序を検証する
- saveDurableWrappingKey 失敗時のログを検証する

### 統合
- consent 署名検証失敗 → UI 検知フラグ → 再同意フローの接続を検証する

## 実装アプローチ

1. `hmacKeyStore` の再生パスに隔離退避とログを追加する(再生自体の fail-open 仕様は維持 — 可用性のため)
2. `privacyConsent` に「署名検証失敗で consent をリセットした」事実を示すフラグを追加し、dashboard/popup がそれを購読して再同意を促す

## 制約

- fail-open を fail-closed へ変更しない(可用性の明示仕様。変更するなら別 PBI で裁定する)
- API キー等の機密をログに含めない

## 見積もり

2 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
