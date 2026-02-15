# 処理時間表示機能 設計書

**作成日**: 2026-02-16
**ステータス**: 承認済み

## 1. 概要

「Obsidianに保存しました」という成功メッセージに、処理にかかった時間を表示する機能を追加する。

### 目的

- ユーザーに処理の完了を明確に伝える
- 処理時間の可視化により、パフォーマンスの透明性を向上
- AI処理時間を別途表示することで、どの処理に時間がかかっているか把握可能

### 表示例

**AI処理あり**:
```
✓ Obsidianに保存しました (1.2秒 / AI: 850ms)
```

**AI処理なし**:
```
✓ Obsidianに保存しました (1.2秒)
```

## 2. 要件

### 機能要件

1. **全体処理時間の測定**
   - ボタンクリックから保存完了までの全体時間を測定
   - 測定範囲: `recordCurrentPage()` 開始 〜 成功レスポンス受信

2. **AI処理時間の測定**
   - AI API呼び出しの開始から終了までの時間を測定
   - Background Worker側で測定し、結果に含めて返す

3. **時間フォーマット**
   - 1秒未満: ミリ秒単位で表示 (例: `850ms`)
   - 1秒以上: 秒単位で小数第1位まで表示 (例: `1.2秒`)

4. **表示形式**
   - メッセージ末尾に全体時間を追加
   - AI処理があった場合は、スラッシュ区切りでAI時間も追加

### 非機能要件

1. **パフォーマンス**: 時間測定自体のオーバーヘッドは無視できる程度
2. **後方互換性**: 既存のメッセージキーを変更せず、動的に時間を追加
3. **テスト容易性**: 時間フォーマット関数は独立してテスト可能

## 3. アーキテクチャ

### データフロー

```
[ユーザー操作]
      ↓ ボタンクリック
[main.ts: recordCurrentPage()]
      ↓ startTime = performance.now()
      ↓
[service-worker.ts]
      ↓ PREVIEW_RECORD / MANUAL_RECORD / SAVE_RECORD
[recordingLogic.ts: record()]
      ↓ aiStartTime = performance.now() (AI処理開始前)
[aiClient.ts: generateSummary()]
      ↓ AI API呼び出し
      ↓ aiEndTime = performance.now() (AI処理終了後)
      ↓ aiDuration = aiEndTime - aiStartTime
[recordingLogic.ts]
      ↓ result.aiDuration = aiDuration
      ↓
[main.ts: 結果受信]
      ↓ totalDuration = performance.now() - startTime
      ↓ message = formatSuccessMessage(totalDuration, aiDuration)
      ↓ 画面に表示
[ユーザー]
```

### コンポーネント設計

#### 3.1 時間フォーマット関数

**場所**: `src/popup/errorUtils.ts` (既存のメッセージユーティリティに追加)

```typescript
/**
 * 処理時間をフォーマット
 * @param ms - ミリ秒単位の時間
 * @returns フォーマットされた文字列 (例: "850ms" or "1.2秒")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}秒`;
}
```

#### 3.2 成功メッセージフォーマット関数

**場所**: `src/popup/errorUtils.ts`

```typescript
/**
 * 処理時間付き成功メッセージを生成
 * @param totalDuration - 全体処理時間 (ms)
 * @param aiDuration - AI処理時間 (ms, optional)
 * @returns フォーマットされたメッセージ
 */
export function formatSuccessMessage(
  totalDuration: number,
  aiDuration?: number
): string {
  const baseMessage = getMessage('success'); // "✓ Obsidianに保存しました"
  const totalTime = formatDuration(totalDuration);

  if (aiDuration !== undefined && aiDuration > 0) {
    const aiTime = formatDuration(aiDuration);
    return `${baseMessage} (${totalTime} / AI: ${aiTime})`;
  }

  return `${baseMessage} (${totalTime})`;
}
```

#### 3.3 main.ts の変更

**変更箇所**: `recordCurrentPage()` 関数

```typescript
export async function recordCurrentPage(force: boolean = false): Promise<void> {
  const startTime = performance.now(); // 🆕 開始時刻を記録
  const statusDiv = document.getElementById('mainStatus');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

  // ... 既存の処理 ...

  try {
    // ... 既存の処理 ...

    if (result && result.success) {
      hideSpinner();

      // 🆕 処理時間を計算してメッセージ表示
      const totalDuration = performance.now() - startTime;
      const message = formatSuccessMessage(totalDuration, result.aiDuration);

      if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = 'success';
      }

      startAutoCloseTimer();
    } else {
      throw new Error(result.error || 'Save failed');
    }
  } catch (error: any) {
    // ... エラー処理 ...
  }
}
```

#### 3.4 recordingLogic.ts の変更

**変更箇所**: `record()` 関数内のAI処理部分

```typescript
// 既存のRecordingResult interfaceに追加
export interface RecordingResult {
  success: boolean;
  error?: string;
  // ... 既存のフィールド ...
  aiDuration?: number; // 🆕 AI処理時間 (ms)
}

