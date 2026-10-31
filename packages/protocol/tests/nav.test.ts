import { describe, expect, it } from 'vitest';
import { buildVesselGraph, nearestNode, shortestPath } from '../src/nav';
import type { VesselBranch, VesselTree } from '../src/types';

function branch(
  id: string,
  parentId: string | null,
  points: Array<[number, number, number]>,
): VesselBranch {
  return {
    id,
    name: id,
    fullName: id,
    parentId,
    points,
    radii: points.map(() => 2),
    tone: 0,
  };
}

const tree: VesselTree = {
  caseId: 'c1',
  branches: [
    branch('aorta', null, [
      [0, 0, 0],
      [0, 0, 20],
      [0, 0, 40],
    ]),
    branch('lad', 'aorta', [
      [0, 0, 40],
      [20, 0, 60],
      [40, 0, 70],
    ]),
    branch('lcx', 'aorta', [
      [0, 0, 40],
      [-20, 0, 60],
      [-40, 0, 70],
    ]),
  ],
  bounds: { min: [-40, 0, 0], max: [40, 0, 70] },
  stats: { branchCount: 3, totalLengthMm: 120, minRadiusMm: 2 },
};

describe('vessel navigation graph', () => {
  it('stitches branches at their parent junction', () => {
    const graph = buildVesselGraph(tree);
    expect(graph.nodes.size).toBe(9);
    const ladStart = graph.byBranch.get('lad')![0]!;
    const aortaEnd = graph.byBranch.get('aorta')![2]!;
    const node = graph.nodes.get(ladStart)!;
    expect(node.edges.some((e) => e.to === aortaEnd)).toBe(true);
  });

  it('finds a route from the root to a distal branch', () => {
    const graph = buildVesselGraph(tree);
    const goal = graph.byBranch.get('lad')![2]!;
    const path = shortestPath(graph, graph.rootId, goal);
    expect(path.length).toBe(6);
    expect(path[path.length - 1]).toBe(goal);
    expect(path[0]).toBe(graph.rootId);
  });

  it('finds the nearest node within a branch', () => {
    const graph = buildVesselGraph(tree);
    const node = nearestNode(graph, [38, 0, 69], 'lad')!;
    expect(node.branchId).toBe('lad');
    expect(node.index).toBe(2);
  });

  it('returns empty path for disconnected ids', () => {
    const graph = buildVesselGraph(tree);
    expect(shortestPath(graph, 'aorta:0', 'nope:1')).toEqual([]);
  });
});
