import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type {
  FinalOutput,
  MeetingRuntimeSnapshot,
  Message,
  StageOutput,
  StageTemplate,
} from "../types";
import { nowIso } from "./ids";

export class OutputManager {
  buildStageOutput(snapshot: MeetingRuntimeSnapshot, stage: StageTemplate): StageOutput {
    const stageMessages = snapshot.messages.filter((message) => message.stage_id === stage.stage_id);
    const riskEvents = snapshot.events.filter(
      (event) => event.stage_id === stage.stage_id && event.event_type === "risk_identified",
    );
    const output = this.outputBySchema(snapshot.meeting_type.output_schema, stageMessages, riskEvents);
    return {
      stage_id: stage.stage_id,
      stage_name: stage.stage_name,
      output,
      created_at: nowIso(),
    };
  }

  buildFinalOutput(snapshot: MeetingRuntimeSnapshot, transcriptRef: string): FinalOutput {
    const keyPoints = pickContents(snapshot.messages, ["summary", "opinion", "answer"], 8);
    const decisions = pickContents(snapshot.messages, ["decision"], 5);
    const risks = [
      ...pickContents(snapshot.messages, ["critique"], 6),
      ...snapshot.meeting_memory.risks.slice(0, 6),
    ].slice(0, 8);
    const openQuestions = [
      ...pickContents(snapshot.messages, ["question"], 5),
      ...snapshot.meeting_memory.open_questions.slice(0, 5),
    ].slice(0, 8);
    const nextActions = this.nextActionsFor(snapshot);
    return {
      executive_summary: `本次会议围绕“${String(
        snapshot.meeting_instance.goal.topic ?? snapshot.meeting_instance.title,
      )}”完成 ${snapshot.stage_outputs.length} 个阶段，形成了观点、风险、阶段输出和后续动作。`,
      key_points: unique(keyPoints).slice(0, 8),
      decisions: unique(decisions.length ? decisions : this.recommendationsFromStages(snapshot)).slice(0, 6),
      risks: unique(risks).slice(0, 8),
      open_questions: unique(openQuestions).slice(0, 8),
      next_actions: nextActions,
      stage_outputs: snapshot.stage_outputs,
      transcript_ref: transcriptRef,
    };
  }

  async writeArtifacts(snapshot: MeetingRuntimeSnapshot, outputRoot: string): Promise<string> {
    const runDir = path.join(outputRoot, snapshot.meeting_instance.meeting_id);
    await mkdir(runDir, { recursive: true });

    const transcript = this.renderTranscript(snapshot);
    const transcriptPath = path.join(runDir, "transcript.md");
    await Promise.all([
      writeFile(path.join(runDir, "state.json"), JSON.stringify(snapshot, null, 2), "utf8"),
      writeFile(path.join(runDir, "messages.json"), JSON.stringify(snapshot.messages, null, 2), "utf8"),
      writeFile(path.join(runDir, "events.json"), JSON.stringify(snapshot.events, null, 2), "utf8"),
      writeFile(path.join(runDir, "stage_outputs.yaml"), stringify(snapshot.stage_outputs), "utf8"),
      writeFile(
        path.join(runDir, "memory.yaml"),
        stringify({
          meeting_memory: snapshot.meeting_memory,
          stage_memory: snapshot.stage_memory,
          agent_private_memory: snapshot.agent_private_memory,
        }),
        "utf8",
      ),
      writeFile(
        path.join(runDir, "final_output.yaml"),
        stringify(snapshot.final_output ?? {}),
        "utf8",
      ),
      writeFile(transcriptPath, transcript, "utf8"),
    ]);
    return runDir;
  }

