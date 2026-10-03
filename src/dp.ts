import { Point, pointToSegment } from "./geometry.js";
import { AppError } from "./errors.js";

export const ALGORITHM_VERSION = "dp-1.0.0";

export interface SplitStep {
  /** 本次处理的原始索引区间（含两端） */
  range: [number, number];
  /** 替代线段端点的原始索引 */
  endpoints: [number, number];
  /** 区间内距替代线段最远的中间点 */
  farthestIndex: number | null;
  /** 最大欧氏距离 */
  maxDistance: number;
  /** 距离达到容差（>tolerance 才分裂；==tolerance 不分裂） */
  tolerance: number;
  /** 本次是否发生分裂 */
  split: boolean;
}

export interface SimplifyResult {
  /** 保留点在原始折线中的索引，严格递增 */
  keptIndices: number[];
  /** 保留点坐标（原始点引用） */
  simplified: Point[];
  /**
   * 每段替代关系：用 (fromIndex,toIndex) 两个保留点构成的线段，
   * 替代原始区间 [fromIndex..toIndex] 的全部采样点。
   */
  segments: ReplacementSegment[];
  steps: SplitStep[];
  forcedIndices: number[];
  tolerance: number;
  algorithmVersion: string;
}

export interface ReplacementSegment {
  fromIndex: number;
  toIndex: number;
  /** 该替代区间内原始采样点到替代线段的最大误差（本算法记录值） */
  maxError: number;
  /** 达到最大误差的原始点索引（平局取最小索引） */
  maxErrorIndex: number | null;
}

export function validatePoints(points: unknown): Point[] {
  if (!Array.isArray(points)) {
    throw new AppError("INVALID_POINT", "points 必须是坐标数组");
  }
  if (points.length === 0) {
    throw new AppError("EMPTY_INPUT", "折线不能为空，至少需要 1 个点");
  }
  return points.map((p, i) => {
    if (
      p === null ||
      typeof p !== "object" ||
      typeof (p as Point).x !== "number" ||
      typeof (p as Point).y !== "number"
    ) {
      throw new AppError(
        "INVALID_COORDINATE",
        `第 ${i} 个点必须是包含数值字段 x、y 的对象`
      );
    }
    const { x, y } = p as Point;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new AppError(
        "INVALID_COORDINATE",
        `第 ${i} 个点坐标必须为有限数值（拒绝 NaN/Infinity）`
      );
    }
    return { x, y };
  });
}

export function validateTolerance(tolerance: unknown): number {
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new AppError(
      "INVALID_TOLERANCE",
      "tolerance 必须是非负有限数值，单位与坐标长度单位相同"
    );
  }
  return tolerance;
}

/**
 * 校验强制保留索引。
 * 公开规则：必须为整数、0 <= i < n；重复指定按索引去重（保留首次出现顺序）。
 */
export function validateForcedIndices(
  forced: unknown,
  n: number
): number[] {
  if (forced === undefined || forced === null) return [];
  if (!Array.isArray(forced)) {
    throw new AppError("INVALID_FORCED_INDEX", "forcedIndices 必须是索引数组");
  }
  const seen = new Set<number>();
  const result: number[] = [];
  for (const raw of forced) {
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw >= n
    ) {
      throw new AppError(
        "INVALID_FORCED_INDEX",
        `强制保留索引 ${String(raw)} 非法：必须是 [0, ${n - 1}] 内的整数`
      );
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      result.push(raw);
    }
  }
  return result;
}

/**
 * Douglas-Peucker 简化。
 *
 * 规则：
 *  - 首尾与强制保留点共同构成分段边界，各段分别简化后按序合并；
 *  - 对每个区间，以两端点建立有限替代线段；
 *  - 中间点到该线段的最大欧氏距离（投影参数截断到 [0,1]，
 *    端点重合时退化为点距）严格大于容差时才分裂；
 *  - 最大距离恰好等于容差时不分裂；
 *  - 多个点同距时选原始索引最小者，保证结果确定。
 */
