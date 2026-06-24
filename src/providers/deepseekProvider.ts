import type {
  AgentInstance,
  AgentInvocationOutput,
  ContextPackage,
  EventCategory,
  EventPriority,
  MessageType,
} from "../types";
import { loadDotEnv } from "../config/env";

interface DeepSeekChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class DeepSeekProvider {
  async invoke(agent: AgentInstance, context: ContextPackage): Promise<AgentInvocationOutput> {
    loadDotEnv();
    const apiKeyEnv = agent.model_config.api_key_env ?? "DEEPSEEK_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`缺少 DeepSeek API Key。请先设置环境变量 ${apiKeyEnv}。`);
    }

    const baseUrl = stripTrailingSlash(
      agent.model_config.base_url ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    );
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(this.buildRequestBody(agent, context)),
    });

    const text = await response.text();
    const data = parseJsonOrNull<DeepSeekChatCompletionResponse>(text);
    if (!response.ok) {
      throw new Error(`DeepSeek 调用失败：HTTP ${response.status} ${data?.error?.message ?? text}`);
    }

    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new Error("DeepSeek 返回为空。");
    }
    return this.parseModelOutput(content, agent, context, data);
  }

  private buildRequestBody(agent: AgentInstance, context: ContextPackage): Record<string, unknown> {
    const params = agent.model_config.generation_params ?? {};
    const body: Record<string, unknown> = {
      model: agent.model_config.model || "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: this.systemPrompt(agent),
        },
        {
          role: "user",
          content: this.userPrompt(context),
        },
      ],
      temperature: params.temperature ?? 0.4,
      max_tokens: params.max_tokens ?? 1200,
      top_p: params.top_p ?? 1,
      stream: false,
      thinking: agent.model_config.thinking ?? { type: "disabled" },
    };
    if (agent.model_config.response_format !== "text") {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  private systemPrompt(agent: AgentInstance): string {
    return [
      "你是一个多智能体会议系统中的独立智能体。",
      "你只能基于会议上下文、阶段目标、可见消息和记忆发言，不要编造外部事实或不存在的数据。",
      "你的输出必须是合法 JSON，不要输出 Markdown，不要输出代码块。",
      "",
      "JSON Schema:",
      JSON.stringify(
        {
          messages: [
            {
              message_type:
                "opinion | question | answer | critique | support | clarification | summary | decision | instruction | system_notice",
              content: "面向会议参与者的中文发言，简明但具体",
              metadata: {
                confidence: 0.8,
              },
            },
          ],
          events: [
            {
              event_type:
                "opinion_created | question_raised | critique_raised | support_added | risk_identified | summary_requested | decision_requested | clarification_requested",
              category: "discussion_event",
              priority: "low | medium | high",
              payload: {
                topic: "与当前发言相关的主题",
              },
              source_message_index: 0,
            },
          ],
        },
        null,
        2,
      ),
      "",
      "智能体设定：",
      `名称：${agent.name}`,
      `角色：${agent.role}`,
      `类型：${agent.type}`,
      `目标：${agent.profile.goal}`,
      `性格：${agent.profile.personality ?? "未指定"}`,
      `发言风格：${agent.profile.speaking_style ?? "清晰、结构化"}`,
      `知识边界：${agent.profile.knowledge_boundary ?? "只基于上下文"}`,
    ].join("\n");
  }

  private userPrompt(context: ContextPackage): string {
    return [
      "请根据下面的 Context Package 生成一次智能体发言和对应事件。",
      "要求：",
      `- 期望消息类型：${context.output_requirement.expected_message_type}`,
      `- 最大长度：${context.output_requirement.max_response_length} 字以内`,
      "- 如果当前有 active_events，优先回应最重要的事件。",
      "- events 至少给出一个，用于驱动后续发言选择。",
      "",
      "Context Package:",
      JSON.stringify(context, null, 2),
    ].join("\n");
  }

  private parseModelOutput(
    content: string,
    agent: AgentInstance,
    context: ContextPackage,
    rawResponse: DeepSeekChatCompletionResponse | null,
  ): AgentInvocationOutput {
    const parsed = parseJsonOrNull<Partial<AgentInvocationOutput>>(extractJson(content));
    if (parsed?.messages?.length) {
      return {
        messages: parsed.messages.map((message) => ({
          message_type: normalizeMessageType(
            message.message_type,
            context.output_requirement.expected_message_type,
          ),
          content: String(message.content ?? "").trim() || content,
          target: message.target,
          metadata: {
            provider: "deepseek",
            model: rawResponse?.model,
            usage: rawResponse?.usage,
            ...(message.metadata ?? {}),
          },
        })),
        events: normalizeEvents(parsed.events, context),
      };
    }

    return {
      messages: [
        {
          message_type: context.output_requirement.expected_message_type,
          content,
          metadata: {
            provider: "deepseek",
            model: rawResponse?.model,
            usage: rawResponse?.usage,
            parse_fallback: true,
          },
        },
      ],
      events: [
        {
          event_type: fallbackEventType(agent.role, context.output_requirement.expected_message_type),
          category: "discussion_event",
          priority: "low",
          payload: {
            topic: context.meeting_context.meeting_goal.topic ?? context.stage_context.stage_id,
          },
          source_message_index: 0,
        },
      ],
    };
  }
}

function normalizeEvents(
  events: Partial<AgentInvocationOutput["events"][number]>[] | undefined,
  context: ContextPackage,
): AgentInvocationOutput["events"] {
  if (!events?.length) {
    return [
      {
        event_type: "opinion_created",
        category: "discussion_event",
        priority: "low",
        payload: {
          topic: context.meeting_context.meeting_goal.topic ?? context.stage_context.stage_id,
        },
        source_message_index: 0,
      },
    ];
  }
  return events.map((event) => ({
    event_type: String(event.event_type ?? "opinion_created"),
    category: normalizeCategory(event.category),
    priority: normalizePriority(event.priority),
    payload: event.payload ?? {
      topic: context.meeting_context.meeting_goal.topic ?? context.stage_context.stage_id,
    },
    source_message_index:
      typeof event.source_message_index === "number" ? event.source_message_index : 0,
  }));
}

function normalizeMessageType(value: unknown, fallback: MessageType): MessageType {
  const allowed: MessageType[] = [
    "opinion",
    "question",
    "answer",
    "critique",
    "support",
    "clarification",
    "summary",
    "decision",
    "instruction",
    "system_notice",
  ];
  return allowed.includes(value as MessageType) ? (value as MessageType) : fallback;
}

function normalizeCategory(value: unknown): EventCategory {
  const allowed: EventCategory[] = ["system_event", "discussion_event", "domain_event"];
  return allowed.includes(value as EventCategory) ? (value as EventCategory) : "discussion_event";
}

function normalizePriority(value: unknown): EventPriority {
  const allowed: EventPriority[] = ["low", "medium", "high"];
  return allowed.includes(value as EventPriority) ? (value as EventPriority) : "low";
}

function fallbackEventType(role: string, messageType: MessageType): string {
  if (role === "critic_agent" || messageType === "critique") {
    return "risk_identified";
  }
  if (messageType === "question") {
    return "question_raised";
  }
  if (messageType === "decision") {
    return "decision_requested";
  }
  if (messageType === "summary") {
    return "summary_requested";
  }
  if (messageType === "support" || messageType === "answer") {
    return "support_added";
  }
  return "opinion_created";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonOrNull<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJson(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}
