/**
 * tagClusterLoading.ts
 * Manages the 4-step loading progress overlay shown inside the Tag Cluster SVG
 * while data is fetched, analyzed, laid out, and rendered.
 */

interface LoadingStep {
  number: number;
  label: string;
  completed: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class TagClusterLoadingManager {
  private svgElement: SVGSVGElement;
  private overlayGroup: SVGGElement | null = null;
  private currentStep = 0;
  private steps: LoadingStep[] = [
    { number: 1, label: 'データ読み込み', completed: false },
    { number: 2, label: 'ノード分析', completed: false },
    { number: 3, label: 'レイアウト計算', completed: false },
    { number: 4, label: 'グラフ描画', completed: false },
  ];

  constructor(svgElement: SVGSVGElement) {
    this.svgElement = svgElement;
  }

  /** Show the loading overlay with the first step active. */
  show(): void {
    this.cleanup();

    this.overlayGroup = document.createElementNS(SVG_NS, 'g');
    this.overlayGroup.setAttribute('class', 'tag-cluster-loading-overlay');

    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', this.svgElement.getAttribute('width') || '400');
    bgRect.setAttribute('height', this.svgElement.getAttribute('height') || '300');
    bgRect.setAttribute('fill', 'rgba(0, 0, 0, 0.3)');
    this.overlayGroup.appendChild(bgRect);

    const textGroup = document.createElementNS(SVG_NS, 'g');
    textGroup.setAttribute('class', 'tag-cluster-loading-text');
    this.overlayGroup.appendChild(textGroup);

    this.svgElement.appendChild(this.overlayGroup);
    this.render();
  }

  /** Mark step at stepIndex (0-based) as completed and move focus to it. */
  updateStep(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.currentStep = stepIndex;
    this.steps[stepIndex].completed = true;
    this.render();
  }

  private render(): void {
    if (!this.overlayGroup) return;
    const textGroup = this.overlayGroup.querySelector('.tag-cluster-loading-text') as SVGGElement | null;
    if (!textGroup) return;

    while (textGroup.firstChild) {
      textGroup.removeChild(textGroup.firstChild);
    }

    const svgWidth = parseInt(this.svgElement.getAttribute('width') || '400', 10);
    const svgHeight = parseInt(this.svgElement.getAttribute('height') || '300', 10);
    const centerX = svgWidth / 2;
    const startY = (svgHeight - this.steps.length * 35) / 2;

    this.steps.forEach((step, idx) => {
      const yOffset = idx * 35;
      const isCompleted = step.completed;
      const isCurrent = idx === this.currentStep && !isCompleted;
      const color = isCompleted ? '#10b981' : isCurrent ? '#3b82f6' : '#9ca3af';

      const marker = document.createElementNS(SVG_NS, 'text');
      marker.setAttribute('x', String(centerX - 90));
      marker.setAttribute('y', String(startY + yOffset));
      marker.setAttribute('font-size', '16');
      marker.setAttribute('font-weight', 'bold');
      marker.setAttribute('fill', color);
      marker.textContent = isCompleted ? '✓' : '◯';
      textGroup.appendChild(marker);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(centerX - 60));
      label.setAttribute('y', String(startY + yOffset + 5));
      label.setAttribute('font-size', '14');
      label.setAttribute('fill', color);
      label.textContent = `${step.number}/4: ${step.label}`;
      textGroup.appendChild(label);
    });
  }

  /** Remove the overlay and reset internal state so it can be shown again. */
  cleanup(): void {
    if (this.overlayGroup && this.overlayGroup.parentNode) {
      this.overlayGroup.parentNode.removeChild(this.overlayGroup);
    }
    this.overlayGroup = null;
    this.steps.forEach(step => { step.completed = false; });
    this.currentStep = 0;
  }
}
