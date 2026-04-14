export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createStatusCircle(svg: SVGSVGElement): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke-width', '2');
  svg.appendChild(circle);
  return circle;
}

export function updateStatusIcon(container: HTMLElement | null, type: 'success' | 'error' | 'warning' | 'muted'): void {
  if (!container) return;

  const svg = container.querySelector('.status-svg') as SVGSVGElement | null;
  if (!svg) return;

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  const ns = 'http://www.w3.org/2000/svg';

  switch (type) {
    case 'success': {
      createStatusCircle(svg);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M8 12l3 3 6-6');
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      break;
    }
    case 'error': {
      createStatusCircle(svg);
      const createLine = (x1: string, y1: string, x2: string, y2: string) => {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
      };
      createLine('9', '9', '15', '15');
      createLine('9', '15', '15', '9');
      break;
    }
    case 'warning': {
      createStatusCircle(svg);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '12');
      line.setAttribute('y1', '8');
      line.setAttribute('x2', '12');
      line.setAttribute('y2', '12');
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);

      const dot = document.createElementNS(ns, 'line');
      dot.setAttribute('x1', '12');
      dot.setAttribute('y1', '16');
      dot.setAttribute('x2', '12');
      dot.setAttribute('y2', '15.5');
      dot.setAttribute('stroke-width', '2.5');
      dot.setAttribute('stroke-linecap', 'round');
      svg.appendChild(dot);
      break;
    }
    case 'muted': {
      createStatusCircle(svg);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '12');
      line.setAttribute('y1', '17');
      line.setAttribute('x2', '12.01');
      line.setAttribute('y2', '17');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
      break;
    }
  }
}