# 通用多 Agent 会议系统产品设计文档

版本：MVP 设计版
定位：产品 PRD + 架构设计 + 配置规范

---

# 1. 项目一句话定义

这是一个**通用多 Agent 会议运行系统**，用户可以基于不同 Meeting Type 创建会议，让多个具备独立身份、目标、记忆、上下文边界和 LLM 模型配置的 Agent，在 Controller 调度下围绕目标自动讨论、响应事件、推进阶段，并生成结构化会议结果。

---

# 2. 产品目标

本系统不是普通 Agent 群聊，而是一个可配置、可暂停、可干预、可复用的多 Agent 会议 Runtime。

核心目标：

1. 支持多种会议类型，例如头脑风暴、方案评审、多角色圆桌、辩论、剧情推演等。
2. 支持多个独立 Agent 参与会议，每个 Agent 可使用不同模型。
3. 支持会议启动后自动推进讨论，而不是等待用户逐句输入。
4. 支持用户运行时暂停、停止、插入、点名、禁用 Agent、切换阶段。
5. 支持 Message + Event 驱动的会议推进机制。
6. 支持 Stage Output、Final Output 和 Memory Commit。
7. 支持通过配置文件创建 Meeting Type、Agent Template 和 Meeting Instance。
8. MVP 第一版优先验证「多 Agent 自动会议闭环」。

---

# 3. 核心使用场景

## 3.1 头脑风暴

用户输入一个主题，系统自动组织多个 Agent 进行发散、补充、质疑、收敛，最终输出创意列表和推荐方向。

## 3.2 方案评审

用户输入一个方案，系统组织产品、技术、市场、风险等 Agent 评审方案，最终输出优点、风险、修改建议和决策结论。

## 3.3 多角色圆桌

多个不同立场或身份的 Agent 围绕一个议题讨论，用户可中途插入意见、点名某个 Agent 回应。

## 3.4 剧情推演 / NPC 演进

多个角色 Agent 在特定世界状态下互动，系统推进事件、记录角色状态变化，并输出剧情走向。

---

# 4. 用户角色

## 4.1 会议创建者

负责选择 Meeting Type，填写会议目标，选择 Agent，配置输入材料。

## 4.2 会议干预者

在会议运行中插入意见、暂停、恢复、停止、点名 Agent、切换阶段。

## 4.3 模板设计者

设计 Meeting Type Template、Stage Template、Agent Template、输出格式和默认策略。

## 4.4 系统开发者

实现 Controller、Event Queue、Agent Invoker、Memory Manager、配置加载器等核心模块。

---

# 5. 核心设计原则

1. **Meeting Type 是会议蓝图，Meeting Instance 是一次真实运行。**
2. **Stage 是会议推进的基本单位。**
3. **Agent 是独立个体，不是简单 Prompt。**
4. **Controller 是 Orchestrator，不是普通 Agent。**
5. **Agent 输出 Message + Event，而不是直接修改状态。**
6. **Event 进入队列，由 Controller 决定响应者。**
7. **用户干预也进入 Message + Event 体系。**
8. **输出结果分为 Stage Output、Final Output、Memory Commit。**
9. **MVP 做会议闭环，不做完整复杂 Agent OS。**

---

# 6. Meeting Type 设计

## 6.1 Meeting Type 定义

Meeting Type 是一种会议模板，采用：

> 场景模板 + 流程模板 + 策略默认值

它负责定义某类会议的默认结构、默认 Agent、默认阶段、默认策略和默认输出格式。

## 6.2 Meeting Type Template 分层结构

```yaml
type_id: brainstorm
type_name: 头脑风暴
description: 用于围绕主题进行发散、补充、收敛的多 Agent 会议

goal_schema:
  required:
    - topic
  optional:
    - constraints
    - target_audience

input_schema:
  required:
    - user_brief
  optional:
    - reference_materials

stage_templates:
  - stage_id: opening
  - stage_id: divergent_ideas
  - stage_id: convergence
  - stage_id: final_summary

output_schema:
  type: brainstorm_output

default_agent_roles:
  - facilitator
  - creative_agent
  - critic_agent
  - summarizer_agent

default_controller_policy:
  max_total_turns: 20
  max_events_per_turn: 3

default_context_policy:
  recent_message_limit: 10
  include_stage_outputs: true

default_user_intervention_policy:
  allow_pause: true
  allow_stop: true
  allow_insert_message: true
  allow_force_agent_speak: true

override_policy:
  allow_goal_override: true
  allow_agent_override: true
  allow_stage_param_override: true
  allow_core_stage_structure_override: false
```

