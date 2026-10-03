import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { AppError } from "./errors.js";
import { simplify, verify } from "./dp.js";
import {
  getPolyline,
  insertPolyline,
  insertSimplification,
  insertVerification,
  listPolylines,
  listSimplifications,
  getSimplification,
  openDatabase,
} from "./db.js";

const DATA_DIR = resolve(process.env.DP_DATA_DIR ?? "data");
const db = openDatabase(resolve(DATA_DIR, "dp.sqlite"));

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  sendJson(res, status, { error: { code, message } });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_POINT", "请求体不是合法 JSON");
  }
}

function requirePolyline(id: number) {
  const poly = getPolyline(db, id);
  if (!poly) {
    throw new AppError("NOT_FOUND", `折线 ${id} 不存在`);
  }
  return poly;
}

async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  try {
    // 健康检查
    if (method === "GET" && path === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // 导入折线 / 列表
    if (path === "/api/polylines" && method === "POST") {
      const body = (await readJson(req)) as {
        points?: unknown;
        name?: unknown;
      };
      const name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : null;
      // validatePoints 在 simplify/verify 中也会再次执行
      const { validatePoints } = await import("./dp.js");
      const points = validatePoints(body.points);
      const record = insertPolyline(db, points, name);
      sendJson(res, 201, record);
      return;
    }
    if (path === "/api/polylines" && method === "GET") {
      sendJson(res, 200, { polylines: listPolylines(db) });
      return;
    }

    const polyMatch = path.match(/^\/api\/polylines\/(\d+)$/);
    if (polyMatch && method === "GET") {
      const poly = requirePolyline(Number(polyMatch[1]));
      sendJson(res, 200, poly);
      return;
    }

    // 简化
    const simplifyMatch = path.match(
      /^\/api\/polylines\/(\d+)\/simplifications$/
    );
    if (simplifyMatch && method === "POST") {
      const poly = requirePolyline(Number(simplifyMatch[1]));
      const body = (await readJson(req)) as {
        tolerance?: unknown;
        forcedIndices?: unknown;
      };
      const result = simplify(
        poly.points,
        body.tolerance as number,
        body.forcedIndices as number[]
      );
      const record = insertSimplification(
        db,
        poly.id,
        result.tolerance,
        result.forcedIndices,
        result
      );
      sendJson(res, 201, record);
      return;
    }
    if (simplifyMatch && method === "GET") {
      const poly = requirePolyline(Number(simplifyMatch[1]));
      sendJson(res, 200, {
        simplifications: listSimplifications(db, poly.id),
      });
      return;
    }

    // 查询某次简化的保留点
    const keptMatch = path.match(
      /^\/api\/simplifications\/(\d+)\/kept-points$/
    );
    if (keptMatch && method === "GET") {
      const record = getSimplification(db, Number(keptMatch[1]));
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      sendJson(res, 200, {
        simplificationId: record.id,
        keptIndices: record.result.keptIndices,
        keptPoints: record.result.keptIndices.map((i) => ({
          index: i,
          point: record.result.simplified[
            record.result.keptIndices.indexOf(i)
          ],
        })),
        tolerance: record.tolerance,
        forcedIndices: record.forced_indices,
      });
      return;
    }

    // 查看分裂步骤
    const stepsMatch = path.match(
      /^\/api\/simplifications\/(\d+)\/steps$/
    );
    if (stepsMatch && method === "GET") {
      const record = getSimplification(db, Number(stepsMatch[1]));
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      sendJson(res, 200, {
        simplificationId: record.id,
        steps: record.result.steps,
        segments: record.result.segments,
      });
      return;
    }

    const simplMatch = path.match(/^\/api\/simplifications\/(\d+)$/);
    if (simplMatch && method === "GET") {
      const record = getSimplification(db, Number(simplMatch[1]));
      if (!record) throw new AppError("NOT_FOUND", "简化结果不存在");
      sendJson(res, 200, record);
      return;
    }

    // 核验
    const verifyMatch = path.match(
      /^\/api\/polylines\/(\d+)\/verify$/
    );
    if (verifyMatch && method === "POST") {
      const poly = requirePolyline(Number(verifyMatch[1]));
      const body = (await readJson(req)) as {
        tolerance?: unknown;
        forcedIndices?: unknown;
        keptIndices?: unknown;
      };
      const report = verify(
        poly.points,
        body.tolerance as number,
        body.keptIndices,
        body.forcedIndices
      );
      const verificationId = insertVerification(
        db,
        poly.id,
        report.tolerance,
        report.forcedIndices,
        report.keptIndices,
        report
      );
      sendJson(res, 200, { verificationId, ...report });
      return;
    }

    sendError(res, 404, "NOT_FOUND", `未匹配的路由：${method} ${path}`);
  } catch (err) {
    if (err instanceof AppError) {
      const status =
        err.code === "NOT_FOUND"
          ? 404
          : err.code === "EMPTY_INPUT"
            ? 400
            : 400;
      sendError(res, status, err.code, err.message);
      return;
    }
    sendError(
      res,
      500,
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : String(err)
    );
  }
}

const server = createServer((req, res) => {
  void handler(req, res);
});

const requestedPort = Number(process.env.PORT ?? "0");
server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address() as AddressInfo;
  console.log(
    JSON.stringify({
      message: "DP 折线简化服务已启动",
      host: "127.0.0.1",
      port: address.port,
      dataDir: DATA_DIR,
    })
  );
});

export { server };
