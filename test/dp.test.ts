import { test } from "node:test";
import assert from "node:assert/strict";
import { pointToSegment } from "../src/geometry.js";
import {
  simplify,
  verify,
  validatePoints,
  validateTolerance,
  validateForcedIndices,
} from "../src/dp.js";
import { AppError } from "../src/errors.js";
import { Point } from "../src/geometry.js";

function expectError(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (err: unknown) => err instanceof AppError && err.code === code
  );
}

test("只有一个点：直接保留，无替代段", () => {
  const r = simplify([{ x: 1, y: 2 }], 5);
  assert.deepEqual(r.keptIndices, [0]);
  assert.deepEqual(r.simplified, [{ x: 1, y: 2 }]);
  assert.deepEqual(r.segments, []);
});

test("两个点：无论容差都保留首尾", () => {
  const r = simplify([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0);
  assert.deepEqual(r.keptIndices, [0, 1]);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0]!.maxError, 0);
});

test("共线点：容差 0 也全部可被首尾线段替代", () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ];
  const r = simplify(pts, 0);
  assert.deepEqual(r.keptIndices, [0, 3]);
  assert.equal(r.segments[0]!.maxError, 0);
});

test("折角：超出容差的转折点被保留（手算）", () => {
  // (0,0)-(1,1)-(2,0)：中点到首尾线段 y=0 的距离恰为 1
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ];
  const keptAtTol0 = simplify(pts, 0);
  assert.deepEqual(keptAtTol0.keptIndices, [0, 1, 2]);

  const keptAtTol1 = simplify(pts, 1);
  // 恰好等于容差 -> 不分裂
  assert.deepEqual(keptAtTol1.keptIndices, [0, 2]);

  const keptAtTolHalf = simplify(pts, 0.5);
  assert.deepEqual(keptAtTolHalf.keptIndices, [0, 1, 2]);
});

test("连续重复点：导入时不去重，重复点不影响分裂", () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  const r = simplify(pts, 0);
  assert.deepEqual(r.keptIndices, [0, 3]);
  // 同坐标不同索引仍是不同顶点：强制保留重复点索引 1
  const forced = simplify(pts, 0, [1]);
  assert.deepEqual(forced.keptIndices, [0, 1, 3]);
});

test("首尾重合：开放折线处理，不当作闭合多边形", () => {
  // 首=尾=(0,0)，中间点 (1,0)；替代线段退化为单点，距离为 1
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  const r = simplify(pts, 0.5);
  assert.deepEqual(r.keptIndices, [0, 1, 2]);
  // 端点重合时距离即到单点距离
  const d = pointToSegment({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(d.distance, 1);
  assert.equal(d.t, 0);

  const collapsed = simplify(pts, 1);
  assert.deepEqual(collapsed.keptIndices, [0, 2]);
});

test("最近投影落在端点外：使用有限线段而非无限延长直线", () => {
  // 线段 (0,0)-(1,0)，点 (5,1)：无限直线距离为 1，
  // 但投影 t=5 被截断为 1，到有限线段距离为 hypot(4,1)
  const d = pointToSegment({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.equal(d.t, 1);
  assert.ok(Math.abs(d.distance - Math.hypot(4, 1)) < 1e-12);

  // 折线：(0,0),(1,0),(2,1)。首尾线段方向 (2,1)，
  // 索引1(1,0) 投影 t = 2/5 = 0.4（落在线内），
  // 垂足 (0.8,0.4)，手算距离 = sqrt(0.2) ≈ 0.4472...
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 1 },
  ];
  const dInner = pointToSegment(
    { x: 1, y: 0 },
    { x: 0, y: 0 },
    { x: 2, y: 1 }
  );
  assert.ok(Math.abs(dInner.distance - Math.sqrt(0.2)) < 1e-12);

  const r = simplify(pts, 0.4);
  assert.deepEqual(r.keptIndices, [0, 1, 2]);
  const r2 = simplify(pts, 0.5);
  assert.deepEqual(r2.keptIndices, [0, 2]);
});

test("最远点平局：选原始索引最小者，结果确定", () => {
  // 对称折线：(0,0),(1,1),(2,0),(3,1),(4,0)
  // 首尾连线 y=0，索引 1 和 3 距离均为 1，平局选 1
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
    { x: 3, y: 1 },
    { x: 4, y: 0 },
  ];
  const r1 = simplify(pts, 0.5);
  const r2 = simplify(pts, 0.5);
  assert.ok(r1.keptIndices.includes(1));
  assert.ok(!r1.keptIndices.includes(3) || r1.keptIndices.indexOf(1) < r1.keptIndices.indexOf(3));
  assert.deepEqual(r1.keptIndices, r2.keptIndices);
  // 分裂步骤记录中第一次分裂选中索引 1
  const firstSplit = r1.steps.find((s) => s.split)!;
  assert.equal(firstSplit.farthestIndex, 1);
});

test("强制保留点：与首尾共同分段，分别简化后合并", () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 5 },
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 5, y: 0 },
  ];
  const plain = simplify(pts, 0.6);
  const forced = simplify(pts, 0.6, [2, 4]);
  for (const f of [2, 4]) assert.ok(forced.keptIndices.includes(f));
  // 强制方案一定包含普通方案的边界吗？不要求；但强制点必须出现
  assert.ok(plain.keptIndices.length <= forced.keptIndices.length);
});