---

# 7. Meeting Instance 设计

## 7.1 Meeting Instance 定义

Meeting Instance 是基于 Meeting Type 创建的一次真实会议运行。

采用：

> 中等覆盖模式

即默认继承 Meeting Type，但允许用户安全覆盖部分配置。

## 7.2 可覆盖内容

Meeting Instance 可覆盖：

* 会议标题
* 会议目标
* 输入材料
* 参与 Agent 列表
* Agent 模型配置
* Agent 启用 / 禁用
* Stage 参数
* Speaking Strategy 参数
* 结束条件参数
* 输出格式参数

不可直接覆盖：

* Meeting Type 的核心场景定义
* Controller 基础规则
* Message System 基础规则
* Meeting State Machine 基础规则

## 7.3 Meeting Instance 示例

```yaml
meeting_id: meeting_001
meeting_type_id: brainstorm
title: AI 编程助手增长方案头脑风暴

goal:
  topic: 如何提升 AI 编程助手的用户留存
  constraints:
    - 面向独立开发者
    - 低预算增长

input_materials:
  - 当前产品功能说明
  - 用户反馈摘要

agent_overrides:
  - agent_template_id: creative_agent
    instance_name: 创意专家
    model_config:
      provider: openai
      model: gpt-4.1

  - agent_template_id: critic_agent
    enabled: true

stage_overrides:
  - stage_id: divergent_ideas
    max_turns: 6
```

---

# 8. Stage 设计

## 8.1 Stage 是核心执行单位

每个 Meeting Type 必须包含 Stage。

Controller 按 Stage 推进会议。

## 8.2 Stage Execution Mode

Stage 支持两种模式：

### Normal Stage

一次性执行。

适合：

* 开场
* 总结
* 评分
* 决策
* 最终输出

### Turn Mode Stage

多轮执行。

适合：

* 头脑风暴
* 辩论
* 圆桌讨论
* 方案评审
* 剧情推演

## 8.3 Stage Template 分层结构

```yaml
stage_id: divergent_ideas
stage_name: 发散创意阶段
stage_goal: 产生尽可能多的不同方向创意
execution_mode: turn

participant_rule:
  include_roles:
    - creative_agent
    - product_agent
    - critic_agent

speaking_strategy:
  type: event_driven
  allow_agent_readiness: true

context_rule:
  recent_message_limit: 10
  include_meeting_goal: true
  include_stage_goal: true
  include_stage_outputs: true

completion_condition:
  max_turns: 6
  required_outputs:
    - idea_list
  no_high_priority_events: true

output_rule:
  type: structured
  schema:
    idea_list: list
    categories: list
    open_questions: list

turn_policy:
  max_turns: 6
  max_responses_per_event: 2

optional:
  memory_rule: default
  tool_rule: none
  visibility_rule: stage_scope
  convergence_strategy: summarize_and_rank
  repetition_guard: true
```

---

# 9. Agent 设计

## 9.1 Agent 系统级类型

MVP 采用三类：

1. **Participant Agent**

   * 前台参与讨论
   * 可以被发言选择机制选中
   * 默认对用户可见

2. **Service Agent**

   * 后台辅助会议运行
   * 由 Controller 触发
   * 例如总结员、记录员、评价员、检查员

3. **Meeting Controller**

   * 不是普通 Agent
   * 是会议调度器和 Orchestrator

## 9.2 Agent 配置采用分层结构

