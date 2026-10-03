import { Point } from './geometry.js';
import { simplify } from './dp.js';
import { distancePointToSegment } from './geometry.js';

/**
 * 内置演示：同一条折线，分别用普通简化与“强制保留转折点”简化，
 * 展示二者差异。仅打印结果，不写数据库。
 */
export function runDemo(): void {
  // 点 2 是高约 1.2 的小凸起（业务转折点），点 4 是高 3 的大折角。
  // 容差 1.5 下：普通 DP 会移除点 2（其误差未超容差）；
  // 强制保留点 2 后，它作为分段边界被保留。点 4 在两种情况下都保留。
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0.6 },
    { x: 2, y: 1.2 },
    { x: 3, y: 0.6 },
    { x: 4, y: 3 },
    { x: 5, y: 0.4 },
    { x: 6, y: 0.2 },
    { x: 7, y: 0 },
  ];
  const tolerance = 1.5;

  const plain = simplify(points, tolerance, []);
  const forced = simplify(points, tolerance, [2]);

  const line = (indices: number[]) =>
    indices.map((i) => `(${points[i].x},${points[i].y})@${i}`).join(' -> ');

  process.stdout.write('=== Douglas–Peucker 折线简化演示 ===\n');
  process.stdout.write(`原始顶点数: ${points.length}，容差: ${tolerance}\n\n`);

  process.stdout.write('[普通简化]\n');
  process.stdout.write(`保留索引: [${plain.keptIndices.join(', ')}]\n`);
  process.stdout.write(`简化折线: ${line(plain.keptIndices)}\n\n`);

  process.stdout.write('[强制保留索引 2（小凸起，业务转折点）]\n');
  process.stdout.write(`保留索引: [${forced.keptIndices.join(', ')}]\n`);
  process.stdout.write(`简化折线: ${line(forced.keptIndices)}\n\n`);

  // 独立复核：每个被替代区间误差均不超过容差。
  for (const [label, result] of [
    ['普通', plain],
    ['强制', forced],
  ] as const) {
    for (const seg of result.segments) {
      for (const i of seg.replacedIndices) {
        const independent = distancePointToSegment(
          points[i],
          points[seg.startIndex],
          points[seg.endIndex],
        );
        if (independent > tolerance + 1e-12) {
          throw new Error(
            `${label}简化区间 [${seg.startIndex}, ${seg.endIndex}] 点 ${i} 误差 ${independent} 超容差`,
          );
        }
      }
    }
    process.stdout.write(`[核验] ${label}简化：全部区间误差 <= ${tolerance}，通过。\n`);
  }
}
