# PBI: 未知 `privacy_mode` の拒否理由を特定可能にする

## ユーザーストーリー
設定バックアップを復元する利用者として、復元失敗時に「どの値が・なぜ不正か」が分かってほしい。なぜなら将来バージョンの `privacy_mode` を知らない旧ビルドで「invalid」とだけ言われても、破損なのか新値なのか判断できず対処できないから。

## 優先度
- 順位: 08 / 11
- RICEスコア: 2.4（Reach=2 / Impact=1.5 / Confidence=0.8 / Effort=1.0）
- 根拠: 発火は将来バージョン跨ぎの復元時のみだが、拒否の不透明さはデータ保全上の不安。設計判断（stamp 形式）が残るため Confidence 0.8。

## 背景
`src/utils/settingsExportImport.ts:502-509` は未知の `privacy_mode` を備份全体の不正として拒否する（fail-closed 自体は正しい）が、破損と将来値の区別がなく理由も伝わらない。レビュー指摘 Low #12（Data Integrity）。

## BDD受け入れシナリオ
Scenario: 未知の privacy_mode は理由付きで拒否される
  Given 未知の `privacy_mode` を含むバックアップ JSON
  When `importSettings`（検証経路）で読み込む
  Then 拒否され、どのフィールドのどの値が不正かが分かる情報が返る／記録される

Scenario: 正常なバックアップは従来どおり復元される
  Given 正当なバックアップ JSON
  When 読み込む
  Then 従来どおり復元される（既存テスト緑）

Scenario: 将来値と破損が区別できる土台がある
  Given export 側の出力
  When バージョン情報を見る
  Then schema/version stamp（または同等の識別子）で新旧判定ができる

## 受け入れ基準
- [x] 拒否時にフィールド名・不正値（またはそのハッシュ等の安全な表現）が特定できる
- [x] export 側に将来値判定の土台（version stamp 等）がある、または不要と判断した根拠が記録される
- [x] `settingsExportImport` 系テスト（ssot 含む）が全緑

## テスト戦略
- 単体: 未知値の拒否理由テスト＋正常復元の回帰テスト
- 既存: `npx vitest run src/utils/__tests__/settingsExportImport*` 全緑

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：fail-closed維持・診断追加のみ）
- [x] ドキュメント更新済み（不要ならその旨を記録）― 利用者向け仕様の変更なし（拒否自体は従来通り、理由の記録が増えたのみ）のため docs 更新不要。設計判断の根拠は `/tmp/whywhy-nn08.md` に記録
