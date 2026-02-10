# i18n改善 - 実装計画

**作成日**: 2026-02-11
**バージョン**: 1.0.0
**ステータス**: 設計完了・実装待ち

## 概要

Chrome Extension「Obsidian Smart History」におけるi18n関連のコード品質を改善し、将来の多言語対応に向けたインフラを構築します。

## 改善項目

1. **ハードコードされたロケールの削除**
   - `recordingLogic.js:208` の `'ja-JP'` を動的取得に置換

2. **ロケールヘルパー関数の追加**
   - ユーザーロケールの取得
   - RTL言語言語判定（インフラのみ）
   - 日時フォーマットのヘルパー

3. **i18n APIの統一使用**
   - `chrome.i18n.getUILanguage()` を一元管理

---

## アーキテクチャ概要

### 実装アプローチ

**最小限の変更**で最大の改善を実現。既存の翻訳（en/ja）は維持。

### 新規作成するモジュール

1. **`src/utils/localeUtils.js`**（新規）
   - ユーザーロケール取得
   - RTL言語判定
   - 日時フォーマットヘルパー

### 既存モジュールの拡張

- **`src/popup/i18n.js`**: `getUserLocale()`エクスポート追加

---

## 詳細設計

### 1. localeUtils.js（ロケールユーティリティ）

#### 目的
ハードコードされたロケール値を排除し、動的にユーザーの言語設定を取得します。

#### 主要な関数

**`getUserLocale()`**
- **動作**:
  - `chrome.i18n.getUILanguage()` を返す
  - Chrome APIが利用できない（テスト環境など）場合: `'en-US'` を返す
- **返り値**: 例: `'ja'`, `'ja-JP'`, `'en-US'`, `'ar'`

**`isRTL()`**
- **動作**:
  - 現在のロケールがRTL（右から左）言語か判定
  - RTL言語リスト: `['ar', 'he', 'fa', 'ur', 'yi']` 等
  - 不明なロケールは `false` を返す
- **返り値**: `boolean`

**`formatDate(date, options)`**
- **パラメータ**:
  - `date`: Dateオブジェクト
  - `options`: Intl.DateTimeFormatオプション（オプション）
- **動作**:
  - ユーザーロケールで日時をフォーマット
  - `Intl.DateTimeFormat` が未サポートの場合はISO文字列を返す
- **返り値**: フォーマットされた文字列

**`getDateSeparator()`**
- **動作**:
  - 日付パス用の区切り文字を返す
  - デフォルト: `'-'`
  - 将来的にロケールに応じて変更可能（例: `'/'`）
- **返り値**: `string`

#### エラーハンドリング

**`getUserLocale()`**
- `chrome.i18n` が未定義の場合: フォールバック to `'en-US'`
- 例外スロー時: コンソールに警告、フォールバック to `'en-US'`

**`formatDate()`**
- `date` が `null`/`undefined` の場合:現在日時を使用
- `Intl.DateTimeFormat` 未対応: フォールバック to `date.toISOString()`

**`isRTL()`**
- `getUserLocale()` が失敗した場合: `false` を返す（LTRデフォルト）

#### テスト戦略
- テストファイル: `src/utils/__tests__/localeUtils.test.js`
- 各関数の正常系・例外系をテスト

---

### 2. recordingLogic.jsの修正

#### 変更箇所: 行208

**修正前**:
```javascript
const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
```

**修正後**:
```javascript
import { getUserLocale } from '../utils/localeUtils.js';

const timestamp = new Date().toLocaleTimeString(getUserLocale(), { hour: '2-digit', minute: '2-digit' });
```

#### テスト戦略
- `recordingLogic.test.js` でタイムスタンプ生成を検証
- `getUserLocale` のspyでテスト

---

### 3. i18n.jsの拡張

#### 変更内容
`getUserLocale` を再エクスポート:

```javascript
import { getUserLocale } from '../utils/localeUtils.js';
export { getUserLocale };
```

これにより、既存の `i18n.js` をインポートしているモジュールで `getUserLocale` も利用可能。

#### テスト戦略
- テストファイル: `src/popup/__tests__/i18n.test.js`
- エクスポート関数の確認

---

## 実装範囲

### 本実装のスコープ（今回行うこと）

| 項目 | 内容 |
|------|------|
| 新規ファイル | `src/utils/localeUtils.js` |
| テストファイル | `src/utils/__tests__/localeUtils.test.js` |
| テストファイル | `src/popup/__tests__/i18n.test.js` |
| 修正ファイル | `src/background/recordingLogic.js` |
| 修正ファイル | `src/popup/i18n.js` |

### 本実装のスコープ外（今回行わないこと）

| 項目 | 理由 |
|------|------|
| 新言語翻訳ファイルの作成 | 今回はインフラ構築のみ |
| 日付パス区切りの動的切り替え | 概念のみ実装 |
| RTL UIの実装 | 関数のみ追加 |
| その他のハードコード修正 | recordingLogic.jsのみ |

---

## テスト戦略

### ユニットテスト

**localeUtils.test.js**
```javascript
describe('localeUtils', () => {
  describe('getUserLocale', () => {
    it('ブラウザ環境で正しいロケールを返す');
    it('テスト環境でフォールバックを返す');
  });
  describe('isRTL', () => {
    it('アラビア語でtrueを返す');
    it('英語でfalseを返す');
    it('不明なロケールでfalseを返す');
  });
  describe('formatDate', () => {
    it('日付を正しくフォーマットする');
    it('null入力で現在日時を使用する');
  });
  describe('getDateSeparator', () => {
    it('デフォルトでハイフンを返す');
  });
});
```

**i18n.test.js**
```javascript
describe('i18n', () => {
  it('getUserLocaleがエクスポートされている');
  it('applyI18nが動作する');
});
```

### 既存テストの確認

- `recordingLogic.test.js` がパスすることを確認

---

## 実装順序

1. **Step 1: localeUtils.js作成**
   - 関数実装
   - テスト作成

2. **Step 2: i18n.js拡張**
   - getUserLocaleエクスポート追加
   - テスト作成

3. **Step 3: recordingLogic.js修正**
   - ハードコード置換
   - テスト確認

4. **Step 4: 全テスト実行**
   - すべてのテストがパスすることを確認

---

## パフォーマンス考慮事項

- `getUserLocale()`: 返り値をキャッシュ可能（必要に応じて）
- `isRTL()`: 計算コストは低い（単純な配列検索）
- `getDateSeparator()`: 定数文字列返却

---

## 今後の拡張性

### 追加言語翻訳

新言語を追加するには、以下のディレクトリを作成:
```
_locales/
├── en/          (既存)
├── ja/          (既存)
├── ko/          (韓国語)
├── zh/          (中国語)
└── ...
```

### 日付フォーマットの高度化

ロケールに応じた日付フォーマットを簡単に追加可能。

### RTL UIの実装

`isRTL()` は将来のRTL UI実装時に再利用可能。

---

## まとめ

この実装計画により、以下の改善が実現されます：

1. ✅ **コード品質向上**: ハードコードされたロケールを削除
2. ✅ **i18nインフラ整備**: 将来の多言語対応を容易に
3. ✅ **RTL対応準備**: 関数インフラのみ実装
4. ✅ **メンテナンス性向上**: ロケール関連処理を一元管理

変更は最小限に抑え、既存機能に影響を与えません。