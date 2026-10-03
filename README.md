# 离线平面折线 Douglas–Peucker 简化与误差核验后端

纯后端服务（HTTP API + CLI），对**开放平面折线**做 Douglas–Peucker（DP）顶点简化，
并提供基于原始数据的**独立误差核验**。使用 TypeScript + Node.js（内置 `node:sqlite`），
无任何网络/地图/外部服务依赖，在 Windows 本地直接运行，不需要 Docker 或 WSL。

## 适用范围与明确不做的事

- 只处理**普通平面坐标**（x、y 使用同一长度单位），不做经纬度、投影换算或地图下载。
- 只处理**开放折线**：即使首尾坐标相同，也**不**自动当成闭合多边形处理。
- 输入保持原有顺序与重复点，导入时**不做任何悄悄去重**；同坐标不同索引仍是不同顶点。
- 不做道路路径规划、多边形拓扑简化、自交消除。
- **不保证**最少顶点的全局最优解、不保证无自交、不保证拓扑保持、
  不给出连续曲线的双向 Hausdorff 界。
- 报告的唯一几何保证：**每个被替代区间内的原始采样点**到对应替代**有限线段**
  的欧氏距离不超过容差。

## 算法规则（确定性）

1. 折线首尾始终保留；用户指定的强制保留索引与首尾共同构成分段边界。
2. 对每个区间，以两端点建立**有限**替代线段，计算各中间点到该线段的欧氏距离，
   取最大者：
   - 投影参数 `t = ((p-a)·(b-a)) / |b-a|²` 被**截断到 [0,1]**，
     即最近点不会落到端点之外（不是到无限延长直线的距离）；
   - 两端重合（`a=b`）时退化为到单点 `a` 的距离。
3. 最大距离 **严格大于** 容差才分裂；**恰好等于容差时不分裂**。
4. 多个点同距时，选**原始索引最小**者；实现为显式栈迭代，结果与运行次数无关。
5. 各分段独立简化后按原始顺序合并。
6. 强制索引规则：必须是 `[0, n-1]` 内整数，否则拒绝；**重复指定按索引去重**。

## 容差与误差定义

- `tolerance` 为非负数值，单位与 x、y 坐标的长度单位完全相同。
- 一个替代区间 `[i..j]` 的**最大误差** =
   `max over k in [i,j]  distance(P[k], segment(P[i], P[j]))`，
   距离定义同上（有限线段、端点截断、重合退化点距）。
- 核验接口从原始坐标**重新独立计算**该最大误差及达到位置（平局取最小索引），
  不依赖简化时保存的数值；任何保留索引方案都可以核验，不要求由本算法产生。

## 环境要求

- Node.js >= 22.5（开发验证版本：Node v25.5.0）。使用内置的
  `node:sqlite` 与 `node:test`，无需编译原生模块。

## 构建、测试、启动、演示

```powershell
npm install        # 仅安装 typescript / @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部自动化测试（node:test）
npm start          # 启动 HTTP 服务（默认 127.0.0.1，自动选择空闲端口）
npm run demo       # 运行内置演示：普通简化 vs 强制保留转折点
```

启动后第一行输出 JSON，其中 `port` 为实际监听端口，例如：

```json
{"message":"DP 折线简化服务已启动","host":"127.0.0.1","port":57520,"dataDir":"E:\\...\\data"}
```

环境变量：

- `PORT`：指定端口；默认 `0`，由操作系统分配空闲端口。
- `DP_DATA_DIR`：SQLite 数据目录，默认项目内 `./data`（自动创建）。

## CLI

```powershell
node dist/src/cli.js import samples/demo-points.json --name demo
node dist/src/cli.js list
node dist/src/cli.js simplify 1 --tolerance 2
node dist/src/cli.js simplify 1 --tolerance 2 --forced 5
node dist/src/cli.js results 1
node dist/src/cli.js kept 2
node dist/src/cli.js steps 2
node dist/src/cli.js verify 1 --tolerance 2 --kept 0,4,5,9 --forced 5
node dist/src/cli.js export 2 result.json
```

## HTTP API

