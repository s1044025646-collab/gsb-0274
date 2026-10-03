export interface Point {
  x: number;
  y: number;
}

/**
 * 点到“有限线段” ab 的欧氏距离。
 * 投影参数 t 被截断到 [0,1]：
 *   - t<=0 取端点 a；t>=1 取端点 b；
 *   - a、b 重合时退化为到单点 a 的距离。
 * 同时返回投影参数与投影点，便于误差报告。
 */
export function pointToSegment(
  p: Point,
  a: Point,
  b: Point
): { distance: number; t: number; closest: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  let t: number;
  if (lengthSq === 0) {
    // 两端重合：退化为到单点的距离
    t = 0;
  } else {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const closest: Point = { x: a.x + t * dx, y: a.y + t * dy };
  const ex = p.x - closest.x;
  const ey = p.y - closest.y;
  return { distance: Math.hypot(ex, ey), t, closest };
}

export function euclidean(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