```yaml
agent_id: product_manager_template
agent_name: 产品经理
agent_type: participant
agent_role: product_manager
description: 负责从用户价值和产品可行性角度参与讨论

profile:
  goal: 发现用户价值和产品机会
  personality: 理性、关注用户、注重可落地性
  speaking_style: 清晰、结构化、偏产品分析
  knowledge_boundary: 只基于会议上下文和已提供材料判断
  behavior_constraints:
    - 不编造不存在的数据
    - 不偏离当前 Stage 目标

capabilities:
  model_config:
    provider: openai
    model: gpt-4.1
    generation_params:
      temperature: 0.7
      max_tokens: 1500
      top_p: 1.0

  tools: []
  memory_access:
    public_memory: read
    private_memory: read_write
  context_access:
    visibility_scope: stage
  permissions:
    can_speak: true
    can_emit_events: true
    can_update_state: false

runtime_policy:
  speaking_permission: selectable
  activation_rule:
    event_subscriptions:
      - question_raised
      - risk_identified
      - decision_requested
  visibility: visible_to_user
  output_schema: message_and_event
```

---

# 10. Agent Template 与 Agent Instance

## 10.1 强区分

系统强区分：

* Agent Template
* Agent Instance

## 10.2 Agent Template

Agent Template 是可复用蓝图，保存默认身份、角色、风格、能力、模型配置和权限。

## 10.3 Agent Instance

Agent Instance 属于某个 Meeting Instance。

它从 Agent Template 创建，可覆盖部分配置，并保存本次会议内运行状态。

```yaml
agent_instance:
  instance_id: agent_pm_001
  template_id: product_manager_template
  meeting_id: meeting_001
  enabled: true

  overrides:
    goal: 专注评估 AI 编程助手的留存增长机会

  runtime_state:
    enabled: true
    current_stage_id: divergent_ideas
    current_turn_index: 2
    last_spoken_turn: 1
    stage_status: active
```

---

# 11. Agent Runtime State 设计

MVP 采用分层 Runtime State。

## 11.1 MVP 必须实现

```yaml
runtime_state:
  enabled: true
  current_stage_id: divergent_ideas
  current_turn_index: 2
  last_active_at: "2026-06-24T10:00:00+08:00"
  last_spoken_turn: 1
  last_message_ids:
    - msg_001

  stage_status: active
  pending_user_request: null
  forced_next_speaker: false
  skip_reason: null
```

## 11.2 后续扩展

```yaml
cognitive_state:
  temporary_goal: null
  current_position: null
  open_questions: []
  claims_made: []
  claims_to_respond: []

memory_refs:
  private_memory_refs: []
  public_memory_refs: []
  context_snapshot_ref: null
```

完整心理状态模型放入后续待办。

---

# 12. Agent LLM Model Config 设计

采用分层 Model Config。

```yaml
model_config:
  provider: openai
  model: gpt-4.1

  generation_params:
    temperature: 0.7
    max_tokens: 2000
    top_p: 1.0

  cost_policy:
    max_tokens_per_call: 4000
    max_cost_per_call: null

  fallback_policy:
    enabled: false
    fallback_models: []
```

MVP 必须实现：

* provider
* model
* temperature
* max_tokens
* top_p

后续扩展：

* fallback_policy
* model_router
* task_based_model_selection

---

# 13. Agent Invocation Contract

Agent 被 Controller 调用时，输入是 Context Package，输出是 Message + Event。

## 13.1 输入

```yaml
agent_invocation_input:
  agent_instance: {}
  meeting_context: {}
  stage_context: {}
  turn_context: {}
  visible_messages: []
  active_events: []
  relevant_memory: []
  user_instruction: null
  output_requirement: {}
```

## 13.2 输出

```yaml
agent_invocation_output:
  messages:
    - message_type: opinion
      content: "我认为可以从插件生态切入。"
      target:
        type: stage
        id: divergent_ideas
      metadata:
        confidence: 0.8

  events:
    - event_type: opinion_created
      category: discussion_event
      source_message_id: msg_001
      payload:
        topic: plugin_ecosystem
```

Agent 不直接修改状态。

---

# 14. Message System 设计

Message 是语义结构化对象。

