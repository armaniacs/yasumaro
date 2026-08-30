# Cleansing Corpus Report

- 生成日時: 2026-08-30T17:13:02.246Z
- 対象: `test/corpus/*.html` (10 files)
- モード: cleanseAISummaryContent (esbuild bundle)
- 閾値: 削除率 50% 超で警告、90% 超でエラー / Body Protection threshold=50
- 検証: 誤爆クラス `address-book` / `admin-panel` / `x-data` が削除されていないこと

| ファイル | 総要素数 | 削除数 | 削除率 | bytesBefore | bytesAfter | bytes削除率 | address-book | admin-panel | x-data | 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| amazon.html | 106 | 19 | 17.9% | 4802 | 3261 | 32.1% | 1→1 | 1→1 | 1→1 | PASS |
| blog.html | 165 | 25 | 15.2% | 9835 | 7076 | 28.1% | 1→1 | 1→1 | 1→1 | PASS |
| cookpad.html | 115 | 19 | 16.5% | 5137 | 3416 | 33.5% | 1→1 | 1→1 | 1→1 | PASS |
| news.html | 163 | 26 | 16.0% | 9103 | 6170 | 32.2% | 1→1 | 1→1 | 1→1 | PASS |
| qiita.html | 107 | 16 | 15.0% | 5668 | 4085 | 27.9% | 1→1 | 1→1 | 1→1 | PASS |
| twitter.html | 96 | 17 | 17.7% | 4385 | 2786 | 36.5% | 1→1 | 1→1 | 1→1 | PASS |
| watanavi.html | 140 | 22 | 15.7% | 6032 | 3915 | 35.1% | 1→1 | 1→1 | 1→1 | PASS |
| wikipedia.html | 98 | 12 | 12.2% | 5101 | 3682 | 27.8% | 1→1 | 1→1 | 1→1 | PASS |
| yahoo.html | 95 | 17 | 17.9% | 4961 | 3187 | 35.8% | 1→1 | 1→1 | 1→1 | PASS |
| zenn.html | 87 | 14 | 16.1% | 4547 | 3135 | 31.1% | 1→1 | 1→1 | 1→1 | PASS |

## 詳細

### amazon.html
- 総要素数: 106, 削除数: 19, 削除率: 17.9%
- bytes: 4802 → 3261 (32.1% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### blog.html
- 総要素数: 165, 削除数: 25, 削除率: 15.2%
- bytes: 9835 → 7076 (28.1% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### cookpad.html
- 総要素数: 115, 削除数: 19, 削除率: 16.5%
- bytes: 5137 → 3416 (33.5% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: N/A

### news.html
- 総要素数: 163, 削除数: 26, 削除率: 16.0%
- bytes: 9103 → 6170 (32.2% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### qiita.html
- 総要素数: 107, 削除数: 16, 削除率: 15.0%
- bytes: 5668 → 4085 (27.9% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### twitter.html
- 総要素数: 96, 削除数: 17, 削除率: 17.7%
- bytes: 4385 → 2786 (36.5% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### watanavi.html
- 総要素数: 140, 削除数: 22, 削除率: 15.7%
- bytes: 6032 → 3915 (35.1% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### wikipedia.html
- 総要素数: 98, 削除数: 12, 削除率: 12.2%
- bytes: 5101 → 3682 (27.8% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### yahoo.html
- 総要素数: 95, 削除数: 17, 削除率: 17.9%
- bytes: 4961 → 3187 (35.8% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

### zenn.html
- 総要素数: 87, 削除数: 14, 削除率: 16.1%
- bytes: 4547 → 3135 (31.1% 削除)
- トラップ保持: address-book 1→1, admin-panel 1→1, x-data 1→1 — OK
- 50%超警告: なし
- 90%超エラー: なし
- Body Protection: checked

## 判定

**PASS** — 全ファイルで誤爆なし、削除率50%以下、本文保持。

## 再現

```bash
node scripts/check-cleansing-corpus.mjs
npm run check:cleansing-corpus
```