export function simplify(
  points: Point[],
  tolerance: number,
  forcedIndices: number[] = []
): SimplifyResult {
  const validatedPoints = validatePoints(points);
  const tol = validateTolerance(tolerance);
  const forced = validateForcedIndices(forcedIndices, validatedPoints.length);

  const n = validatedPoints.length;
  const boundariesSet = new Set<number>([0, n - 1, ...forced]);
  const boundaries = [...boundariesSet].sort((a, b) => a - b);

  const kept = new Set<number>(boundaries);
  const steps: SplitStep[] = [];

  // 显式栈实现，避免递归深度问题；每个待处理区间独立计算，结果确定。
  for (let b = 0; b < boundaries.length - 1; b++) {
    const start = boundaries[b]!;
    const end = boundaries[b + 1]!;
    const stack: Array<[number, number]> = [[start, end]];
    while (stack.length > 0) {
      const [lo, hi] = stack.pop()!;
      let farthestIndex: number | null = null;
      let maxDistance = -1;
      for (let i = lo + 1; i < hi; i++) {
        const d = pointToSegment(
          validatedPoints[i]!,
          validatedPoints[lo]!,
          validatedPoints[hi]!
        ).distance;
        // 严格大于才更新：平局自然保留更小的原始索引
        if (d > maxDistance) {
          maxDistance = d;
          farthestIndex = i;
        }
      }
      const split = farthestIndex !== null && maxDistance > tol;
      steps.push({
        range: [lo, hi],
        endpoints: [lo, hi],
        farthestIndex: split ? farthestIndex : farthestIndex,
        maxDistance: farthestIndex === null ? 0 : maxDistance,
        tolerance: tol,
        split,
      });
      if (split) {
        kept.add(farthestIndex!);
        // 先压右段再压左段，使左段先被处理，步骤顺序直观
        stack.push([farthestIndex!, hi]);
        stack.push([lo, farthestIndex!]);
      }
    }
  }

  const keptIndices = [...kept].sort((a, b) => a - b);
  const simplified = keptIndices.map((i) => validatedPoints[i]!);

  const segments: ReplacementSegment[] = [];
  for (let k = 0; k < keptIndices.length - 1; k++) {
    const from = keptIndices[k]!;
    const to = keptIndices[k + 1]!;
    let maxError = 0;
    let maxErrorIndex: number | null = from;
    for (let i = from; i <= to; i++) {
      const d = pointToSegment(
        validatedPoints[i]!,
        validatedPoints[from]!,
        validatedPoints[to]!
      ).distance;
      if (d > maxError) {
        maxError = d;
        maxErrorIndex = i;
      }
    }
    segments.push({ fromIndex: from, toIndex: to, maxError, maxErrorIndex });
  }

  return {
    keptIndices,
    simplified,
    segments,
    steps,
    forcedIndices: forced,
    tolerance: tol,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

export interface VerificationIssue {
  code:
    | "NOT_STRICTLY_INCREASING"
    | "MISSING_FIRST_OR_LAST"
    | "MISSING_FORCED_INDEX"
    | "INDEX_OUT_OF_RANGE"
    | "TOLERANCE_EXCEEDED";
  message: string;
}

export interface VerificationReport {
  valid: boolean;
  tolerance: number;
  keptIndices: number[];
  forcedIndices: number[];
  segments: Array<{
    fromIndex: number;
    toIndex: number;
    maxError: number;
    maxErrorIndex: number | null;
    withinTolerance: boolean;
  }>;
  issues: VerificationIssue[];
}

/**
 * 独立核验给定保留索引方案：
 * 从原始数据重新计算每个替代区间的最大误差及达到位置，
 * 并检查索引合法性、严格递增、首尾与强制点是否保留。
 * 即使索引方案不是本算法产生的，也能报告是否满足约束。
 */
export function verify(
  points: Point[],
  tolerance: number,
  keptIndices: unknown,
  forcedIndices: unknown = []
): VerificationReport {
  const validatedPoints = validatePoints(points);
  const tol = validateTolerance(tolerance);
  const forced = validateForcedIndices(forcedIndices, validatedPoints.length);
  const n = validatedPoints.length;

  const issues: VerificationIssue[] = [];

  if (!Array.isArray(keptIndices)) {
    throw new AppError("INVALID_KEEP_INDEX", "keptIndices 必须是索引数组");
  }
  for (const raw of keptIndices) {
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw >= n
    ) {
      issues.push({
        code: "INDEX_OUT_OF_RANGE",
        message: `保留索引 ${String(raw)} 超出 [0, ${n - 1}] 或不是整数`,
      });
    }
  }

  const numericKept = keptIndices.filter(
    (v): v is number =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n
  );

  let strictlyIncreasing = numericKept.length > 0;
  for (let i = 1; i < numericKept.length; i++) {
    if (numericKept[i]! <= numericKept[i - 1]!) {
      strictlyIncreasing = false;
      break;
    }
  }
  if (!strictlyIncreasing) {
    issues.push({
      code: "NOT_STRICTLY_INCREASING",
      message: "保留索引必须严格递增且不可重复",
    });
  }

  const keptSet = new Set(numericKept);
  if (!keptSet.has(0) || !keptSet.has(n - 1)) {
    issues.push({
      code: "MISSING_FIRST_OR_LAST",
      message: "必须保留首点索引 0 与尾点索引 " + (n - 1),
    });
  }
  for (const f of forced) {
    if (!keptSet.has(f)) {
      issues.push({
        code: "MISSING_FORCED_INDEX",
        message: `强制保留点索引 ${f} 未出现在保留索引中`,
      });
    }
  }

  const segments: VerificationReport["segments"] = [];
  if (strictlyIncreasing) {
    for (let k = 0; k < numericKept.length - 1; k++) {
      const from = numericKept[k]!;
      const to = numericKept[k + 1]!;
      let maxError = 0;
      let maxErrorIndex: number | null = from;
      for (let i = from; i <= to; i++) {
        const d = pointToSegment(
          validatedPoints[i]!,
          validatedPoints[from]!,
          validatedPoints[to]!
        ).distance;
        if (d > maxError) {
          maxError = d;
          maxErrorIndex = i;
        }
      }
      const withinTolerance = maxError <= tol;
      if (!withinTolerance) {
        issues.push({
          code: "TOLERANCE_EXCEEDED",
          message: `替代区间 [${from}..${to}] 最大误差 ${maxError} 超过容差 ${tol}（出现于索引 ${maxErrorIndex}）`,
        });
      }
      segments.push({
        fromIndex: from,
        toIndex: to,
        maxError,
        maxErrorIndex: numericKept.length === 1 ? null : maxErrorIndex,
        withinTolerance,
      });
    }
  }

  return {
    valid: issues.length === 0,
    tolerance: tol,
    keptIndices: numericKept,
    forcedIndices: forced,
    segments,
    issues,
  };
}
