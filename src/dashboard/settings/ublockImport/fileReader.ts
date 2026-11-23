/**
 * fileReader.ts
 * uBlockインポートモジュール - ファイル読み込み処理
 */

import { getMessage } from '../../../utils/i18n.js';

/** uBlock取り込みのファイルサイズ上限 (5MB)。上限値のSSOTはここ。 */
export const UBLOCK_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface ReadFileOptions {
  /** バイト単位の上限。省略時は UBLOCK_FILE_MAX_BYTES。 */
  maxBytes?: number;
  /** 中断用シグナル。abort で読み込みを止めて中断エラーを返す。 */
  signal?: AbortSignal;
}

/**
 * ファイル読み込み
 * @param {File} file - 読み込むファイル
 * @param {ReadFileOptions} options - 上限と中断の指定
 * @returns {Promise<string>} ファイルのテキスト内容
 */
export function readFile(file: File, options: ReadFileOptions = {}): Promise<string> {
  const { maxBytes = UBLOCK_FILE_MAX_BYTES, signal } = options;
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(getMessage('ublockFileTooLarge', { max: `${Math.round(maxBytes / 1024 / 1024)} MB` })));
      return;
    }
    if (signal?.aborted) {
      reject(new Error(getMessage('ublockFileAborted')));
      return;
    }
    const reader = new FileReader();

    const detach = (): void => {
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      // 読み込み中の abort は onabort 経由でも reject されるが、イベントが
      // 届かない環境向けにここでも直接 reject する（二重 reject は無害）。
      try {
        reader.abort();
      } catch {
        // 既に settled の場合など。reject は下行で行う。
      }
      detach();
      reject(new Error(getMessage('ublockFileAborted')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const text = e.target?.result as string;
      detach();
      // BOM (Byte Order Mark) を除去
      if (text && text.charCodeAt(0) === 0xFEFF) {
        resolve(text.slice(1));
      } else {
        resolve(text || '');
      }
    };

    reader.onerror = () => {
      detach();
      reject(reader.error ?? new Error(getMessage('fileReadError')));
    };
    reader.onabort = () => {
      detach();
      reject(new Error(getMessage('ublockFileAborted')));
    };
    try {
      reader.readAsText(file, 'utf-8');
    } catch (error) {
      detach();
      reject(error instanceof Error ? error : new Error(getMessage('fileReadError')));
    }
  });
}
