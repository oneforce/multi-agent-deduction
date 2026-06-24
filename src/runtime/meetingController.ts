import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentInstance,
  AgentOverride,
  AgentTemplate,
  MeetingEvent,
  MeetingRuntimeSnapshot,
  MeetingStatus,
  Message,
  ModelConfig,
  RuntimePatch,
  StageOverride,
  StageTemplate,
} from "../types";
import { ConfigLoader } from "../config/configLoader";
import { AgentInvoker } from "./agentInvoker";
import { ContextBuilder } from "./contextBuilder";
import { EventProcessor } from "./eventProcessor";
import { EventQueue } from "./eventQueue";
import { makeId, nowIso } from "./ids";
import { InterventionManager } from "./interventionManager";
import { MemoryManager } from "./memoryManager";
import { OutputManager } from "./outputManager";
import { SpeakerSelector } from "./speakerSelector";

export interface StepResult {
  status: MeetingStatus;
  action: string;
  stage_id?: string;
  speaker_id?: string;
  message_count: number;
  event_count: number;
}

export interface RunResult {
  status: MeetingStatus;
  steps: StepResult[];
  run_dir: string;
}

export class MeetingController {
  private readonly configLoader: ConfigLoader;
  private readonly memoryManager = new MemoryManager();
  private readonly outputManager = new OutputManager();
  private readonly interventionManager = new InterventionManager();
  private readonly speakerSelector = new SpeakerSelector();
  private readonly eventProcessor = new EventProcessor();
  private readonly agentInvoker = new AgentInvoker();
  private snapshotValue: MeetingRuntimeSnapshot | null = null;

  constructor(
    private readonly options: {
      configRoot?: string;
      outputRoot?: string;
    } = {},
  ) {
    this.configLoader = new ConfigLoader(options.configRoot);
  }

  get snapshot(): MeetingRuntimeSnapshot {
    if (!this.snapshotValue) {
      throw new Error("MeetingController 尚未初始化。");
    }
    return this.snapshotValue;
  }

  static async fromSnapshotFile(snapshotPath: string, outputRoot = "runs"): Promise<MeetingController> {
    const raw = await readFile(snapshotPath, "utf8");
    const controller = new MeetingController({ outputRoot });
    controller.snapshotValue = JSON.parse(raw) as MeetingRuntimeSnapshot;
    controller.snapshotValue.event_handling_log ??= [];
    return controller;
  }

  async initializeFromInstance(instancePath: string): Promise<MeetingRuntimeSnapshot> {
    const resolved = await this.configLoader.resolve(instancePath);
    const meetingType = {
      ...resolved.meetingType,
      stage_templates: applyStageOverrides(
        resolved.meetingType.stage_templates,
        resolved.meetingInstance.stage_overrides ?? [],
      ),
    };
    const agents = instantiateAgents(
      meetingType.default_agent_roles,
      resolved.agentTemplates,
      resolved.meetingInstance.agent_overrides ?? [],
    );
    const createdAt = nowIso();

    this.snapshotValue = {
      version: 1,
      status: "initialized",
      meeting_type: meetingType,
      meeting_instance: resolved.meetingInstance,
      agents,
      current_stage_index: 0,
      current_turn_index: 0,
      total_turns: 0,
      forced_next_speaker_id: null,
      messages: [],
      events: [],
      queued_events: [],
      event_handling_log: [],
      stage_outputs: [],
      final_output: null,
      meeting_memory: this.memoryManager.createMeetingMemory(resolved.meetingInstance.goal),
      stage_memory: this.memoryManager.createStageMemory(meetingType.stage_templates),
      agent_private_memory: {},
      created_at: createdAt,
      updated_at: createdAt,
    };

    this.enqueueSystemEvent("meeting_started", "high", {
      title: resolved.meetingInstance.title,
      meeting_type_id: meetingType.type_id,
    });
    return this.snapshot;
  }

  applyIntervention(patch: RuntimePatch): void {
    this.interventionManager.apply(this.snapshot, patch);
  }

