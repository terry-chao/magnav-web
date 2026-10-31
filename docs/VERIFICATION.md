# 验证记录

> 环境：Windows 11 · Node.js v24.22.1 · Chrome 156（Playwright headless）· 1600×1000
> 日期：2026-10-31

---

## 1. 自动化测试

```bash
npm test
```

结果：**9 个测试文件、51 项全部通过。**

| 套件 | 文件 | 覆盖 |
|---|---|---|
| 协议 / 几何 | `packages/protocol/tests/geometry.test.ts` | 重采样、平滑、曲率、弧长、固定拓扑形状、四元数旋转 |
| 协议 / 编解码 | `telemetry.test.ts` | 全字段 round-trip、零拷贝视图、clone、magic/version 拒绝 |
| 协议 / 场模型 | `field.test.ts` | 目标场强与方向、电流限幅、梯度、力矩、场线有限性 |
| 协议 / 导航 | `nav.test.ts` | 分支缝合、根到远端 Dijkstra、最近节点、断连路径 |
| 协议 / 状态机 | `machine.test.ts` | 9 项：就绪门禁、TRE、双人确认、暂停/继续、急停、接管、中止、非法迁移 |
| 服务端 / 门禁 | `apps/server/tests/service.test.ts` | 12 项：预检、双人武装、角色拒绝、幂等、急停复位、故障注入、中止、接管重预检、登录、演示会话复用 |
| 服务端 / 持久化 | `apps/server/tests/persistence.test.ts` | 2 项：状态机事件重放与暂停恢复、文件型 DB 重开后的病例/计划保留 |
| 服务端 / 网关 | `apps/server/tests/gateway.test.ts` | 4 项：默认模拟器、会话独立实例、未知模式失败、外部模式 fail-fast |
| 客户端 / 坐标 | `apps/console/src/scene/coords.test.ts` | LPS↔scene 轴映射、200 组往返、100 组 `F·R·F⁻¹` 姿态基变换 |

### 类型检查

```bash
npm run typecheck
```

三个 workspace（protocol / server / console）均为 `strict`，0 error。

### 构建

```bash
npm run build
```

| 产物 | 大小 | gzip |
|---|---|---|
| `apps/console/dist/assets/index-*.js` | 1,301 KB | 373 KB |
| `apps/console/dist/assets/index-*.css` | 97.7 KB | 18.8 KB |
| telemetry worker | 39.1 KB | — |
| field worker | 39.5 KB | — |
| `apps/server/dist/index.js`（含协议包） | 231.7 KB | — |

---

## 2. 浏览器端到端

### 2.1 Playwright 自动化（`npm run test:e2e`）

结果：**5 项全部通过**（真实 Chrome / 生产构建 / 隔离 SQLite）。

| # | 流程 | 结果 |
|---|---|---|
| 1 | 首页 → 一键登录 → 装载 LAD → 术中页 + DEMO 导览 | ✅ |
| 2 | 登录 → 3 个演示病例 | ✅ |
| 3 | LCX 计划审核签字 → 可进入术中 | ✅ |
| 4 | 预检 → 双人武装 → 启动 → 暂停 → 急停复位 → 中止 → 复盘 | ✅ |
| 5 | 归档复盘播放 + 审计链校验 (`/audit/verify`) | ✅ |

### 2.2 手工浏览器验收

以下流程均在真实浏览器中执行并通过（Playwright + 系统 Chrome）：

| # | 流程 | 结果 |
|---|---|---|
| 1 | 登录（术者/工程师）→ Cookie 会话 → `/auth/me` | ✅ |
| 2 | 病例列表、状态筛选、搜索、新建病例入口 | ✅ |
| 3 | 规划页：3D 场景、相机预设、图层、分支选择 | ✅ |
| 4 | 计划审核签字（PIN 2468）→ 状态 `approved` | ✅ |
| 5 | 生成新计划（LAD，332 mm，3 段，ETA 1:08） | ✅ |
| 6 | 3D 选点（屏幕空间 28 px 命中）→ 目标标记 | ✅ |
| 7 | 重新配准（TRE 序列）→ 超限告警 | ✅ |
| 8 | 进入术中 → 自动创建会话 → 订阅 WS | ✅ |
| 9 | 预检 9 项 → 全绿 | ✅ |
| 10 | 双人确认武装（助手 1357）→ `ARMED` | ✅ |
| 11 | 启动自动（二次勾选 + 0.8 s 长按）→ `AUTO_RUNNING` | ✅ |
| 12 | 120 Hz 遥测、B/梯度/力矩/力、线圈 12 路、DSA 同步 | ✅ |
| 13 | 暂停 → `AUTO_PAUSED`；继续 → `AUTO_RUNNING` | ✅ |
| 14 | 第二客户端（工程师）只读加入 → 故障注入「线圈饱和」 | ✅ |
| 15 | 术者屏 1 s 内 `AUTO_PAUSED` + 高危告警 + C7 100% | ✅ |
| 16 | 告警确认 → 继续 → 运行 | ✅ |
| 17 | 软件急停（0.7 s 长按）→ 锁定横幅 → 复位（勾选） | ✅ |
| 18 | 中止并回撤（0.8 s 长按）→ `ABORTING` → `ABORTED` | ✅ |
| 19 | 完整到达 → `COMPLETED` → 完成卡片 → 进入复盘 | ✅ |
| 20 | 复盘播放、时间轴事件、三组曲线、导出 JSON、审计校验 | ✅ |
| 21 | 审计页：链校验通过、NDJSON 导出 | ✅ |
| 22 | 生产单端口 (`:8810`)：静态资源、CSP、Worker、WS、Cookie | ✅ |

