# codex-mgr

本地多实例管理器，用于隔离启动 Codex 桌面客户端、Codex CLI，以及通过 OpenCodex 代理访问第三方 provider。

## 数据目录

- 实例配置：`~/.codex-instances/<instance-id>/`
- 面板状态：`~/.codex-mgr/registry.json`
- API key：`~/.codex-mgr/.env`
- 活动历史：`~/.codex-mgr/activity.jsonl`
- CLI 日志：`~/.codex-mgr/logs/`

删除非官方实例会终止其检测到的进程，并永久删除对应实例目录及本地会话。API key 只有在没有其他实例引用时才会清理。

## OpenCodex

OpenCodex 通过 Bun 作为独立 detached 进程启动。面板退出不会停止 OpenCodex；启动前会检查 `/healthz` 并确认响应身份为 `service: "opencodex"`，已有健康实例时直接采纳。

## 开发

```bash
bun install
bun run dev
```

## 构建 / 生产启动

```bash
bun run build
bun run start
```

## 后台运行 / 退出

```bash
# 后台启动面板
bun run daemon start

# 查看面板状态
bun run daemon status

# 只停止面板，OpenCodex 和实例继续运行
bun run daemon stop
```

状态文件位于 `~/.codex-mgr/panel-state.json`，日志位于 `~/.codex-mgr/panel.log`。

OpenCodex 是独立进程。需要停止 OpenCodex 时调用：

```bash
curl -X POST http://127.0.0.1:9810/api/adapters/opencodex/stop
```
