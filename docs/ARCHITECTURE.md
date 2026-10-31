# 架构说明

> 版本 0.1 · 2026-10-31 · 与 `plan/磁控介入手术机器人前端方案.md` 对应
> 研究原型，非医疗器械。

---

## 1. 运行拓扑

```
Browser（同一台工作站或院内终端）
  ├─ React 18 SPA（Vite 构建，Fastify 静态托管）
  ├─ Web Worker #1：二进制遥测解码
  ├─ Web Worker #2：场线 RK4 积分
  └─ WebSocket /ws/v1（Cookie 鉴权）
            │
Fastify :8810
  ├─ REST /api/v1/*（登录、病例、计划、配准、会话、复盘、设备、审计、故障注入）
  ├─ 权威 xstate 过程状态机（每会话一个 actor）
  ├─ RobotGateway（接口）→ RobotEngine（simulated）/ 外部实时层适配器
  ├─ 安全服务（预检、双人确认、deadman、看门狗、告警、急停）
  ├─ SQLite 持久化（病例、计划、配准、会话、状态机事件、告警、复盘帧）
  └─ 审计链（内存 + data/audit.jsonl 追加）
```

没有 Electron 主进程、本地 IPC 或原生设备服务。需要硬件的部分（串口、脚踏、相机、1 kHz 实时层）在本原型中由模拟器替代，接口边界保留。

### 1.1 两种交付形态

- **完整 Web 全栈**：`npm start` 由 Fastify 托管 SPA + API/WS + SQLite，支持登录、多人、持久化与完整审计。
- **GitHub Pages 静态演示**：`npm run build:pages` 输出 `apps/console/dist-pages`，只把共享状态机、模拟器与 3D 场景打包进浏览器；没有 API、WebSocket 或数据库。首页 CTA 指向 `/demo`，用于零安装体验。

两者共用 `@magnav/protocol`、`procedureMachine`、场景与视觉代码；差异只在“谁来持有权威状态”。

### 1.2 为什么是单端口 / 单 WebSocket

- 浏览器与 API 同源，Cookie `SameSite=Strict` + CSRF 头即可工作，无需 CORS。
- 方案明确要求「命令通道不要两套」；遥测、事件、命令共用一条连接，鉴权、重连、快照恢复只有一个生命周期。
- 二进制帧与 JSON 文本帧可以共存：`ArrayBuffer` → 遥测；字符串 → 控制/事件。
- 代价是慢客户端可能阻塞事件；通过 `bufferedAmount` 上限丢弃遥测帧（事件不丢）处理。

---

## 2. 共享协议包 `packages/protocol`

单一事实来源，服务端与浏览器都直接引用 TypeScript 源码（Vite/tsx 编译，无构建产物）。

| 文件 | 内容 |
|---|---|
| `types.ts` | 领域类型、阶段、命令、告警、审计、快照、复盘 |
| `constants.ts` | 安全阈值、线圈几何、阶段元数据、命令/角色矩阵、拒绝码文案 |
| `telemetry.ts` | 二进制帧编解码（零拷贝视图） |
| `machine.ts` | xstate v5 过程状态机 + 守卫 |
| `geometry.ts` | 向量/四元数、Catmull-Rom、重采样、曲率、导管形状 |
| `field.ts` | 偶极子场、最小范数线圈电流求解、梯度、力矩、场线 |
| `nav.ts` | 血管图、Dijkstra、最近节点、路径半径 |
| `num.ts` | 数值/时间格式化、确定性 PRNG |

### 2.1 遥测帧格式

小端，固定长度 **1320 B**：

