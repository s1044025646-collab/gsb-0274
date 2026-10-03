import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as netCreateServer } from 'node:net';
import { SimplifyService } from './service.js';
import { ApiError, errorStatusCode } from './errors.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError('INVALID_JSON', '请求体不是合法 JSON');
  }
}

/** 请求 0 端口让操作系统分配空闲端口，返回实际端口。 */
export function pickFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = netCreateServer();
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', reject);
  });
}

export function startHttpServer(service: SimplifyService, port: number, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && path === '/api/polylines') {
        sendJson(res, 200, { polylines: service.listPolylines() });
        return;
      }

      if (method === 'POST' && path === '/api/polylines') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = service.importPolyline(body.name, body.points);
        sendJson(res, 201, result);
        return;
      }

      const polylineMatch = path.match(/^\/api\/polylines\/(\d+)$/);
      if (method === 'GET' && polylineMatch) {
        sendJson(res, 200, service.getPolylineOrThrow(Number(polylineMatch![1])));
        return;
      }

      const simplifyMatch = path.match(/^\/api\/polylines\/(\d+)\/simplify$/);
      if (method === 'POST' && simplifyMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        sendJson(
          res,
          201,
          service.simplify(
            Number(simplifyMatch![1]),
            body.tolerance,
            body.forcedIndices,
          ),
        );
        return;
      }

      const versionsMatch = path.match(/^\/api\/polylines\/(\d+)\/versions$/);
      if (method === 'GET' && versionsMatch) {
        const polylineId = Number(versionsMatch![1]);
        sendJson(res, 200, { versions: service.listVersions(polylineId) });
        return;
      }

      const keptMatch = path.match(/^\/api\/versions\/(\d+)\/kept$/);
      if (method === 'GET' && keptMatch) {
        sendJson(res, 200, service.queryKept(Number(keptMatch![1])));
        return;
      }

      const stepsMatch = path.match(/^\/api\/versions\/(\d+)\/steps$/);
      if (method === 'GET' && stepsMatch) {
        sendJson(res, 200, service.getSteps(Number(stepsMatch![1])));
        return;
      }

      const verifyMatch = path.match(/^\/api\/versions\/(\d+)\/verify$/);
      if (method === 'POST' && verifyMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        sendJson(res, 200, service.verify(Number(verifyMatch![1]), body.keptIndices));
        return;
      }

      const exportMatch = path.match(/^\/api\/versions\/(\d+)\/export$/);
      if (method === 'GET' && exportMatch) {
        sendJson(res, 200, service.exportJson(Number(exportMatch![1])));
        return;
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '未知的 API 路径' } });
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, errorStatusCode(err.errCode), {
          error: { code: err.errCode, message: err.message, details: err.details ?? null },
        });
      } else {
        sendJson(res, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  });

  return new Promise<void>((resolvePort) => {
    server.listen(port, host, () => resolvePort());
  }).then(() => server);
}
