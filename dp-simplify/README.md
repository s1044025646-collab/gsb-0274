# dp-simplify — 离线平面折线 Douglas–Peucker 简化与误差核验后端

纯本地运行的折线简化服务（只有 API 与 CLI，无前端）。使用 TypeScript + Node.js +
内置 `node:sqlite`，无需 Docker、WSL、付费服务或任何在线 API。

## 适用范围与术语

- 输入是**有序二维坐标**的**开放折线**，所有坐标使用同一平面长度单位
  （普通平面直角坐标）。
- **不做**经纬度/大地测量、投影、地图下载、道路路径规划或多边形拓扑简化。
- 即使首尾坐标相同，也按开放折线处理，**不会**自动当成闭合多边形。
- 输入严格保留原有顺序与重复点，导入时**不去重**；同坐标但不同索引仍是不同顶点。

## 容差与误差定义（重要）

- `tolerance`（容差）是一个**非负长度**，单位与坐标单位完全相同。
  例如坐标单位是米，容差 1.5 就表示 1.5 米。
- 对一个被端点 `A、B` 替代的区间，其中任意原始采样点 `P` 的误差定义为
  **`P` 到有限线段 `AB` 的最短欧氏距离**：
  - 投影参数
    `t = ((P-A)·(B-A)) / |B-A|²` 被**截断到 `[0, 1]`**，
    因此投影落在线段外时按到最近端点的距离计算，**不是**到无限延长直线的距离；
  - 当 `A、B` 重合（长度为 0）时，退化为 `P` 到单点 `A` 的距离。
- 只有当区间内最大误差**严格大于**容差时才分裂；**恰好等于容差不分裂**。
- 多个点同距时，选择**原始索引最小**的点分裂。
  上述规则保证相同输入总是得到相同结果。

## 算法说明

自行实现的 Douglas–Peucker（确定性、迭代栈实现）：

1. 以区间两端建立替代线段，求中间点到该**有限线段**的最大距离及最远点；
2. 最大距离 `> tolerance` 时保留最远点，递归/迭代处理左右两段；
3. 否则允许用两个端点替代整段。

**强制保留点**：用户指定的索引与首尾一起作为分段边界，各段分别简化后按顺序合并。
重复指定的索引按集合去重（公开规则）。强制点为 `[0, n-1]` 内整数，首尾允许出现。

## 明确不提供的几何保证

本服务**不**追求顶点数最少的全局最优解；**不**保证结果无自交、不保证拓扑保持、
**不**给出连续曲线的双向 Hausdorff 界。唯一报告的保证是：

> 每个被替代区间内的原始采样点，到对应替代线段的距离都不超过容差。

这是对**离散采样点**的保证，不对采样点之间未观测到的真实曲线作任何承诺。

## 环境要求

- Node.js ≥ 22.5（`node:sqlite` 内置；开发与验证使用 Node v25.5.0）
- Windows / macOS / Linux 均可，以下命令在 Windows PowerShell 下验证。

## 安装与构建

```powershell
cd dp-simplify
npm install
npm run build      # tsc 编译到 dist/
```

## 测试

```powershell
npm test           # node:test 单元/集成测试（通过 tsx 直接跑 TS）
npm run smoke      # 构建后对全部 HTTP 接口做端到端冒烟检查
```

测试覆盖：单点、两点、共线、折角、连续重复点、首尾重合、投影落在端点外、
误差恰好等于容差、最远点平局、空输入、非有限坐标、非法强制点、持久化与重启复查，
并用独立距离计算验证误差声明。

## 演示：普通简化 vs 强制保留转折点

```powershell
npm run demo
```

演示使用容差 1.5：普通 DP 会移除高约 1.2 的小凸起（索引 2），而强制保留索引 2
后它作为分段边界保留；两种结果都通过独立误差复核。

## CLI

数据默认存于项目内 `./data/dp.sqlite`（自动创建），可用 `--db` 修改。
坐标同时接受 `{x,y}` 对象与 `[x,y]` 数组。

```powershell
# 启动 HTTP API（默认自动选择空闲端口；可用 --port 指定）
node dist/src/cli.js serve --port 8080 --host 127.0.0.1

# 导入折线
node dist/src/cli.js import --name 线1 --points "[[0,0],[1,1],[2,0]]"

# 简化（--polyline 为导入返回的 id）
node dist/src/cli.js simplify --polyline 1 --tolerance 0.5
node dist/src/cli.js simplify --polyline 1 --tolerance 0.5 --forced "[1,3]"

# 查询保留点 / 查看分裂步骤
node dist/src/cli.js kept --version 1
node dist/src/cli.js steps --version 1

# 核验任意保留索引方案（不要求由本算法产生）
node dist/src/cli.js verify --version 1 --kept "[0,2]"

# 导出完整 JSON（原线 + 参数 + 版本报告 + 简化折线）
node dist/src/cli.js export --version 1
```