| 偏移 | 大小 | 字段 |
|---|---|---|
| 0 | 2 | magic `0x4D47`（`MG`） |
| 2 | 1 | version = 1 |
| 3 | 1 | type = 1（telemetry） |
| 4 | 4 | seq |
| 8 | 8 | ts（float64，服务端毫秒） |
| 16 | 4 | payload length |
| 20 | 12 | tip t（3×f32，mm LPS） |
| 32 | 16 | tip q（4×f32，x y z w） |
| 48 | 8 | tip ts |
| 56 | 2+2 | shape count（96）+ reserved |
| 60 | 1152 | shape（96×3 f32，mm LPS） |
| 1212 | 12 | moment（3×f32） |
| 1224 | 1+3 | coil count（12）+ reserved |
| 1228 | 48 | coil currents（12×f32，A，双极性） |
| 1276 | 12 | B（3×f32，mT） |
| 1288 | 4 | grad（f32，T/m） |
| 1292 | 4 | torque（f32，mN·m） |
| 1296 | 4 | axial force（N） |
| 1300 | 4 | lateral force（N） |
| 1304 | 4 | flags（u32） |
| 1308 | 4 | progress（0..1） |
| 1312 | 2+2 | segment index + reserved |
| 1316 | 4 | speed（mm/s） |

编解码返回 `Float32Array` 视图，解码 Worker 在 `postMessage` 时转移整个 `ArrayBuffer`，主线程零拷贝。测试覆盖 round-trip、magic/version 校验与 views 生命周期。

### 2.2 时钟与「数据年龄」

- 客户端每 5 s 发送 `{kind:'ping', t0}`；服务端回 `serverTime` 与 `t1`。
- 使用最近一分钟最低 RTT 样本估计偏移：`offset = serverTime − (t0+t1)/2`。
- 数据年龄 = `serverNow() − latest.ts`；显示在顶栏和术中底栏。
- 年龄 > `LIMITS.stalePoseMs`（200 ms）时，`hot.sampleAt()` 返回 `null`，3D 冻结、显示「位姿数据中断」，不进行外推。
- 渲染插值固定取 `serverNow() − 40 ms`，在环形缓冲内二分/线性查找相邻帧，位置线性、姿态 slerp、形状逐点线性。

### 2.3 命令模型

```ts
interface CommandEnvelope {
  id: string;          // uuid，幂等键
  type: CommandType;   // START_PRECHECK / ARM / START_AUTO / ...
  params: object;
  issuedBy: string;
  issuedAt: number;
  expectedState: ProcedurePhase;
  nonce: string;
}
```

服务端处理顺序：

1. 会话存在、`issuedBy` 与登录用户一致；
2. 命令是否已处理（`processedCommands`）→ 返回 `IDEMPOTENT`；
3. `expectedState` 与当前阶段一致；
4. 角色矩阵 `COMMAND_ROLE`；
5. 阶段矩阵 `PHASE_COMMANDS`；
6. 业务门禁（预检、TRE、计划、急停、告警、双人确认…）；
7. 派发到状态机 / 模拟器；
8. 写入哈希链审计，广播 `command` 事件（ack）。

前端在 2.5 s 内未收到 ack 时显示「指令未确认」，但仍以服务端广播状态为准。UI 在 ack 前禁用重复提交；幂等键保证重发不会重复动作。

---

## 3. 权威过程状态机

定义于 `packages/protocol/src/machine.ts`，服务端为每个会话 `createActor` 一个实例，UI 不持有权威状态。

```
IDLE → CASE_READY → SEGMENTED → PLAN_READY → REGISTERED → ARMED
                                                    │
                                ┌───────────────────┴──────────────┐
                                ▼                                  ▼
                           AUTO_RUNNING ──PAUSE──▶ AUTO_PAUSED ──RESUME──▶ AUTO_RUNNING
                                │  │                    │
                                │  ├─TAKEOVER──────────┴────▶ MANUAL ──PRECHECK_PASSED──▶ ARMED
                                │  ├─TARGET_REACHED──────────▶ COMPLETED
                                │  └─ABORT────────────────────▶ ABORTING ──ABORT_DONE──▶ ABORTED
                                └─ESTOP / FAULT ──────────────▶ AUTO_PAUSED
```

安全门禁：

