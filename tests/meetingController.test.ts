import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeetingController } from "../src/runtime/meetingController";

const instancePath = "configs/instances/meetings/brainstorm_demo.yaml";
const runnableInstances = [
  ["brainstorm", "configs/instances/meetings/brainstorm_demo.yaml", "AI 编程助手"],
  ["review", "configs/instances/meetings/review_demo.yaml", "继续上次工作"],
  ["roundtable", "configs/instances/meetings/roundtable_demo.yaml", "第二周留存"],
] as const;

describe("MeetingController", () => {
  let outputRoot: string;

  beforeEach(async () => {
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "meeting-mvp-"));
  });

  afterEach(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  it.each(runnableInstances)("runs %s meeting to final output", async (_type, path, summaryText) => {
    const controller = new MeetingController({ outputRoot });
    await controller.initializeFromInstance(path);

    const result = await controller.runToCompletion();

    expect(result.status).toBe("completed");
    expect(controller.snapshot.stage_outputs).toHaveLength(4);
    expect(controller.snapshot.messages.length).toBeGreaterThan(0);
    expect(controller.snapshot.events.length).toBeGreaterThan(controller.snapshot.messages.length);
    expect(controller.snapshot.final_output?.executive_summary).toContain(summaryText);
  });

  it("supports force speaker intervention during a turn stage", async () => {
    const controller = new MeetingController({ outputRoot });
    await controller.initializeFromInstance(instancePath);
    await controller.step();

    controller.applyIntervention({
      kind: "force_agent_speak",
      value: "critic_agent",
    });
    const step = await controller.step();

    expect(step.speaker_id).toBe("agent_critic_agent");
    expect(controller.snapshot.messages.at(-1)?.sender_id).toBe("agent_critic_agent");
  });

  it("supports pause and resume without losing queued state", async () => {
    const controller = new MeetingController({ outputRoot });
    await controller.initializeFromInstance(instancePath);

    controller.applyIntervention({ kind: "pause_meeting" });
    const paused = await controller.step();
    expect(paused.status).toBe("paused");

    controller.applyIntervention({ kind: "resume_meeting" });
    const resumed = await controller.step();
    expect(resumed.status).toBe("running");
    expect(controller.snapshot.messages.length).toBeGreaterThan(0);
  });

  it("supports adding an agent from a template at runtime", async () => {
    const controller = new MeetingController({ outputRoot });
    await controller.initializeFromInstance(instancePath);
    const beforeCount = controller.snapshot.agents.length;

    const agent = await controller.addAgentFromTemplate({
      templateSelector: "creative_agent",
      instanceName: "新增创意顾问",
    });

    expect(controller.snapshot.agents).toHaveLength(beforeCount + 1);
    expect(agent.instance_id).toBe("agent_creative_agent_2");
    expect(agent.name).toBe("新增创意顾问");
    expect(controller.snapshot.events.at(-1)?.event_type).toBe("agent_added");
    expect(
      controller.snapshot.meeting_type.stage_templates
        .filter((stage) => stage.execution_mode === "turn")
        .every((stage) => stage.participant_rule?.include_roles?.includes("creative_agent")),
    ).toBe(true);
  });

  it("records explicit event handling when active events are processed", async () => {
    const controller = new MeetingController({ outputRoot });
    await controller.initializeFromInstance(instancePath);

    await controller.step();
    await controller.step();

    expect(controller.snapshot.event_handling_log.length).toBeGreaterThan(0);
    expect(
      controller.snapshot.event_handling_log.some(
        (record) => record.handler_id === "event_processor",
      ),
    ).toBe(true);
    expect(
      controller.snapshot.event_handling_log.some(
        (record) => record.handler_id === "speaker_selector",
      ),
    ).toBe(true);
  });
});
