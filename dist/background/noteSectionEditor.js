// src/background/noteSectionEditor.ts
export class NoteSectionEditor {
    static DEFAULT_SECTION_HEADER = '# 🌐 ブラウザ閲覧履歴';
    static insertIntoSection(existingContent, sectionHeader, newContent) {
        if (existingContent.includes(sectionHeader)) {
            return this._insertUnderExistingSection(existingContent, sectionHeader, newContent);
        }
        else {
            return this._createNewSection(existingContent, sectionHeader, newContent);
        }
    }
    static _insertUnderExistingSection(content, sectionHeader, newContent) {
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
    static _createNewSection(existingContent, sectionHeader, newContent) {
        let content = existingContent;
        if (content && !content.endsWith('\n')) {
            content += '\n';
        }
        return content + `${sectionHeader}\n${newContent}\n`;
    }
}
//# sourceMappingURL=noteSectionEditor.js.map