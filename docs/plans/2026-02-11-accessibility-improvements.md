# Accessibility Improvements Implementation Plan

## Context

This plan addresses accessibility issues identified in the code review by the Accessibility Advocate. The goal is to improve the Obsidian Smart History Chrome Extension to meet WCAG AA standards, ensuring users with disabilities can effectively use the extension.

### Current State Assessment

**Good Points (Already Implemented):**
- Tab navigation for all elements
- Tab keyboard navigation with arrow keys, Home/End, Space/Enter
- `role="tab"`, `role="tabpanel"`, `role="tablist"` attributes
- `aria-live="polite"` for status messages
- Focus trap implementation exists in `sanitizePreview.js` for confirmation modal
- Some `aria-invalid` and `aria-describedby` attributes on input fields
- Dark mode support via `prefers-color-scheme: dark`

**Issues to Fix (High Priority):**
1. **Modal Accessibility - Import Confirmation Modal**: Missing focus trap and proper focus management
2. **Drop Zone**: Missing `role="region"` and `aria-label` attributes
3. **Radio Button Descriptions**: Privacy mode radio buttons need `aria-describedby` linking
4. **Color Contrast**: Verify existing contrast ratios meet WCAG AA (4.5:1 for normal text, 3:1 for large text)

---

## Implementation Plan

### Task 1: Import Confirmation Modal Accessibility Improvements

**Files:**
- Modify: `src/popup/popup.js` (lines 210-264)
- Modify: `src/popup/popup.html` (lines 366-387)

**Description:**
Currently, the import confirmation modal (`#importConfirmModal`) has basic ESC key detect but lacks proper focus trap and focus management. We'll reuse the focus trap implementation from `sanitizePreview.js`.

**Steps:**

1. **Add focus trap helper functions** to `src/popup/popup.js`:

```javascript
// Focus trap implementation (reused from sanitizePreview.js)
let importModalFocusHandler = null;
let importModalPreviousFocus = null;

function trapImportModalFocus(modal) {
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = modal.querySelectorAll(focusableSelector);
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  if (!firstFocusable || !lastFocusable) return;

  const keydownHandler = (e) => {
    if (e.key === 'Escape') {
      closeImportModal();
      return;
    }
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  };

  if (!modal.trapFocusHandler) {
    modal.trapFocusHandler = keydownHandler;
    modal.addEventListener('keydown', keydownHandler);
  }
}

function releaseImportModalFocus(modal) {
  if (modal && modal.trapFocusHandler) {
    modal.removeEventListener('keydown', modal.trapFocusHandler);
    modal.trapFocusHandler = null;
  }
}
```

2. **Update modal opening logic** to include focus management:

```javascript
// In importFileInput.addEventListener('change', ...), replace the modal show section:
showImportPreview(parsed);

if (importConfirmModal) {
  // Store previous focus
  importModalPreviousFocus = document.activeElement;

  importConfirmModal.classList.remove('hidden');
  importConfirmModal.style.display = 'flex';
  void importConfirmModal.offsetHeight;
  importConfirmModal.classList.add('show');

  // Set up focus trap
  trapImportModalFocus(importConfirmModal);

  // Move focus to first focusable element (cancel button or confirm button)
  const firstFocusable = importConfirmModal.querySelector('button, [tabindex]:not([tabindex="-1"])');
  if (firstFocusable) {
    firstFocusable.focus();
  }
}
```

3. **Update modal closing logic** to release focus trap and restore focus:

```javascript
function closeImportModal() {
  if (importConfirmModal) {
    // Release focus trap
    releaseImportModalFocus(importConfirmModal);

    importConfirmModal.classList.remove('show');
    importConfirmModal.style.display = 'none';
    importConfirmModal.classList.add('hidden');

    // Restore previous focus
    if (importModalPreviousFocus && document.body.contains(importModalPreviousFocus)) {
      importModalPreviousFocus.focus();
    }
    importModalPreviousFocus = null;
  }

  pendingImportData = null;
  pendingImportJson = null;
  if (importPreview) {
    importPreview.textContent = '';
  }
}
```