async record(data: RecordingData): Promise<RecordingResult> {
  // ... 既存の処理 ...

  // AI処理がある場合
  if (needsAIProcessing) {
    const aiStartTime = performance.now(); // 🆕 AI処理開始時刻

    // 既存のAI処理呼び出し
    const summary = await this.aiClient.generateSummary(content);

    const aiEndTime = performance.now(); // 🆕 AI処理終了時刻
    const aiDuration = aiEndTime - aiStartTime;

    // 結果に含める
    return {
      success: true,
      processedContent: processedContent,
      aiDuration: aiDuration, // 🆕
      // ... その他のフィールド ...
    };
  }

  // AI処理がない場合はaiDurationを含めない
  return {
    success: true,
    processedContent: processedContent,
    // ... その他のフィールド ...
  };
}
```

## 4. 実装範囲

### 変更ファイル

1. **src/popup/errorUtils.ts**
   - `formatDuration()` 関数を追加
   - `formatSuccessMessage()` 関数を追加

2. **src/popup/main.ts**
   - `recordCurrentPage()` 関数内で開始時刻を記録
   - 成功時に `formatSuccessMessage()` を使用

3. **src/background/recordingLogic.ts**
   - `RecordingResult` interfaceに `aiDuration?: number` を追加
   - `record()` 関数内でAI処理時間を測定
   - 結果に `aiDuration` を含める

### テスト追加

1. **src/popup/__tests__/errorUtils.test.ts**
   - `formatDuration()` のテスト
     - 1秒未満の場合 (例: 500ms → "500ms")
     - 1秒以上の場合 (例: 1234ms → "1.2秒")
     - 境界値テスト (999ms, 1000ms)
   - `formatSuccessMessage()` のテスト
     - AI時間なしの場合
     - AI時間ありの場合
     - AI時間が0の場合

2. **src/popup/__tests__/main.test.ts**
   - 成功メッセージに時間が含まれることを確認

## 5. 設計判断

### なぜアプローチ1を選択したか

1. **シンプルさ**: フロントエンド (main.ts) で全体時間を測定するだけで、ユーザー体感時間を正確に測定できる
2. **最小限の変更**: 既存のアーキテクチャに最小限の変更で実装可能
3. **テスト容易性**: 時間フォーマット関数は純粋関数として独立してテスト可能
4. **保守性**: TypeScript移行後のコードベースに自然に統合

### AI時間の測定位置

- Background Worker (recordingLogic.ts) で測定する理由:
  - AI処理の実体がBackground Workerにあるため、正確な測定が可能
  - main.tsはメッセージ送受信のオーバーヘッドを含む全体時間を測定
  - 2つの異なる視点 (全体 vs AI) を提供

### 時間フォーマットの自動切り替え

- 1秒を境界とする理由:
  - 1秒未満: ミリ秒の方が精度高く表示 (例: "850ms" vs "0.9秒")
  - 1秒以上: 秒の方が読みやすい (例: "1.2秒" vs "1234ms")
  - ユーザーにとって最も直感的な表現

## 6. 将来の拡張性

### 可能な拡張

1. **詳細な内訳表示**: コンテンツ取得、AI処理、Obsidian保存の各ステップの時間
2. **パフォーマンスログ**: 処理時間をローカルストレージに記録して統計分析
3. **閾値アラート**: 処理時間が長すぎる場合に警告表示
4. **i18n対応**: 時間単位の表示を多言語対応 (現在は日本語固定)

### 制約事項

- 現在の実装では成功時のみ時間を表示 (エラー時は表示しない)
- AI処理をスキップした場合、aiDurationは含まれない
- ネットワーク遅延や端末性能により、時間は大きく変動する可能性がある

## 7. まとめ

この設計により、ユーザーは保存処理の完了とその所要時間を明確に把握できるようになる。実装はシンプルで保守性が高く、既存のアーキテクチャに自然に統合される。