test("强制索引重复指定按规则去重", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ];
  const r = simplify(pts, 0, [1, 1, 1]);
  assert.deepEqual(r.forcedIndices, [1]);
  assert.deepEqual(r.keptIndices, [0, 1, 2]);
});

test("输出是原始点的有序子序列", () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 0 },
    { x: 3, y: -3 },
    { x: 4, y: 0 },
  ];
  const r = simplify(pts, 0.5);
  for (let i = 1; i < r.keptIndices.length; i++) {
    assert.ok(r.keptIndices[i]! > r.keptIndices[i - 1]!);
  }
  r.keptIndices.forEach((idx, k) => {
    assert.deepEqual(r.simplified[k], pts[idx]);
  });
  // 首尾始终保留
  assert.equal(r.keptIndices[0], 0);
  assert.equal(r.keptIndices.at(-1), pts.length - 1);
});

test("独立距离计算验证误差声明：所有替代段 maxError <= tolerance", () => {
  const pts: Point[] = [];
  for (let i = 0; i <= 20; i++) {
    pts.push({ x: i, y: Math.sin(i / 2) * 2 });
  }
  const tolerance = 0.7;
  const r = simplify(pts, tolerance);
  for (const seg of r.segments) {
    assert.ok(
      seg.maxError <= tolerance + 1e-9,
      `段 ${seg.fromIndex}-${seg.toIndex} 误差 ${seg.maxError} 超容差`
    );
    // 独立重算，不依赖 simplify 的记录
    const rep = verify(pts, tolerance, r.keptIndices);
    assert.equal(rep.valid, true);
  }
  const rep = verify(pts, tolerance, r.keptIndices);
  assert.equal(rep.valid, true);
});

test("verify 可核验非本算法产生的索引方案", () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 5 },
    { x: 2, y: 0 },
  ];
  const bad = verify(pts, 1, [0, 2]);
  assert.equal(bad.valid, false);
  assert.ok(bad.issues.some((i) => i.code === "TOLERANCE_EXCEEDED"));

  const good = verify(pts, 5, [0, 2]);
  assert.equal(good.valid, true);

  const missingForced = verify(pts, 5, [0, 2], [1]);
  assert.equal(missingForced.valid, false);
  assert.ok(missingForced.issues.some((i) => i.code === "MISSING_FORCED_INDEX"));

  const notIncreasing = verify(pts, 5, [0, 1, 1, 2]);
  assert.equal(notIncreasing.valid, false);
  assert.ok(
    notIncreasing.issues.some((i) => i.code === "NOT_STRICTLY_INCREASING")
  );

  const missingEnds = verify(pts, 5, [1]);
  assert.ok(missingEnds.issues.some((i) => i.code === "MISSING_FIRST_OR_LAST"));

  const outOfRange = verify(pts, 5, [0, 99]);
  assert.ok(outOfRange.issues.some((i) => i.code === "INDEX_OUT_OF_RANGE"));
});

test("明确拒绝：空输入", () => {
  expectError(() => validatePoints([]), "EMPTY_INPUT");
});

test("明确拒绝：非有限坐标（NaN/Infinity/非数字）", () => {
  expectError(() => validatePoints([{ x: NaN, y: 0 }]), "INVALID_COORDINATE");
  expectError(
    () => validatePoints([{ x: Infinity, y: 0 }]),
    "INVALID_COORDINATE"
  );
  expectError(
    () => validatePoints([{ x: 1, y: "0" }]),
    "INVALID_COORDINATE"
  );
  expectError(() => validatePoints([null]), "INVALID_COORDINATE");
});

test("明确拒绝：非法容差", () => {
  expectError(() => validateTolerance(-1), "INVALID_TOLERANCE");
  expectError(() => validateTolerance(NaN), "INVALID_TOLERANCE");
  expectError(() => validateTolerance(Infinity), "INVALID_TOLERANCE");
});

test("明确拒绝：非法强制点", () => {
  expectError(() => validateForcedIndices([-1], 3), "INVALID_FORCED_INDEX");
  expectError(() => validateForcedIndices([3], 3), "INVALID_FORCED_INDEX");
  expectError(() => validateForcedIndices([1.5], 3), "INVALID_FORCED_INDEX");
  expectError(() => validateForcedIndices(["1"], 3), "INVALID_FORCED_INDEX");
});

test("手算例子：垂足距离数值核对", () => {
  // 点 (0,1) 到线段 (-1,0)-(1,0)：垂足 (0,0)，距离 1，t=0.5
  const d = pointToSegment({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 });
  assert.equal(d.distance, 1);
  assert.equal(d.t, 0.5);
  assert.deepEqual(d.closest, { x: 0, y: 0 });

  // 点 (-5,1) 投影到线段外：t=0，距离到 (-1,0) = hypot(4,1)
  const d2 = pointToSegment({ x: -5, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 });
  assert.equal(d2.t, 0);
  assert.ok(Math.abs(d2.distance - Math.hypot(4, 1)) < 1e-12);
});
