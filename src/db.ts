import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ALGORITHM_VERSION,
  SimplifyResult,
  VerificationReport,
} from "./dp.js";
import { Point } from "./geometry.js";

export interface PolylineRecord {
  id: number;
  name: string | null;
  points: Point[];
  point_count: number;
  created_at: string;
}

export interface SimplificationRecord {
  id: number;
  polyline_id: number;
  tolerance: number;
  forced_indices: number[];
  algorithm_version: string;
  result: SimplifyResult;
  created_at: string;
}

export function openDatabase(dbPath: string): DatabaseSync {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS polylines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      points TEXT NOT NULL,
      point_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS simplifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      polyline_id INTEGER NOT NULL,
      tolerance REAL NOT NULL,
      forced_indices TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (polyline_id) REFERENCES polylines(id)
    );
    CREATE TABLE IF NOT EXISTS verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      polyline_id INTEGER NOT NULL,
      tolerance REAL NOT NULL,
      forced_indices TEXT NOT NULL,
      kept_indices TEXT NOT NULL,
      report TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (polyline_id) REFERENCES polylines(id)
    );
  `);
  return db;
}

export function insertPolyline(
  db: DatabaseSync,
  points: Point[],
  name: string | null
): PolylineRecord {
  const stmt = db.prepare(
    "INSERT INTO polylines (name, points, point_count) VALUES (?, ?, ?)"
  );
  const info = stmt.run(name, JSON.stringify(points), points.length);
  return getPolyline(db, Number(info.lastInsertRowid))!;
}

export function getPolyline(
  db: DatabaseSync,
  id: number
): PolylineRecord | null {
  const row = db.prepare("SELECT * FROM polylines WHERE id = ?").get(id) as
    | {
        id: number;
        name: string | null;
        points: string;
        point_count: number;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    points: JSON.parse(row.points) as Point[],
    point_count: row.point_count,
    created_at: row.created_at,
  };
}

export function listPolylines(db: DatabaseSync): PolylineRecord[] {
  const rows = db
    .prepare(
      "SELECT id, name, point_count, created_at FROM polylines ORDER BY id"
    )
    .all() as Array<Omit<PolylineRecord, "points">>;
  return rows.map((r) => ({ ...r, points: [] }));
}

export function insertSimplification(
  db: DatabaseSync,
  polylineId: number,
  tolerance: number,
  forcedIndices: number[],
  result: SimplifyResult
): SimplificationRecord {
  const stmt = db.prepare(
    `INSERT INTO simplifications
       (polyline_id, tolerance, forced_indices, algorithm_version, result)
     VALUES (?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    polylineId,
    tolerance,
    JSON.stringify(forcedIndices),
    ALGORITHM_VERSION,
    JSON.stringify(result)
  );
  return getSimplification(db, Number(info.lastInsertRowid))!;
}

export function getSimplification(
  db: DatabaseSync,
  id: number
): SimplificationRecord | null {
  const row = db
    .prepare("SELECT * FROM simplifications WHERE id = ?")
    .get(id) as
    | {
        id: number;
        polyline_id: number;
        tolerance: number;
        forced_indices: string;
        algorithm_version: string;
        result: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    polyline_id: row.polyline_id,
    tolerance: row.tolerance,
    forced_indices: JSON.parse(row.forced_indices) as number[],
    algorithm_version: row.algorithm_version,
    result: JSON.parse(row.result) as SimplifyResult,
    created_at: row.created_at,
  };
}

export function listSimplifications(
  db: DatabaseSync,
  polylineId: number
): Array<Omit<SimplificationRecord, "result">> {
  const rows = db
    .prepare(
      `SELECT id, polyline_id, tolerance, forced_indices, algorithm_version, created_at
       FROM simplifications WHERE polyline_id = ? ORDER BY id`
    )
    .all(polylineId) as unknown as Array<
    Omit<SimplificationRecord, "result"> & { forced_indices: string }
  >;
  return rows.map((r) => ({ ...r, forced_indices: JSON.parse(r.forced_indices as unknown as string) }));
}

export function insertVerification(
  db: DatabaseSync,
  polylineId: number,
  tolerance: number,
  forcedIndices: number[],
  keptIndices: number[],
  report: VerificationReport
): number {
  const info = db
    .prepare(
      `INSERT INTO verifications
         (polyline_id, tolerance, forced_indices, kept_indices, report)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      polylineId,
      tolerance,
      JSON.stringify(forcedIndices),
      JSON.stringify(keptIndices),
      JSON.stringify(report)
    );
  return Number(info.lastInsertRowid);
}
