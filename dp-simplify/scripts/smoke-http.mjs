// 端到端 HTTP 冒烟测试：启动内存服务并依次调用全部 API。
import { rmSync } from 'node:fs';
import { Store } from '../dist/src/store.js';
import { SimplifyService } from '../dist/src/service.js';
import { startHttpServer } from '../dist/src/server.js';

const dbPath = './data/smoke.sqlite';
rmSync(dbPath, { force: true });
const store = new Store(dbPath);
const service = new SimplifyService(store);
const server = await startHttpServer(service, 8731, '127.0.0.1');
const base = 'http://127.0.0.1:8731';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const checks = [];
function check(name, cond, extra = '') {
  checks.push([name, cond, extra]);
  if (!cond) throw new Error(`检查失败: ${name} ${extra}`);
}

const health = await call('GET', '/health');
check('health', health.status === 200 && health.json.ok === true);

const created = await call('POST', '/api/polylines', {
  name: '冒烟折线',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 0 },
    { x: 3, y: 0.5 },
    { x: 4, y: 0 },
  ],
});
check('import', created.status === 201 && created.json.pointCount === 5);
const pid = created.json.id;

const empty = await call('POST', '/api/polylines', { name: 'x', points: [] });
check('empty rejected', empty.status === 400 && empty.json.error.code === 'EMPTY_POINTS');

const badCoord = await call('POST', '/api/polylines', {
  name: 'x',
  points: [{ x: 1, y: NaN }],
});
check('NaN rejected', badCoord.status === 400 && badCoord.json.error.code === 'INVALID_COORDINATE');

const badForced = await call('POST', `/api/polylines/${pid}/simplify`, {
  tolerance: 1,
  forcedIndices: [99],
});
check('bad forced rejected', badForced.status === 400 && badForced.json.error.code === 'INVALID_FORCED_INDEX');

const simplified = await call('POST', `/api/polylines/${pid}/simplify`, { tolerance: 1 });
check('simplify', simplified.status === 201, JSON.stringify(simplified.json.keptIndices));
const vid = simplified.json.keptIndices.includes(1) ? simplified.json.versionId : -1;
check('kept apex at tolerance 1', simplified.json.keptIndices.includes(1));

const kept = await call('GET', `/api/versions/${vid}/kept`);
check('kept query', kept.json.keptIndices.length === simplified.json.keptIndices.length);

const steps = await call('GET', `/api/versions/${vid}/steps`);
check('steps query', Array.isArray(steps.json.steps) && steps.json.steps.length > 0);

const verifyBad = await call('POST', `/api/versions/${vid}/verify`, { keptIndices: [0, 4] });
check(
  'verify external invalid scheme',
  verifyBad.json.valid === false && verifyBad.json.withinTolerance === false,
);

const verifyGood = await call('POST', `/api/versions/${vid}/verify`, {
  keptIndices: simplified.json.keptIndices,
});
check('verify algorithm scheme', verifyGood.json.valid === true);

const second = await call('POST', `/api/polylines/${pid}/simplify`, {
  tolerance: 3,
  forcedIndices: [2],
});
check('new version for new params', second.json.versionId !== vid);

const versions = await call('GET', `/api/polylines/${pid}/versions`);
check('versions listed', versions.json.versions.length === 2);

const exported = await call('GET', `/api/versions/${vid}/export`);
check(
  'export',
  exported.json.polyline.points.length === 5 &&
    Array.isArray(exported.json.version.keptIndices),
);

const missing = await call('GET', '/api/polylines/9999');
check('404 polyline', missing.status === 404 && missing.json.error.code === 'POLYLINE_NOT_FOUND');

server.close();
store.close();

for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`\n${checks.filter(([, ok]) => ok).length}/${checks.length} 项 HTTP 冒烟检查通过`);