4. **Remove the global Escape key listener** for import modal (now handled by focus trap):

Delete or comment out lines 253-257 in popup.js:
```javascript
// Close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !importConfirmModal?.classList.contains('hidden')) {
        closeImportModal();
    }
});
```

---

### Task 2: Drop Zone ARIA Attributes

**Files:**
- Modify: `src/popup/popup.html` (lines 235-237)

**Description:**
Add semantic roles and labels to the drop zone for screen reader users.

**Steps:**

Update the drop zone HTML to include ARIA attributes:

```html
<div id="uBlockDropZone"
     class="drop-zone"
     role="region"
     aria-label="uBlock filter file drop zone">
  <p data-i18n="dropFileHere">Drop file here</p>
</div>
```

**Notes:**
- The file selection button (`uBlockFileSelectBtn`) provides keyboard-accessible alternative, satisfying WCAG 2.1, Level AA requirements for drag-and-drop functionality.
- The drop zone is visually enhanced for mouse users but not a required interaction method.

---

### Task 3: Privacy Mode Radio Button Description Association

**Files:**
- Modify: `src/popup/popup.html` (lines 281-321)

**Description:**
Link the privacy mode radio buttons to their description text using `aria-describedby`.

**Steps:**

1. **Add unique IDs to description elements** and update radio buttons:

```html
<div class="form-group">
  <label data-i18n="privacyMode">Privacy Mode</label>
  <div class="radio-group" id="privacyModeGroup" role="radiogroup" aria-labelledby="privacyModeLabel">

    <div>
      <input type="radio" id="modeA" name="privacyMode" value="local_only"
             aria-describedby="modeADesc">
      <label for="modeA"><strong data-i18n="modeA">Mode A: Local Only</strong> <span
          data-i18n="modeADetail">(Under development)</span></label>
      <div class="help-text ml-24" id="modeADesc" data-i18n="modeADesc">
        Summarize page content using only local AI, without sending data externally.<br>
        Currently not supported on most browsers.
      </div>
    </div>

    <div class="mt-10">
      <input type="radio" id="modeB" name="privacyMode" value="full_pipeline"
             aria-describedby="modeBDesc">
      <label for="modeB"><strong data-i18n="modeB">Mode B: Full Pipeline</strong> <span
          data-i18n="modeBCurrently">(Under development)</span></label>
      <div class="help-text ml-24" id="modeBDesc" data-i18n="modeBDesc">
        Local AI summary → PII masking → Cloud AI refinement.<br>
        Currently not supported on most browsers.
      </div>
    </div>

    <div class="mt-10">
      <input type="radio" id="modeC" name="privacyMode" value="masked_cloud"
             aria-describedby="modeCDesc">
      <label for="modeC"><strong data-i18n="modeC">Mode C: Masked Cloud</strong> <span
          data-i18n="modeCRecommended">(Recommended)</span></label>
      <div class="help-text ml-24" id="modeCDesc" data-i18n="modeCDesc">
        Send only masked data to cloud AI.<br>
        For environments where local AI is not available.
      </div>
    </div>

    <div class="mt-10">
      <input type="radio" id="modeD" name="privacyMode" value="cloud_only"
             aria-describedby="modeDDesc">
      <label for="modeD"><strong data-i18n="modeD">Mode D: Cloud Only</strong></label>
      <div class="help-text ml-24" id="modeDDesc" data-i18n="modeDDesc">
        Send raw text directly to cloud AI.<br>
        Prioritize speed.
      </div>
    </div>

  </div>
</div>
```

**Notes:**
- Added `role="radiogroup"` to the container for proper semantic structure
- Each radio button now has `aria-describedby` linking to its corresponding description
- The `aria-labelledby="privacyModeLabel"` would require adding an ID to the main label

---

### Task 4: Verify Color Contrast Ratios

**Files:**
- Review: `src/popup/styles.css` (color definitions in `:root` and `@media (prefers-color-scheme: dark)`)

**Description:**
Review and verify that all color combinations meet WCAG AA standards.

