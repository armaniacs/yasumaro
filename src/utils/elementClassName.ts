/**
 * Element class name helpers that are safe for SVG/MathML elements.
 *
 * `Element.className` is a plain string only for HTML elements. On SVG (and
 * MathML) elements it is an `SVGAnimatedString`, so `element.className || ''`
 * still yields an object and `.toLowerCase()` throws a TypeError. Every code
 * path that inspects class names must go through these helpers.
 */

/**
 * Returns the element's class names as a space separated string.
 * Always returns a string, including for SVG elements and elements with no class attribute.
 */
export function getClassNameString(element: Element): string {
    const raw: unknown = element.className;
    if (typeof raw === 'string') {
        return raw;
    }

    // SVGAnimatedString exposes the current value via baseVal.
    if (raw && typeof raw === 'object' && typeof (raw as SVGAnimatedString).baseVal === 'string') {
        return (raw as SVGAnimatedString).baseVal;
    }

    // Fall back to the attribute itself (covers exotic hosts and detached nodes).
    return element.getAttribute?.('class') ?? '';
}

/**
 * Returns the element's class names lowercased, for case-insensitive pattern matching.
 */
export function getLowerClassName(element: Element): string {
    return getClassNameString(element).toLowerCase();
}
