# 通用多 Agent 会议系统 MVP

这是根据 `docs/通用多Agent会议系统产品设计文档_MVP.md` 落地的第一版 CLI 运行时。它不是 Web UI，而是配置驱动的会议 Runtime：加载 Meeting Type、Agent Template 和 Meeting Instance，自动推进 Stage，生成 Message/Event、Stage Output、Final Output 和会议内 Memory。

## 已实现

- 3 个 Meeting Type：`brainstorm`、`review`、`roundtable`
- Agent Template / Agent Instance 初始化与覆盖
- Normal Stage 与 Turn Mode Stage
- 优先级 Event Queue 与简化事件抑制
- 显式 Event Processor 与 event_handling_log，可查看事件处理链
- Event-driven / reviewer_once_each / round_robin 等 Speaker Selector
- Context Package 构造
- mock LLM provider，默认无需 API key
- 用户干预：pause、resume、stop、end、insert、force、disable、switch、summary
- Stage Output、Final Output、meeting_memory、stage_memory、agent_private_memory
- CLI 单步执行与完整运行

## 快速开始

```bash
npm install
npm run demo
```

demo 会运行：

```bash
tsx src/cli.ts run configs/instances/meetings/brainstorm_demo.yaml --fresh
```

默认 demo 使用 mock provider，不会调用真实大模型。

## 使用 DeepSeek

先设置 DeepSeek API Key：

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-api-key"
```

也可以复制 `.env.example` 为 `.env`，把 key 填进去；运行时会自动读取 `.env`。

然后运行 DeepSeek 真实模型测试实例：

```bash
npm run cli -- run configs/instances/meetings/brainstorm_deepseek.yaml --fresh
```

如果用 TUI 验证：

```bash
npm run tui
```

进入 TUI 后可以在底部指令输入区执行：

```text
select deepseek
init
step
messages
events
step
run
final
```

DeepSeek 配置位于：

```text
configs/instances/meetings/brainstorm_deepseek.yaml
configs/templates/model_profiles/deepseek_v4_flash.yaml
```

当前默认模型是 `deepseek-v4-flash`，接口地址默认是 `https://api.deepseek.com`，也可以通过 `DEEPSEEK_BASE_URL` 覆盖。

还可以直接运行另外两种 Meeting Type：

```bash
npm run cli -- run configs/instances/meetings/review_demo.yaml --fresh
npm run cli -- run configs/instances/meetings/roundtable_demo.yaml --fresh
```

输出文件会写入：

```text
runs/meeting_001/
  state.json
  transcript.md
  messages.json
  events.json
  stage_outputs.yaml
  final_output.yaml
  memory.yaml
```

## CLI

启动 TUI 逐项验证 MVP：

```bash
npm run tui
```

TUI 是中文界面，支持选择会议实例、初始化/加载智能体、单步推进、跑到完成、暂停/恢复/停止、插入用户消息、点名智能体、禁用智能体、切换阶段，并查看智能体、阶段、消息、事件、事件处理器、阶段输出、最终输出和记忆。
其中 `handlers / 事件处理器` 可以查看 event 从 EventQueue 取出后，被 EventProcessor、阶段管理器、发言者选择器、记忆管理器等处理器消费的记录。
首次执行 `init / 初始化` 时，如果还没有选择会议实例，TUI 会先弹出会议 config 列表；也可以提前用 `select mock`、`select deepseek` 或 `select <关键词>` 指定。

TUI 底部有常驻“指令输入”区域，按 `/` 聚焦输入框，输入指令后按 Enter 执行。常用指令：

```text
init / 初始化
step / 下一步
run / 运行
pause / 暂停
resume / 恢复
insert 请优先考虑低预算实验
force critic_agent
disable critic_agent
add critic_agent
add creative_agent 新创意顾问
switch convergence
select mock
messages / 消息
events / 事件
handlers / 事件处理器
timeline / 时序图
commands / 命令
collapse all
expand all
collapse divergent_ideas
expand divergent_ideas
outputs / 输出
final / 最终
memory / 记忆
```

`timeline / 时序图` 会显示 `MSG`、`EVT`、`HND`、`OBJ` 四类记录，其中 `HND` 表示 event 被 EventProcessor、发言者选择器、记忆管理器等处理器消费的时序，`OBJ` 表示 MeetingController、EventQueue、SpeakerSelector、ContextBuilder、AgentInvoker、MemoryManager、OutputManager 等核心对象活动。

完整跑完一次会议：

```bash
npm run cli -- run configs/instances/meetings/brainstorm_demo.yaml --fresh
```

单步推进，便于运行中干预：

```bash
npm run cli -- step configs/instances/meetings/brainstorm_demo.yaml --fresh
npm run cli -- intervene meeting_001 force critic_agent
npm run cli -- step configs/instances/meetings/brainstorm_demo.yaml
```

常用干预：

```bash
npm run cli -- intervene meeting_001 pause
npm run cli -- intervene meeting_001 resume
npm run cli -- intervene meeting_001 insert "请优先考虑低预算实验"
npm run cli -- intervene meeting_001 force product_manager
npm run cli -- intervene meeting_001 disable critic_agent
npm run cli -- intervene meeting_001 add creative_agent
npm run cli -- intervene meeting_001 switch convergence
npm run cli -- intervene meeting_001 end
```

查看状态：

```bash
npm run cli -- inspect meeting_001
```

## 开发校验

```bash
npm run typecheck
npm test
```

## 主要目录

```text
configs/
  system/
  templates/
    meeting_types/
    agents/
    output_schemas/
  instances/meetings/
src/
  config/
  providers/
  runtime/
tests/
```

## 说明

当前 provider 使用 deterministic mock 输出，目的是先验证多 Agent 自动会议闭环。`model_config` 已保留 `provider/model/temperature/max_tokens/top_p` 字段，后续可以在 `AgentInvoker` 中接入真实 LLM provider。