  async addAgentFromTemplate(params: {
    templateSelector: string;
    instanceName?: string;
    modelConfig?: ModelConfig;
  }): Promise<AgentInstance> {
    const templates = await this.configLoader.loadAgentTemplates();
    const template = findTemplateBySelector(templates, params.templateSelector);
    if (!template) {
      throw new Error(`找不到智能体模板：${params.templateSelector}`);
    }

    const agent = createAgentInstance(
      template,
      {
        instance_name: params.instanceName,
        enabled: true,
        model_config: params.modelConfig,
        agent_template_id: template.agent_id,
      },
      this.nextAgentInstanceId(template.agent_role),
      this.currentStage()?.stage_id ?? null,
      this.snapshot.current_turn_index,
    );
    this.snapshot.agents.push(agent);
    this.snapshot.agent_private_memory[agent.instance_id] = {
      agent_id: agent.instance_id,
      notes: [],
    };
    this.ensureRoleCanParticipate(agent.role, agent.type);
    this.enqueueSystemEvent("agent_added", "high", {
      agent_id: agent.instance_id,
      agent_name: agent.name,
      agent_role: agent.role,
      template_id: agent.template_id,
    });
    this.snapshot.updated_at = nowIso();
    return agent;
  }

  async runToCompletion(maxSteps = 100): Promise<RunResult> {
    const steps: StepResult[] = [];
    for (let index = 0; index < maxSteps; index += 1) {
      if (["completed", "stopped", "failed", "paused"].includes(this.snapshot.status)) {
        break;
      }
      const result = await this.step();
      steps.push(result);
      if (["completed", "stopped", "failed", "paused"].includes(result.status)) {
        break;
      }
    }

    if (!["completed", "stopped", "paused"].includes(this.snapshot.status)) {
      this.snapshot.status = "failed";
      throw new Error(`会议在 ${maxSteps} 步内未能结束，已触发保护。`);
    }

    const runDir = await this.saveArtifacts();
    return {
      status: this.snapshot.status,
      steps,
      run_dir: runDir,
    };
  }

  async step(): Promise<StepResult> {
    if (this.snapshot.status === "paused") {
      return this.result("paused", "meeting_paused");
    }
    if (this.snapshot.status === "stopped") {
      return this.result("stopped", "meeting_stopped");
    }
    if (this.snapshot.status === "completed") {
      return this.result("completed", "meeting_completed");
    }

    if (this.snapshot.status === "summarizing") {
      this.jumpToFinalSummaryStage();
    }

    if (this.snapshot.status === "initialized" || this.snapshot.status === "resuming") {
      this.snapshot.status = "running";
    }

    if (this.snapshot.total_turns >= this.maxTotalTurns()) {
      this.finalize();
      return this.result("completed", "max_total_turns_reached");
    }

    const stage = this.currentStage();
    if (!stage) {
      this.finalize();
      return this.result("completed", "meeting_completed");
    }

    this.ensureStageStarted(stage);

    if (stage.execution_mode === "normal") {
      return this.executeNormalStage(stage);
    }
    return this.executeTurnStage(stage);
  }

  async saveArtifacts(): Promise<string> {
    if (!this.snapshot.final_output && this.snapshot.status === "completed") {
      this.finalize();
    }
    return this.outputManager.writeArtifacts(
      this.snapshot,
      path.resolve(this.options.outputRoot ?? "runs"),
    );
  }

