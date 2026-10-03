import { Point } from './geometry.js';
import { simplify } from './dp.js';
import { verifyKeptIndices, VerifyResult } from './verify.js';
import {
  Store,
  PolylineRow,
  VersionRow,
  ALGORITHM_VERSION,
} from './store.js';
import { ApiError } from './errors.js';
import {
  validatePoints,
  validateTolerance,
  validateForcedIndices,
  validateKeptIndices,
} from './validation.js';

export interface SimplifyResponse {
  polylineId: number;
  versionId: number;
  algorithmVersion: string;
  tolerance: number;
  forcedIndices: number[];
  keptIndices: number[];
  simplifiedPolyline: Point[];
  removedCount: number;
  segments: VersionRow['segments'];
  steps: VersionRow['steps'];
}

/** 业务编排：参数校验 -> DP 简化 -> 落库（新参数追加新记录）。 */
export class SimplifyService {
  constructor(private store: Store) {}

 importPolyline(name: unknown, rawPoints: unknown): { id: number; pointCount: number } {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ApiError('INVALID_NAME', 'name 必须为非空字符串');
    }
    const points = validatePoints(rawPoints);
    const id = this.store.insertPolyline(name.trim(), points);
    return { id, pointCount: points.length };
  }

  getPolylineOrThrow(polylineId: number): PolylineRow {
    const polyline = this.store.getPolyline(polylineId);
    if (!polyline) {
      throw new ApiError(
        'POLYLINE_NOT_FOUND',
        `折线 ${polylineId} 不存在`,
      );
    }
    return polyline;
  }

  listPolylines() {
    return this.store.listPolylines();
  }

  listVersions(polylineId: number) {
    this.getPolylineOrThrow(polylineId);
    return this.store.listVersions(polylineId);
  }

  simplify(
    polylineId: number,
    rawTolerance: unknown,
    rawForced: unknown,
  ): SimplifyResponse {
    const polyline = this.getPolylineOrThrow(polylineId);
    const tolerance = validateTolerance(rawTolerance);
    const forcedIndices = validateForcedIndices(rawForced, polyline.points.length);
    const result = simplify(polyline.points, tolerance, forcedIndices);
    const versionId = this.store.insertVersion(
      polylineId,
      tolerance,
      forcedIndices,
      result,
    );
    return {
      polylineId,
      versionId,
      algorithmVersion: ALGORITHM_VERSION,
      tolerance,
      forcedIndices,
      keptIndices: result.keptIndices,
      simplifiedPolyline: result.keptIndices.map((i) => polyline.points[i]),
      removedCount: polyline.points.length - result.keptIndices.length,
      segments: result.segments,
      steps: result.steps,
    };
  }

  getVersionOrThrow(versionId: number): { version: VersionRow; polyline: PolylineRow } {
    const version = this.store.getVersion(versionId);
    if (!version) {
      throw new ApiError('VERSION_NOT_FOUND', `版本 ${versionId} 不存在`);
    }
    const polyline = this.getPolylineOrThrow(version.polylineId);
    return { version, polyline };
  }

  /** 查询某次简化保留的原始索引与简化折线。 */
  queryKept(versionId: number): {
    versionId: number;
    polylineId: number;
    tolerance: number;
    forcedIndices: number[];
    keptIndices: number[];
    simplifiedPolyline: Point[];
  } {
    const { version, polyline } = this.getVersionOrThrow(versionId);
    return {
      versionId,
      polylineId: polyline.id,
      tolerance: version.tolerance,
      forcedIndices: version.forcedIndices,
      keptIndices: version.keptIndices,
      simplifiedPolyline: version.keptIndices.map((i) => polyline.points[i]),
    };
  }

  getSteps(versionId: number): {
    versionId: number;
    algorithmVersion: string;
    steps: VersionRow['steps'];
  } {
    const { version } = this.getVersionOrThrow(versionId);
    return { versionId, algorithmVersion: version.algorithmVersion, steps: version.steps };
  }

  /**
   * 核验给定保留索引（可来自任意方案）。
   * versionId 提供原始数据/容差/强制点上下文。
   */
  verify(versionId: number, rawKept: unknown): VerifyResult & { versionId: number } {
    const { version, polyline } = this.getVersionOrThrow(versionId);
    const keptIndices = validateKeptIndices(rawKept, polyline.points.length);
    const report = verifyKeptIndices(
      polyline.points,
      version.tolerance,
      version.forcedIndices,
      keptIndices,
    );
    return { versionId, ...report };
  }

  exportJson(versionId: number): {
    polyline: { id: number; name: string; points: Point[] };
    version: Omit<VersionRow, 'polylineId'> & { polylineId?: number };
    simplifiedPolyline: Point[];
  } {
    const { version, polyline } = this.getVersionOrThrow(versionId);
    return {
      polyline: { id: polyline.id, name: polyline.name, points: polyline.points },
      version,
      simplifiedPolyline: version.keptIndices.map((i) => polyline.points[i]),
    };
  }
}
