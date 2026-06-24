import type {
  AgentInstance,
  AgentInvocationOutput,
  ContextPackage,
  MeetingEvent,
  Message,
} from "../types";
import { DeepSeekProvider } from "../providers/deepseekProvider";
import { MockLlmProvider } from "../providers/mockLlmProvider";
import { makeId, nowIso } from "./ids";

export class AgentInvoker {
  private readonly mockProvider = new MockLlmProvider();
  private readonly deepSeekProvider = new DeepSeekProvider();

  async invoke(params: {
    agent: AgentInstance;
    context: ContextPackage;
    meetingId: string;
    stageId: string;
    turnId: string;
  }): Promise<{ messages: Message[]; events: MeetingEvent[]; raw: AgentInvocationOutput }> {
    const { agent, context, meetingId, stageId, turnId } = params;
    const raw = await this.invokeProvider(agent, context);
    const createdAt = nowIso();
    const messages = raw.messages.map<Message>((message) => ({
      message_id: makeId("msg"),
      meeting_id: meetingId,
      stage_id: stageId,
      turn_id: turnId,
      sender_id: agent.instance_id,
      sender_type: agent.type === "service" ? "service_agent" : "participant_agent",
      message_type: message.message_type,
      content: message.content,
      target: message.target ?? {
        type: "stage",
        id: stageId,
      },
      reply_to_message_id: null,
      visibility_scope: "stage",
      metadata: message.metadata ?? {},
      created_at: createdAt,
    }));

    const events = raw.events.map<MeetingEvent>((event) => {
      const sourceMessage = messages[event.source_message_index ?? 0];
      return {
        event_id: makeId("evt"),
        meeting_id: meetingId,
        stage_id: stageId,
        category: event.category,
        event_type: event.event_type,
        source_message_id: sourceMessage?.message_id ?? null,
        source_agent_id: agent.instance_id,
        priority: event.priority ?? "low",
        payload: event.payload ?? {},
        created_at: createdAt,
      };
    });

    return { messages, events, raw };
  }

  private async invokeProvider(
    agent: AgentInstance,
    context: ContextPackage,
  ): Promise<AgentInvocationOutput> {
    if (agent.model_config.provider === "mock") {
      return this.mockProvider.invoke(context);
    }
    if (agent.model_config.provider === "openai") {
      return this.mockProvider.invoke(context);
    }
    if (agent.model_config.provider === "deepseek") {
      return this.deepSeekProvider.invoke(agent, context);
    }
    return this.mockProvider.invoke(context);
  }
}
