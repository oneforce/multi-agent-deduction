import type {
  AgentInstance,
  MeetingEvent,
  MeetingMemory,
  MeetingRuntimeSnapshot,
  Message,
  StageMemory,
  StageOutput,
  StageTemplate,
} from "../types";

export class MemoryManager {
  createMeetingMemory(goal: Record<string, unknown>): MeetingMemory {
    return {
      meeting_goal: goal,
      key_conclusions: [],
      open_questions: [],
      risks: [],
      stage_summaries: [],
    };
  }

  createStageMemory(stages: StageTemplate[]): Record<string, StageMemory> {
    return Object.fromEntries(
      stages.map((stage) => [
        stage.stage_id,
        {
          stage_id: stage.stage_id,
          stage_input: {
            stage_goal: stage.stage_goal,
          },
          key_event_ids: [],
          key_message_ids: [],
        },
      ]),
    );
  }

  commitInvocation(params: {
    snapshot: MeetingRuntimeSnapshot;
    agent: AgentInstance;
    messages: Message[];
    events: MeetingEvent[];
  }): void {
    const { snapshot, agent, messages, events } = params;
    const privateMemory = snapshot.agent_private_memory[agent.instance_id] ?? {
      agent_id: agent.instance_id,
      notes: [],
    };

    for (const message of messages) {
      const stageMemory = snapshot.stage_memory[message.stage_id];
      stageMemory?.key_message_ids.push(message.message_id);

      if (message.message_type === "question") {
        pushUnique(snapshot.meeting_memory.open_questions, message.content);
      }
      if (message.message_type === "critique") {
        pushUnique(snapshot.meeting_memory.risks, message.content);
      }
      if (["summary", "decision", "opinion"].includes(message.message_type)) {
        pushUnique(snapshot.meeting_memory.key_conclusions, message.content);
      }
      privateMemory.notes.push(
        `[${message.stage_id}] ${message.message_type}: ${message.content.slice(0, 160)}`,
      );
    }

    for (const event of events) {
      const stageMemory = event.stage_id ? snapshot.stage_memory[event.stage_id] : null;
      stageMemory?.key_event_ids.push(event.event_id);
      if (event.event_type === "risk_identified") {
        pushUnique(
          snapshot.meeting_memory.risks,
          String(event.payload.risk_type ?? event.payload.topic ?? "风险待确认"),
        );
      }
      if (event.event_type === "question_raised") {
        pushUnique(
          snapshot.meeting_memory.open_questions,
          String(event.payload.question ?? event.payload.topic ?? "问题待确认"),
        );
      }
    }

    snapshot.agent_private_memory[agent.instance_id] = {
      ...privateMemory,
      notes: privateMemory.notes.slice(-20),
    };
  }

  commitStageOutput(snapshot: MeetingRuntimeSnapshot, stageOutput: StageOutput): void {
    const stageMemory = snapshot.stage_memory[stageOutput.stage_id];
    if (stageMemory) {
      stageMemory.stage_output = stageOutput;
    }
    const summary = summarizeStageOutput(stageOutput);
    snapshot.meeting_memory.stage_summaries.push({
      stage_id: stageOutput.stage_id,
      summary,
    });
    pushUnique(snapshot.meeting_memory.key_conclusions, summary);
  }
}

function summarizeStageOutput(stageOutput: StageOutput): string {
  const keys = Object.keys(stageOutput.output);
  const short = keys
    .map((key) => {
      const value = stageOutput.output[key];
      if (Array.isArray(value)) {
        return `${key}: ${value.slice(0, 2).join("；")}`;
      }
      return `${key}: ${String(value).slice(0, 80)}`;
    })
    .join(" | ");
  return `${stageOutput.stage_name} 输出：${short}`;
}

function pushUnique(target: string[], value: string): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}
