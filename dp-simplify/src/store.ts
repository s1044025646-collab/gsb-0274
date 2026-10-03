import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Point } from './geometry.js';
import { SimplifyResult } from './dp.js';

/** 本实现的算法版本标识；算法规则变化时升级。 */
export const ALGORITHM_VERSION = 'dp-1.0.0';

export interface PolylineRow {
  id: number;
  name: string;
  points: Point[];
  createdAt: string;
}

export interface VersionRow {
  id: number;
  polylineId: number;
  tolerance: number;
  forcedIndices: number[];
  algorithmVersion: string;
  keptIndices: number[];
  steps: SimplifyResult['steps'];
  segments: SimplifyResult['segments'];
  createdAt: string;
}

/**
 * SQLite 持久层。原线与其简化版本分开存储；
 * 改变参数（容差/强制点）会追加新记录，旧结果重启后仍可复查。
 */
export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const full = resolve(dbPath);
    mkdirSync(dirname(full), { recursive: true });
    this.db = new DatabaseSync(full);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS polylines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        points TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        polyline_id INTEGER NOT NULL REFERENCES polylines(id),
        tolerance REAL NOT NULL,
        forced_indices TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        kept_indices TEXT NOT NULL,
        steps TEXT NOT NULL,
        segments TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  insertPolyline(name: string, points: Point[]): number {
    const stmt = this.db.prepare(
      'INSERT INTO polylines (name, points) VALUES (?, ?)',
    );
    const info = stmt.run(name, JSON.stringify(points));
    return Number(info.lastInsertRowid);
  }

  getPolyline(id: number): PolylineRow | null {
    const row = this.db
      .prepare('SELECT id, name, points, created_at FROM polylines WHERE id = ?')
      .get(id) as
      | {
          id: number;
          name: string;
          points: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      points: JSON.parse(row.points) as Point[],
      createdAt: row.created_at,
    };
  }

  listPolylines(): Array<{ id: number; name: string; pointCount: number; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT id, name, points, created_at FROM polylines ORDER BY id')
      .all() as Array<{
      id: number;
      name: string;
      points: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      pointCount: (JSON.parse(r.points) as Point[]).length,
      createdAt: r.created_at,
    }));
  }

  insertVersion(
    polylineId: number,
    tolerance: number,
    forcedIndices: number[],
    result: SimplifyResult,
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO versions
         (polyline_id, tolerance, forced_indices, algorithm_version, kept_indices, steps, segments)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        polylineId,
        tolerance,
        JSON.stringify(forcedIndices),
        ALGORITHM_VERSION,
        JSON.stringify(result.keptIndices),
        JSON.stringify(result.steps),
        JSON.stringify(result.segments),
      );
    return Number(info.lastInsertRowid);
  }

  getVersion(id: number): VersionRow | null {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE id = ?')
      .get(id) as
      | {
          id: number;
          polyline_id: number;
          tolerance: number;
          forced_indices: string;
          algorithm_version: string;
          kept_indices: string;
          steps: string;
          segments: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      polylineId: row.polyline_id,
      tolerance: row.tolerance,
      forcedIndices: JSON.parse(row.forced_indices) as number[],
      algorithmVersion: row.algorithm_version,
      keptIndices: JSON.parse(row.kept_indices) as number[],
      steps: JSON.parse(row.steps) as SimplifyResult['steps'],
      segments: JSON.parse(row.segments) as SimplifyResult['segments'],
      createdAt: row.created_at,
    };
  }

  listVersions(polylineId: number): Array<{
    id: number;
    tolerance: number;
    forcedIndices: number[];
    algorithmVersion: string;
    keptCount: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        'SELECT * FROM versions WHERE polyline_id = ? ORDER BY id',
      )
      .all(polylineId) as Array<{
      id: number;
      tolerance: number;
      forced_indices: string;
      algorithm_version: string;
      kept_indices: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      tolerance: r.tolerance,
      forcedIndices: JSON.parse(r.forced_indices) as number[],
      algorithmVersion: r.algorithm_version,
      keptCount: (JSON.parse(r.kept_indices) as number[]).length,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
