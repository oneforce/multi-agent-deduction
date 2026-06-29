import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ConfigLoader } from "./config/configLoader";
import { MeetingController } from "./runtime/meetingController";
import type { RuntimePatch } from "./types";

const program = new Command();

program
  .name("meeting-mvp")
  .description("通用多 Agent 会议系统 MVP CLI")
  .version("0.1.0");

program
  .command("run")
  .argument("<instance>", "Meeting Instance YAML 路径")
  .option("--fresh", "忽略已有 runs 快照，重新初始化")
  .option("--out <dir>", "输出目录", "runs")
  .option("--max-steps <n>", "最大执行步数", "100")
  .option("--insert <text>", "运行前插入一条用户消息")
  .option("--force <agent>", "运行前点名下一位发言 Agent，可用 role/name/id")
  .option("--disable <agent>", "运行前禁用 Agent，可用 role/name/id")
  .action(async (instance: string, options) => {
    await withCliErrors(async () => {
      const controller = await loadOrInitialize(instance, options.out, Boolean(options.fresh));
      applyOptionInterventions(controller, options);
      const result = await controller.runToCompletion(Number(options.maxSteps));
      printRunResult(controller, result.run_dir, result.steps.length);
    });
  });

program
  .command("step")
  .argument("<instance>", "Meeting Instance YAML 路径")
  .option("--fresh", "忽略已有 runs 快照，重新初始化")
  .option("--out <dir>", "输出目录", "runs")
  .option("--insert <text>", "本步前插入一条用户消息")
  .option("--force <agent>", "本步前点名下一位发言 Agent，可用 role/name/id")
  .option("--disable <agent>", "本步前禁用 Agent，可用 role/name/id")
  .action(async (instance: string, options) => {
    await withCliErrors(async () => {
      const controller = await loadOrInitialize(instance, options.out, Boolean(options.fresh));
      try {
        applyOptionInterventions(controller, options);
        const step = await controller.step();
        const runDir = await controller.saveArtifacts();
        console.log(`step: ${step.action}`);
        console.log(`status: ${step.status}`);
        if (step.stage_id) {
          console.log(`stage: ${step.stage_id}`);
        }
        if (step.speaker_id) {
          console.log(`speaker: ${step.speaker_id}`);
        }
        console.log(`messages: ${step.message_count}`);
        console.log(`events: ${step.event_count}`);
        console.log(`artifacts: ${runDir}`);
      } catch (error) {
        const runDir = await saveFailedController(controller, error, "cli_step_failed");
        throw new Error(`${errorMessage(error)}；失败状态已保存：${runDir}`);
      }
    });
  });

program
  .command("intervene")
  .argument("<meeting_id>", "已保存会议 ID")
  .argument("<command>", "pause|resume|stop|end|insert|force|disable|add|switch|summary")
  .argument("[value]", "命令参数，例如消息内容、agent role、stage_id")
  .option("--out <dir>", "输出目录", "runs")
  .action(async (meetingId: string, command: string, value: string | undefined, options) => {
    await withCliErrors(async () => {
      const controller = await MeetingController.fromSnapshotFile(
        statePathForMeeting(options.out, meetingId),
        options.out,
      );
      if (command === "add") {
        const agent = await controller.addAgentFromTemplate({
          templateSelector: requireValue(command, value),
        });
        const runDir = await controller.saveArtifacts();
        console.log(`intervention: ${command}`);
        console.log(`added_agent: ${agent.instance_id}`);
        console.log(`status: ${controller.snapshot.status}`);
        console.log(`artifacts: ${runDir}`);
        return;
      }
      controller.applyIntervention(toPatch(command, value));
      const runDir = await controller.saveArtifacts();
      console.log(`intervention: ${command}`);
      console.log(`status: ${controller.snapshot.status}`);
      console.log(`artifacts: ${runDir}`);
    });
  });