  renderTranscript(snapshot: MeetingRuntimeSnapshot): string {
    const lines = [
      `# ${snapshot.meeting_instance.title}`,
      "",
      `- meeting_id: ${snapshot.meeting_instance.meeting_id}`,
      `- meeting_type: ${snapshot.meeting_type.type_id}`,
      `- status: ${snapshot.status}`,
      "",
    ];
    for (const message of snapshot.messages) {
      const sender = this.senderName(snapshot, message);
      lines.push(`## ${message.stage_id} / ${message.turn_id} / ${sender}`);
      lines.push("");
      lines.push(`**${message.message_type}**`);
      lines.push("");
      lines.push(message.content);
      lines.push("");
    }
    if (snapshot.final_output) {
      lines.push("## Final Output");
      lines.push("");
      lines.push("```yaml");
      lines.push(stringify(snapshot.final_output).trim());
      lines.push("```");
      lines.push("");
    }
    return lines.join("\n");
  }

  private outputBySchema(
    schema: string,
    stageMessages: Message[],
    riskEvents: Array<{ payload: Record<string, unknown> }>,
  ): Record<string, unknown> {
    if (schema === "brainstorm_output") {
      return {
        ideas: pickContents(stageMessages, ["opinion", "support", "answer"], 6),
        categories: ["激活与复访", "工作流嵌入", "低预算验证"],
        risks: [
          ...pickContents(stageMessages, ["critique"], 4),
          ...riskEvents.map((event) => String(event.payload.risk_type ?? "风险待确认")),
        ].slice(0, 6),
        open_questions: pickContents(stageMessages, ["question"], 5),
        recommendations: pickContents(stageMessages, ["decision", "summary", "answer"], 5),
      };
    }

    if (schema === "review_output") {
      return {
        strengths: pickContents(stageMessages, ["support", "opinion"], 5),
        risks: [
          ...pickContents(stageMessages, ["critique"], 5),
          ...riskEvents.map((event) => String(event.payload.risk_type ?? "风险待确认")),
        ].slice(0, 6),
        suggestions: pickContents(stageMessages, ["answer", "opinion"], 5),
        decision: pickContents(stageMessages, ["decision", "summary"], 3),
        open_questions: pickContents(stageMessages, ["question"], 5),
      };
    }

    return {
      perspectives: pickContents(stageMessages, ["opinion", "answer"], 8),
      agreements: pickContents(stageMessages, ["support", "summary"], 5),
      disagreements: pickContents(stageMessages, ["critique"], 5),
      decisions: pickContents(stageMessages, ["decision"], 4),
      next_actions: pickContents(stageMessages, ["summary", "answer"], 4),
    };
  }

  private senderName(snapshot: MeetingRuntimeSnapshot, message: Message): string {
    if (message.sender_type === "user") {
      return "用户";
    }
    if (message.sender_type === "controller") {
      return "Controller";
    }
    return snapshot.agents.find((agent) => agent.instance_id === message.sender_id)?.name ?? message.sender_id;
  }

  private recommendationsFromStages(snapshot: MeetingRuntimeSnapshot): string[] {
    return snapshot.stage_outputs
      .flatMap((stageOutput) => {
        const value = stageOutput.output.recommendations ?? stageOutput.output.decision;
        return Array.isArray(value) ? value : value ? [String(value)] : [];
      })
      .filter(Boolean);
  }

  private nextActionsFor(snapshot: MeetingRuntimeSnapshot): string[] {
    const topic = String(snapshot.meeting_instance.goal.topic ?? "会议目标");
    const defaults = [
      `围绕“${topic}”选 1 个低成本方向做两周验证`,
      "补齐关键风险的验证问题和成功指标",
      "把阶段输出转成负责人、时间点和验收口径",
    ];
    return unique([
      ...pickContents(snapshot.messages, ["decision", "summary"], 4),
      ...defaults,
    ]).slice(0, 6);
  }
}

function pickContents(messages: Message[], types: string[], limit: number): string[] {
  return messages
    .filter((message) => types.includes(message.message_type))
    .map((message) => message.content)
    .filter(Boolean)
    .slice(-limit);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
