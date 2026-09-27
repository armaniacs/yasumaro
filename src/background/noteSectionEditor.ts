// src/background/noteSectionEditor.ts
export interface InsertOptions {
  /**
   * PBI 2026-09-25-13: when true, skip insertion when the target section
   * already contains an identical content block. Only the offline replay path
   * sets this — the retry of one operation must not stack a second copy.
   * Dashboard append (user-invoked) keeps unconditional insertion.
   */
  dedupe?: boolean;
}

export class NoteSectionEditor {
  static DEFAULT_SECTION_HEADER = '# 🌐 ブラウザ閲覧履歴';

  static insertIntoSection(existingContent: string, sectionHeader: string, newContent: string, options: InsertOptions = {}): string {
    if (existingContent.includes(sectionHeader)) {
      return this._insertUnderExistingSection(existingContent, sectionHeader, newContent, options);
    } else {
      return this._createNewSection(existingContent, sectionHeader, newContent);
    }
  }

  private static _insertUnderExistingSection(content: string, sectionHeader: string, newContent: string, options: InsertOptions = {}): string {
    const lines = content.split('\n');
    const sectionIndex = lines.findIndex(line => line.trim() === sectionHeader);

    if (options.dedupe && this._sectionContains(lines, sectionIndex, newContent)) {
      // Same operation replayed: the identical block is already in the
      // section, so inserting again would stack a duplicate.
      return content;
    }

    // Start at the line after the section header
    let insertIndex = sectionIndex + 1;

    // Find the next section header (any line starting with #)
    for (let i = sectionIndex + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith('#')) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }

    lines.splice(insertIndex, 0, newContent);
    return lines.join('\n');
  }

  /**
   * Whether the section starting at `sectionIndex` already contains the exact
   * `newContent` block. The section runs until the next heading line; match is
   * by contiguous line sequence, so a partial or reordered match does not
   * count.
   */
  private static _sectionContains(lines: string[], sectionIndex: number, newContent: string): boolean {
    const block = newContent.split('\n');
    const end = lines.findIndex((line, i) => i > sectionIndex && line.startsWith('#'));
    const sectionEnd = end === -1 ? lines.length : end;

    for (let i = sectionIndex + 1; i + block.length <= sectionEnd; i++) {
      let matched = true;
      for (let j = 0; j < block.length; j++) {
        if (lines[i + j] !== block[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return true;
      }
    }
    return false;
  }

  private static _createNewSection(existingContent: string, sectionHeader: string, newContent: string): string {
    let content = existingContent;
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    return content + `${sectionHeader}\n${newContent}\n`;
  }
}
