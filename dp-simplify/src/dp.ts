import { Point, distancePointToSegment } from './geometry.js';

/** 一次分裂决策的记录，用于“查看分裂步骤”。 */
export interface SplitStep {
  /** 被处理区间（全局原始索引，闭区间）。 */
  startIndex: number;
  endIndex: number;
  /** 区间内离替代线段最远的点索引；没有中间点时为 null。 */
  farthestIndex: number | null;
  /** 该最远距离。 */
  maxDistance: number;
  /** 是否因严格大于容差而分裂。 */
  split: boolean;
}

/** 一个端点区间的替代关系与误差。 */
export interface SegmentReport {
  /** 区间起点、终点（全局原始索引）。 */
  startIndex: number;
  endIndex: number;
  /** 区间内（不含端点）最大误差点的索引；无中间点时为 null。 */
  worstIndex: number | null;
  /** 最大误差；空区间为 0。 */
  maxDistance: number;
  /** 被该替代线段覆盖（移除）的原始中间索引，有序。 */
  replacedIndices: number[];
}

export interface SimplifyResult {
  /** 保留下来的原始索引，严格递增，含首尾（及全部强制点）。 */
  keptIndices: number[];
  /** 分裂决策步骤，按处理顺序记录（深度优先）。 */
  steps: SplitStep[];
  /** 每个保留相邻点对构成的替代区间报告。 */
  segments: SegmentReport[];
}

/**
 * 对一个闭区间 [first, last] 做 Douglas–Peucker 简化。
 * 端点视为必须保留。使用显式栈的迭代实现，结果与递归一致、确定性。
 *
 * 规则：
 * - 距离严格大于 tolerance 才分裂；恰好等于容差不分裂。
 * - 多个点同距时取原始索引最小者。
 */
function simplifyRange(
  pts: Point[],
  first: number,
  last: number,
  tolerance: number,
  kept: boolean[],
  steps: SplitStep[],
): void {
  const stack: Array<[number, number]> = [[first, last]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthestIndex: number | null = null;
    let maxDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const d = distancePointToSegment(pts[i], pts[start], pts[end]);
      // 仅在严格更大时更新 => 同距保留索引最小者。
      if (d > maxDistance) {
        maxDistance = d;
        farthestIndex = i;
      }
    }
    const split = farthestIndex !== null && maxDistance > tolerance;
    steps.push({
      startIndex: start,
      endIndex: end,
      farthestIndex,
      maxDistance,
      split,
    });
    if (split) {
      kept[farthestIndex!] = true;
      // 先压右段再压左段，使左段先被处理（深度优先，左到右）。
      stack.push([farthestIndex!, end]);
      stack.push([start, farthestIndex!]);
    }
  }
}

/** 根据保留索引生成逐段误差报告（独立重算，不依赖分裂过程）。 */
export function buildSegments(
  pts: Point[],
  keptIndices: number[],
): SegmentReport[] {
  const segments: SegmentReport[] = [];
  for (let k = 0; k + 1 < keptIndices.length; k++) {
    const startIndex = keptIndices[k];
    const endIndex = keptIndices[k + 1];
    let worstIndex: number | null = null;
    let maxDistance = 0;
    const replacedIndices: number[] = [];
    for (let i = startIndex + 1; i < endIndex; i++) {
      replacedIndices.push(i);
      const d = distancePointToSegment(pts[i], pts[startIndex], pts[endIndex]);
      if (d > maxDistance) {
        maxDistance = d;
        worstIndex = i;
      }
    }
    segments.push({
      startIndex,
      endIndex,
      worstIndex,
      maxDistance,
      replacedIndices,
    });
  }
  return segments;
}

/**
 * 折线简化入口。
 * @param points 有序原始顶点（保持顺序与重复点，不去重）。
 * @param tolerance 非负容差，单位与坐标相同。
 * @param forcedIndices 必须保留的原始索引（首尾始终保留）；重复值会去重。
 */
export function simplify(
  points: Point[],
  tolerance: number,
  forcedIndices: number[] = [],
): SimplifyResult {
  const n = points.length;
  const kept = new Array<boolean>(n).fill(false);
  kept[0] = true;
  kept[n - 1] = true;

  const boundary = new Set<number>([0, n - 1]);
  for (const idx of forcedIndices) boundary.add(idx);
  const boundaries = [...boundary].sort((a, b) => a - b);
  for (const b of boundaries) {
    if (b !== 0 && b !== n - 1) kept[b] = true;
  }

  const steps: SplitStep[] = [];
  for (let k = 0; k + 1 < boundaries.length; k++) {
    simplifyRange(points, boundaries[k], boundaries[k + 1], tolerance, kept, steps);
  }

  const keptIndices: number[] = [];
  for (let i = 0; i < n; i++) if (kept[i]) keptIndices.push(i);
  const segments = buildSegments(points, keptIndices);
  return { keptIndices, steps, segments };
}
