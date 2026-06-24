import type {
  AgentInstance,
  ContextPackage,
  MeetingEvent,
  MeetingRuntimeSnapshot,
  MessageType,
  StageTemplate,
} from "../types";

export class ContextBuilder {
  constructor(private readonly recentMessageLimit: number) {}

  build(params: {
    snapshot: MeetingRuntimeSnapshot;
    stage: StageTemplate;
    agent: AgentInstance;
    activeEvents: MeetingEvent[];
    expectedMessageType: MessageType;
    maxTurns: number | null;
  }): ContextPackage {
    const { snapshot, stage, agent, activeEvents, expectedMessageType, maxTurns } = params;
    const recentVisibleMessages = snapshot.messages
      .filter((message) => message.visibility_scope !== "private")
      .slice(-this.recentMessageLimit);

    return {
      meeting_context: {
        meeting_id: snapshot.meeting_instance.meeting_id,
        meeting_title: snapshot.meeting_instance.title,
        meeting_type: snapshot.meeting_type.type_id,
        meeting_goal: snapshot.meeting_instance.goal,
        input_materials: snapshot.meeting_instance.input_materials ?? [],
      },
      stage_context: {
        stage_id: stage.stage_id,
        stage_name: stage.stage_name,
        stage_goal: stage.stage_goal,
        stage_mode: stage.execution_mode,
        stage_progress: {
          current_turn: snapshot.current_turn_index,
          max_turns: maxTurns,
        },
      },
      turn_context: {
        current_turn: snapshot.current_turn_index,
        active_events: activeEvents,
      },
      visible_messages: {
        recent_visible_messages: recentVisibleMessages,
      },
      agent_context: {
        agent_id: agent.instance_id,
        agent_role: agent.role,
        agent_goal: agent.profile.goal,
        runtime_state: agent.runtime_state,
      },
      memory_context: {
        relevant_public_memory: [
          snapshot.meeting_memory.key_conclusions,
          snapshot.meeting_memory.open_questions,
          snapshot.meeting_memory.risks,
        ].flat(),
        relevant_private_memory:
          snapshot.agent_private_memory[agent.instance_id]?.notes.slice(-5) ?? [],
        relevant_stage_outputs: snapshot.stage_outputs.slice(-3),
      },
      output_requirement: {
        expected_message_type: expectedMessageType,
        max_response_length: 500,
      },
    };
  }
}