所有请求/响应均为 JSON。错误响应统一形如
`{"error":{"code":"...","message":"..."}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/health` | 健康检查 |
| POST | `/api/polylines` | 导入折线 `{name?, points:[{x,y},...]}` |
| GET  | `/api/polylines` | 列出折线 |
| GET  | `/api/polylines/:id` | 查看原始折线 |
| POST | `/api/polylines/:id/simplifications` | 简化 `{tolerance, forcedIndices?}` |
| GET  | `/api/polylines/:id/simplifications` | 该折线的历史简化记录 |
| GET  | `/api/simplifications/:id` | 完整简化结果 |
| GET  | `/api/simplifications/:id/kept-points` | 保留点原始索引与坐标 |
| GET  | `/api/simplifications/:id/steps` | 分裂步骤与每段替代关系 |
| POST | `/api/polylines/:id/verify` | 核验 `{tolerance, keptIndices, forcedIndices?}` |

### 请求示例（PowerShell）

```powershell
$base = "http://127.0.0.1:<port>"
Invoke-RestMethod "$base/api/polylines" -Method Post -ContentType "application/json" `
  -Body '{"points":[{"x":0,"y":0},{"x":1,"y":3},{"x":2,"y":0}]}'
Invoke-RestMethod "$base/api/polylines/1/simplifications" -Method Post `
  -ContentType "application/json" -Body '{"tolerance":0.5}'
Invoke-RestMethod "$base/api/polylines/1/verify" -Method Post `
  -ContentType "application/json" -Body '{"tolerance":0.5,"keptIndices":[0,2]}'
```

### 核验响应要点

- `valid`：是否全部约束通过。
- `segments[]`：每段 `fromIndex/toIndex`、独立重算的 `maxError`、
  达到位置 `maxErrorIndex`、`withinTolerance`。
- `issues[]`：约束冲突明细。

## 错误码

| code | 含义 | HTTP |
| --- | --- | --- |
| `EMPTY_INPUT` | 折线为空 | 400 |
| `INVALID_COORDINATE` | 点格式错误或坐标非有限值（NaN/Infinity） | 400 |
| `INVALID_POINT` | points 不是数组 / 请求体不是 JSON | 400 |
| `INVALID_TOLERANCE` | 容差不是非负有限数值 | 400 |
| `INVALID_FORCED_INDEX` | 强制索引越界、非整数或格式错误 | 400 |
| `INVALID_KEEP_INDEX` | keptIndices 不是数组 | 400 |
| `NOT_FOUND` | 折线或简化结果不存在 / 路由不存在 | 404 |

核验中保留索引越界、非递增等问题不作为请求错误，而在 `issues[]` 中报告
（`INDEX_OUT_OF_RANGE`、`NOT_STRICTLY_INCREASING`、`MISSING_FIRST_OR_LAST`、
`MISSING_FORCED_INDEX`、`TOLERANCE_EXCEEDED`），以便一次给出全部问题。

## 持久化

SQLite 文件位于 `$DP_DATA_DIR/dp.sqlite`（默认 `./data/dp.sqlite`），包含：

- `polylines`：原始折线版本（原始点序与重复点原样保存）；
- `simplifications`：容差、强制点、算法版本（`dp-1.0.0`）、完整报告；
- `verifications`：核验参数、给定索引与核验报告。

改变参数会产生**新记录**而不覆盖旧记录；重启后可用 `results` / `kept` /
`steps` / `export` 复查历史结果。

## 自动化测试覆盖

`test/dp.test.ts` 与 `test/db.test.ts` 覆盖：单点、两点、共线、折角、
连续重复点、首尾重合（开放折线）、投影落在端点外、等于容差不分裂、
最远点平局取最小索引、强制保留分段、独立误差核验、非本算法方案核验、
空输入/非有限坐标/非法强制点拒绝，以及 SQLite 写入后“重启”复查。
另含手算垂足距离数值核对与“输出必为原始点有序子序列”检查。

## 限制

- 误差保证只针对**已采样的原始顶点**，不外推到顶点之间的连续曲线。
- 不保证顶点数全局最少；不同强制点集合会得到不同但各自满足容差的方案。
- 简化结果可能产生自交，本服务不检测也不处理拓扑关系。
- 服务仅监听 `127.0.0.1`，定位为本地离线工具，不含鉴权。
