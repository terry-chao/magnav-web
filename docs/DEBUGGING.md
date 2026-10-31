# VS Code 调试指南

仓库根目录已经包含 `.vscode/launch.json`、`.vscode/tasks.json` 和 `.vscode/settings.json`。
在 **仓库根目录** 打开 VS Code，按 `F5` 即可。

> F5 使用 **5174（Vite）/ 8820（API + WS）**，与生产 `npm start` 的 **8810** 隔离，因此可以在生产实例运行时调试。

---

## 1. F5：全栈 + Chrome

默认配置：

```
▶ MAGNAV 全栈调试（F5）
```

执行内容：

1. `scripts/debug-fullstack.ts` 以 Node 调试器启动；
2. 同一进程内通过 Vite JS API 启动前端（<http://127.0.0.1:5174>，已配置 `/api`、`/ws` 代理到 8820）；
3. 动态导入 `apps/server/src/index.ts`，启动 Fastify + WebSocket（<http://127.0.0.1:8820>）；
4. 健康检查通过后输出 `MAGNAV DEBUG READY http://127.0.0.1:5174`；
5. `serverReadyAction: debugWithChrome` 自动打开 Chrome 调试会话。

断点：

| 位置 | 方式 |
|---|---|
| `apps/server/src/**` | 直接在 TS 行号左侧点击；Node 调试器 + tsx inline source map |
| `apps/console/src/**` | 自动打开的 Chrome 会话；或在调试下拉选「Console · Chrome（调试页 :5174）」 |
| `packages/protocol/src/**` | 同服务端，TS 源码 |
| Vite 配置 / 调试脚本 | `scripts/debug-fullstack.ts`、`apps/console/vite.config.ts` |

调试要点：

- **服务端改动**：Vite 会 HMR 前端，但服务端不会自动重启；停止（Shift+F5）再 F5。
- **前端改动**：Vite HMR 立即生效，Chrome 调试会话保持。
- **生产 8810 不受影响**：可以同时 `npm start` 和 F5；调试实例使用独立的 `data/debug-audit.jsonl`，不会与生产审计链互相追加。
- 若 Chrome 没有自动打开：手动选择「Console · Chrome（调试页 :5174）」。
- 如果 TS 断点显示为空心圆（未绑定）：
  1. 确认 `sourceMaps` 已开启（配置已开启）；
  2. 在 Chrome 调试会话的 `Sources` 面板确认源码路径是 `apps/console/src/...`；
  3. 服务端使用 `--enable-source-maps`（配置已加），并在断点后再触发一次请求；
  4. 仍不绑定则使用「Server · 编译产物调试」方案（见第 6 节）。

---

## 2. 仅调服务端

```
Server · 仅后端（tsx, :8820）
```

- 只启动 Fastify + WS，不开 Vite。
- 适合用 curl/WebSocket 客户端调 API/状态机。
- 断点直接落在 `apps/server/src/**`。

---

## 3. 附加到 tsx watch

```
Server · 附加到 tsx watch（:9229）
```

该配置会先运行任务 `server:debug:watch`：

```bash
cd apps/server
tsx watch --inspect=9229 src/index.ts
```

然后附加到 `9229`，`restart: true` 会在 tsx 重载后自动重连。服务端监听 **8810**（与生产端口一致；请先停止 `npm start`）。

> 这是「改一行服务端代码就自动重启并保持调试」的配置；F5 全栈配置则胜在一条命令同时启动前后端。

---

## 4. 仅调前端

```
Console · Chrome（开发页 :5173）
```

- 预启动任务 `vite:ensure`：如果 5173 没有 Vite，会以分离进程启动；如果已在跑则直接复用。
- 5173 的 `/api` 与 `/ws` 默认代理到 **8810**。
- 如果 8810 没有服务，请先 `npm run dev:server` 或 `npm start`。
- 断点直接落在 `apps/console/src/**`。

```
Console · Chrome（调试页 :5174）
```

- 用于 F5 全栈会话已经启动、只想再开一个 Chrome 调试页的情况；它不会启动 Vite。

---

## 5. 测试与构建

| 配置 / 任务 | 用途 |
|---|---|
| `Vitest · 当前测试文件` | 调试当前打开的 `*.test.ts`（`${relativeFile}`） |
| `Vitest · 全部` | 调试全部 44 项测试 |
| 任务 `test:all` | 终端运行 `npm test` |
| 任务 `typecheck` | `npm run typecheck` |
| 任务 `build:prod` | `npm run build` |
| `Production · 构建并运行（:8810）` | 先构建，再调试 **打包后的** 服务端（`apps/server/dist/index.js`） |

调试 Vitest 时，测试文件里的断点会生效；不支持在 `beforeEach` 里跨进程断点。

---

## 6. 编译产物调试（断点兜底）

如果 TS 源映射在某些 tsx/VS Code 组合下不绑定，可使用打包产物：

- 选择 `Server · 编译产物调试（:8820）`：预启动任务 `build:server`（tsup），再调试 `apps/server/dist/index.js`。
- `tsup` 生成的 source map 会把 `dist/index.js` 映射回 `apps/server/src/**`。
- 或选择 `Production · 构建并运行（:8810）`：先 `npm run build`，再调试生产服务端（8810）。
- 前端仍可用 `Console · Chrome` 配置（生产页面或 5173 Vite）。

---

## 7. 端口与故障排查

| 端口 | 用途 |
|---|---|
| `8810` | 生产：`npm start`（Fastify 静态托管 + API/WS） |
| `5173` | 常规开发：Vite（`npm run dev`） |
| `5174` | F5 调试：Vite |
| `8820` | F5 调试：API/WS |
| `9229` | tsx watch inspector（附加配置） |

常见问题：

- **F5 启动后马上退出**：8820 或 5174 被占用。关闭旧调试会话 / 旧 Vite。
- **Chrome 打开但页面 502**：API 未就绪，等 1–2 秒刷新；查看 `MAGNAV DEBUG READY` 是否输出。
- **F5 打开的是生产 8810**：默认配置是 5174；检查调试下拉是否选错，或上次会话遗留。
- **断点不绑定**：见第 1 节末尾；优先尝试「Production · 构建并运行」。
- **改了服务端代码没反应**：F5 配置不 watch 服务端；重启调试。需要自动重启时用第 3 节。
- **Windows 下端口被占用查询**：
  ```powershell
  Get-NetTCPConnection -LocalPort 8810,8820,5173,5174 -ErrorAction SilentlyContinue |
    Select-Object LocalPort, State, OwningProcess
  ```

---

## 8. 命令行等价方式

```bash
# 全栈调试入口（不带 inspector 时也可直接跑）
npm run debug:fullstack

# 仅服务端
npm run debug:server

# 常规开发
npm run dev

# 构建 + 生产
npm run build
npm start
```

F5 只是把上述入口接到 VS Code 调试器上；两者行为一致。