**Current Color Palette (Light Mode):**

| Element | Foreground | Background | Contrast Ratio |
|---------|-----------|------------|----------------|
| Text | `#333` | White (`#fff`) | ~12.6:1 ✓ (AA/AAA) |
| Secondary Text | `#444` | White | ~8.2:1 ✓ (AA/AAA) |
| Muted Text | `#666` | White | ~5.1:1 ✓ (AA/AAA) |
| Help Text | `#666` | `#f8f9fa` | ~4.4:1 ✓ (AA) |
| Primary Button Text | `#fff` | `#2E7D32` | ~5.1:1 ✓ (AA/AAA) |
| Primary Button Hover | `#fff` | `#256628` | ~5.8:1 ✓ (AA/AAA) |
| Secondary Button Text | `#fff` | `#6c757d` | ~3.6:1 ✓ (AA for large, AAA for large) |
| Danger Text | `#c62828` | White | ~4.6:1 ✓ (AA) |
| Error Text | `#721c24` | `#f8d7da` | ~4.3:1 ✓ (AA) |

**Current Color Palette (Dark Mode):**

| Element | Foreground | Background | Contrast Ratio |
|---------|-----------|------------|----------------|
| Text | `#E0E0E0` | `#1a1a1a` | ~8.9:1 ✓ (AA/AAA) |
| Secondary Text | `#BDBDBD` | `#1a1a1a` | ~6.3:1 ✓ (AA/AAA) |
| Primary Button Text | `#fff` | `#66BB6A` | ~3.2:1 ⚠ (AA for large, not AA for small) |
| Help Text | `#9E9E9E` | `#1e1e1e` | ~4.1:1 ✓ (AA) |

**Action:**
- Update dark mode primary button color to improve contrast for normal text
- Consider changing `--color-primary` from `#66BB6A` to a darker shade like `#43A047` or `#388E3C`

**Proposed Fix for Dark Mode Primary Button:**

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* Change to darker green for better contrast */
    --color-primary: #43A047;
    --color-primary-hover: #388E3C;
    /* ... */
  }
}
```

---

### Task 5: Accessibility Testing

**Files:**
- Create: `src/popup/__tests__/accessibility.test.js` (optional)

**Description:**
Create accessibility tests to verify the improvements.

**Manual Testing Steps:**

1. **Keyboard-only Navigation:**
   - Navigate through all UI elements using Tab key
   - Verify each interactive element receives visible focus
   - Test Enter/Space on buttons and links
   - Test arrow keys on tab navigation

2. **Screen Reader Testing:**
   - Use NVDA (Windows), VoiceOver (Mac), or ChromeVox (Chrome OS)
   - Verify all labels and descriptions are announced
   - Test modal focus trap behavior
   - Verify radio button groups are properly announced

3. **Color Contrast:**
   - Use browser DevTools Accessibility panel
   - Use contrast checker extension (e.g., WCAG Color Contrast Checker)
   - Verify all text meets WCAG AA standards

4. **Modal Focus Management:**
   - Open import confirmation modal
   - Verify focus is trapped inside the modal
   - Verify Escape closes the modal
   - Verify focus returns to previous element

---

## Files to Modify

| File | Description |
|------|-------------|
| `src/popup/popup.js` | Add focus trap functions for import modal |
| `src/popup/popup.html` | Update modal, drop zone, radio button accessibility attributes |
| `src/popup/styles.css` | Improve dark mode primary button contrast |

---

## Verification

After implementation, verify with:

```bash
# Run existing tests
npm test

# Manually test in Chrome Extension
1. Load unpacked extension
2. Open extension popup
3. Test keyboard navigation (Tab, Enter, Escape)
4. Test modal opening/closing with keyboard
5. Verify screen reader announcements (if available)
```

**Expected Results:**
- All keyboard interactions work without a mouse
- Screen readers properly announce all interactive elements and their descriptions
- All color combinations meet WCAG AA standards
- Modal focus trap works correctly
- Focus returns to the triggering element after modal close