| 门禁 | 实现 |
|---|---|
| TRE | `<= 1.5 mm` 才允许 `REGISTERED → ARMED` |
| 预检 | 9 项全部通过（影像、配准、计划、可行性、线圈、温升、急停、延迟、存储） |
| 双人确认 | 术者发起 + 助手工牌/口令；第二人不能是本人；记录双方 ID |
| 计划 | 必须 `approved` 且 `feasibility.passed` |
| 急停 | `estopLatched` 时拒绝 `START_AUTO` / `RESUME` |
| 告警 | 高危未确认告警阻止 `RESUME` |
| 接管后再武装 | `precheckPhase` 必须为 `MANUAL`（必须重跑预检） |
| 人在环 | 自动运行每 40 s 需 `PRESENCE`，超时 10 s 自动暂停 |
| 看门狗 | 客户端心跳丢失 > 5 s 自动暂停 |
| 中止 | 二次确认 + 800 ms 长按；进入 ABORTING 后仅硬件急停可干预 |

---

## 4. 模拟器与磁场模型

### 4.1 运动学

- 路径按 1.5 mm 重采样；每段有标称速度与 ETA。
- 120 Hz 目标；Windows 上 Node `setInterval` 约 64 Hz，服务端在每次 tick 内做 2 个 7.8 ms 子步，使遥测仍为 ~120 Hz。
- 加速度限制 3.2 mm/s²；末段 8 mm 内减速。
- 支持暂停、继续、接管（冻结）、中止回撤（14 mm/s 反向）。
- 到达目标 → `arrived` effect → 状态机 `TARGET_REACHED`；回撤完成 → `ABORT_DONE`。

### 4.2 线圈与场

- 12 个线圈，3 环 × 4；位置半径 255 mm，z = −110/0/110 mm；双极性 ±120 A。
- 每个线圈建模为磁偶极子：`m = axis · I · 45 A·m²/A`。
- 场：`B(r) = μ0/4π · (3(m·r̂)r̂ − m)/|r|³`。
- **最小范数电流求解**：`c = Uᵀ (U Uᵀ)⁻¹ T`，`U` 为 12 个线圈在 tip 处每安培的场向量；如需限制可进入有界投影梯度细化。相比普通梯度下降，避免大电流对消与饱和。
- 梯度：沿路径切向的向量差 `|B(s+1mm) − B(s−1mm)| / 0.002 m`。
- 力矩：`|m_tip × B|`，`m_tip = 0.06 A·m²`。
- 场线：以 tip 偶极子做 RK4 积分的可视化流线（Worker，5 Hz 节流），明确标注「示意场线，非剂量学依据」。

### 4.3 可行性

沿重采样路径每 ~4 mm 采样，检查：

- `B ≤ 60 mT`、`∇B ≤ 1.2 T/m`、`τ ≤ 2.0 mN·m`、`κ ≤ 0.08 mm⁻¹`；
- 线圈是否饱和；
- 最小余量 = min(各约束归一化余量)；
- 返回分段速度与风险等级。

不可行路径直接拒绝生成计划（HTTP 422 / `PLAN_INFEASIBLE`），并在 UI 展示原因。

---

## 5. 规划路径

1. 血管树由程序化控制点 + Catmull-Rom 平滑，2 mm 重采样；半径来自「分割结果」并叠加狭窄高斯衰减。
2. `buildVesselGraph` 将每个样本作为节点，分支内相邻连边，分支起点连接到父分支最近节点。
3. 入口 = 主动脉根；目标 = 选中分支的样本或 3D 点最近节点。
4. Dijkstra 求最短路径（图是树，但保留通用实现）。
5. 拼接路径按 1.5 mm 重采样，半径沿路径插值，计算 Menger 曲率。
6. 可行性校验 + 分段（主动脉逆行 / 主动脉根 / 目标段），速度按曲率与狭窄降速。
7. 审核签字（术者 PIN）→ `approved`；术者可在同一病例上生成多个版本。

---

## 6. 3D 场景

### 6.1 坐标

唯一转换入口 `apps/console/src/scene/coords.ts`：

