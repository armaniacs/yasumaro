# PBI: dashboard マスターパスワード UI の checkbox/confirm 欄の状態バグを解消する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

dashboard のプライバシー設定を使うユーザーとして、checkbox と confirm 入力欄が storage の実態と一致した表示をされたい。なぜなら、save 失敗時のロールバックが常に no-op で checkbox が「設定済み」のまま残ったり、認証モーダルを cancel すると checkbox がリロードまで不整合のまま残り、誤ったセキュリティ状態を示すから。

## 優先度

- 順位: 7 / 13
- RICE スコア: 4.0(Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25)
- 根拠: 単体では軽微だが、順位 2(乗っ取りガード)の前提条件になる UI 不整合の解消。順位 2 の後に着地する。

## 証拠(レビュー由来・配線を直接確認済み)

- `src/dashboard/masterPassword.ts:204` — `wasChecked` を save 時(トグル後)に読むため、set モードでは常に true
- `:227` — catch 側のロールバックは `checked = wasChecked`(true → true)で観測効果ゼロ。storage 上は `MASTER_PASSWORD_ENABLED` 未書き込みのまま checkbox が ON に残る
- `:249-258` — `closePasswordAuthModal` は checkbox を復元しない。cancel 経路(`:381`/`:382`/`:387-389`/Escape)は全てここに着地する
- 再同期は mount 時のみ(`privacySettingsPanel.ts:19`)。`refresh()`(`:110-112`)は `loadPrivacySettings()` のみで本番呼び出しゼロ
- `:137` と `:141` — change モードで `confirmPasswordGroup` を表示しながら `masterPasswordConfirm` input を隠す(逆方向)。`entrypoints/options/index.html:2455-2459` のラベルが孤立表示される
- 対象テストの問題(本番到達不能シナリオ)は順位 10 の PBI で扱う

## BDD 受け入れシナリオ

```gherkin
  Scenario: set 失敗後に checkbox がトグル前の状態へ戻る
    Given マスターパスワードが未設定で checkbox が OFF である
    When checkbox を ON にして保存が失敗する
    Then checkbox は OFF に戻る
    And 成功メッセージは表示されない

  Scenario: 認証モーダル cancel 後に checkbox が storage の実態と一致する
    Given マスターパスワードが設定済みである
    When checkbox を OFF にして認証モーダルを cancel する
    Then checkbox は ON に復元される(storage の実態と一致)

  Scenario: change モードで confirm 入力欄とラベルの表示が一致する
    Given change モーダルが開いている
    When confirm 欄が使われない設計の場合
    Then ラベルと input の両方が非表示になる(または両方が表示される)
```

## 受け入れ基準

- [ ] トグル直前の checkbox 状態を change イベント冒頭で記録し、save 失敗時にその値へ復元する
- [ ] `closePasswordAuthModal` で checkbox を storage の実態と再同期する(または cancel 時に明示復元する)
- [ ] change モードの confirm group / input の表示が一致する(どちらを正とするかは実装時に set モードのみ confirm を使う現行設計に合わせ、group ごと隠す)
- [ ] `masterPasswordEnabled.checked =` の全代入箇所を見直し、storage 実態との不整合が残らないことを確認する
- [ ] 既存テスト(`masterPassword.test.ts:856-874` は本番到達不能シナリオ)との整合は順位 10 の PBI で処理する

## テスト戦略

### E2E
- set 失敗 → checkbox 復元、cancel → checkbox 復元の 2 経路を検証する

### 単体
- change モード開時の confirm group / input の表示状態を検証する

## 実装アプローチ

1. change イベントハンドラ冒頭で `preToggleChecked` をインスタンスに保存し、save 失敗時とモーダル cancel 時に復元する
2. `closePasswordAuthModal` に checkbox 再同期を追加する(非同期の storage 読み取りが必要なら呼び出し側で実施)
3. `showPasswordModal` の `:137` / `:141` を統一する

## 制約

- focus trap の動作を壊さない
- i18n 属性の追加・変更に従う(ラベル表示の制御に data-i18n を壊さない)

## 見積もり

1 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
