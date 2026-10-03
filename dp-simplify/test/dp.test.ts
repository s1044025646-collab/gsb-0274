import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplify, buildSegments } from '../src/dp.js';
import { distancePointToSegment, Point } from '../src/geometry.js';
import {
  validatePoints,
  validateTolerance,
  validateForcedIndices,
} from '../src/validation.js';
import { verifyKeptIndices } from '../src/verify.js';
import { ApiError } from '../src/errors.js';

const P = (arr: Array<[number, number]>): Point[] =>
  arr.map(([x, y]) => ({ x, y }));

test('只有一个点：保留唯一顶点，无区间', () => {
  const pts = P([[1, 1]]);
  const r = simplify(pts, 1, []);
  assert.deepEqual(r.keptIndices, [0]);
  assert.deepEqual(r.segments, []);
});

test('两个点：总是保留首尾', () => {
  const pts = P([[0, 0], [10, 10]]);
  assert.deepEqual(simplify(pts, 0, []).keptIndices, [0, 1]);
  assert.deepEqual(simplify(pts, 999, []).keptIndices, [0, 1]);
});

test('共线点：任意非负容差下都可被移除', () => {
  const pts = P([[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(simplify(pts, 0, []).keptIndices, [0, 3]);
  assert.deepEqual(simplify(pts, 0.5, []).keptIndices, [0, 3]);
});

test('折角：超容差时保留最远点并递归', () => {
  // 经典三角形：点 (1,1) 距底边 1。
  const pts = P([[0, 0], [1, 1], [2, 0]]);
  assert.deepEqual(simplify(pts, 0.5, []).keptIndices, [0, 1, 2]);
  assert.deepEqual(simplify(pts, 1, []).keptIndices, [0, 2]);
});

test('连续重复点不影响，首尾重合不当作多边形', () => {
  // 首尾相同但仍是开放折线：替代线段退化为单点 (0,0)，
  // (2,0) 距该点 2 > 0.1 必然保留；重复的 (1,0) 点不影响结果。
  const pts = P([[0, 0], [1, 0], [1, 0], [2, 0], [0, 0]]);
  const r = simplify(pts, 0.1, []);
  assert.deepEqual(r.keptIndices, [0, 3, 4]);
  // 首尾同坐标时距离退化到单点；(2,0) 到 (0,0) 为 2 > 0.1，应保留
  const pts2 = P([[0, 0], [2, 0], [0, 0]]);
  assert.deepEqual(simplify(pts2, 1, []).keptIndices, [0, 1, 2]);
});

test('等于容差不分裂', () => {
  const pts = P([[0, 0], [1, 1], [2, 0]]);
  const r = simplify(pts, 1, []);
  assert.deepEqual(r.keptIndices, [0, 2]);
  assert.equal(r.steps[0].split, false);
});

test('最远点平局时选原始索引最小者（确定性）', () => {
  // 两个对称高点距底边同为 1，取较小索引 1。
  const pts = P([[0, 0], [1, 1], [2, 1], [3, 0]]);
  const r = simplify(pts, 0.5, []);
  assert.equal(r.steps[0].farthestIndex, 1);
  assert.ok(r.keptIndices.includes(1));
  // 重复调用结果一致
  assert.deepEqual(simplify(pts, 0.5, []).keptIndices, r.keptIndices);
});

test('强制保留点作为分段边界', () => {
  // 高点 (1,5) 相对 (0,0)-(4,0) 距离 5 本来就会保留；
  // 构造一个普通容差下被删、但强制后保留的点。
  const pts = P([[0, 0], [1, 0.4], [2, 0], [3, 0.4], [4, 0]]);
  const plain = simplify(pts, 1, []);
  assert.deepEqual(plain.keptIndices, [0, 4]);
  const forced = simplify(pts, 1, [1]);
  assert.deepEqual(forced.keptIndices, [0, 1, 4]);
  // 重复强制索引按集合去重
  const forced2 = simplify(pts, 1, [1, 1, 4, 0]);
  assert.deepEqual(forced2.keptIndices, [0, 1, 4]);
});

test('输出是原始点的有序子序列且误差声明由独立计算验证', () => {
  const pts = P([
    [0, 0],
    [1, 0.3],
    [2, -0.8],
    [3, 0.2],
    [4, 2],
    [5, 0.1],
    [6, -0.5],
    [7, 0],
  ]);
  const tolerance = 0.6;
  const r = simplify(pts, tolerance, []);
  // 严格递增、首尾在内
  assert.equal(r.keptIndices[0], 0);
  assert.equal(r.keptIndices[r.keptIndices.length - 1], pts.length - 1);
  for (let i = 1; i < r.keptIndices.length; i++) {
    assert.ok(r.keptIndices[i] > r.keptIndices[i - 1]);
  }
  // 独立距离计算核对每个报告区间
  const rebuilt = buildSegments(pts, r.keptIndices);
  assert.equal(rebuilt.length, r.segments.length);
  for (const seg of r.segments) {
    for (let i = seg.startIndex + 1; i < seg.endIndex; i++) {
      const d = distancePointToSegment(pts[i], pts[seg.startIndex], pts[seg.endIndex]);
      assert.ok(d <= tolerance + 1e-12, `点 ${i} 误差 ${d} 超容差`);
    }
    assert.ok(seg.maxDistance <= tolerance + 1e-12);
  }
});

test('空输入、非有限坐标、非法容差被明确拒绝', () => {
  assert.throws(() => validatePoints([]), (e: Error) => e instanceof ApiError && e.message.includes('不能为空'));
  assert.throws(() => validatePoints([{ x: 1, y: NaN }]), ApiError);
  assert.throws(() => validatePoints([{ x: Infinity, y: 0 }]), ApiError);
  assert.throws(() => validatePoints('nope'), ApiError);
  assert.throws(() => validateTolerance(-1), ApiError);
  assert.throws(() => validateTolerance(NaN), ApiError);
});

test('非法强制点索引被拒绝；同坐标不同索引仍是不同顶点', () => {
  const pts = P([[0, 0], [0, 0], [1, 1]]);
  assert.throws(() => validateForcedIndices([3], 3), ApiError);
  assert.throws(() => validateForcedIndices([-1], 3), ApiError);
  assert.throws(() => validateForcedIndices([1.5], 3), ApiError);
  // 索引 0 和 1 坐标相同但不同；分别强制都合法
  assert.deepEqual(validateForcedIndices([0, 1], 3), [0, 1]);
});

test('核验：非算法产生的索引方案也能独立判定', () => {
  const pts = P([[0, 0], [1, 1], [2, 0]]);
  // 仅首尾：点1距线段1，容差0.5 -> 不满足
  const bad = verifyKeptIndices(pts, 0.5, [], [0, 2]);
  assert.equal(bad.valid, false);
  assert.equal(bad.withinTolerance, false);
  assert.equal(bad.globalWorstIndex, 1);
  assert.ok(Math.abs(bad.globalMaxDistance - 1) < 1e-12);
  // 保留全部 -> 满足
  const good = verifyKeptIndices(pts, 0.5, [], [0, 1, 2]);
  assert.equal(good.valid, true);
  // 缺强制点
  const missingForced = verifyKeptIndices(pts, 5, [1], [0, 2]);
  assert.equal(missingForced.forcedKept, false);
  assert.deepEqual(missingForced.missingForcedIndices, [1]);
  // 非严格递增 / 缺首尾
  assert.equal(verifyKeptIndices(pts, 5, [], [0, 0, 2]).strictlyIncreasing, false);
  assert.equal(verifyKeptIndices(pts, 5, [], [1, 2]).endpointsKept, false);
});