```yaml
message:
  message_id: msg_001
  meeting_id: meeting_001
  stage_id: divergent_ideas
  turn_id: turn_002
  sender_id: agent_pm_001
  sender_type: participant_agent
  message_type: opinion
  content: "我认为可以从插件生态切入，提升用户长期留存。"
  target:
    type: stage
    id: divergent_ideas
  reply_to_message_id: null
  visibility_scope: stage
  metadata:
    tags:
      - retention
      - ecosystem
    confidence: 0.82
  created_at: "2026-06-24T10:00:00+08:00"
```

## 14.1 MVP Message Type

* opinion
* question
* answer
* critique
* support
* clarification
* summary
* decision
* instruction
* system_notice

后续扩展：

* content_blocks
* attachments
* citations
* scorecards
* whiteboard_refs

---

# 15. Event System 设计

## 15.1 Message 与 Event 的关系

Message 和 Event 是独立对象。

Event 可以通过 `source_message_id` 关联 Message。

```yaml
event:
  event_id: evt_001
  meeting_id: meeting_001
  stage_id: divergent_ideas
  category: discussion_event
  event_type: risk_identified
  source_message_id: msg_002
  source_agent_id: critic_agent_001
  priority: medium
  payload:
    risk_type: user_value_unclear
    severity: high
  created_at: "2026-06-24T10:01:00+08:00"
```

## 15.2 Event Type 三层结构

### System Event

用于会议运行控制。

* meeting_started
* meeting_paused
* meeting_resumed
* meeting_stopped
* stage_started
* stage_completed
* stage_transition_requested
* agent_added
* agent_disabled
* user_intervention_received

### Discussion Event

用于讨论语义触发。

* opinion_created
* question_raised
* critique_raised
* support_added
* conflict_detected
* risk_identified
* summary_requested
* decision_requested
* clarification_requested
* repetition_detected

### Domain Event

由 Meeting Type 自定义，但必须映射到基础事件类型。

例如：

```yaml
domain_events:
  character_conflict:
    base_type: conflict_detected
  feasibility_risk:
    base_type: risk_identified
  world_state_changed:
    base_type: state_changed
```

---

# 16. Event 响应机制

采用：

> Stage Rule + Agent Subscription + Controller Resolver

## 16.1 Stage Event Rule

```yaml
event_response_rule:
  risk_identified:
    required_responder_roles:
      - solution_owner
      - product_manager
    service_agents:
      - recorder_agent
```

## 16.2 Agent Event Subscription

```yaml
event_subscriptions:
  - question_raised
  - risk_identified
  - decision_requested
```

## 16.3 Controller Resolver

Controller 根据以下因素选择响应者：

* 当前 Stage
* Event Type
* Event Priority
* Stage Event Rule
* Agent Subscription
* Agent Runtime State
* 用户点名
* 最近发言情况
* 是否重复发言
* 是否与 Stage Goal 相关

---

# 17. Event Queue 与处理机制

采用：

> 优先级 Event Queue + Event 合并 / 抑制机制

```yaml
event_queue_policy:
  queue_type: priority_queue
  max_events_per_turn: 3
  max_responses_per_event: 2
  merge_similar_events: true
  suppress_low_value_events: true
```

## 17.1 优先级

High：

* pause
* stop
* resume
* user_intervention
* stage_transition

Medium：

* risk_identified
* question_raised
* conflict_detected
* decision_requested

Low：

* opinion_created
* support_added
* repetition_detected

## 17.2 合并规则

相似 Event 可以合并：

* 相同 event_type
* 相似 payload
* 相同 stage_id
* 相同 topic

## 17.3 抑制规则

低价值 Event 可被抑制：

* 重复
* 与当前 Stage Goal 无关
* 超出每轮处理上限
* 只产生无目标闲聊

---

# 18. Speaker Selection 机制

采用：

> Speaking Strategy + Agent Readiness + Controller Selector

## 18.1 Stage Speaking Strategy

MVP 支持：

* round_robin
* free_discussion
* event_driven
* reviewer_once_each
* moderator_controlled

后续扩展：

* debate_alternating
* small_group_discussion
* graph_workflow_driven

