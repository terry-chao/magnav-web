# 实时层接入

> 目标：让控制台通过一个明确的网关契约对接真实实时层（1 kHz 闭环 / PLC / FPGA），
> 而不是把模拟器逻辑散落在业务代码里。

---

## 1. 当前实现

```
ConsoleService
   └─ RobotGateway（接口）
        └─ RobotEngine（simulated，默认）
```

- 接口定义：`apps/server/src/gateway.ts`
- 默认实现：`apps/server/src/simulator.ts`（`RobotEngine implements RobotGateway`）
- 工厂：`createGatewayFactory()` 读取 `MAGNAV_GATEWAY`
  - `simulated`（默认）
  - `external`：当前 fail-fast，提示实现外部适配器
  - 其他值：启动即报错，避免静默降级

所有会话通过工厂创建网关；`ConsoleService` 不再 `new RobotEngine()`。服务重启恢复会话时也走同一工厂。

---

## 2. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MAGNAV_GATEWAY` | `simulated` | `simulated` / `external` |
| `MAGNAV_ROBOT_WS_URL` | — | 未来外部适配器的实时层地址 |
| `MAGNAV_DB_PATH` | `data/magnav.sqlite` | 领域数据库 |
| `MAGNAV_AUDIT_PATH` | `data/audit.jsonl` | 哈希链审计 |
| `PORT` / `HOST` | `8810` / `127.0.0.1` | HTTP/WS 监听 |

---

## 3. `RobotGateway` 契约

```ts
interface RobotGateway {
  kind: 'simulated' | 'external';
  progress: number;          // 0..1，沿计划
  segmentIndex: number;
  totalMm: number;
  sMm: number;               // 当前弧长
  mode: 'HOLD' | 'RUNNING' | 'ABORTING';
  injection: InjectedFaults; // 演示/测试注入，真实网关可 no-op
  effects: SimEffect[];       // 到达、分段、告警等状态机效果
  start(): void;              // START_AUTO 已获授权
  resume(): void;
  hold(): void;
  abort(): void;              // 回撤
  step(dtSeconds: number): void;
  frame(ts?: number): TelemetryFrame;
  reviewFrame(phase: ProcedurePhase, ts?: number): ReviewFrame;
}
```

### 语义约束

1. **高层意图**：`start/resume/hold/abort` 只能翻译成实时层的高层命令，绝不能发送原始线圈电流。
2. **`frame()` 必须是已确认的遥测**：不能外推、不能伪造时间戳；数据过期时由前端冻结。
3. **`effects` 是权威的**：`arrived` / `abort_done` / `segment` / `alarm` 由服务端消费并驱动状态机，外部适配器不能直接改阶段。
4. **`step()` 对推送式传输可以 no-op**；但外部适配器仍需维护最新 `sMm/progress` 供快照与恢复使用。
5. **恢复安全**：服务重启后，处于 `AUTO_RUNNING` 的会话必须被服务端暂停并产生 `SERVICE_RESTART` 告警；不能静默恢复运动。
6. **失败即安全**：外部链路断开、帧过期、命令无 ack 时，网关保持 HOLD，服务端看门狗负责暂停。

---

## 4. 实现外部网关的步骤

1. 新建 `apps/server/src/gateways/external.ts`，实现 `RobotGateway`。
2. 在 `createGatewayFactory()` 的 `external` 分支返回适配器工厂。
3. 适配器职责：
   - 连接实时层（WebSocket / gRPC-Web / 厂商 SDK），完成鉴权与心跳；
   - 将 `TelemetryFrame`（或厂商格式）转换成共享协议类型；
   - 维护 `sMm/progress/segmentIndex`；
   - 把 `start/resume/hold/abort` 映射到实时层命令，并等待 ack；
   - 把实时层事件映射为 `SimEffect`（到达、回撤完成、告警）；
   - 处理断连、重连、首帧快照，绝不返回过期位姿。
4. 增加契约测试：用录制帧回放（replay transport）验证转换、过期、断连与恢复。
5. 在 `docs/SAFETY.md` 增补外部网关的危害分析。

### 推荐拆分

```
ExternalRobotGateway
  ├─ Transport（WS / gRPC / SDK）
  ├─ FrameDecoder（厂商格式 → TelemetryFrame）
  ├─ CommandClient（高层意图 + ack）
  └─ Watchdog（心跳 / 帧龄 / 重连）
```

---

## 5. 协议 v2 计划

当前 v1 是固定布局二进制帧 + JSON 事件。接入真实实时层时建议：

- 使用 **protobuf** 定义遥测/命令 schema，生成 TS 与服务端类型；
- 增加 `protocolVersion` 与 `capabilities` 握手；
- 遥测帧加入 `sensorTs`、`sourceSeq`、`quality`；
- 命令增加 `expectedState`、`nonce`、`countersign` 与幂等键（已有）；
- 保留 v1 二进制帧用于回放/模拟，双版本可共存一个迁移窗口。

---

## 6. 与持久化/恢复的关系

- 会话持久化只存领域状态（阶段、事件、告警、轨迹、引擎弧长），不存 socket。
- 重启恢复时由工厂重新创建网关；外部网关需要从实时层拉取当前位置/首帧，再交回服务端。
- 在外部网关确认位置前，恢复后的会话保持 `AUTO_PAUSED`，禁止运动。

---

## 7. 验收清单（接入真实层前）

- [ ] 外部网关实现 `RobotGateway`，类型检查通过
- [ ] 高层命令只发意图，抓包无 `SET_COIL_CURRENT`
- [ ] 断连 5 s 内服务端进入暂停
- [ ] 帧龄 > 200 ms 前端冻结，服务端暂停
- [ ] 重启后会话恢复为暂停并产生 `SERVICE_RESTART`
- [ ] 命令 ack 超时/重复/乱序测试通过
- [ ] 回撤过程可被急停打断
- [ ] 录制帧回放与真实帧的一致性测试
- [ ] 硬件在环台架故障注入通过