program
  .command("inspect")
  .argument("<meeting_id>", "已保存会议 ID")
  .option("--out <dir>", "输出目录", "runs")
  .action(async (meetingId: string, options) => {
    await withCliErrors(async () => {
      const controller = await MeetingController.fromSnapshotFile(
        statePathForMeeting(options.out, meetingId),
        options.out,
      );
      const snapshot = controller.snapshot;
      const stage = snapshot.meeting_type.stage_templates[snapshot.current_stage_index];
      console.log(`meeting: ${snapshot.meeting_instance.meeting_id}`);
      console.log(`title: ${snapshot.meeting_instance.title}`);
      console.log(`status: ${snapshot.status}`);
      console.log(`current_stage: ${stage?.stage_id ?? "none"}`);
      console.log(`current_turn: ${snapshot.current_turn_index}`);
      console.log(`messages: ${snapshot.messages.length}`);
      console.log(`events: ${snapshot.events.length}`);
      if (snapshot.last_error) {
        console.log(`last_error: ${snapshot.last_error.message}`);
        console.log(`last_error_action: ${snapshot.last_error.action}`);
        console.log(`last_error_at: ${snapshot.last_error.created_at}`);
      }
      console.log("agents:");
      for (const agent of snapshot.agents) {
        console.log(
          `  - ${agent.instance_id} (${agent.role}) enabled=${agent.runtime_state.enabled}`,
        );
      }
    });
  });

await program.parseAsync();

async function loadOrInitialize(
  instancePath: string,
  outputRoot: string,
  fresh: boolean,
): Promise<MeetingController> {
  const absoluteOut = path.resolve(outputRoot);
  const loader = new ConfigLoader();
  const instance = await loader.loadMeetingInstance(instancePath);
  const statePath = statePathForMeeting(absoluteOut, instance.meeting_id);
  if (!fresh && existsSync(statePath)) {
    return MeetingController.fromSnapshotFile(statePath, absoluteOut);
  }
  const controller = new MeetingController({ outputRoot: absoluteOut });
  await controller.initializeFromInstance(instancePath);
  return controller;
}

function statePathForMeeting(outputRoot: string, meetingId: string): string {
  return path.join(path.resolve(outputRoot), meetingId, "state.json");
}

function applyOptionInterventions(
  controller: MeetingController,
  options: {
    insert?: string;
    force?: string;
    disable?: string;
  },
): void {
  if (options.insert) {
    controller.applyIntervention({
      kind: "user_message_inserted",
      value: options.insert,
    });
  }
  if (options.disable) {
    controller.applyIntervention({
      kind: "disable_agent",
      value: options.disable,
    });
  }
  if (options.force) {
    controller.applyIntervention({
      kind: "force_agent_speak",
      value: options.force,
    });
  }
}

function toPatch(command: string, value?: string): RuntimePatch {
  switch (command) {
    case "pause":
      return { kind: "pause_meeting" };
    case "resume":
      return { kind: "resume_meeting" };
    case "stop":
      return { kind: "stop_meeting" };
    case "end":
      return { kind: "end_and_summarize" };
    case "insert":
      return { kind: "user_message_inserted", value: requireValue(command, value) };
    case "force":
      return { kind: "force_agent_speak", value: requireValue(command, value) };
    case "disable":
      return { kind: "disable_agent", value: requireValue(command, value) };
    case "switch":
      return { kind: "switch_stage", value: requireValue(command, value) };
    case "summary":
      return { kind: "request_stage_summary" };
    default:
      throw new Error(`未知干预命令: ${command}`);
  }
}

function requireValue(command: string, value?: string): string {
  if (!value) {
    throw new Error(`${command} 需要提供参数。`);
  }
  return value;
}

function printRunResult(controller: MeetingController, runDir: string, stepCount: number): void {
  const snapshot = controller.snapshot;
  console.log(`status: ${snapshot.status}`);
  console.log(`steps: ${stepCount}`);
  console.log(`messages: ${snapshot.messages.length}`);
  console.log(`events: ${snapshot.events.length}`);
  console.log(`stage_outputs: ${snapshot.stage_outputs.length}`);
  console.log(`artifacts: ${runDir}`);
  if (snapshot.final_output) {
    console.log("");
    console.log("final_output:");
    console.log(`  executive_summary: ${snapshot.final_output.executive_summary}`);
    console.log(`  key_points: ${snapshot.final_output.key_points.length}`);
    console.log(`  risks: ${snapshot.final_output.risks.length}`);
    console.log(`  next_actions: ${snapshot.final_output.next_actions.length}`);
  }
}

async function withCliErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  }
}

async function saveFailedController(
  controller: MeetingController,
  error: unknown,
  action: string,
): Promise<string> {
  if (controller.snapshot.status !== "failed") {
    controller.recordFailure(error, action);
  }
  return controller.saveArtifacts();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
