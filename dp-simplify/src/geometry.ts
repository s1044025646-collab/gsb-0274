export interface Point {
  x: number;
  y: number;
}

/**
 * 点 P 到有限线段 AB 的最短欧氏距离。
 * - 投影参数 t 被截断到 [0, 1]，即端点外的点按到端点的距离计算，
 *   不使用到无限延长直线的距离。
 * - A、B 重合时退化为到单点 A 的距离。
 */
export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const ex = p.x - projX;
  const ey = p.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
