import { Point } from './geometry.js';
import { buildSegments } from './dp.js';

export interface VerifyResult {
  /** 所有检查是否通过（含逐段误差不超过容差）。 */
  valid: boolean;
  strictlyIncreasing: boolean;
  endpointsKept: boolean;
  forcedKept: boolean;
  /** 每个被替代区间的最大误差是否都 <= tolerance。 */
  withinTolerance: boolean;
  /** 全部区间中的最大误差及其所在位置（独立重算）。 */
  globalMaxDistance: number;
  globalWorstIndex: number | null;
  /** 未被保留的强制点索引。 */
  missingForcedIndices: number[];
  segments: Array<{
    startIndex: number;
    endIndex: number;
    worstIndex: number | null;
    maxDistance: number;
    exceeds: boolean;
  }>;
}

/**
 * 独立核验给定的保留索引方案是否满足约束。
 * 即使该方案不是本算法产生的，也可据此报告是否可行。
 */
export function verifyKeptIndices(
  points: Point[],
  tolerance: number,
  forcedIndices: number[],
  keptIndices: number[],
): VerifyResult {
  const n = points.length;

  let strictlyIncreasing = true;
  for (let i = 1; i < keptIndices.length; i++) {
    if (keptIndices[i] <= keptIndices[i - 1]) {
      strictlyIncreasing = false;
      break;
    }
  }

  const endpointsKept =
    keptIndices.length >= 1 &&
    keptIndices[0] === 0 &&
    keptIndices[keptIndices.length - 1] === n - 1;

  const keptSet = new Set(keptIndices);
  const missingForcedIndices = forcedIndices.filter((i) => !keptSet.has(i));
  const forcedKept = missingForcedIndices.length === 0;

  let withinTolerance = true;
  let globalMaxDistance = 0;
  let globalWorstIndex: number | null = null;

  let segments: VerifyResult['segments'] = [];
  if (strictlyIncreasing && endpointsKept) {
    segments = buildSegments(points, keptIndices).map((s) => {
      const exceeds = s.maxDistance > tolerance;
      if (exceeds) withinTolerance = false;
      if (s.maxDistance > globalMaxDistance) {
        globalMaxDistance = s.maxDistance;
        globalWorstIndex = s.worstIndex;
      }
      return {
        startIndex: s.startIndex,
        endIndex: s.endIndex,
        worstIndex: s.worstIndex,
        maxDistance: s.maxDistance,
        exceeds,
      };
    });
  }

  const valid =
    strictlyIncreasing && endpointsKept && forcedKept && withinTolerance;
  return {
    valid,
    strictlyIncreasing,
    endpointsKept,
    forcedKept,
    withinTolerance,
    globalMaxDistance,
    globalWorstIndex,
    missingForcedIndices,
    segments,
  };
}