  private async executeNormalStage(stage: StageTemplate): Promise<StepResult> {
    const queue = new EventQueue(this.snapshot.queued_events);
    const activeEvents = queue.nextBatch(this.maxEventsPerTurn());
    const processedEvents = this.processActiveEvents(stage, activeEvents, "normal_stage");
    const selected = this.speakerSelector.select({
      snapshot: this.snapshot,
      stage,
      activeEvents: processedEvents,
      allowServiceAgents: true,
    });

    if (!selected) {
      this.snapshot.queued_events = queue.peek();
      this.completeStage(stage);
      return this.result(this.snapshot.status, "normal_stage_skipped", stage.stage_id);
    }

    this.snapshot.current_turn_index = 1;
    const turnId = `${stage.stage_id}_normal`;
    const context = new ContextBuilder(this.recentMessageLimit()).build({
      snapshot: this.snapshot,
      stage,
      agent: selected.agent,
      activeEvents: processedEvents,
      expectedMessageType: selected.expectedMessageType,
      maxTurns: 1,
    });
    const invocation = await this.agentInvoker.invoke({
      agent: selected.agent,
      context,
      meetingId: this.snapshot.meeting_instance.meeting_id,
      stageId: stage.stage_id,
      turnId,
    });
    this.recordInvocation(selected.agent, invocation.messages, invocation.events, queue);
    this.snapshot.queued_events = queue.peek();
    this.completeStage(stage);
    this.snapshot.current_turn_index = 0;
    return this.result(this.snapshot.status, "normal_stage_completed", stage.stage_id, selected.agent.instance_id);
  }

  private async executeTurnStage(stage: StageTemplate): Promise<StepResult> {
    const maxTurns = this.stageMaxTurns(stage);
    if (this.snapshot.current_turn_index >= maxTurns) {
      this.completeStage(stage);
      return this.result(this.snapshot.status, "turn_stage_completed", stage.stage_id);
    }

    const queue = new EventQueue(this.snapshot.queued_events);
    const activeEvents = queue.nextBatch(this.maxEventsPerTurn());
    const processedEvents = this.processActiveEvents(stage, activeEvents, "turn_stage");
    const selected = this.speakerSelector.select({
      snapshot: this.snapshot,
      stage,
      activeEvents: processedEvents,
      allowServiceAgents: false,
    });

    if (!selected) {
      this.snapshot.queued_events = queue.peek();
      this.completeStage(stage);
      return this.result(this.snapshot.status, "no_speaker_stage_completed", stage.stage_id);
    }

    this.snapshot.current_turn_index += 1;
    this.snapshot.total_turns += 1;
    const turnId = `turn_${String(this.snapshot.current_turn_index).padStart(3, "0")}`;
    const context = new ContextBuilder(this.recentMessageLimit()).build({
      snapshot: this.snapshot,
      stage,
      agent: selected.agent,
      activeEvents: processedEvents,
      expectedMessageType: selected.expectedMessageType,
      maxTurns,
    });
    const invocation = await this.agentInvoker.invoke({
      agent: selected.agent,
      context,
      meetingId: this.snapshot.meeting_instance.meeting_id,
      stageId: stage.stage_id,
      turnId,
    });
    this.recordInvocation(selected.agent, invocation.messages, invocation.events, queue);
    this.snapshot.queued_events = queue.peek();

    const action =
      this.snapshot.current_turn_index >= maxTurns
        ? "turn_stage_completed"
        : "turn_completed";
    if (this.snapshot.current_turn_index >= maxTurns) {
      this.completeStage(stage);
    }

    return this.result(this.snapshot.status, action, stage.stage_id, selected.agent.instance_id);
  }

  private processActiveEvents(
    stage: StageTemplate,
    events: MeetingEvent[],
    phase: "normal_stage" | "turn_stage",
  ): MeetingEvent[] {
    return this.eventProcessor.process({
      snapshot: this.snapshot,
      stage,
      events,
      phase,
    });
  }

  private recordInvocation(
    agent: AgentInstance,
    messages: Message[],
    events: MeetingEvent[],
    queue: EventQueue,
  ): void {
    this.snapshot.messages.push(...messages);
    this.snapshot.events.push(...events);
    queue.enqueueMany(events);

    agent.runtime_state.current_turn_index = this.snapshot.current_turn_index;
    agent.runtime_state.last_active_at = nowIso();
    agent.runtime_state.last_spoken_turn = this.snapshot.total_turns;
    agent.runtime_state.last_message_ids = messages.map((message) => message.message_id);
    agent.runtime_state.forced_next_speaker = false;
    agent.runtime_state.stage_status = "active";
    this.snapshot.forced_next_speaker_id = null;
    this.memoryManager.commitInvocation({
      snapshot: this.snapshot,
      agent,
      messages,
      events,
    });
    this.snapshot.updated_at = nowIso();
  }

