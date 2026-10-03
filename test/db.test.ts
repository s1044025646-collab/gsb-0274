import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { simplify, verify } from "../src/dp.js";
import {
  getPolyline,
  getSimplification,
  insertPolyline,
  insertSimplification,
  insertVerification,
  listSimplifications,
  openDatabase,
} from "../src/db.js";

const tmpDbPath = resolve("data/test-tmp.sqlite");

test("SQLite 持久化：写入后重新打开可复查旧结果", () => {
  rmSync(tmpDbPath, { force: true });
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 3 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ];

  const db1 = openDatabase(tmpDbPath);
  const poly = insertPolyline(db1, points, "test-line");
  const result = simplify(points, 0.5, [1]);
  const rec = insertSimplification(db1, poly.id, 0.5, [1], result);
  const vid = insertVerification(
    db1,
    poly.id,
    0.5,
    [1],
    result.keptIndices,
    verify(points, 0.5, result.keptIndices, [1])
  );
  assert.ok(vid > 0);
  db1.close();

  // 模拟重启
  const db2 = openDatabase(tmpDbPath);
  const reloaded = getPolyline(db2, poly.id)!;
  assert.equal(reloaded.point_count, 4);
  assert.deepEqual(reloaded.points, points);
  const simpl = getSimplification(db2, rec.id)!;
  assert.equal(simpl.algorithm_version, result.algorithmVersion);
  assert.deepEqual(simpl.forced_indices, [1]);
  assert.deepEqual(simpl.result.keptIndices, result.keptIndices);
  assert.equal(listSimplifications(db2, poly.id).length, 1);
  db2.close();

  rmSync(tmpDbPath, { force: true });
  rmSync(tmpDbPath + "-wal", { force: true });
  rmSync(tmpDbPath + "-shm", { force: true });
});
