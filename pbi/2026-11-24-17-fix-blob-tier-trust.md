# PBI: blob-tier の信頼境界を狭める(content script の読み範囲と世代ずれの fail-closed)

## ユーザーストーリー
閲覧履歴を記録している利用者として、遮断したはずのサイトの判定が、設定の保存の途中の状態のせいで許容側に倒れないようにしてほしいし、Web ページ側の処理が設定全体を読めないようになっていてほしい、なぜなら現状は content script が暗号文を含む設定全体を取得し、世代のずれた読みで遮断が効かなくなり得るから。

## 優先度
- 順位: 06/12 の監査 run-3 の confirmed C-5/C-6 に対応
- RICE: 要チームでの見積もり
- 根拠と依存: なし。後続は 2026-11-24-08(実機スモーク)

## ビジネス価値
- 設定の読みの最小権限が守られ、Web 側からの到達面が狭まる
- 世代ずれの読みが遮断の回避にならない
- 測定方法: BDD の 3 シナリオが単体・統合テストで緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: content script は判定に要る設定だけを読む
  Given content script がドメイン判定を行う
  When  storage の読みを観測する
  Then  取得されるのは判定に要る設定だけ(暗号化された API キーや送信先の情報を含まない)
  And   判定の結果は従来と変わらない

Scenario: 世代のずれた読みは許容側に倒れない
  Given blob の空リストと top-level の古い遮断リストがずれている
  When  遮断対象のドメインを判定する
  Then  許容にならず、遮断か判定不能(キャッシュ無効)のいずれかになる

Scenario: 世代の一致した読みは従来どおり動く
  Given blob と top-level が一致している
  When  遮断対象と非対象のドメインを判定する
  Then  従来どおり遮断と許容が返る
  And   fold 前後の twin 回帰が緑のまま
```

## 受け入れ基準
- [ ] content script の blob 読みが必要最小限(判定に要る設定だけ)になっている
- [ ] 世代ずれの判定が fail-closed(遮断か判定不能のいずれか)になっている
- [ ] 既存の twin 回帰と監査 pin(`raw-owned-keys-audit-pin`)が緑のまま
- [ ] page 側への設定値の橋渡しが無いことがテストで固定されている

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加は最小限。既存の twin 回帰の緑を維持する

### 統合テスト
- 世代ずれの seed(seed 済み storage)での判定テスト

### 単体テスト
- 世代ずれの表駆動テスト(`blocked.com` が許容になる発火デモを先に書く)
- 読み範囲の pin(取得キー一覧の固定)

## 実装アプローチ
- **Outside-In**: 世代ずれの発火デモから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める

## 見積もり
5 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `InMemoryStoragePort` に世代ずれを seed して判定できる
- 非機能要件: 判定不能にする場合は呼び出し側(`useCache: false` の扱い)と整合させる
- ロールバック手段: 読み範囲と tie-break の差し戻しで現行動作に戻せる

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "withBlobTierKeys" src/content/domainPolicyPort.ts src/content/cleansingOffscreenDelegate.ts src/utils/storage/blobTierRead.ts
git -C /Users/yaar/Playground/yasumaro grep -n "allowed: true" src/content/visitAdmission.ts
```

確認結果(run-3 時点):
- `withBlobTierKeys` が `settings` blob 全体を読みに足す
- `evaluateDomainPolicy` が `disabled`/不明 mode と `simpleEnabled === false` を `allowed: true` にする

### 実装手順
1. 世代ずれの発火デモ(`blocked.com` が許容になる)を先に書く
2. 読み範囲を狭めるか、世代の tie-break を fail-closed にする
3. pin と twin 回帰が緑のままであることを確認する
4. `npm run validate` で全体を確認

### 落とし穴
- `TOP_LEVEL_ONLY_KEYS` の 4 キーと委譲フラグの読みを壊さないこと
- `updateDomainFilterCache` の二段階書きとの整合を保つこと
- background の `isDomainAllowed`(blob-authoritative)との乖離を広げないこと

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 実装済み。`1124a` に取込済み。進捗は [handoff/2026-11-24-07-release-ga-security-audit-run3.md](handoff/2026-11-24-07-release-ga-security-audit-run3.md) に記録した。