### 2.3 服务重启恢复

在 `AUTO_RUNNING` 状态下直接终止服务进程，再以同一 SQLite 文件重启：

| 检查 | 结果 |
|---|---|
| 会话被恢复 | ✅ 同一 `sessionId`，阶段 `AUTO_PAUSED` |
| 运动安全 | ✅ 引擎弧长保留、`HOLD`，不自动继续 |
| 告警 | ✅ 出现高危 `SERVICE_RESTART`，需确认后才能继续 |
| 归档复盘 | ✅ 轨迹、事件、审计仍可打开 |
| 种子/审计重复 | ✅ DB 非空时不再播种；重启不追加归档审计 |

单元测试 `persistence.test.ts` 覆盖同一路径（状态机事件重放、弧长恢复、文件型 DB 重开）。

### 2.4 关键观测值

| 指标 | 观测 |
|---|---|
| 3D 帧率（headless Chrome） | 59–60 FPS |
| 数据年龄（同机） | 0–22 ms |
| 术中遥测 | 124 Hz（2.5 s / 310 帧，服务端子步；Node 定时器约 64 Hz） |
| 会话时长 | 约 75 s（计划 ETA 72 s） |
| 复盘帧 | 10 Hz 记录，约 760 帧 |
| 最大梯度 / 侧向力（正常路径） | ~0.21 T/m / ~0.09 N |
| 完成用时 / 偏差 | 1:16 / 0.75 mm（归档演示） |

> 后续版本应把「124 Hz」替换为服务端实际发送计数与 P99 延迟的正式 benchmark。

---

## 3. 安全场景验证

| 场景 | 操作 | 预期 | 结果 |
|---|---|---|---|
| 未武装启动 | 直接发 `START_AUTO` | 拒绝 `BAD_STATE` | ✅ |
| 未预检武装 | `ARM` | 拒绝 `PRECHECK_REQUIRED` | ✅ |
| 错误助手口令 | `ARM` with 0000 | 拒绝 `COUNTERSIGN_INVALID` | ✅ |
| 角色越权 | 助手发 `START_AUTO` | 拒绝 `ROLE_DENIED` | ✅ |
| 命令重放 | 同一 command id 重发 | `IDEMPOTENT`，不重复执行 | ✅ |
| 接管后直接再武装 | `TAKEOVER` → `ARM` | 拒绝，要求重新预检 | ✅ |
| 高危告警未确认继续 | 注入饱和 → `RESUME` | 拒绝 `ALARM_PENDING` | ✅ |
| 急停后继续 | `ESTOP` → `RESUME` | 拒绝 `ESTOP_LATCHED` | ✅ |
| 急停复位 | `RESET_ESTOP` + confirm | 解锁，但保持暂停 | ✅ |
| 断连看门狗 | 关闭术者页 5 s+ | 服务端暂停并保持位置 | ✅（第二客户端观测） |
| 审计篡改 | 修改 `data/audit.jsonl` 一行后重启 | `/audit/verify` 报断点 | 设计支持；未做自动化注入 |
| 位姿过期 | 停止遥测 | 3D 冻结 + 数据年龄 > 200 ms 标红 | 逻辑已实现；未做长时断流 UI 回归 |
| WebGL 崩溃 | 强制 loseContext | 错误提示，2D/数值仍在 | 逻辑已实现；未做自动化 |

---

## 4. 未验证 / 待补

- 8 h 连续运行、堆增长 < 5%、显存泄漏；
- 真实 DICOM / Cornerstone3D、MPR、窗宽窗位；
- 真实硬件在环（跟踪器、线圈、急停回路、脚踏）；
- 1 kHz 实时层与真实安全包络；`RobotGateway` 外部适配器尚未实现；
- 故障注入自动化（拔网线、杀进程、断电、丢帧）；
- 可用性形成性/总结性评估、use error 分析；
- 多实例一致性、SQLite → PostgreSQL 迁移、WORM 审计；
- 浏览器矩阵（Chrome 之外）、4K 降采样、触摸屏手型测试。

---

## 5. 复现命令

```bash
npm install
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
# 打开 http://127.0.0.1:8810
```

无浏览器冒烟：

```bash
npm run smoke
```

> `scripts/ws-smoke.ts` 会创建真实会话并走完预检、武装、启动、暂停、急停、复盘，最后校验审计链。