## 18.2 Agent Readiness

```yaml
agent_readiness:
  agent_id: product_manager
  wants_to_speak: true
  reason: "需要回应用户价值风险"
  relevance_score: 0.92
  urgency_score: 0.85
  novelty_score: 0.74
```

## 18.3 Controller Selector

Controller 最终输出：

```yaml
selected_speaker:
  agent_id: product_manager
  reason: 当前风险事件指向产品价值，需要产品经理回应
  expected_response_type: answer
  max_response_length: 500
```

---

# 19. Context System 设计

采用：

> Context Package + Visibility Rule + Retrieval

## 19.1 Context Package

```yaml
context_package:
  meeting_context:
    meeting_goal: {}
    meeting_type: brainstorm
    input_materials: []

  stage_context:
    stage_id: divergent_ideas
    stage_goal: 产生创意
    stage_mode: turn
    stage_progress: {}

  turn_context:
    current_turn: 2
    active_events: []

  visible_messages:
    recent_visible_messages: []
    referenced_messages: []

  agent_context:
    agent_role: product_manager
    agent_goal: 评估用户价值
    runtime_state: {}
    permissions: {}

  memory_context:
    relevant_public_memory: []
    relevant_private_memory: []

  output_requirement:
    expected_message_type: opinion
```

## 19.2 MVP 简化实现

MVP 至少注入：

* meeting_goal
* stage_goal
* current_turn
* active_events
* recent_visible_messages
* agent_runtime_state
* relevant_stage_outputs

---

# 20. Memory System 设计

采用分层 Memory System。

## 20.1 MVP 必须实现

### meeting_memory

保存当前会议公共记忆：

* 会议目标
* 关键结论
* 开放问题
* 风险
* 阶段摘要

### stage_memory

保存当前 Stage 记忆：

* Stage Input
* Stage Output
* Stage 内关键事件
* Stage 内关键消息

### agent_private_memory

保存某个 Agent Instance 的会议内私有记忆：

* 私有观察
* 待回应事项
* 当前立场
* 未完成任务

## 20.2 MVP 可选

### service_memory

由 Service Agent 维护，例如记录员、总结员、评价员。

## 20.3 后续扩展

* global_memory
* retrieval_index
* vector retrieval
* timeline retrieval
* cross-meeting memory

---

# 21. Meeting Controller 设计

Controller 采用：

> Orchestrator + 多个内部 Manager

## 21.1 Controller 职责

MVP 逻辑职责：

* 加载 Meeting Type Template
* 创建 Meeting Instance
* 初始化 Agent Instance
* 执行 Stage
* 管理 Turn Loop
* 处理 Event Queue
* 选择下一个 Speaker
* 构造 Context Package
* 调用 Agent
* 校验 Message / Event
* 路由 Message
* 更新 Runtime State
* 写入 Memory
* 处理用户干预
* 判断 Stage 是否完成
* 判断 Meeting 是否结束
* 生成最终输出

## 21.2 后续工程拆分

```text
MeetingController
  StageManager
  TurnManager
  EventManager
  SpeakerSelector
  ContextBuilder
  AgentInvoker
  MemoryManager
  StateManager
  InterventionManager
  OutputManager
```

MVP 可以先合并实现为一个 Controller 类，但代码结构应保留拆分边界。

---

# 22. 自动讨论主循环

采用：

> Stage 主导 + Event 驱动的混合主循环

## 22.1 Normal Stage

```text
1. Controller 启动 Stage
2. 构造 Context Package
3. 调用指定 Agent / Service Agent
4. 生成 Message / Event
5. 生成 Stage Output
6. 写入 Memory
7. 判断进入下一 Stage
```

## 22.2 Turn Mode Stage

```text
1. 处理用户控制 Event
2. 处理高优先级 Event
3. 合并 / 抑制低价值 Event
4. 根据 Stage Speaking Strategy 生成候选 Agent
5. 根据 Event Resolver 补充候选 Agent
6. 根据 Agent Readiness 计算发言优先级
7. Controller Selector 选择 Speaker
8. 构造 Context Package
9. 调用 Agent
10. 保存 Message
11. 将新 Event 放入 Event Queue
12. 更新 Agent Runtime State
13. 更新 Meeting / Stage Memory
14. 必要时触发 Service Agent
15. 判断 Stage 是否完成
16. 判断是否继续下一 Turn
```