复杂参数可用文件：`--points-file input.json`、`--forced-file forced.json`、
`--kept-file kept.json`。

## HTTP API

请求/响应均为 JSON；错误响应形如
`{"error":{"code":"ERROR_CODE","message":"...","details":...}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/health` | 健康检查 |
| POST | `/api/polylines` | 导入折线 `{name, points:[[x,y],...]}` |
| GET  | `/api/polylines` | 列出折线 |
| GET  | `/api/polylines/:id` | 查看原线 |
| POST | `/api/polylines/:id/simplify` | 简化 `{tolerance, forcedIndices?}`，返回版本 id |
| GET  | `/api/polylines/:id/versions` | 该线的全部简化版本（改参数即新增） |
| GET  | `/api/versions/:vid/kept` | 查询保留的原始索引与简化折线 |
| GET  | `/api/versions/:vid/steps` | 查看分裂步骤 |
| POST | `/api/versions/:vid/verify` | 核验 `{keptIndices}`，独立重算各区间误差 |
| GET  | `/api/versions/:vid/export` | 导出完整 JSON |

简化响应中的 `segments` 给出每段替代关系：`startIndex/endIndex`（端点）、
`replacedIndices`（被移除的中间点）、`worstIndex/maxDistance`（最大误差及位置）。
`steps` 给出每次区间决策（最远点、距离、是否分裂），便于复查算法过程。

核验响应包含：`valid`、`strictlyIncreasing`、`endpointsKept`、`forcedKept`、
`withinTolerance`、`globalMaxDistance/globalWorstIndex`、`missingForcedIndices`
与逐段 `segments`（含 `exceeds` 标记）。

### curl 示例

```powershell
curl.exe -X POST http://127.0.0.1:8080/api/polylines `
  -H "Content-Type: application/json" `
  -d '{\"name\":\"线1\",\"points\":[{\"x\":0,\"y\":0},{\"x\":1,\"y\":2},{\"x\":2,\"y\":0}]}'

curl.exe -X POST http://127.0.0.1:8080/api/polylines/1/simplify `
  -H "Content-Type: application/json" -d '{\"tolerance\":1}'
```

## 错误码

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_JSON` | 400 | 请求体不是合法 JSON |
| `INVALID_NAME` | 400 | name 缺失或非字符串 |
| `INVALID_POINTS` | 400 | points 不是数组 |
| `EMPTY_POINTS` | 400 | points 为空（至少需要 1 个点） |
| `INVALID_COORDINATE` | 400 | 某点不是有限数值坐标 |
| `INVALID_TOLERANCE` | 400 | tolerance 不是非负有限数 |
| `INVALID_FORCED_INDICES` / `INVALID_FORCED_INDEX` | 400 | 强制点参数类型错误 / 某个索引越界或非整数 |
| `INVALID_KEPT_INDICES` / `INVALID_KEPT_INDEX` | 400 | 核验输入类型错误 / 某个索引越界或非整数 |
| `POLYLINE_NOT_FOUND` | 404 | 折线不存在 |
| `VERSION_NOT_FOUND` | 404 | 简化版本不存在 |
| `NOT_FOUND` | 404 | 未知 API 路径 |
| `INTERNAL_ERROR` | 500 | 服务内部错误 |

## 数据存储

- SQLite 文件位于项目内 `data/`（可用 `--db` 覆盖）。
- `polylines` 保存原线版本（原始坐标，不去重）；
  `versions` 保存容差、强制点、算法版本（`dp-1.0.0`）、保留索引、分裂步骤与误差报告。
- 每次改变参数简化都会**追加**一条新版本记录；重启后可用 `kept/steps/export`
  复查历史结果。

## 项目结构

```
src/
  geometry.ts   点到有限线段距离（投影截断、重合退化）
  dp.ts         Douglas–Peucker、分裂步骤、逐段报告
  verify.ts     独立核验（严格递增/首尾/强制点/逐段误差）
  validation.ts 参数校验与错误码
  store.ts      SQLite 持久层
  service.ts    业务编排
  server.ts     HTTP API 与空闲端口选择
  cli.ts        命令行入口
  demo.ts       内置演示
test/           node:test 测试
scripts/        HTTP 冒烟脚本
```
