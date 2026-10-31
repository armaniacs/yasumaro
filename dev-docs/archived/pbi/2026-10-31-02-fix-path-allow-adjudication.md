# PBI: パス許可のUI文言と実装の一致（ROADMAP T4）

## ユーザーストーリー
プライバシーを重視するユーザーとして、確認ダイアログの「パス許可」が実際に何を許可するか正確に知りたい、なぜなら表示と実挙動（そのドメイン全体が許可される）のずれは誤った許可を招くから。

## 優先度
- 順位: 2 / 9（全候補）
- RICEスコア: 12.8（Reach=8 / Impact=1 / Confidence=80% / Effort=0.5人週）
- 根拠: プライバシー系の約束と実装の不一致。確認ダイアログは「パス許可」を提示するが、実装は URL の hostname への正規化でパス単位マッチングは未実装（DESIGN_SPECIFICATIONS.md §13.5、src/popup/whitelistWriter.ts、ROADMAP.md T4）。プライバシー約束の正確性は全ユーザーに影響し、修正は裁定 1 件と gateway 1 ファイル（または文言統一）の小規模で済むため Confidence 80% / Effort 0.5人週で高順位。

## ビジネス価値
表示と実装が一致すると、次の 3 つが実現する。

- ユーザーが意図より広い範囲（ドメイン全体）を誤って許可する事故を防げる。プライバシー機能への信頼は Chrome Web Store の評価と継続利用に直結する
- path whitelist エントリがかつての「どの consumer でも一度もマッチしない死エントリ」の状態から完全に脱する
- ROADMAP T4 が 1 件の PBI で閉じられる

測定方法: README（日英）と PRIVACY.md の記述が実装と一致することをレビューで確認。public/PRIVACY.md と docs/PRIVACY.md の差分（バイト同一必須、差分 0）で同期を確認。BDD シナリオの自動テストが CI でグリーンであることを確認。

## BDD受け入れシナリオ

```gherkin
Scenario: 裁定どおりの許可適用（ハッピーパス）
  Given 確認ダイアログに「パス許可（またはドメイン許可）」が表示されている
  When  ユーザーが保存時に「パス許可（またはドメイン許可）」を選択する
  Then  許可が裁定された意味（path 単位または hostname 単位）どおりに適用される

Scenario: 文言と実装の不一致の検出（境界）
  Given whitelist エントリが URL の hostname に正規化されている
  When  確認ダイアログの文言と実際のマッチング範囲を突き合わせる
  Then  不一致があればテストが失敗し文言か実装のどちらかが修正される
```

## 受け入れ基準
- [x] 裁定タスク（(a) path 照合を実装する、(b) UI文言を「ドメイン許可」に統一する）が完了し、選択理由が記録されている
  - 裁定（2026-10-31 ユーザー確定済み）: (b) UI 選択肢・文言を「ドメイン許可」に統一（実装は hostname 正規化のまま）。選択理由: 「パス許可」ボタンと「ドメイン許可」ボタンは hostname 正規化で完全に同一動作（extractDomain は extractHostname のエイリアス）のため、「このパスのみ許可」の表示は実際の許可範囲（ドメイン全体）と不一致で、ユーザーのプライバシー期待を裏切る。パス許可の選択肢を削除し、選択肢を「ドメイン許可」1 つに統一した
  - (a) path 照合の実装は裁定により実施せず（未実施）。将来候補として ROADMAP 条件付き C9 に記録済み（本タスクでは実装しない）
- [x] 選択した裁定に合わせて README（日英）と PRIVACY.md の記述が実装と同期している
- [x] public/PRIVACY.md と docs/PRIVACY.md がバイト同一である
- [x] 確認ダイアログの文言（data-i18n、_locales/ja/en）と実装のマッチング範囲が一致している
- [x] 単体テスト（whitelistWriter の分類・正規化）と統合テスト（確認ダイアログ経路の許可適用）がパスする
- [x] E2E テストでプライベート判定ページの許可選択後の挙動が文言どおりであることを確認している

## テスト戦略
### E2Eテスト
- プライベート判定ページで「パス許可（またはドメイン許可）」を選択し、許可後の挙動が裁定どおり（path 単位か hostname 単位か）であることを検証する

### 統合テスト
- 確認ダイアログから whitelistWriter、gateway を経由して whitelist 消費者へ至る経路で、許可が正しく適用されることを検証する

### 単体テスト
- whitelistWriter の path と hostname の分類および正規化を検証する。(b) を選んだ場合は data-i18n の文言と pin テストの更新も検証する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）

```bash
grep -rn "whitelistWriter" src/popup/
grep -rn "パス許可\|Save with path\|pathAllow" src/ _locales/
```

path whitelist エントリはかつてどの consumer でも一度もマッチしない死エントリだった。アーカイブ済み PBI（dev-docs/archived/pbi/2026-09-12-05-refactor-whitelist-write-gateway.md）で hostname 正規化が設計判断として記録され、将来の path 照合は gateway 1 ファイルの変更で可能な状態にされている。設計仕様は dev-docs/DESIGN_SPECIFICATIONS.md §13.5。

### 実装手順
1. 裁定タスク: (a) path 照合を実装する、(b) UI文言を「ドメイン許可」に統一する のどちらかを決定し、選択理由を記録する
2. E2E テストを書く（Red）: プライベート判定ページで許可選択後の挙動を検証する
3. 統合テストを書く（Red）: 確認ダイアログ経路の許可適用を検証する
4. 単体テストを書く（Red）: whitelistWriter の分類・正規化を検証する
5. 実装する（Green）: (a) なら gateway の path 照合、(b) なら i18n（data-i18n、_locales/ja/en）と pin テストの更新
6. README（日英）と PRIVACY.md を同期させ、public/PRIVACY.md と docs/PRIVACY.md をバイト同一にする

### 落とし穴
- (a) を選ぶ場合: path 照合は privacyCache・DomainFilter など全 whitelist 消費者に波及する可能性がある。dev-docs/archived/pbi/2026-09-12-05-refactor-whitelist-write-gateway.md の gateway 記録から影響範囲を確認してから着手する
- (b) を選ぶ場合: 文言変更は i18n（data-i18n、_locales/ja/en）と pin テストの更新がセット。ハードコードされた文言が残ると日英どちらかがずれる
- README（日英）と PRIVACY.md の更新を漏らすと約束と実装の不一致が別の箇所に残る。PRIVACY.md は public/ と docs/ の 2 箇所ある

## 見積もり
1pt目安（0.5人週相当）: 本体は裁定とドキュメント同期。(a) を選んでも path 照合は gateway 1 ファイルの変更で可能な状態にされている（アーカイブ済み PBI 2026-09-12-05 の記録）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（シナリオ 1: privatePageDialog / whitelistWriter の正規化テストと E2E の save-domain 経路。シナリオ 2: E2E の #dialog-save-path not.toBeAttached ピン、golden pin、check-i18n の ja/en キー対称性）
- [x] コードレビュー完了（セルフレビュー: 「パス許可」関連文言の残存 grep 0 件、PRIVACY.md byte-identical、validate 全グリーン）
- [x] ドキュメント更新済み（README 日英、PRIVACY.md 2 箇所バイト同一）

## 参照
- ブレスト報告書: docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md（プライバシー系の約束と実装の不一致）
- dev-docs/DESIGN_SPECIFICATIONS.md §13.5
- dev-docs/archived/pbi/2026-09-12-05-refactor-whitelist-write-gateway.md（gateway 記録）
- ROADMAP.md T4