## 22.3 保护机制

* max_turns
* max_events_per_turn
* max_responses_per_event
* repetition_guard
* stage_completion_condition
* user_stop_event 最高优先级

---

# 23. Stage Completion / Transition

采用：

> 硬性保护 + 规则判断 + Service Agent 评估

## 23.1 硬性保护

* max_turns
* max_events_per_stage
* max_duration
* user_stop_event
* forced_stage_transition_event

## 23.2 规则完成条件

* required_outputs 已生成
* required_agent_roles 已覆盖
* no_unresolved_high_priority_events
* minimum_discussion_coverage 达成
* repetition_guard 触发时可进入收敛 / 总结

## 23.3 Service Agent 评估

```yaml
stage_evaluation:
  stage_goal_completed: true
  missing_points: []
  should_continue: false
  suggested_next_stage: convergence
  reason: 阶段目标已覆盖，主要创意已充分产生
```

## 23.4 Controller 最终决策

* continue_current_stage
* enter_stage_summary
* transition_to_next_stage
* pause_for_user_input
* end_meeting

---

# 24. User Intervention 机制

采用：

> Message + Intervention Event + Runtime Patch

## 24.1 用户输入处理流程

```text
1. 用户输入
2. 保存为 User Message
3. Intervention Parser 解析意图
4. 生成 Intervention Event
5. 必要时生成 Runtime Patch
6. 进入高优先级 Event Queue
7. Controller 校验并执行
8. 更新 Meeting / Stage / Agent Runtime State
```

## 24.2 用户干预分级

### Soft Intervention

只影响上下文。

例如：

* 补充观点
* 修正方向
* 提出问题

### Control Intervention

影响运行流程。

例如：

* pause
* resume
* stop
* force_agent_speak
* request_summary
* switch_stage

### Runtime Patch

修改运行时配置。

例如：

* add_agent
* disable_agent
* modify_goal
* modify_stage_param

## 24.3 MVP 支持指令

* pause_meeting
* resume_meeting
* stop_meeting
* end_and_summarize
* user_message_inserted
* force_agent_speak
* disable_agent
* add_participant_agent
* request_stage_summary
* switch_stage

---

# 25. 暂停 / 停止 / 恢复机制

采用：

> 完整状态机 + Event Queue 冻结策略

## 25.1 Meeting Status

```yaml
meeting_status:
  - created
  - initialized
  - running
  - pausing
  - paused
  - resuming
  - summarizing
  - completed
  - stopped
  - failed
```

## 25.2 Pause

规则：

* 产生 meeting_pause_requested Event
* 当前 Agent 调用完成后进入 paused
* 冻结普通 Discussion / Domain Event
* 仍允许用户输入 Control Intervention 和 Runtime Patch

## 25.3 Resume

规则：

* 产生 meeting_resume_requested Event
* 先处理暂停期间积累的 Control Event
* 应用 Runtime Patch
* 重建 Context Package
* 重新执行 Speaker Selection
* 回到 running

## 25.4 Stop

规则：

* 产生 meeting_stop_requested Event
* 冻结 Event Queue
* 不再进入下一 Turn
* 可选择是否生成最终总结

## 25.5 End and Summarize

规则：

* 产生 final_summary_requested Event
* 跳转 summarizing
* 调用 Summary Service Agent
* 生成 Final Output
* 进入 completed

---

# 26. Output Design

采用：

> Stage Output + Final Output + Memory Commit

## 26.1 Stage Output

每个 Stage 完成时生成。

```yaml
stage_output:
  stage_id: divergent_ideas
  output:
    ideas:
      - name: 插件生态增长
        description: 通过插件市场提升用户粘性
    open_questions:
      - 用户是否愿意安装第三方插件？
```

Stage Output 写入 stage_memory，可被后续 Stage 读取。

