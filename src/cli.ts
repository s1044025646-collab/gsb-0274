#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";
import { simplify, verify } from "./dp.js";
import { Point } from "./geometry.js";
import {
  getPolyline,
  getSimplification,
  insertPolyline,
  insertSimplification,
  insertVerification,
  listPolylines,
  listSimplifications,
  openDatabase,
} from "./db.js";

const DATA_DIR = resolve(process.env.DP_DATA_DIR ?? "data");
const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function parsePointsFile(path: string): Point[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new AppError("INVALID_POINT", "点文件内容必须是 [{x,y}, ...] 数组");
  }
  return raw as Point[];
}

function parseIntList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function getDemoPolyline(): Point[] {
  // 一条带明显转折与冗余采样点的折线，转折点在索引 5
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0.1 },
    { x: 2, y: -0.1 },
    { x: 3, y: 0.05 },
    { x: 4, y: -0.05 },
    { x: 5, y: 3 },
    { x: 6, y: 3.1 },
    { x: 7, y: 2.9 },
    { x: 8, y: 3.05 },
    { x: 9, y: 3 },
  ];
}

function runDemo(): void {
  const points = getDemoPolyline();
  const tolerance = 2;
  console.log("=== Douglas-Peucker 折线简化演示 ===");
  console.log(`原始点数: ${points.length}，容差: ${tolerance}（与坐标同一长度单位）`);

  const plain = simplify(points, tolerance);
  console.log("\n[普通简化] 保留索引:", plain.keptIndices, "（转折点索引 5 到首尾连线距离约 1.2 <= 容差，被删除）");
  console.log("每段替代关系:");
  for (const seg of plain.segments) {
    console.log(
      `  线段(${seg.fromIndex}->${seg.toIndex}) 替代区间[${seg.fromIndex}..${seg.toIndex}]，最大误差=${seg.maxError.toFixed(4)} @索引${seg.maxErrorIndex}`
    );
  }

  const forced = simplify(points, tolerance, [5]);
  console.log("\n[强制保留转折点索引 5] 保留索引:", forced.keptIndices);
  console.log("差别：强制点必为分段边界，即使全局距离未超容差也保留，两侧区间分别核验。");
  for (const seg of forced.segments) {
    console.log(
      `  线段(${seg.fromIndex}->${seg.toIndex}) 替代区间[${seg.fromIndex}..${seg.toIndex}]，最大误差=${seg.maxError.toFixed(4)} @索引${seg.maxErrorIndex}`
    );
  }

  const report = verify(points, tolerance, plain.keptIndices);
  console.log("\n[独立核验普通简化结果] valid =", report.valid);

  const tampered = verify(points, 1, [0, points.length - 1]);
  console.log(
    `[容差 1 时仅保留首尾的方案] valid = ${tampered.valid}（区间最大误差约 1.31 > 1）`
  );
  for (const issue of tampered.issues) console.log("  -", issue.message);
}

const HELP = `
DP 折线简化 CLI

  demo                                  运行内置演示（不写数据库）
  serve                                 启动 HTTP 服务（默认空闲端口）
  import <points.json> [--name 名称]    导入折线 [{x,y}, ...]
  list                                  列出已导入折线
  simplify <折线id> --tolerance 1 [--forced 2,5]
                                        执行 Douglas-Peucker 简化
  results <折线id>                      列出该折线的历史简化记录
  kept <简化id>                         查询保留点的原始索引与坐标
  steps <简化id>                        查看分裂步骤与每段替代关系
  verify <折线id> --tolerance 1 --kept 0,3,9 [--forced 3]
                                        独立核验给定保留索引
  export <简化id> [out.json]            导出完整 JSON 结果

环境变量:
  PORT         HTTP 端口，默认 0 表示由系统选择空闲端口
  DP_DATA_DIR  数据目录，默认 ./data
`;

function main(): void {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (command === "demo") {
    runDemo();
    return;
  }
  if (command === "serve") {
    const child = spawn(process.execPath, [resolve(__dirname, "server.js")], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  const db = openDatabase(resolve(DATA_DIR, "dp.sqlite"));

  switch (command) {
    case "import": {
      const file = positional[0] ?? flags.get("file");
      if (!file) {
        throw new AppError("INVALID_POINT", "用法: cli import <points.json> [--name 名称]");
      }
      const points = parsePointsFile(file);
      const record = insertPolyline(db, points, flags.get("name") ?? null);
      printJson({ id: record.id, point_count: record.point_count });
      break;
    }
    case "list": {
      printJson(listPolylines(db));
      break;
    }
    case "simplify": {
      const id = Number(positional[0] ?? flags.get("id"));
      const tolerance = Number(flags.get("tolerance") ?? "0");
      const forced = parseIntList(flags.get("forced"));
      const poly = getPolyline(db, id);
      if (!poly) throw new AppError("NOT_FOUND", `折线 ${id} 不存在`);
      const result = simplify(poly.points, tolerance, forced);
      const record = insertSimplification(
        db,
        poly.id,
        result.tolerance,
        result.forcedIndices,
        result
      );
      printJson({
        simplificationId: record.id,
        keptIndices: record.result.keptIndices,
        simplified: record.result.simplified,
        segments: record.result.segments,
      });
      break;
    }
    case "kept": {
      const sid = Number(positional[0]);
      const record = getSimplification(db, sid);
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      printJson({
        keptIndices: record.result.keptIndices,
        keptPoints: record.result.keptIndices.map((i, k) => ({
          index: i,
          point: record.result.simplified[k],
        })),
      });
      break;
    }
    case "steps": {
      const sid = Number(positional[0]);
      const record = getSimplification(db, sid);
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      printJson({
        steps: record.result.steps,
        segments: record.result.segments,
      });
      break;
    }
    case "results": {
      const id = Number(positional[0]);
      printJson(listSimplifications(db, id));
      break;
    }
    case "verify": {
      const id = Number(positional[0] ?? flags.get("id"));
      const tolerance = Number(flags.get("tolerance") ?? "0");
      const forced = parseIntList(flags.get("forced"));
      const kept = parseIntList(flags.get("kept") ?? "");
      const poly = getPolyline(db, id);
      if (!poly) throw new AppError("NOT_FOUND", `折线 ${id} 不存在`);
      const report = verify(poly.points, tolerance, kept, forced);
      const verificationId = insertVerification(
        db,
        poly.id,
        report.tolerance,
        report.forcedIndices,
        report.keptIndices,
        report
      );
      printJson({ verificationId, ...report });
      break;
    }
    case "export": {
      const sid = Number(positional[0]);
      const out =
        positional[1] ?? flags.get("out") ?? `simplification-${sid}.json`;
      const record = getSimplification(db, sid);
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      writeFileSync(resolve(out), JSON.stringify(record, null, 2), "utf-8");
      console.log(`已导出到 ${resolve(out)}`);
      break;
    }
    default:
      console.log(HELP);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof AppError) {
    console.error(
      JSON.stringify({ error: { code: err.code, message: err.message } }, null, 2)
    );
    process.exit(1);
  }
  throw err;
}
