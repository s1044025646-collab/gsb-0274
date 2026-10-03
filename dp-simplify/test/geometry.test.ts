import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distancePointToSegment } from '../src/geometry.js';

test('端点外投影被截断：按到端点距离而非到直线距离', () => {
  // 线段 (0,0)-(2,0)，点 (3,4) 到无限直线的距离为 4，但投影参数 t=1.5>1 被截断，
  // 最近点是端点 (2,0)，距离为 sqrt((3-2)^2+4^2)=sqrt(17)。
  const d = distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.ok(Math.abs(d - Math.sqrt(17)) < 1e-12, `got ${d}`);
  // 左端点外
  const d2 = distancePointToSegment({ x: -1, y: -1 }, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.ok(Math.abs(d2 - Math.sqrt(2)) < 1e-12);
});

test('投影落在线段内部时等于垂直距离', () => {
  const d = distancePointToSegment({ x: 1, y: 3 }, { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.equal(d, 3);
});

test('两端重合时退化为到单点距离', () => {
  const d = distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(d, 5);
});