  private completeStage(stage: StageTemplate): void {
    const stageOutput = this.outputManager.buildStageOutput(this.snapshot, stage);
    this.snapshot.stage_outputs.push(stageOutput);
    this.memoryManager.commitStageOutput(this.snapshot, stageOutput);
    for (const agent of this.snapshot.agents) {
      if (agent.runtime_state.current_stage_id === stage.stage_id) {
        agent.runtime_state.stage_status = "completed";
      }
    }
    this.enqueueSystemEvent("stage_completed", "medium", {
      stage_id: stage.stage_id,
    });
    this.snapshot.current_stage_index += 1;
    this.snapshot.current_turn_index = 0;
    if (!this.currentStage()) {
      this.finalize();
    }
  }

  private finalize(): void {
    this.snapshot.status = "completed";
    this.snapshot.final_output = this.outputManager.buildFinalOutput(this.snapshot, "transcript.md");
    this.snapshot.updated_at = nowIso();
  }

  private ensureStageStarted(stage: StageTemplate): void {
    const alreadyHasStageStart = this.snapshot.events.some(
      (event) => event.stage_id === stage.stage_id && event.event_type === "stage_started",
    );
    if (alreadyHasStageStart) {
      return;
    }
    for (const agent of this.snapshot.agents) {
      agent.runtime_state.current_stage_id = stage.stage_id;
      agent.runtime_state.stage_status = "active";
    }
    this.enqueueSystemEvent("stage_started", "medium", {
      stage_id: stage.stage_id,
      stage_name: stage.stage_name,
    });
  }

  private enqueueSystemEvent(
    eventType: string,
    priority: MeetingEvent["priority"],
    payload: Record<string, unknown>,
  ): void {
    const stage = this.currentStage();
    const event: MeetingEvent = {
      event_id: makeId("evt"),
      meeting_id: this.snapshot.meeting_instance.meeting_id,
      stage_id: stage?.stage_id ?? null,
      category: "system_event",
      event_type: eventType,
      source_message_id: null,
      source_agent_id: "controller",
      priority,
      payload,
      created_at: nowIso(),
    };
    this.snapshot.events.push(event);
    this.snapshot.queued_events.push(event);
  }

  private currentStage(): StageTemplate | null {
    return this.snapshot.meeting_type.stage_templates[this.snapshot.current_stage_index] ?? null;
  }

  private nextAgentInstanceId(role: string): string {
    const base = `agent_${role}`;
    if (!this.snapshot.agents.some((agent) => agent.instance_id === base)) {
      return base;
    }
    let index = 2;
    while (this.snapshot.agents.some((agent) => agent.instance_id === `${base}_${index}`)) {
      index += 1;
    }
    return `${base}_${index}`;
  }

  private ensureRoleCanParticipate(role: string, type: AgentInstance["type"]): void {
    if (!this.snapshot.meeting_type.default_agent_roles.includes(role)) {
      this.snapshot.meeting_type.default_agent_roles.push(role);
    }
    if (type !== "participant") {
      return;
    }
    for (const stage of this.snapshot.meeting_type.stage_templates) {
      if (stage.execution_mode !== "turn") {
        continue;
      }
      stage.participant_rule ??= {};
      stage.participant_rule.include_roles ??= [];
      if (!stage.participant_rule.include_roles.includes(role)) {
        stage.participant_rule.include_roles.push(role);
      }
    }
  }

  private jumpToFinalSummaryStage(): void {
    const finalIndex = this.snapshot.meeting_type.stage_templates.findIndex(
      (stage) => stage.stage_id === "final_summary",
    );
    if (finalIndex >= 0) {
      this.snapshot.current_stage_index = finalIndex;
      this.snapshot.current_turn_index = 0;
      this.snapshot.status = "running";
      return;
    }
    this.finalize();
  }

  private stageMaxTurns(stage: StageTemplate): number {
    return stage.max_turns ?? stage.completion_condition?.max_turns ?? 3;
  }