## 26.2 Final Output

会议结束时生成。

```yaml
final_output:
  executive_summary: 本次会议围绕 AI 编程助手留存增长展开讨论。
  key_points:
    - 插件生态可能提升长期留存
    - 新手引导影响首次激活
  decisions:
    - 优先验证插件生态方向
  risks:
    - 插件开发成本较高
  open_questions:
    - 目标用户是否有强插件需求？
  next_actions:
    - 调研 20 个独立开发者
    - 设计插件 MVP
  stage_outputs: []
  transcript_ref: transcript_001
```

## 26.3 Memory Commit

```yaml
memory_commit:
  meeting_memory:
    decisions:
      - 优先验证插件生态方向
    reusable_insights:
      - 留存增长需要围绕长期工作流嵌入

  agent_private_memory:
    - agent_id: product_manager
      notes:
        - 后续应继续关注用户价值验证
```

---

# 27. 配置文件结构

采用：

> System Defaults + Template Library + Instance Override

## 27.1 目录结构

```text
configs/
  system/
    event_types.yaml
    message_types.yaml
    speaking_strategies.yaml
    context_rules.yaml
    memory_rules.yaml
    controller_defaults.yaml

  templates/
    meeting_types/
      brainstorm.yaml
      review.yaml
      roundtable.yaml

    agents/
      product_manager.yaml
      engineer.yaml
      critic.yaml
      creative_agent.yaml
      summarizer.yaml

    output_schemas/
      brainstorm_output.yaml
      review_output.yaml
      roundtable_output.yaml

    model_profiles/
      gpt_4_1.yaml
      gpt_4_1_mini.yaml
      local_small.yaml

  instances/
    meetings/
      meeting_001.yaml
```

## 27.2 配置覆盖优先级

```text
System Defaults
→ Meeting Type Template
→ Agent Template
→ Meeting Instance Override
→ Runtime Patch
```

---

# 28. YAML 示例

## 28.1 system/event_types.yaml

```yaml
system_events:
  - meeting_started
  - meeting_paused
  - meeting_resumed
  - meeting_stopped
  - stage_started
  - stage_completed
  - stage_transition_requested
  - agent_added
  - agent_disabled
  - user_intervention_received

discussion_events:
  - opinion_created
  - question_raised
  - critique_raised
  - support_added
  - conflict_detected
  - risk_identified
  - summary_requested
  - decision_requested
  - clarification_requested
  - repetition_detected
```

## 28.2 templates/meeting_types/brainstorm.yaml

```yaml
type_id: brainstorm
type_name: 头脑风暴
description: 多 Agent 自动发散、补充、收敛创意

stage_templates:
  - stage_id: opening
    stage_name: 开场
    execution_mode: normal
    stage_goal: 明确问题和讨论目标

  - stage_id: divergent_ideas
    stage_name: 发散创意
    execution_mode: turn
    stage_goal: 产生多方向创意
    max_turns: 6
    speaking_strategy:
      type: event_driven

  - stage_id: convergence
    stage_name: 收敛筛选
    execution_mode: turn
    stage_goal: 筛选高价值创意
    max_turns: 4

  - stage_id: final_summary
    stage_name: 最终总结
    execution_mode: normal
    stage_goal: 输出结构化创意结果

default_agent_roles:
  - facilitator
  - creative_agent
  - critic_agent
  - summarizer_agent

output_schema: brainstorm_output
```

## 28.3 templates/agents/summarizer.yaml

```yaml
agent_id: summarizer_template
agent_name: 总结员
agent_type: service
agent_role: summarizer
description: 负责阶段总结和最终总结

profile:
  goal: 提炼讨论结论，生成结构化输出
  personality: 客观、简洁、结构化
  speaking_style: 总结式、条理清晰
  knowledge_boundary: 只总结会议中已出现的信息

capabilities:
  model_config:
    provider: openai
    model: gpt-4.1-mini
    generation_params:
      temperature: 0.3
      max_tokens: 2000

  memory_access:
    public_memory: read_write
    private_memory: none

runtime_policy:
  speaking_permission: controller_triggered
  activation_rule:
    event_subscriptions:
      - summary_requested
      - stage_completed
  visibility: visible_to_user
```

