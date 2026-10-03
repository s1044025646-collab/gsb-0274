import { Point } from './geometry.js';
import { ApiError } from './errors.js';

/** 校验并规范化坐标输入；任何不合法情况都抛出带错误码的 ApiError。 */
export function validatePoints(input: unknown): Point[] {
  if (!Array.isArray(input)) {
    throw new ApiError('INVALID_POINTS', 'points 必须是坐标数组');
  }
  if (input.length === 0) {
    throw new ApiError('EMPTY_POINTS', 'points 不能为空：至少需要 1 个点');
  }
  const points: Point[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i] as Record<string, unknown>;
    // 同时接受 {x, y} 对象与 [x, y] 二元数组。
    let x: unknown;
    let y: unknown;
    if (Array.isArray(item) && item.length === 2) {
      x = item[0];
      y = item[1];
    } else if (item !== null && typeof item === 'object') {
      x = item.x;
      y = item.y;
    }
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      throw new ApiError(
        'INVALID_COORDINATE',
        `第 ${i} 个点坐标非法：必须是 {x,y} 对象或 [x,y] 数组，且为有限数值`,
        { index: i },
      );
    }
    points.push({ x, y });
  }
  return points;
}

export function validateTolerance(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) {
    throw new ApiError(
      'INVALID_TOLERANCE',
      'tolerance 必须为非负有限数值',
    );
  }
  return input;
}

/**
 * 校验强制点索引。
 * 公开去重规则：重复索引按集合去重；必须为 [0, n-1] 内的整数。
 * 首尾允许出现在列表中（本就保留）。
 */
export function validateForcedIndices(input: unknown, n: number): number[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new ApiError(
      'INVALID_FORCED_INDICES',
      'forcedIndices 必须是整数数组',
    );
  }
  const set = new Set<number>();
  for (const raw of input) {
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw >= n
    ) {
      throw new ApiError(
        'INVALID_FORCED_INDEX',
        `强制点索引越界或非整数（合法范围 0..${n - 1}）`,
        { value: raw },
      );
    }
    set.add(raw);
  }
  return [...set].sort((a, b) => a - b);
}

export function validateKeptIndices(input: unknown, n: number): number[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiError(
      'INVALID_KEPT_INDICES',
      'keptIndices 必须是非空整数数组',
    );
  }
  for (const raw of input) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= n) {
      throw new ApiError(
        'INVALID_KEPT_INDEX',
        `保留索引越界或非整数（合法范围 0..${n - 1}）`,
        { value: raw },
      );
    }
  }
  return input as number[];
}