  private maxTotalTurns(): number {
    return this.snapshot.meeting_type.default_controller_policy?.max_total_turns ?? 30;
  }

  private maxEventsPerTurn(): number {
    return this.snapshot.meeting_type.default_controller_policy?.max_events_per_turn ?? 3;
  }

  private recentMessageLimit(): number {
    return this.snapshot.meeting_type.default_context_policy?.recent_message_limit ?? 10;
  }

  private result(
    status: MeetingStatus,
    action: string,
    stageId?: string,
    speakerId?: string,
  ): StepResult {
    return {
      status,
      action,
      stage_id: stageId,
      speaker_id: speakerId,
      message_count: this.snapshot.messages.length,
      event_count: this.snapshot.events.length,
    };
  }
}

function applyStageOverrides(
  stages: StageTemplate[],
  overrides: StageOverride[],
): StageTemplate[] {
  return stages.map((stage) => {
    const override = overrides.find((item) => item.stage_id === stage.stage_id);
    if (!override) {
      return { ...stage };
    }
    return {
      ...stage,
      max_turns: override.max_turns ?? stage.max_turns,
      speaking_strategy: override.speaking_strategy ?? stage.speaking_strategy,
    };
  });
}

function instantiateAgents(
  roles: string[],
  templates: AgentTemplate[],
  overrides: AgentOverride[],
): AgentInstance[] {
  const selectedTemplates = roles
    .map((role) => templateForRole(templates, role))
    .filter((template): template is AgentTemplate => Boolean(template));

  for (const override of overrides) {
    const template = templates.find(
      (candidate) =>
        candidate.agent_id === override.agent_template_id ||
        candidate.agent_role === override.agent_template_id,
    );
    if (template && !selectedTemplates.some((item) => item.agent_id === template.agent_id)) {
      selectedTemplates.push(template);
    }
  }

  return selectedTemplates.map((template) => {
    const override = overrides.find(
      (item) =>
        item.agent_template_id === template.agent_id ||
        item.agent_template_id === template.agent_role,
    );
    return createAgentInstance(template, override, `agent_${template.agent_role}`, null, 0);
  });
}

function createAgentInstance(
  template: AgentTemplate,
  override: AgentOverride | undefined,
  instanceId: string,
  currentStageId: string | null,
  currentTurnIndex: number,
): AgentInstance {
  return {
    instance_id: instanceId,
    template_id: template.agent_id,
    name: override?.instance_name ?? template.agent_name,
    type: template.agent_type,
    role: template.agent_role,
    description: template.description,
    profile: template.profile,
    model_config: override?.model_config ?? template.capabilities.model_config,
    event_subscriptions:
      template.runtime_policy.activation_rule?.event_subscriptions ?? [],
    runtime_state: {
      enabled: override?.enabled ?? true,
      current_stage_id: currentStageId,
      current_turn_index: currentTurnIndex,
      last_active_at: null,
      last_spoken_turn: null,
      last_message_ids: [],
      stage_status: currentStageId ? "active" : "idle",
      pending_user_request: null,
      forced_next_speaker: false,
      skip_reason: null,
    },
  };
}

function templateForRole(templates: AgentTemplate[], role: string): AgentTemplate | null {
  return (
    templates.find((template) => template.agent_role === role) ??
    templates.find((template) => template.agent_id === role || template.agent_id === `${role}_template`) ??
    null
  );
}

function findTemplateBySelector(
  templates: AgentTemplate[],
  selector: string,
): AgentTemplate | null {
  const normalized = selector.toLowerCase();
  const exact = templates.find((template) =>
    [
      template.agent_id,
      template.agent_role,
      template.agent_name,
      template.agent_id.replace(/_template$/, ""),
    ].some((value) => value.toLowerCase() === normalized),
  );
  if (exact) {
    return exact;
  }
  return (
    templates.find((template) =>
      [
        template.agent_id,
        template.agent_role,
        template.agent_name,
      ].some((value) => value.toLowerCase().includes(normalized)),
    ) ?? null
  );
}