---

# 29. MVP 范围

MVP 第一版采用：

> 会议闭环 MVP

## 29.1 支持 3 个 Meeting Type

1. brainstorm：头脑风暴
2. review：方案评审
3. roundtable：多角色圆桌

## 29.2 支持核心对象

* Meeting Type Template
* Meeting Instance
* Stage Template
* Agent Template
* Agent Instance
* Message
* Event
* Stage Output
* Final Output

## 29.3 支持 Agent 类型

* Participant Agent
* Service Agent

  * 至少实现 Summary Agent

## 29.4 支持执行能力

* Normal Stage
* Turn Mode Stage
* Stage 主导 + Event 驱动主循环
* 简化 Speaker Selector
* 简化 Event Queue
* 简化 Context Package

## 29.5 支持用户干预

* pause
* resume
* stop
* end_and_summarize
* insert_message
* force_agent_speak
* disable_agent

## 29.6 支持配置文件

* system defaults
* meeting type templates
* agent templates
* meeting instance overrides

## 29.7 MVP 不做

* Web UI
* 完整向量 Retrieval
* 完整长期 Memory
* 模型路由器
* 图结构工作流
* 多模态 Message
* 完整心理状态模型
* Agent Marketplace
* 多用户协同编辑

---

# 30. 后续 Roadmap

## 30.1 高级完全覆盖模式

允许高级用户深度修改 Stage、策略、流程和输出结构。

## 30.2 图结构 / 工作流节点模式

支持条件分支、循环、跳转、子流程。

## 30.3 多级 Agent 类型体系

进一步细分：

* Expert Agent
* Roleplay Agent
* Reviewer Agent
* Judge Agent
* World State Agent
* Memory Agent
* Speaker Selector Agent

## 30.4 完整心理状态模型

用于 NPC 演进、剧情推演、角色长期模拟。

包括：

* beliefs
* desires
* intentions
* emotion_state
* relationship_state
* knowledge_state
* current_plan

## 30.5 模型路由器

根据任务类型、成本、延迟、质量要求自动选择模型。

## 30.6 多模态 Message

支持：

* content_blocks
* attachments
* citations
* scorecards
* whiteboard_refs

## 30.7 Retrieval Index

支持：

* 向量检索
* 标签检索
* 时间线检索
* 跨会议记忆复用

---

# 31. MVP 验收标准

MVP 完成时，系统应满足以下标准：

1. 可以通过配置文件创建一个 Meeting Instance。
2. 可以加载 Meeting Type Template 和 Agent Template。
3. 可以自动初始化 Agent Instance。
4. 可以按 Stage 顺序推进会议。
5. 可以执行 Normal Stage 和 Turn Mode Stage。
6. Agent 可以输出 Message + Event。
7. Event 可以进入 Queue，并影响后续发言选择。
8. Controller 可以选择下一个 Agent 发言。
9. 用户可以暂停、恢复、停止、插入消息、点名 Agent。
10. 每个 Stage 可以生成 Stage Output。
11. 会议结束可以生成结构化 Final Output。
12. 会议结果可以写入 meeting_memory 和 stage_memory。
13. 系统不会退化成简单轮流聊天。
14. 系统具备后续扩展到复杂 Agent Runtime 的结构边界。

---

# 32. 最终结论

本系统的核心不是“多个 Agent 一起聊天”，而是一个以 Meeting Type 为蓝图、以 Stage 为执行单位、以 Controller 为调度核心、以 Message + Event 为交互机制、以 Memory 和 Output 为沉淀结果的多 Agent 会议 Runtime。

MVP 第一版应优先完成「会议闭环」：

```text
配置会议
→ 初始化 Agent
→ 启动 Stage
→ 多 Agent 自动讨论
→ Event 驱动响应
→ 用户可干预
→ Stage Output
→ Final Output
→ Memory Commit
```

这条闭环跑通后，再逐步扩展图结构工作流、长期记忆、复杂角色心理状态、多模型路由和 Web UI。
