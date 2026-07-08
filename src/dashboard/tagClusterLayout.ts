/**
 * tagClusterLayout.ts
 * Minimal force-directed layout: repulsion between all nodes + attraction along edges.
 * Not a general-purpose physics engine — sized for a few dozen tag nodes.
 */

import type { TagNode, TagEdge } from './tagCooccurrence.js';

export interface Position {
  x: number;
  y: number;
}

const ITERATIONS = 100;
const REPULSION = 4000;
const ATTRACTION = 0.02;
const DAMPING = 0.9;

const BASE_CANVAS_WIDTH = 800;
const BASE_CANVAS_HEIGHT = 600;
const MAX_CANVAS_WIDTH = 2400;
const MAX_CANVAS_HEIGHT = 1800;
const PER_NODE_WIDTH = 40;
const PER_NODE_HEIGHT = 30;

/**
 * Compute the layout coordinate space size for a given node count.
 * Used as both computeLayout()'s width/height and the SVG viewBox size,
 * so that nodes have room to spread out as the tag count grows instead of
 * being crammed into a fixed 800x600 space (which previously caused nodes
 * to overflow the panel with no way to see them, since there was no pan/zoom).
 */
export function computeCanvasSize(nodeCount: number): { width: number; height: number } {
  const width = Math.min(MAX_CANVAS_WIDTH, Math.max(BASE_CANVAS_WIDTH, 400 + nodeCount * PER_NODE_WIDTH));
  const height = Math.min(MAX_CANVAS_HEIGHT, Math.max(BASE_CANVAS_HEIGHT, 300 + nodeCount * PER_NODE_HEIGHT));
  return { width, height };
}

export function computeLayout(
  nodes: TagNode[],
  edges: TagEdge[],
  width: number,
  height: number
): Map<string, Position> {
  const positions = new Map<string, Position>();
  const velocities = new Map<string, Position>();

  if (nodes.length === 0) {
    return positions;
  }

  if (nodes.length === 1) {
    positions.set(nodes[0].tag, { x: width / 2, y: height / 2 });
    return positions;
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 3;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    positions.set(node.tag, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
    velocities.set(node.tag, { x: 0, y: 0 });
  });

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = new Map<string, Position>();
    nodes.forEach(n => forces.set(n.tag, { x: 0, y: 0 }));

    // Repulsion between every pair of nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].tag;
        const b = nodes[j].tag;
        const posA = positions.get(a)!;
        const posB = positions.get(b)!;
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = REPULSION / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(a)!.x += fx;
        forces.get(a)!.y += fy;
        forces.get(b)!.x -= fx;
        forces.get(b)!.y -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const posA = positions.get(edge.source);
      const posB = positions.get(edge.target);
      if (!posA || !posB) continue;
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      forces.get(edge.source)!.x += dx * ATTRACTION * edge.weight;
      forces.get(edge.source)!.y += dy * ATTRACTION * edge.weight;
      forces.get(edge.target)!.x -= dx * ATTRACTION * edge.weight;
      forces.get(edge.target)!.y -= dy * ATTRACTION * edge.weight;
    }

    // Apply forces with damping, then clamp to canvas bounds
    for (const node of nodes) {
      const vel = velocities.get(node.tag)!;
      const force = forces.get(node.tag)!;
      vel.x = (vel.x + force.x) * DAMPING;
      vel.y = (vel.y + force.y) * DAMPING;

      const pos = positions.get(node.tag)!;
      pos.x = Math.max(0, Math.min(width, pos.x + vel.x));
      pos.y = Math.max(0, Math.min(height, pos.y + vel.y));
    }
  }

  return positions;
}
