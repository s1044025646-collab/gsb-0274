#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Store } from './store.js';
import { SimplifyService } from './service.js';
import { startHttpServer, pickFreePort } from './server.js';
import { runDemo } from './demo.js';
import { ApiError } from './errors.js';

interface Args {
  command: string;
  opts: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [command = '', ...rest] = argv;
  const opts = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts.set(key, 'true');
      } else {
        opts.set(key, next);
        i++;
      }
    }
  }
  return { command, opts };
}

function readJsonOption(opts: Map<string, string>, key: string, fileKey: string): unknown {
  const file = opts.get(fileKey);
  if (file !== undefined) {
    return JSON.parse(readFileSync(resolve(file), 'utf-8'));
  }
  const inline = opts.get(key);
  if (inline === undefined) return undefined;
  return JSON.parse(inline);
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

const USAGE = `用法: dp-simplify <命令> [选项]

命令:
  serve      启动 HTTP API 服务 (--port, --host, --db)
  import     导入折线 (--name, --points 或 --points-file)
  simplify   简化折线 (--polyline, --tolerance, --forced 或 --forced-file)
  kept       查询保留点 (--version)
  steps      查看分裂步骤 (--version)
  verify     核验保留索引 (--version, --kept 或 --kept-file)
  export     导出 JSON (--version)
  demo       运行内置演示（普通简化 vs 强制保留转折点）

通用:
  --db PATH  SQLite 路径 (默认 ./data/dp.sqlite)
`;

async function main(): Promise<void> {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const dbPath = resolve(opts.get('db') ?? 'data/dp.sqlite');

  if (command === 'demo') {
    runDemo();
    return;
  }

  if (command === 'serve') {
    const host = opts.get('host') ?? '127.0.0.1';
    const requestedPort = opts.get('port');
    const port = requestedPort ? Number(requestedPort) : await pickFreePort(host);
    const store = new Store(dbPath);
    const service = new SimplifyService(store);
    await startHttpServer(service, port, host);
    process.stdout.write(
      `HTTP API 已启动: http://${host}:${port}  (数据文件: ${dbPath})\n`,
    );
    return;
  }

  if (!['import', 'simplify', 'kept', 'steps', 'verify', 'export'].includes(command)) {
    process.stdout.write(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }

  const store = new Store(dbPath);
  const service = new SimplifyService(store);
  try {
    switch (command) {
      case 'import': {
        print(
          service.importPolyline(
            opts.get('name'),
            readJsonOption(opts, 'points', 'points-file'),
          ),
        );
        break;
      }
      case 'simplify': {
        print(
          service.simplify(
            Number(opts.get('polyline')),
            opts.has('tolerance') ? JSON.parse(opts.get('tolerance')!) : undefined,
            readJsonOption(opts, 'forced', 'forced-file'),
          ),
        );
        break;
      }
      case 'kept':
        print(service.queryKept(Number(opts.get('version'))));
        break;
      case 'steps':
        print(service.getSteps(Number(opts.get('version'))));
        break;
      case 'verify':
        print(
          service.verify(
            Number(opts.get('version')),
            readJsonOption(opts, 'kept', 'kept-file'),
          ),
        );
        break;
      case 'export':
        print(service.exportJson(Number(opts.get('version'))));
        break;
    }
  } finally {
    store.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ApiError) {
    process.stderr.write(
      JSON.stringify({ error: { code: err.errCode, message: err.message } }, null, 2) + '\n',
    );
    process.exitCode = 1;
  } else {
    process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + '\n');
    process.exitCode = 1;
  }
});
