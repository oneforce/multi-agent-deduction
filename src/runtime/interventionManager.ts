import type { MeetingEvent, MeetingRuntimeSnapshot, Message, RuntimePatch } from "../types";
import { makeId, nowIso } from "./ids";

export class InterventionManager {
  apply(snapshot: MeetingRuntimeSnapshot, patch: RuntimePatch): void {
    const stage = snapshot.meeting_type.stage_templates[snapshot.current_stage_index];
    const stageId = stage?.stage_id ?? null;
    const createdAt = nowIso();

    switch (patch.kind) {
      case "pause_meeting":
        snapshot.status = "paused";
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "meeting_paused", "system_event", "high", patch, createdAt),
        );
        break;
      case "resume_meeting":
        snapshot.status = "running";
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "meeting_resumed", "system_event", "high", patch, createdAt),
        );
        break;
      case "stop_meeting":
        snapshot.status = "stopped";
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "meeting_stopped", "system_event", "high", patch, createdAt),
        );
        break;
      case "end_and_summarize":
        snapshot.status = "summarizing";
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "final_summary_requested", "system_event", "high", patch, createdAt),
        );
        break;
      case "user_message_inserted":
        this.insertUserMessage(snapshot, stageId, patch.value ?? "", createdAt);
        snapshot.queued_events.push(
          this.event(
            snapshot,
            stageId,
            "user_intervention_received",
            "system_event",
            "high",
            patch,
            createdAt,
          ),
        );
        break;
      case "force_agent_speak":
        this.forceSpeaker(snapshot, patch.value ?? "");
        snapshot.queued_events.push(
          this.event(
            snapshot,
            stageId,
            "user_intervention_received",
            "system_event",
            "high",
            patch,
            createdAt,
          ),
        );
        break;
      case "disable_agent":
        this.disableAgent(snapshot, patch.value ?? "");
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "agent_disabled", "system_event", "high", patch, createdAt),
        );
        break;
      case "request_stage_summary":
        snapshot.queued_events.push(
          this.event(snapshot, stageId, "summary_requested", "discussion_event", "medium", patch, createdAt),
        );
        break;
      case "switch_stage":
        this.switchStage(snapshot, patch.value ?? "");
        snapshot.queued_events.push(
          this.event(
            snapshot,
            snapshot.meeting_type.stage_templates[snapshot.current_stage_index]?.stage_id ?? null,
            "stage_transition_requested",
            "system_event",
            "high",
            patch,
            createdAt,
          ),
        );
        break;
      case "add_participant_agent":
        throw new Error("add_participant_agent 需要在后续版本提供模板选择，当前 MVP CLI 未开放。");
    }

    snapshot.events.push(...snapshot.queued_events.slice(-1));
    snapshot.updated_at = nowIso();
  }

  private insertUserMessage(
    snapshot: MeetingRuntimeSnapshot,
    stageId: string | null,
    content: string,
    createdAt: string,
  ): void {
    const message: Message = {
      message_id: makeId("msg"),
      meeting_id: snapshot.meeting_instance.meeting_id,
      stage_id: stageId ?? "meeting",
      turn_id: `turn_${snapshot.current_turn_index}`,
      sender_id: "user",
      sender_type: "user",
      message_type: "instruction",
      content,
      target: {
        type: "meeting",
        id: snapshot.meeting_instance.meeting_id,
      },
      reply_to_message_id: null,
      visibility_scope: "meeting",
      metadata: {
        intervention: true,
      },
      created_at: createdAt,
    };
    snapshot.messages.push(message);
  }

  private forceSpeaker(snapshot: MeetingRuntimeSnapshot, selector: string): void {
    const agent = findAgent(snapshot, selector);
    if (!agent) {
      throw new Error(`找不到可点名 Agent: ${selector}`);
    }
    if (!agent.runtime_state.enabled) {
      throw new Error(`Agent 已禁用，无法点名: ${selector}`);
    }
    snapshot.forced_next_speaker_id = agent.instance_id;
    agent.runtime_state.forced_next_speaker = true;
  }

  private disableAgent(snapshot: MeetingRuntimeSnapshot, selector: string): void {
    const agent = findAgent(snapshot, selector);
    if (!agent) {
      throw new Error(`找不到要禁用的 Agent: ${selector}`);
    }
    agent.runtime_state.enabled = false;
    agent.runtime_state.skip_reason = "disabled_by_user";
  }

  private switchStage(snapshot: MeetingRuntimeSnapshot, stageId: string): void {
    const index = snapshot.meeting_type.stage_templates.findIndex((stage) => stage.stage_id === stageId);
    if (index < 0) {
      throw new Error(`找不到 Stage: ${stageId}`);
    }
    snapshot.current_stage_index = index;
    snapshot.current_turn_index = 0;
  }

  private event(
    snapshot: MeetingRuntimeSnapshot,
    stageId: string | null,
    eventType: string,
    category: MeetingEvent["category"],
    priority: MeetingEvent["priority"],
    patch: RuntimePatch,
    createdAt: string,
  ): MeetingEvent {
    return {
      event_id: makeId("evt"),
      meeting_id: snapshot.meeting_instance.meeting_id,
      stage_id: stageId,
      category,
      event_type: eventType,
      source_message_id: null,
      source_agent_id: "user",
      priority,
      payload: {
        command: patch.kind,
        value: patch.value,
        ...(patch.payload ?? {}),
      },
      created_at: createdAt,
    };
  }
}

export function findAgent(snapshot: MeetingRuntimeSnapshot, selector: string) {
  return snapshot.agents.find((agent) => {
    const normalizedSelector = selector.toLowerCase();
    return [
      agent.instance_id,
      agent.template_id,
      agent.role,
      agent.name,
    ].some((value) => value.toLowerCase() === normalizedSelector);
  });
}
