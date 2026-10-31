import { V, cumulativeLengths, nearestOnPolyline, resamplePolyline } from './geometry';
import type { Vec3, VesselBranch, VesselTree } from './types';

export interface VesselGraphEdge {
  to: string;
  weight: number;
}

export interface VesselGraphNode {
  id: string;
  branchId: string;
  branchName: string;
  index: number;
  point: Vec3;
  radius: number;
  /** arc length from branch start */
  sMm: number;
  edges: VesselGraphEdge[];
}

export interface VesselGraph {
  nodes: Map<string, VesselGraphNode>;
  byBranch: Map<string, string[]>;
  rootId: string;
}

export function buildVesselGraph(tree: VesselTree): VesselGraph {
  const nodes = new Map<string, VesselGraphNode>();
  const byBranch = new Map<string, string[]>();

  for (const branch of tree.branches) {
    const ids: string[] = [];
    const cum = cumulativeLengths(branch.points);
    branch.points.forEach((point, index) => {
      const id = `${branch.id}:${index}`;
      const node: VesselGraphNode = {
        id,
        branchId: branch.id,
        branchName: branch.name,
        index,
        point,
        radius: branch.radii[index] ?? 1.5,
        sMm: cum[index] ?? 0,
        edges: [],
      };
      nodes.set(id, node);
      ids.push(id);
      if (index > 0) {
        const prev = nodes.get(ids[index - 1]!)!;
        const w = V.dist(prev.point, point);
        prev.edges.push({ to: id, weight: w });
        node.edges.push({ to: prev.id, weight: w });
      }
    });
    byBranch.set(branch.id, ids);
  }

  const rootBranch = tree.branches.find((b) => b.parentId === null) ?? tree.branches[0];
  const rootId = rootBranch ? (byBranch.get(rootBranch.id)?.[0] ?? '') : '';

  // stitch branches to their parent at the closest parent sample
  for (const branch of tree.branches) {
    if (!branch.parentId) continue;
    const startId = byBranch.get(branch.id)?.[0];
    if (!startId) continue;
    const start = nodes.get(startId)!;
    const parentIds = byBranch.get(branch.parentId);
    if (!parentIds || parentIds.length === 0) continue;
    let best: { id: string; distance: number } | null = null;
    for (const candidate of parentIds) {
      const node = nodes.get(candidate)!;
      const distance = V.dist(node.point, start.point);
      if (!best || distance < best.distance) best = { id: candidate, distance };
    }
    if (best && best.distance < 18) {
      const parent = nodes.get(best.id)!;
      parent.edges.push({ to: start.id, weight: best.distance });
      start.edges.push({ to: parent.id, weight: best.distance });
    }
  }

  return { nodes, byBranch, rootId };
}

export function nearestNode(
  graph: VesselGraph,
  point: Vec3,
  branchId?: string,
): VesselGraphNode | null {
  let best: VesselGraphNode | null = null;
  let bestDistance = Infinity;
  for (const node of graph.nodes.values()) {
    if (branchId && node.branchId !== branchId) continue;
    const d = V.dist(node.point, point);
    if (d < bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
}

/** Dijkstra over the vessel graph. Returns node ids from start to goal (inclusive). */
export function shortestPath(
  graph: VesselGraph,
  startId: string,
  goalId: string,
): string[] {
  if (!graph.nodes.has(startId) || !graph.nodes.has(goalId)) return [];
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const id of graph.nodes.keys()) dist.set(id, Infinity);
  dist.set(startId, 0);

  while (visited.size < graph.nodes.size) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null || best === Infinity) break;
    if (current === goalId) break;
    visited.add(current);
    const node = graph.nodes.get(current)!;
    for (const edge of node.edges) {
      if (visited.has(edge.to)) continue;
      const alt = best + edge.weight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  if (!prev.has(goalId) && startId !== goalId) return [];
  const out: string[] = [goalId];
  let cursor = goalId;
  let guard = 0;
  while (cursor !== startId && guard < graph.nodes.size + 2) {
    const p = prev.get(cursor);
    if (!p) return [];
    out.push(p);
    cursor = p;
    guard += 1;
  }
  return out.reverse();
}

export function pathFromNodeIds(graph: VesselGraph, ids: readonly string[]): Vec3[] {
  return ids.map((id) => graph.nodes.get(id)!.point);
}

export function nodePathLength(graph: VesselGraph, ids: readonly string[]): number {
  let total = 0;
  for (let i = 1; i < ids.length; i += 1) {
    total += V.dist(graph.nodes.get(ids[i - 1]!)!.point, graph.nodes.get(ids[i]!)!.point);
  }
  return total;
}

/** Radius per resampled path point by interpolating the nearest node radius. */
export function radiusAlongPath(graph: VesselGraph, ids: readonly string[], path: Vec3[]): number[] {
  const nodePoints = ids.map((id) => graph.nodes.get(id)!.point);
  const nodeRadii = ids.map((id) => graph.nodes.get(id)!.radius);
  const cum = cumulativeLengths(nodePoints);
  const total = cum[cum.length - 1] ?? 0;
  return path.map((point) => {
    const s = nearestOnPolyline(nodePoints, point).sMm;
    if (total <= 0) return nodeRadii[0] ?? 1.5;
    const t = Math.min(1, Math.max(0, s / total)) * (nodeRadii.length - 1);
    const i = Math.min(nodeRadii.length - 2, Math.floor(t));
    const f = t - i;
    return (nodeRadii[i] ?? 1.5) * (1 - f) + (nodeRadii[i + 1] ?? 1.5) * f;
  });
}

export interface TargetCandidate {
  branch: VesselBranch;
  index: number;
  point: Vec3;
  sMm: number;
  label: string;
}

export function targetCandidates(tree: VesselTree): TargetCandidate[] {
  const out: TargetCandidate[] = [];
  for (const branch of tree.branches) {
    if (branch.id === 'aorta') continue;
    const step = Math.max(1, Math.floor(branch.points.length / 3));
    for (let i = step; i < branch.points.length - 1; i += step) {
      out.push({
        branch,
        index: i,
        point: branch.points[i]!,
        sMm: 0,
        label: `${branch.name} · ${Math.round((i / branch.points.length) * 100)}%`,
      });
    }
  }
  return out;
}

export { resamplePolyline };
