# codex-mgr

`codex-mgr` 是一个本地 Codex 多实例管理器，用于创建、启动、停止和删除隔离的 Codex 桌面客户端 / CLI 实例，并通过 OpenCodex 代理接入第三方模型服务。

它面向本地使用，默认只监听 `127.0.0.1`。

## 功能

- 自动检测本机 Codex CLI、OpenCode CLI 和 Codex 桌面客户端
- 导入现有 `~/.codex/config.toml`
- 创建独立第三方 provider 实例
- 支持 DeepSeek、OpenCode Zen、OpenCode Go、OpenAI 和自定义 provider
- 内置 / 动态模型目录
- 隔离桌面客户端 profile
- 启动 / 停止桌面客户端和 CLI
- 显示真实进程、PID、启动时间、profile 占用状态
- API key 集中存储并按 env key 注入
- 记录创建、启动、停止、删除、模型切换和 OpenCodex 事件
- OpenCodex 独立后台运行，不随面板退出
- 支持面板后台启动、状态查询和停止

## 支持的模型来源

| 来源 | 说明 |
| --- | --- |
| DeepSeek | 默认探测 `https://api.deepseek.com/` 的 `/models`，失败时使用内置目录 |
| OpenCode Zen | 通过本地 OpenCodex 代理和内置目录 |
| OpenCode Go | 通过本地 OpenCodex 代理和内置目录 |
| OpenAI | 使用 Codex CLI 内置模型目录 |
| 自定义 | 填写 provider id、base URL、env key，并可选填写 API key |

## 安装

需要：

- Bun
- Codex CLI
- Codex / ChatGPT 桌面客户端

安装依赖：

```bash
bun install
```

## 开发

```bash
bun run dev
```

开发服务默认地址：

```text
http://127.0.0.1:9810
```

如果 9810 被占用，Vite 会自动尝试后续端口。

## 构建

```bash
bun run build
```

## 前台启动

```bash
bun run start
```

适合调试日志或直接在终端观察输出。

## 后台启动 / 停止面板

后台启动：

```bash
bun run daemon start
```

查询状态：

```bash
bun run daemon status
```

输出示例：

```text
running pid=12345 url=http://127.0.0.1:9810
log=C:\Users\<user>\.codex-mgr\panel.log
```

停止面板：

```bash
bun run daemon stop
```

`daemon stop` 只停止面板进程：

- 不停止 OpenCodex
- 不停止已启动的 Codex 实例
- 不删除任何实例数据

## OpenCodex

OpenCodex 是 OpenCode Zen / Go 相关实例的本地代理依赖。

面板启动 OpenCodex 时会：

1. 请求 `http://127.0.0.1:10100/healthz`
2. 校验响应中 `service === "opencodex"`
3. 如果已有健康实例，直接采纳
4. 如果没有，通过 Bun 启动独立 detached 进程

因此：

- 面板退出不会停止 OpenCodex
- 面板重启后会重新识别已有 OpenCodex
- OpenCodex 可以独立于面板持续服务已启动实例

显式停止 OpenCodex：

```bash
curl -X POST http://127.0.0.1:9810/api/adapters/opencodex/stop
```

## 数据目录

### 面板状态

```text
~/.codex-mgr/
```

包含：

| 文件 / 目录 | 说明 |
| --- | --- |
| `registry.json` | 实例注册表 |
| `.env` | API key |
| `activity.jsonl` | 操作历史 |
| `panel-state.json` | 后台面板 PID / 端口状态 |
| `panel.log` | 后台面板日志 |
| `logs/` | CLI 日志 |

### Codex 实例

```text
~/.codex-instances/<instance-id>/
```

每个实例包含：

- `config.toml`
- `models.json`
- `.desktop-profile/`
- 本地会话数据
- 配置备份

### 官方实例

官方实例复用：

```text
~/.codex
```

不会为官方实例创建独立实例目录。

## API key

第三方 provider 的 API key 不会写入实例 `config.toml`。

面板会将 key 存入：

```text
~/.codex-mgr/.env
```

实例配置中只写入 env key 名称，例如：

```toml
[model_providers.deepseek]
base_url = "https://api.deepseek.com/"
env_key = "DEEPSEEK_API_KEY"
```

启动实例时，面板读取 `.env` 并注入对应环境变量。

如果多个实例共享同一个 env key，删除其中一个实例不会删除 key。只有没有任何剩余实例引用时，才会清理。

## 删除实例

删除非官方实例会：

1. 停止该实例检测到的桌面 / CLI 进程
2. 删除实例目录
3. 删除本地会话和配置备份
4. 在没有其他实例引用时删除 API key

官方实例不可删除，因为它共享 `~/.codex` 和已登录桌面客户端 profile。

## 进程状态识别

面板同时结合两类信息识别进程：

1. 本面板启动进程时留下的 registry 记录
2. 桌面进程命令行中的 `--user-data-dir`

这保证了：

- 面板重启后仍能找到真实桌面进程
- “运行中”状态和“停止”操作使用同一事实来源
- 多个隔离 profile 不互相误杀
- 未跟踪进程会被显示为 untracked

## 常用 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/status` | 检测 CLI、桌面客户端和进程状态 |
| `GET` | `/api/instances` | 列出实例及真实运行状态 |
| `POST` | `/api/instances` | 创建实例 |
| `DELETE` | `/api/instances/:id` | 删除实例 |
| `POST` | `/api/instances/:id/launch` | 启动实例 |
| `POST` | `/api/instances/:id/stop` | 停止实例 |
| `POST` | `/api/instances/:id/switch-model` | 切换当前模型 |
| `GET` | `/api/instances/:id/activity` | 查看实例操作历史 |
| `GET` | `/api/models` | 获取模型目录 |
| `POST` | `/api/adapters/opencodex/start` | 启动 OpenCodex |
| `POST` | `/api/adapters/opencodex/stop` | 停止 OpenCodex |

## 项目结构

```text
src/
  routes/              前端页面
  http/                Hono API
  clone.ts             实例配置生成
  launcher.ts          桌面客户端 / CLI 启动
  runtime.ts           实例运行状态解析
  registry.ts          实例注册表
  activity.ts          操作历史
  opencodex-adapter.ts OpenCodex 适配层
  models.ts            模型目录
scripts/
  start.ts             前台启动
  daemon.ts            后台启动 / 状态 / 停止
tests/                 单元测试
```

## 验证

```bash
bun run typecheck
bun test
bun run build
```

## 当前限制

- 面板 API 尚未增加浏览器鉴权层，建议只在可信本机环境使用
- 官方实例默认共享桌面客户端 profile，不支持安全多开
- 外部终端启动的 CLI 进程不保证可由面板精确停止
- Windows 是当前主要验证平台，macOS 支持仍需实测