```
x_scene = −x_lps
y_scene =  z_lps
z_scene =  y_lps
```

这是一个 180° 旋转（绕 (0,1,1)），行列式 +1。姿态使用 `F·R·F⁻¹`，**不是**四元数分量重排；单测对 100 组随机姿态断言与向量变换一致。

场景图：

```
worldRoot（matrix = LPS_TO_SCENE，matrixAutoUpdate=false）
 ├─ Phantom（体表壳）
 ├─ VesselTree（合并的管状网格，aTone/aHighlight）
 ├─ TargetPath（分段 Line2 + 目标环）
 ├─ CoilArray（InstancedMesh + 点光晕）
 ├─ FieldLines（Worker 生成 LineSegments）
 └─ Catheter（固定拓扑 96×8 管，逐帧写顶点）
```

### 6.2 血管

- 每个分支用平行传输帧生成 10 边管，合并为单个 BufferGeometry（减少 draw call）。
- 自定义 ShaderMaterial：Fresnel 边缘光 + 半透明内壁；`aHighlight` 顶点属性用于选中分支，不需要换材质。
- 狭窄位置用金色环标记（数据来自分割结果，不做视觉「美化」）。

### 6.3 导管

- 96 截面 × 8 径向，固定索引；每帧只写 position/normal，不重建几何。
- 平行传输帧避免 Frenet 翻转；曲率沿路径 smooth 后的切线。
- 形状来自服务端 `TelemetryFrame.shape`（150 mm，96 点，LPS）；客户端按 40 ms 插值读取。
- 尖端独立球体 + 磁矩箭头；磁矩方向来自遥测。
- 无物理形变仿真；形状由实时层/模拟器给出。

### 6.4 相机 / 交互

- `OrbitControls` + 阻尼；C-ARM 预设 ISO / AP / PA / LAO30 / RAO30 / CRAN / CAUD，480 ms 缓动，禁止瞬移。
- 规划页支持 3D 选点：屏幕空间投影中心线样本，点击 28 px 内最近样本即选中（比细管网格命中更可用），随后生成计划。
- 2D DSA 面板用同一中心线做风格化投影，显示 tip、目标、C 臂角度、FOV、时间戳；这是低成本的降级视图，不是 DICOM 查看器。
- WebGL context lost 监听 + 错误边界；失败时显示「3D 渲染不可用，2D/数值视图仍可用」。

---

## 7. 高频数据路径

```
WS binary ──▶ telemetry.worker（decodeTelemetry，零拷贝）
          ──▶ hot.push（seq 去重，256 帧环形缓冲，10 Hz 通知 React）
          ──▶ Catheter.useFrame：hot.sampleAt(serverNow − 40 ms) → 写顶点
          ──▶ HUD：useSyncExternalStore 10 Hz 读取 latest
          ──▶ 力/梯度 sparkline：10 Hz 采样、160 点环形
```

- 环形缓冲不进入 zustand；React 重渲染与动画循环解耦。
- `useFrame` 内无对象分配：模块级 Vector3/Quaternion/矩阵复用。
- 数据年龄 > 200 ms 时返回 `null`，导管保持最后位置，不预测。
- 遥测 seq 回退丢弃；检测到断流（seq 跳跃 > 12）清空环形缓冲。
- 场线计算放到独立 Worker，200 ms 节流；主线程只更新 LineSegments 顶点。

### 7.1 性能预算

| 指标 | 本原型 |
|---|---|
| 遥测 | 120 Hz，约 1.3 KB/帧 ≈ 156 KB/s/客户端 |
| 渲染 | 60 fps（1600×1000 headless Chrome 观测 ~60） |
| 3D 数据 | 血管 ~8 分支、~5–6k 顶点；导管 96×8；12 线圈 |
| React 高频更新 | 仅 HUD 10 Hz；场景在 `useFrame` |
| 首屏 | Vite 生产包 ~366 KB gzip（含 Three/R3F） |

### 7.2 降级

