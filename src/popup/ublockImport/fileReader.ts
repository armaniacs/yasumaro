/**
 * fileReader.ts
 * uBlockインポートモジュール - ファイル読み込み処理
 */

/**
 * ファイル読み込み
 * @param {File} file - 読み込むファイル
 * @returns {Promise<string>} ファイルのテキスト内容
 */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const text = e.target?.result as string;
      // BOM (Byte Order Mark) を除去
      if (text && text.charCodeAt(0) === 0xFEFF) {
        resolve(text.slice(1));
      } else {
        resolve(text || '');
      }
    };

    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}