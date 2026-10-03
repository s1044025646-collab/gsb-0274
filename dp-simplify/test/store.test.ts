import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, ALGORITHM_VERSION } from '../src/store.js';
import { simplify } from '../src/dp.js';

test('原线与版本持久化：改参数产生新记录，重开可复查', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dp-store-'));
  const dbPath = join(dir, 'test.sqlite');
  try {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 0.5 },
      { x: 4, y: 0 },
    ];
    let store = new Store(dbPath);
    const polylineId = store.insertPolyline('测试线', points);
    const v1 = simplify(points, 0.5, []);
    const v2 = simplify(points, 2, []);
    const id1 = store.insertVersion(polylineId, 0.5, [], v1);
    const id2 = store.insertVersion(polylineId, 2, [], v2);
    assert.notEqual(id1, id2);
    assert.equal(store.listVersions(polylineId).length, 2);
    store.close();

    // 重新打开（模拟重启）
    store = new Store(dbPath);
    const reloaded = store.getPolyline(polylineId);
    assert.ok(reloaded);
    assert.equal(reloaded!.name, '测试线');
    assert.deepEqual(reloaded!.points, points);
    const rv1 = store.getVersion(id1);
    assert.equal(rv1!.algorithmVersion, ALGORITHM_VERSION);
    assert.deepEqual(rv1!.keptIndices, v1.keptIndices);
    const rv2 = store.getVersion(id2);
    assert.deepEqual(rv2!.keptIndices, v2.keptIndices);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