- 3D 异常 → 2D DSA + 数值面板（未实现自动隐藏，但布局独立）。
- 链路断开 → 全屏遮罩 + 3D 冻结 + 服务端 watchdog 暂停。
- 位姿超时 → 横幅 + 冻结 + 禁止启动/继续。

---

## 8. 认证、授权与审计

- 登录：工牌 + 口令；服务端保存 SHA-256(salt:pin)，比较使用 `timingSafeEqual`。
- 会话：随机 32 B token，HttpOnly Cookie，`SameSite=Strict`，8 h；服务端内存表。
- CSRF：所有变更请求要求 `X-CSRF-Token` 与登录会话中的随机值一致；登录/健康检查除外。
- RBAC：`ROLE_CAPS` 在协议包定义；服务端命令、审批、故障注入、审计导出均再次校验。
- 审计：每条记录 `seq | ts | actor | role | action | subject | detail | prevHash`，SHA-256 链；JSONL 追加到 `data/audit.jsonl`；`/audit/verify` 重算；导出 NDJSON。
- 脱敏：患者姓名首字 + `*`，MRN 掩码；无外部请求；CSP `default-src 'self'`。
- 生产托管：禁用 `X-Powered-By`、`nosniff`、`DENY` frame、最小权限 CSP。

---

## 9. 关键决策记录（ADR 摘要）

| 决策 | 结果 | 理由 |
|---|---|---|
| 无 Electron | 纯浏览器 + 服务端托管 | 按需求移除桌面壳；评审与部署更简单 |
| 单 WS | `/ws/v1` 复用 | 避免双通道状态漂移；一个鉴权/心跳/快照生命周期 |
| 权威 FSM 在服务端 | 前端只读阶段 | 多屏一致；前端崩溃不影响状态 |
| 共享协议包 | 类型 + 编解码 + 机器 | 防止两端漂移；单测覆盖 |
| 最小范数线圈求解 | 解析 + 有界回退 | 避免梯度下降收敛到饱和/对消解 |
| 不接 DICOM | 合成 DSA | 无数据；聚焦交互与降级路径 |
| 自绘 UI | 暗色设计系统 | 医疗控制台需要密度、触摸尺寸与告警语义一致性 |
| 审计 JSONL | 本地追加 | 离线、只读导出、便于质控复核 |

---

## 10. 与原方案的主要偏差

1. **Electron → Web 全栈**（用户要求）。
2. **双 WebSocket → 单路复用**（见 ADR）。
3. **Ant Design → 自绘设计系统**；**Cornerstone3D → 合成 DSA**。
4. **protobuf → 自定义固定布局二进制**：无 schema 编译链，帧长固定，Worker 零拷贝；代价是版本演进需显式处理。
5. **不实现 1 kHz 闭环**，前端模拟器为演示；生产必须替换为实时层接口。
6. **单进程 SQLite 持久化**：病例、计划、配准、会话与复盘帧落库，支持进程重启恢复；未做多实例并发。审计仍为 JSONL 哈希链。
7. **无 5 分钟自动锁屏**；登录会话 8 h。
8. **无专用助手/影像屏**；通过多客户端 + RBAC 只读实现同步。

---

## 11. 后续演进

- 接入真实实时层：实现 `RobotGateway` 外部适配器；protobuf / gRPC-Web 或二进制协议 v2，保留 FSM 与审计（契约见 `docs/INTEGRATION.md`）。
- 接入 DICOMweb / Cornerstone3D；血管树由分割服务产出 GLB/JSON。
- 持久化演进：SQLite → PostgreSQL；审计链分段落盘、外部时间戳与 WORM；多实例会话锁与一致性。
- 多屏：助手屏 / 影像屏专用路由与只读订阅；同一 session 多端状态以快照 + 事件重建。
- 可用性：IEC 62366-1 形成性/总结性评估；告警 sound set 按 IEC 60601-1-8 校准。
- 可靠性：8 h 压测、WebGL 上下文恢复演练、故障注入台架。
