/**
 * maskNavigator.ts
 * Pure mask position collection and navigation logic.
 * No DOM access — unit testable without jsdom.
 */

export interface MaskedPosition {
  start: number;
  end: number;
}

/**
 * Collect [MASKED:*] token positions from text.
 * Pure function: same input -> same output, no side effects.
 */
export function collectPositions(text: string): MaskedPosition[] {
  const positions: MaskedPosition[] = [];
  const regex = /\[MASKED:\w+\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    positions.push({ start: match.index, end: match.index + match[0].length });
  }
  return positions;
}

/** Pure wrap helpers — jsdom-free */
export function nextIndex(current: number, length: number): number {
  if (length === 0) return -1;
  return (current + 1) % length;
}

export function prevIndex(current: number, length: number): number {
  if (length === 0) return -1;
  return (current - 1 + length) % length;
}

export class MaskNavigator {
  private positions: MaskedPosition[] = [];
  private currentIndex = -1;

  constructor(initialText?: string) {
    if (initialText) this.setText(initialText);
  }

  setText(text: string): void {
    this.positions = collectPositions(text);
    this.currentIndex = -1;
  }

  getPositions(): MaskedPosition[] {
    return [...this.positions];
  }

  getCount(): number {
    return this.positions.length;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrent(): MaskedPosition | undefined {
    if (this.currentIndex < 0 || this.currentIndex >= this.positions.length) return undefined;
    return this.positions[this.currentIndex];
  }

  jumpTo(index: number): number {
    if (this.positions.length === 0) return -1;
    // clamp via modulo for robustness
    const len = this.positions.length;
    this.currentIndex = ((index % len) + len) % len;
    return this.currentIndex;
  }

  next(): number {
    if (this.positions.length === 0) return -1;
    this.currentIndex = nextIndex(this.currentIndex, this.positions.length);
    return this.currentIndex;
  }

  prev(): number {
    if (this.positions.length === 0) return -1;
    this.currentIndex = prevIndex(this.currentIndex, this.positions.length);
    return this.currentIndex;
  }

  reset(): void {
    this.positions = [];
    this.currentIndex = -1;
  }

  static collectPositions = collectPositions;
  static nextIndex = nextIndex;
  static prevIndex = prevIndex;
}
