// src/background/noteSectionEditor.ts
export class NoteSectionEditor {
  static DEFAULT_SECTION_HEADER = '# 🌐 ブラウザ閲覧履歴';

  static insertIntoSection(existingContent: string, sectionHeader: string, newContent: string): string {
    if (existingContent.includes(sectionHeader)) {
      return this._insertUnderExistingSection(existingContent, sectionHeader, newContent);
    } else {
      return this._createNewSection(existingContent, sectionHeader, newContent);
    }
  }

  private static _insertUnderExistingSection(content: string, sectionHeader: string, newContent: string): string {
    const lines = content.split('\n');
    const sectionIndex = lines.findIndex(line => line.trim() === sectionHeader);

    // Start at the line after the section header
    let insertIndex = sectionIndex + 1;

    // Find the next section header (any line starting with #)
    for (let i = sectionIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('#')) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }

    lines.splice(insertIndex, 0, newContent);
    return lines.join('\n');
  }

  private static _createNewSection(existingContent: string, sectionHeader: string, newContent: string): string {
    let content = existingContent;
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    return content + `${sectionHeader}\n${newContent}\n`;
  }
}