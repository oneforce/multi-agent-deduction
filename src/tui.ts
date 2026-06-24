import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import blessed from "blessed";
import { ConfigLoader } from "./config/configLoader";
import { MeetingController } from "./runtime/meetingController";
import type {
  AgentTemplate,
  EventHandlingRecord,
  MeetingRuntimeSnapshot,
  RuntimePatch,
  StageTemplate,
} from "./types";

type MenuAction =
  | "select_instance"
  | "load_state"
  | "init"
  | "step"
  | "run"
  | "pause"
  | "resume"
  | "stop"
  | "end"
  | "insert"
  | "force"
  | "disable"
  | "add_agent"
  | "switch_stage"
  | "overview"
  | "agent_templates"
  | "agents"
  | "stages"
  | "messages"
  | "events"
  | "event_handlers"
  | "timeline"
  | "commands"
  | "expand_timeline"
  | "collapse_timeline"
  | "outputs"
  | "final"
  | "memory"
  | "save"
  | "help"
  | "quit";

interface MenuItem {
  label: string;
  action: MenuAction;
}

const outputRoot = path.resolve("runs");
const instancesDir = path.resolve("configs/instances/meetings");
const menuWidth = 34;

const menuItems: MenuItem[] = [
  { label: "1. 选择会议实例", action: "select_instance" },
  { label: "2. 加载已有会议状态", action: "load_state" },
  { label: "3. 初始化/加载智能体", action: "init" },
  { label: "4. 单步推进", action: "step" },
  { label: "5. 运行到结束", action: "run" },
  { label: "6. 暂停会议", action: "pause" },
  { label: "7. 恢复会议", action: "resume" },
  { label: "8. 停止会议", action: "stop" },
  { label: "9. 结束并总结", action: "end" },
  { label: "10. 插入用户消息", action: "insert" },
  { label: "11. 点名智能体发言", action: "force" },
  { label: "12. 禁用智能体", action: "disable" },
  { label: "13. 新增智能体", action: "add_agent" },
  { label: "14. 切换阶段", action: "switch_stage" },
  { label: "15. 查看总览", action: "overview" },
  { label: "16. 查看智能体模板", action: "agent_templates" },
  { label: "17. 查看已加载智能体", action: "agents" },
  { label: "18. 查看阶段", action: "stages" },
  { label: "19. 查看消息", action: "messages" },
  { label: "20. 查看事件", action: "events" },
  { label: "21. 查看事件处理器", action: "event_handlers" },
  { label: "22. 查看时序图", action: "timeline" },
  { label: "23. 快速命令", action: "commands" },
  { label: "24. 查看阶段输出", action: "outputs" },
  { label: "25. 查看最终输出", action: "final" },
  { label: "26. 查看记忆", action: "memory" },
  { label: "27. 保存产物", action: "save" },
  { label: "28. 帮助", action: "help" },
  { label: "29. 退出", action: "quit" },
];

class MeetingTui {
  private readonly screen = blessed.screen({
    smartCSR: true,
    title: "多智能体会议系统 MVP TUI",
    fullUnicode: true,
  });

  private readonly menu = blessed.list({
    parent: this.screen,
    label: " 操作 ",
    top: 0,
    left: 0,
    width: menuWidth,
    height: "100%-4",
    keys: true,
    vi: true,
    mouse: true,
    border: "line",
    style: {
      selected: {
        bg: "blue",
        fg: "white",
      },
      item: {
        hover: {
          bg: "gray",
        },
      },
      border: {
        fg: "cyan",
      },
    },
    items: menuItems.map((item) => item.label),
  });

  private readonly content = blessed.box({
    parent: this.screen,
    label: " 视图 ",
    top: 0,
    left: menuWidth,
    width: `100%-${menuWidth}`,
    height: "100%-12",
    border: "line",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    padding: {
      left: 1,
      right: 1,
    },
    style: {
      border: {
        fg: "cyan",
      },
    },
  });

  private readonly log = blessed.log({
    parent: this.screen,
    label: " 日志 ",
    bottom: 7,
    left: menuWidth,
    width: `100%-${menuWidth}`,
    height: 5,
    border: "line",
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    padding: {
      left: 1,
      right: 1,
    },
    style: {
      border: {
        fg: "yellow",
      },
    },
  });

  private readonly commandInput = blessed.box({
    parent: this.screen,
    label: " 指令输入，按 / 聚焦，Enter 执行 ",
    bottom: 4,
    left: menuWidth,
    width: `100%-${menuWidth}`,
    height: 3,
    border: "line",
    mouse: true,
    padding: {
      left: 1,
      right: 1,
    },
    style: {
      border: {
        fg: "magenta",
      },
      focus: {
        border: {
          fg: "green",
        },
      },
    },
  });

  private readonly status = blessed.box({
    parent: this.screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 4,
    border: "line",
    tags: true,
    padding: {
      left: 1,
      right: 1,
    },
    style: {
      border: {
        fg: "green",
      },
    },
  });

  private readonly prompt = blessed.prompt({
    parent: this.screen,
    border: "line",
    height: 8,
    width: "60%",
    top: "center",
    left: "center",
    label: " 输入 ",
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
    style: {
      border: {
        fg: "magenta",
      },
    },
  });

  private readonly selector = blessed.list({
    parent: this.screen,
    border: "line",
    width: "64%",
    height: "60%",
    top: "center",
    left: "center",
    label: " 选择 ",
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
    style: {
      selected: {
        bg: "blue",
        fg: "white",
      },
      border: {
        fg: "magenta",
      },
    },
  });

  private controller: MeetingController | null = null;
  private selectedInstancePath: string | null = null;
  private lastRunDir: string | null = null;
  private busy = false;
  private commandMode = false;
  private commandBuffer = "";
  private ignoreNextCommandChar: string | null = null;
  private collapsedTimelineStages = new Set<string>();

  async start(): Promise<void> {
    this.bindKeys();
    this.bindCommandInput();
    this.menu.focus();
    this.menu.on("select", async (_item, index) => {
      await this.dispatch(menuItems[index].action);
    });
    this.setView("欢迎", this.renderHelp());
    this.logLine("TUI 已启动。请选择会议实例开始验证。");
    await this.autoSelectFirstInstance();
    this.renderStatus();
    this.screen.render();
  }

  private bindKeys(): void {
    this.screen.key(["C-c"], () => this.quit());
    this.screen.key(["q"], () => {
      if (this.commandMode) {
        return;
      }
      this.quit();
    });
    this.screen.key(["/"], () => {
      if (this.commandMode) {
        return;
      }
      this.enterCommandMode();
    });
    this.screen.key(["escape"], () => {
      if (this.commandMode) {
        this.exitCommandMode();
        return;
      }
      this.menu.focus();
      this.screen.render();
    });
    this.screen.key(["?"], async () => {
      if (!this.commandMode) await this.dispatch("help");
    });
    this.screen.key(["s"], async () => {
      if (!this.commandMode) await this.dispatch("step");
    });
    this.screen.key(["g"], async () => {
      if (!this.commandMode) await this.dispatch("run");
    });
    this.screen.key(["i"], async () => {
      if (!this.commandMode) await this.dispatch("insert");
    });
    this.screen.key(["f"], async () => {
      if (!this.commandMode) await this.dispatch("force");
    });
    this.screen.key(["d"], async () => {
      if (!this.commandMode) await this.dispatch("disable");
    });
    this.screen.key(["p"], async () => {
      if (!this.commandMode) await this.dispatch("pause");
    });
    this.screen.key(["u"], async () => {
      if (!this.commandMode) await this.dispatch("resume");
    });
    this.screen.key(["a"], async () => {
      if (!this.commandMode) await this.dispatch("agents");
    });
    this.screen.key(["m"], async () => {
      if (!this.commandMode) await this.dispatch("messages");
    });
    this.screen.key(["e"], async () => {
      if (!this.commandMode) await this.dispatch("events");
    });
    this.screen.key(["o"], async () => {
      if (!this.commandMode) await this.dispatch("outputs");
    });
    this.screen.key(["t"], async () => {
      if (!this.commandMode) await this.dispatch("timeline");
    });
    this.screen.key(["c"], async () => {
      if (!this.commandMode) await this.dispatch("commands");
    });
    this.screen.key(["r"], () => {
      if (this.commandMode) {
        return;
      }
      this.renderStatus();
      this.screen.render();
    });
  }

  private bindCommandInput(): void {
    this.renderCommandInput();
    this.screen.on("keypress", async (ch, key) => {
      if (!this.commandMode) {
        return;
      }
      if (key.ctrl && key.name === "c") {
        this.quit();
        return;
      }
      if (key.ctrl && key.name === "u") {
        this.commandBuffer = "";
        this.renderCommandInput();
        return;
      }
      if (key.name === "escape") {
        this.exitCommandMode();
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        await this.submitCommandBuffer();
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        this.commandBuffer = this.commandBuffer.slice(0, -1);
        this.renderCommandInput();
        return;
      }
      if (typeof ch === "string" && ch.length > 0 && !key.ctrl && !key.meta) {
        if (this.ignoreNextCommandChar === ch) {
          this.ignoreNextCommandChar = null;
          return;
        }
        this.appendCommandText(ch);
      }
    });
  }

  private enterCommandMode(): void {
    this.commandMode = true;
    this.commandBuffer = "";
    this.ignoreNextCommandChar = "/";
    this.renderCommandInput();
  }

  private exitCommandMode(): void {
    this.commandMode = false;
    this.commandBuffer = "";
    this.ignoreNextCommandChar = null;
    this.renderCommandInput();
    this.menu.focus();
  }

  private appendCommandText(text: string): void {
    this.commandBuffer += text;
    this.renderCommandInput();
  }

  private async submitCommandBuffer(): Promise<void> {
    const command = this.commandBuffer.trim();
    this.commandBuffer = "";
    this.renderCommandInput();
    if (!command) {
      return;
    }
    await this.executeCommand(command);
    this.commandMode = true;
    this.renderCommandInput();
  }

  private renderCommandInput(): void {
    this.commandInput.setLabel(
      this.commandMode
        ? " 指令输入中，Enter 执行，Esc 退出，Ctrl+U 清空 "
        : " 指令输入，按 / 聚焦，Enter 执行 ",
    );
    this.commandInput.setContent(
      this.commandMode
        ? `> ${this.commandBuffer}_`
        : "> 按 / 后输入 init、step、run、force critic_agent ...",
    );
    this.screen.render();
  }

  private async dispatch(action: MenuAction): Promise<void> {
    if (this.busy) {
      if (!this.commandMode) {
        this.logLine("上一个操作还在执行，请稍等。");
      }
      return;
    }
    this.busy = true;
    try {
      switch (action) {
        case "select_instance":
          await this.selectInstance();
          break;
        case "load_state":
          await this.loadState();
          break;
        case "init":
          await this.initializeFresh();
          break;
        case "step":
          await this.step();
          break;
        case "run":
          await this.runToCompletion();
          break;
        case "pause":
          await this.applyAndSave({ kind: "pause_meeting" }, "会议已暂停。");
          break;
        case "resume":
          await this.applyAndSave({ kind: "resume_meeting" }, "会议已恢复。");
          break;
        case "stop":
          await this.applyAndSave({ kind: "stop_meeting" }, "会议已停止。");
          break;
        case "end":
          await this.applyAndSave({ kind: "end_and_summarize" }, "已请求结束并生成最终总结。");
          break;
        case "insert":
          await this.insertMessage();
          break;
        case "force":
          await this.forceAgent();
          break;
        case "disable":
          await this.disableAgent();
          break;
        case "add_agent":
          await this.addAgent();
          break;
        case "switch_stage":
          await this.switchStage();
          break;
        case "overview":
          this.showOverview();
          break;
        case "agent_templates":
          await this.showAgentTemplates();
          break;
        case "agents":
          this.showAgents();
          break;
        case "stages":
          this.showStages();
          break;
        case "messages":
          this.showMessages();
          break;
        case "events":
          this.showEvents();
          break;
        case "event_handlers":
          this.showEventHandlers();
          break;
        case "timeline":
          this.showTimeline();
          break;
        case "commands":
          this.showCommands();
          break;
        case "outputs":
          this.showStageOutputs();
          break;
        case "final":
          this.showFinalOutput();
          break;
        case "memory":
          this.showMemory();
          break;
        case "save":
          await this.saveArtifacts();
          break;
        case "help":
          this.setView("帮助", this.renderHelp());
          break;
        case "quit":
          this.quit();
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logLine(`{red-fg}错误：{/red-fg}${message}`);
    } finally {
      this.busy = false;
      this.renderStatus();
      this.screen.render();
    }
  }

  private async executeCommand(rawCommand: string): Promise<void> {
    if (this.busy) {
      this.logLine("上一个操作还在执行，请稍等。");
      return;
    }

    this.busy = true;
    this.logLine(`> ${rawCommand}`);
    try {
      const { command, argument } = parseCommand(rawCommand);
      switch (normalizeCommand(command, argument)) {
        case "help":
          this.setView("帮助", this.renderHelp());
          break;
        case "select_instance":
          if (argument) {
            await this.selectInstanceByKeyword(argument);
          } else {
            await this.selectInstance();
          }
          break;
        case "load_state":
          if (argument) {
            await this.loadStateByMeetingId(argument);
          } else {
            await this.loadState();
          }
          break;
        case "init":
          await this.initializeFresh();
          break;
        case "step":
          await this.step();
          break;
        case "run":
          await this.runToCompletion();
          break;
        case "pause":
          await this.applyAndSave({ kind: "pause_meeting" }, "会议已暂停。");
          break;
        case "resume":
          await this.applyAndSave({ kind: "resume_meeting" }, "会议已恢复。");
          break;
        case "stop":
          await this.applyAndSave({ kind: "stop_meeting" }, "会议已停止。");
          break;
        case "end":
          await this.applyAndSave({ kind: "end_and_summarize" }, "已请求结束并生成最终总结。");
          break;
        case "insert":
          if (argument) {
            await this.applyAndSave(
              {
                kind: "user_message_inserted",
                value: argument,
              },
              "用户消息已插入。",
            );
            this.showMessages();
          } else {
            await this.insertMessage();
          }
          break;
        case "force":
          if (argument) {
            await this.applyAndSave(
              {
                kind: "force_agent_speak",
                value: argument,
              },
              `已点名下一位发言者：${argument}`,
            );
          } else {
            await this.forceAgent();
          }
          break;
        case "disable":
          if (argument) {
            await this.applyAndSave(
              {
                kind: "disable_agent",
                value: argument,
              },
              `已禁用智能体：${argument}`,
            );
            this.showAgents();
          } else {
            await this.disableAgent();
          }
          break;
        case "add_agent":
          if (argument) {
            await this.addAgentFromCommand(argument);
          } else {
            await this.addAgent();
          }
          break;
        case "switch_stage":
          if (argument) {
            await this.applyAndSave(
              {
                kind: "switch_stage",
                value: argument,
              },
              `已切换阶段：${argument}`,
            );
          } else {
            await this.switchStage();
          }
          break;
        case "overview":
          this.showOverview();
          break;
        case "agent_templates":
          await this.showAgentTemplates();
          break;
        case "agents":
          this.showAgents();
          break;
        case "stages":
          this.showStages();
          break;
        case "messages":
          this.showMessages();
          break;
        case "events":
          this.showEvents();
          break;
        case "event_handlers":
          this.showEventHandlers();
          break;
        case "timeline":
          this.showTimeline();
          break;
        case "commands":
          this.showCommands();
          break;
        case "expand_timeline":
          this.expandTimeline(argument);
          break;
        case "collapse_timeline":
          this.collapseTimeline(argument);
          break;
        case "outputs":
          this.showStageOutputs();
          break;
        case "final":
          this.showFinalOutput();
          break;
        case "memory":
          this.showMemory();
          break;
        case "save":
          await this.saveArtifacts();
          break;
        case "quit":
          this.quit();
          break;
        default:
          this.logLine(`未知指令：${rawCommand}`);
          this.setView("指令帮助", this.renderCommandHelp());
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logLine(`{red-fg}错误：{/red-fg}${message}`);
    } finally {
      this.busy = false;
      this.renderStatus();
      this.screen.render();
    }
  }

  private async autoSelectFirstInstance(): Promise<void> {
    const instances = await this.instancePaths();
    const preferred =
      instances.find((instancePath) => path.basename(instancePath) === "brainstorm_demo.yaml") ??
      instances.find((instancePath) => !path.basename(instancePath).includes("deepseek")) ??
      instances[0];
    if (preferred) {
      this.selectedInstancePath = preferred;
      this.logLine(`已自动选择：${path.relative(process.cwd(), preferred)}`);
    }
  }

  private async selectInstance(): Promise<void> {
    const instances = await this.instancePaths();
    if (instances.length === 0) {
      throw new Error("没有找到会议实例 YAML 文件。");
    }
    const labels = instances.map((item) => path.relative(process.cwd(), item));
    const selected = await this.select("会议实例", labels);
    if (selected == null) {
      return;
    }
    this.selectedInstancePath = instances[selected];
    this.controller = null;
    this.lastRunDir = null;
    this.logLine(`已选择会议实例：${labels[selected]}`);
    this.setView("已选择会议实例", `当前选择：\n${labels[selected]}\n\n下一步请选择“初始化/加载智能体”。`);
  }

  private async selectInstanceByKeyword(keyword: string): Promise<void> {
    const instances = await this.instancePaths();
    const normalized = keyword.toLowerCase();
    const mockPreferred =
      normalized === "mock" || normalized === "模拟" || normalized === "本地"
        ? instances.find((instancePath) => path.basename(instancePath) === "brainstorm_demo.yaml") ??
          instances.find((instancePath) => !path.basename(instancePath).includes("deepseek"))
        : null;
    if (mockPreferred) {
      this.selectedInstancePath = mockPreferred;
      this.controller = null;
      this.lastRunDir = null;
      this.logLine(`已选择 mock 会议实例：${path.relative(process.cwd(), mockPreferred)}`);
      this.showOverview();
      return;
    }
    const matched = instances.find((instancePath) => {
      const label = path.relative(process.cwd(), instancePath).toLowerCase();
      return label.includes(normalized);
    });
    if (!matched) {
      throw new Error(`没有找到匹配的会议实例：${keyword}`);
    }
    this.selectedInstancePath = matched;
    this.controller = null;
    this.lastRunDir = null;
    this.logLine(`已选择会议实例：${path.relative(process.cwd(), matched)}`);
    this.showOverview();
  }

  private async loadState(): Promise<void> {
    const states = await this.runStatePaths();
    if (states.length === 0) {
      throw new Error("runs/ 目录下没有找到已保存的会议状态。");
    }
    const labels = states.map((item) => path.relative(process.cwd(), item));
    const selected = await this.select("已保存会议", labels);
    if (selected == null) {
      return;
    }
    this.controller = await MeetingController.fromSnapshotFile(states[selected], outputRoot);
    this.selectedInstancePath = await this.instancePathForLoadedState();
    this.lastRunDir = path.dirname(states[selected]);
    this.logLine(`已加载会议状态：${labels[selected]}`);
    this.showOverview();
  }

  private async loadStateByMeetingId(meetingId: string): Promise<void> {
    const statePath = path.join(outputRoot, meetingId, "state.json");
    if (!existsSync(statePath)) {
      throw new Error(`没有找到会议状态：${statePath}`);
    }
    this.controller = await MeetingController.fromSnapshotFile(statePath, outputRoot);
    this.selectedInstancePath = await this.instancePathForLoadedState();
    this.lastRunDir = path.dirname(statePath);
    this.logLine(`已加载会议状态：${path.relative(process.cwd(), statePath)}`);
    this.showOverview();
  }

  private async initializeFresh(): Promise<void> {
    const instancePath = this.requireInstancePath();
    this.controller = new MeetingController({ outputRoot });
    await this.controller.initializeFromInstance(instancePath);
    this.lastRunDir = await this.controller.saveArtifacts();
    this.logLine("会议已初始化，智能体已加载。");
    this.showOverview();
  }

  private async step(): Promise<void> {
    const controller = this.requireController();
    const result = await controller.step();
    this.lastRunDir = await controller.saveArtifacts();
    this.logLine(
      `单步推进：${result.action}；状态=${result.status}；阶段=${result.stage_id ?? "无"}；发言者=${result.speaker_id ?? "无"}`,
    );
    this.showMessages();
  }

  private async runToCompletion(): Promise<void> {
    const controller = this.requireController();
    const result = await controller.runToCompletion();
    this.lastRunDir = result.run_dir;
    this.logLine(`运行完成：状态=${result.status}；步数=${result.steps.length}`);
    this.showFinalOutput();
  }

  private async applyAndSave(patch: RuntimePatch, successMessage: string): Promise<void> {
    const controller = this.requireController();
    controller.applyIntervention(patch);
    this.lastRunDir = await controller.saveArtifacts();
    this.logLine(successMessage);
    this.showOverview();
  }

  private async insertMessage(): Promise<void> {
    const text = await this.ask("请输入要插入的用户消息：");
    if (!text) {
      return;
    }
    await this.applyAndSave(
      {
        kind: "user_message_inserted",
        value: text,
      },
      "用户消息已插入。",
    );
    this.showMessages();
  }

  private async forceAgent(): Promise<void> {
    const agentId = await this.pickAgent("点名智能体发言");
    if (!agentId) {
      return;
    }
    await this.applyAndSave(
      {
        kind: "force_agent_speak",
        value: agentId,
      },
      `已点名下一位发言者：${agentId}`,
    );
  }

  private async disableAgent(): Promise<void> {
    const agentId = await this.pickAgent("禁用智能体");
    if (!agentId) {
      return;
    }
    await this.applyAndSave(
      {
        kind: "disable_agent",
        value: agentId,
      },
      `已禁用智能体：${agentId}`,
    );
    this.showAgents();
  }

  private async addAgent(): Promise<void> {
    const templates = await new ConfigLoader().loadAgentTemplates();
    const labels = templates.map(
      (template) =>
        `${template.agent_role} | ${template.agent_name} | ${template.agent_type} | ${template.agent_id}`,
    );
    const selected = await this.select("新增智能体：选择模板", labels);
    if (selected == null) {
      return;
    }
    await this.addAgentBySelector(templates[selected].agent_role);
  }

  private async addAgentFromCommand(argument: string): Promise<void> {
    const { selector, name } = parseAddAgentArgument(argument);
    await this.addAgentBySelector(selector, name);
  }

  private async addAgentBySelector(templateSelector: string, instanceName?: string): Promise<void> {
    const controller = this.requireController();
    const agent = await controller.addAgentFromTemplate({
      templateSelector,
      instanceName,
    });
    this.lastRunDir = await controller.saveArtifacts();
    this.logLine(`已新增智能体：${agent.instance_id} / ${agent.name} / ${agent.role}`);
    this.showAgents();
  }

  private async switchStage(): Promise<void> {
    const controller = this.requireController();
    const stages = controller.snapshot.meeting_type.stage_templates;
    const labels = stages.map((stage, index) => `${index + 1}. ${stage.stage_id} - ${stage.stage_name}`);
    const selected = await this.select("切换阶段", labels);
    if (selected == null) {
      return;
    }
    await this.applyAndSave(
      {
        kind: "switch_stage",
        value: stages[selected].stage_id,
      },
      `已切换阶段：${stages[selected].stage_id}`,
    );
  }

  private showOverview(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView(
        "总览",
        [
          "当前没有活动会议。",
          "",
          `已选择会议实例：${this.selectedInstancePath ? path.relative(process.cwd(), this.selectedInstancePath) : "无"}`,
          "",
          "请选择：",
          "1. 选择会议实例",
          "3. 初始化/加载智能体",
        ].join("\n"),
      );
      return;
    }
    const stage = snapshot.meeting_type.stage_templates[snapshot.current_stage_index];
    this.setView(
      "总览",
      [
        `标题：${snapshot.meeting_instance.title}`,
        `会议 ID：${snapshot.meeting_instance.meeting_id}`,
        `会议类型：${snapshot.meeting_type.type_id} / ${snapshot.meeting_type.type_name}`,
        `状态：${snapshot.status}`,
        `当前阶段：${stage ? `${stage.stage_id} - ${stage.stage_name}` : "无"}`,
        `当前轮次：${snapshot.current_turn_index}`,
        `总发言轮次：${snapshot.total_turns}`,
        `消息数：${snapshot.messages.length}`,
        `事件数：${snapshot.events.length}`,
        `队列事件数：${snapshot.queued_events.length}`,
        `阶段输出数：${snapshot.stage_outputs.length}`,
        `最终输出：${snapshot.final_output ? "已生成" : "未生成"}`,
        `产物目录：${this.lastRunDir ?? "尚未保存"}`,
        "",
        "会议目标：",
        pretty(snapshot.meeting_instance.goal),
      ].join("\n"),
    );
  }

  private async showAgentTemplates(): Promise<void> {
    const templates = await new ConfigLoader().loadAgentTemplates();
    this.setView(
      "智能体模板",
      templates.map(renderAgentTemplate).join("\n\n"),
    );
  }

  private showAgents(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("已加载智能体", "当前没有活动会议。请先初始化会议。");
      return;
    }
    this.setView(
      "已加载智能体",
      snapshot.agents
        .map((agent) =>
          [
            `${agent.name} (${agent.instance_id})`,
            `  角色：${agent.role}`,
            `  类型：${agent.type}`,
            `  是否启用：${agent.runtime_state.enabled}`,
            `  模型：${agent.model_config.provider}/${agent.model_config.model}`,
            `  订阅事件：${agent.event_subscriptions.join(", ") || "无"}`,
            `  当前阶段：${agent.runtime_state.current_stage_id ?? "无"}`,
            `  上次发言轮次：${agent.runtime_state.last_spoken_turn ?? "未发言"}`,
            `  跳过原因：${agent.runtime_state.skip_reason ?? "无"}`,
          ].join("\n"),
        )
        .join("\n\n"),
    );
  }

  private showStages(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("阶段", "当前没有活动会议。");
      return;
    }
    this.setView(
      "阶段",
      snapshot.meeting_type.stage_templates
        .map((stage, index) => renderStage(stage, index, index === snapshot.current_stage_index))
        .join("\n\n"),
    );
  }

  private showMessages(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("消息", "当前没有活动会议。");
      return;
    }
    if (snapshot.messages.length === 0) {
      this.setView("消息", "还没有消息。请先执行“单步推进”。");
      return;
    }
    this.setView(
      "消息",
      snapshot.messages
        .map((message, index) => {
          const sender = snapshot.agents.find((agent) => agent.instance_id === message.sender_id)?.name ?? message.sender_id;
          return [
            `#${index + 1} ${message.stage_id} / ${message.turn_id}`,
            `发送者：${sender} (${message.sender_type})`,
            `消息类型：${message.message_type}`,
            `时间：${message.created_at}`,
            "",
            message.content,
          ].join("\n");
        })
        .join("\n\n---\n\n"),
    );
  }

  private showEvents(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("事件", "当前没有活动会议。");
      return;
    }
    if (snapshot.events.length === 0) {
      this.setView("事件", "还没有事件。");
      return;
    }
    this.setView(
      "事件",
      snapshot.events
        .map((event, index) =>
          [
            `#${index + 1} ${event.event_type}`,
            `分类：${event.category}`,
            `优先级：${event.priority}`,
            `阶段：${event.stage_id ?? "会议级"}`,
            `来源智能体：${event.source_agent_id ?? "无"}`,
            `来源消息：${event.source_message_id ?? "无"}`,
            `载荷：${pretty(event.payload)}`,
          ].join("\n"),
        )
        .join("\n\n---\n\n"),
    );
  }

  private showEventHandlers(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("事件处理器", "当前没有活动会议。请先 init。");
      return;
    }
    this.setView("事件处理器", renderEventHandlingLog(snapshot));
  }

  private showTimeline(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("时序图", "当前没有活动会议。请先 init。");
      return;
    }
    this.setView("时序图", renderTimeline(snapshot, this.collapsedTimelineStages));
  }

  private showCommands(): void {
    this.setView("快速命令", this.renderQuickCommands());
  }

  private expandTimeline(argument: string): void {
    const snapshot = this.requireController().snapshot;
    const target = argument.trim();
    if (!target || target === "all" || target === "全部") {
      this.collapsedTimelineStages.clear();
      this.logLine("时序图已全部展开。");
      this.showTimeline();
      return;
    }
    for (const stage of matchingStages(snapshot, target)) {
      this.collapsedTimelineStages.delete(stage.stage_id);
    }
    this.showTimeline();
  }

  private collapseTimeline(argument: string): void {
    const snapshot = this.requireController().snapshot;
    const target = argument.trim();
    if (!target || target === "all" || target === "全部") {
      for (const stage of snapshot.meeting_type.stage_templates) {
        this.collapsedTimelineStages.add(stage.stage_id);
      }
      this.logLine("时序图已全部折叠。");
      this.showTimeline();
      return;
    }
    const stages = matchingStages(snapshot, target);
    if (stages.length === 0) {
      throw new Error(`找不到要折叠的阶段：${target}`);
    }
    for (const stage of stages) {
      this.collapsedTimelineStages.add(stage.stage_id);
    }
    this.showTimeline();
  }

  private showStageOutputs(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("阶段输出", "当前没有活动会议。");
      return;
    }
    this.setView("阶段输出", pretty(snapshot.stage_outputs));
  }

  private showFinalOutput(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("最终输出", "当前没有活动会议。");
      return;
    }
    this.setView(
      "最终输出",
      snapshot.final_output ? pretty(snapshot.final_output) : "最终输出尚未生成。",
    );
  }

  private showMemory(): void {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      this.setView("记忆", "当前没有活动会议。");
      return;
    }
    this.setView(
      "记忆",
      pretty({
        meeting_memory: snapshot.meeting_memory,
        stage_memory: snapshot.stage_memory,
        agent_private_memory: snapshot.agent_private_memory,
      }),
    );
  }

  private async saveArtifacts(): Promise<void> {
    const controller = this.requireController();
    this.lastRunDir = await controller.saveArtifacts();
    this.logLine(`产物已保存：${this.lastRunDir}`);
  }

  private async pickAgent(title: string): Promise<string | null> {
    const controller = this.requireController();
    const labels = controller.snapshot.agents.map(
      (agent) => `${agent.instance_id} | ${agent.name} | ${agent.role} | enabled=${agent.runtime_state.enabled}`,
    );
    const selected = await this.select(title, labels);
    if (selected == null) {
      return null;
    }
    return controller.snapshot.agents[selected].instance_id;
  }

  private async ask(question: string): Promise<string | null> {
    this.prompt.show();
    this.prompt.focus();
    this.screen.render();
    return new Promise((resolve) => {
      this.prompt.input(question, "", (_error, value) => {
        this.prompt.hide();
        this.menu.focus();
        resolve(typeof value === "string" && value.trim() ? value.trim() : null);
      });
    });
  }

  private async select(title: string, labels: string[]): Promise<number | null> {
    this.selector.setLabel(` ${title} `);
    this.selector.setItems(labels);
    this.selector.select(0);
    this.selector.show();
    this.selector.focus();
    this.screen.render();

    return new Promise((resolve) => {
      const cleanup = () => {
        this.selector.removeListener("select", onSelect);
        this.selector.removeListener("cancel", onCancel);
        this.selector.unkey("escape", onCancel);
        this.selector.hide();
        this.menu.focus();
      };
      const onSelect = (_item: blessed.Widgets.BlessedElement, index: number) => {
        cleanup();
        resolve(index);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      this.selector.once("select", onSelect);
      this.selector.once("cancel", onCancel);
      this.selector.key("escape", onCancel);
    });
  }

  private setView(title: string, body: string): void {
    this.content.setLabel(` ${title} `);
    this.content.setScrollPerc(0);
    this.content.setContent(body);
  }

  private logLine(message: string): void {
    this.log.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  private renderStatus(): void {
    const snapshot = this.snapshotOrNull();
    const stage = snapshot?.meeting_type.stage_templates[snapshot.current_stage_index];
    this.status.setContent(
      [
        "{bold}多智能体会议系统 MVP TUI{/bold}",
        `会议实例：${this.selectedInstancePath ? path.relative(process.cwd(), this.selectedInstancePath) : "无"}`,
        `会议：${snapshot?.meeting_instance.meeting_id ?? "未初始化"} | 状态：${snapshot?.status ?? "无"} | 阶段：${stage?.stage_id ?? "无"} | 轮次：${snapshot?.current_turn_index ?? 0} | 消息：${snapshot?.messages.length ?? 0} | 事件：${snapshot?.events.length ?? 0}`,
        "快捷键：s 单步 | g 运行到结束 | i 插入消息 | f 点名 | d 禁用 | p 暂停 | u 恢复 | a 智能体 | m 消息 | e 事件 | t 时序 | c 命令 | o 输出 | ? 帮助 | q 退出",
      ].join("\n"),
    );
  }

  private renderHelp(): string {
    return [
      "使用方向键或鼠标选择左侧菜单，按 Enter 执行动作。",
      "也可以按 / 聚焦底部“指令输入”，输入指令后按 Enter 执行。",
      "",
      "建议的 MVP 验证流程：",
      "1. 选择会议实例",
      "2. 初始化/加载智能体",
      "3. 查看已加载智能体",
      "4. 单步推进几轮",
      "5. 查看消息、事件和事件处理器",
      "6. 查看时序图并展开/折叠阶段",
      "7. 点名智能体发言或插入用户消息",
      "8. 运行到结束",
      "9. 查看阶段输出、最终输出和记忆",
      "",
      "每次改变状态的操作都会保存到 runs/<meeting_id>/。",
      "",
      "快捷键：",
      "s 单步，g 运行到结束，i 插入消息，f 点名，d 禁用，p 暂停，u 恢复",
      "a 智能体，m 消息，e 事件，t 时序图，c 快速命令，o 输出，? 帮助，q 退出",
      "",
      this.renderCommandHelp(),
    ].join("\n");
  }

  private renderCommandHelp(): string {
    return [
      "常用指令：",
      "init / 初始化                    初始化会议并加载智能体",
      "step / 下一步                     单步推进",
      "run / 运行                        运行到结束",
      "pause / 暂停                      暂停会议",
      "resume / 恢复                     恢复会议",
      "stop / 停止                       停止会议",
      "end / 结束                        结束并生成总结",
      "insert <内容> / 插入 <内容>       插入用户消息",
      "force <智能体> / 点名 <智能体>    点名下一位发言者",
      "disable <智能体> / 禁用 <智能体>  禁用智能体",
      "add <模板> [名称] / 新增 <模板>   新增智能体并加入会议",
      "switch <阶段> / 切换 <阶段>       切换阶段",
      "select <关键词> / 选择 <关键词>   选择会议实例",
      "select mock / 选择 mock           切回默认 mock 会议实例",
      "load <会议ID> / 加载 <会议ID>     加载已保存会议状态",
      "agents / 智能体                   查看已加载智能体",
      "messages / 消息                   查看消息",
      "events / 事件                     查看事件",
      "handlers / 事件处理器             查看 event 被哪些处理器消费",
      "timeline / 时序图                 查看阶段/智能体/消息/事件时序",
      "commands / 命令                   快速查看命令",
      "collapse all / 折叠 all           折叠全部时序阶段",
      "expand all / 展开 all             展开全部时序阶段",
      "outputs / 输出                    查看阶段输出",
      "final / 最终                      查看最终输出",
      "memory / 记忆                     查看记忆",
      "overview / 总览                   查看总览",
      "help / 帮助                       查看帮助",
    ].join("\n");
  }

  private renderQuickCommands(): string {
    return [
      "会议推进",
      "  init                       初始化并加载智能体",
      "  step                       单步推进",
      "  run                        运行到结束",
      "  pause / resume / stop       暂停 / 恢复 / 停止",
      "  end                        结束并总结",
      "",
      "干预会议",
      "  insert <内容>               插入用户消息",
      "  force <智能体ID或角色>       点名下一位发言",
      "  disable <智能体ID或角色>     禁用智能体",
      "  add <模板> [名称]            运行时新增智能体",
      "  switch <阶段ID>              切换阶段",
      "",
      "查看视图",
      "  overview                   总览",
      "  agents                     智能体",
      "  stages                     阶段",
      "  messages                   消息",
      "  events                     事件",
      "  handlers                   事件处理器",
      "  timeline                   时序图",
      "  outputs                    阶段输出",
      "  final                      最终输出",
      "  memory                     记忆",
      "",
      "时序图折叠/展开",
      "  collapse all               折叠全部阶段",
      "  expand all                 展开全部阶段",
      "  collapse divergent_ideas   折叠某个阶段",
      "  expand divergent_ideas     展开某个阶段",
      "",
      "实例与保存",
      "  select mock                切回 mock 实例",
      "  select deepseek            选择 DeepSeek 实例",
      "  load meeting_001           加载已保存会议",
      "  save                       保存产物",
      "",
      "提示：按 / 聚焦指令输入，Enter 执行，Esc 退出输入模式，Ctrl+U 清空。",
    ].join("\n");
  }

  private requireController(): MeetingController {
    if (!this.controller) {
      throw new Error("请先初始化会议，或加载已有会议状态。");
    }
    return this.controller;
  }

  private requireInstancePath(): string {
    if (!this.selectedInstancePath) {
      throw new Error("请先选择会议实例。");
    }
    return this.selectedInstancePath;
  }

  private snapshotOrNull(): MeetingRuntimeSnapshot | null {
    return this.controller?.snapshot ?? null;
  }

  private async instancePathForLoadedState(): Promise<string | null> {
    const snapshot = this.snapshotOrNull();
    if (!snapshot) {
      return null;
    }
    const candidates = await this.instancePaths();
    for (const candidate of candidates) {
      const instance = await new ConfigLoader().loadMeetingInstance(candidate);
      if (instance.meeting_id === snapshot.meeting_instance.meeting_id) {
        return candidate;
      }
    }
    return null;
  }

  private async instancePaths(): Promise<string[]> {
    const entries = await readdir(instancesDir);
    return entries
      .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
      .sort()
      .map((entry) => path.join(instancesDir, entry));
  }

  private async runStatePaths(): Promise<string[]> {
    if (!existsSync(outputRoot)) {
      return [];
    }
    const entries = await readdir(outputRoot);
    const statePaths: string[] = [];
    for (const entry of entries.sort()) {
      const candidate = path.join(outputRoot, entry, "state.json");
      if (existsSync(candidate) && (await stat(candidate)).isFile()) {
        statePaths.push(candidate);
      }
    }
    return statePaths;
  }

  private quit(): void {
    this.screen.destroy();
    process.exit(0);
  }
}

function renderAgentTemplate(template: AgentTemplate): string {
  return [
    `${template.agent_name} (${template.agent_id})`,
    `  角色：${template.agent_role}`,
    `  类型：${template.agent_type}`,
    `  模型：${template.capabilities.model_config.provider}/${template.capabilities.model_config.model}`,
    `  目标：${template.profile.goal}`,
    `  订阅事件：${template.runtime_policy.activation_rule?.event_subscriptions?.join(", ") ?? "无"}`,
  ].join("\n");
}

function renderStage(stage: StageTemplate, index: number, current: boolean): string {
  return [
    `${current ? ">" : " "} ${index + 1}. ${stage.stage_id} - ${stage.stage_name}`,
    `  执行模式：${stage.execution_mode}`,
    `  阶段目标：${stage.stage_goal}`,
    `  最大轮次：${stage.max_turns ?? stage.completion_condition?.max_turns ?? "默认"}`,
    `  发言角色：${(stage.speaker_roles ?? stage.participant_rule?.include_roles ?? []).join(", ") || "默认"}`,
    `  发言策略：${stage.speaking_strategy?.type ?? "round_robin"}`,
  ].join("\n");
}

function renderEventHandlingLog(snapshot: MeetingRuntimeSnapshot): string {
  const records = snapshot.event_handling_log ?? [];
  if (records.length === 0) {
    return [
      "还没有事件处理记录。",
      "",
      "执行顺序：",
      "1. init 初始化会议",
      "2. step 单步推进一次",
      "3. handlers / 事件处理器 查看处理链",
      "",
      "说明：events 是已经生成的事件列表；event_handling_log 是事件从 EventQueue 取出后，被处理器消费的记录。",
    ].join("\n");
  }

  const handlerCounts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.handler_name} (${record.handler_id})`;
    handlerCounts.set(key, (handlerCounts.get(key) ?? 0) + 1);
  }

  const lines = [
    "事件处理器",
    "",
    `已生成事件：${snapshot.events.length}`,
    `队列待处理事件：${snapshot.queued_events.length}`,
    `处理记录：${records.length}`,
    "",
    "Handler 统计：",
    ...[...handlerCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([handler, count]) => `  ${handler}: ${count}`),
    "",
    "处理链：",
    "",
  ];

  for (const [index, group] of groupHandlingRecords(records).entries()) {
    const event = snapshot.events.find((item) => item.event_id === group.eventId);
    const first = group.records[0];
    const eventType = event?.event_type ?? first.event_type;
    const category = event?.category ?? first.event_category;
    const priority = event?.priority ?? "unknown";
    const stageId = event?.stage_id ?? first.stage_id ?? "meeting";
    lines.push(
      `#${index + 1} ${eventType} (${group.eventId})`,
      `  分类/优先级：${category} / ${priority}`,
      `  阶段：${stageId}`,
      `  来源：${event?.source_agent_id ?? "unknown"}${event?.source_message_id ? ` <- ${event.source_message_id}` : ""}`,
      `  生成时间：${event ? formatTime(event.created_at) : "unknown"}`,
    );
    const payload = event ? compactPayload(event.payload) : "";
    if (payload) {
      lines.push(`  payload：${payload}`);
    }
    for (const record of group.records) {
      lines.push(
        `  - ${record.handler_name} / ${record.handler_type}`,
        `    handler_id：${record.handler_id}`,
        `    action：${record.action}`,
        `    effect：${record.effect}`,
        `    phase：${record.phase}，turn：${record.turn_index}，处理时间：${formatTime(record.created_at)}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function groupHandlingRecords(
  records: EventHandlingRecord[],
): Array<{ eventId: string; records: EventHandlingRecord[] }> {
  const groups = new Map<string, EventHandlingRecord[]>();
  for (const record of records) {
    const group = groups.get(record.event_id) ?? [];
    group.push(record);
    groups.set(record.event_id, group);
  }
  return [...groups.entries()].map(([eventId, group]) => ({
    eventId,
    records: group,
  }));
}

function renderTimeline(
  snapshot: MeetingRuntimeSnapshot,
  collapsedStages: Set<string>,
): string {
  const currentStageId = snapshot.meeting_type.stage_templates[snapshot.current_stage_index]?.stage_id;
  const stageIds = timelineStageIds(snapshot);
  const lines = [
    "会议时序图",
    "",
    "图例：",
    "  MSG = Message，智能体/用户发出的会议消息",
    "  EVT = Event，进入队列并影响后续调度的事件",
    "  [-] = 已展开，[+] = 已折叠，* = 当前阶段",
    "",
    "折叠/展开命令：collapse all、expand all、collapse <stage_id>、expand <stage_id>",
    "",
  ];

  for (const stageId of stageIds) {
    const stage = snapshot.meeting_type.stage_templates.find((item) => item.stage_id === stageId);
    const messages = snapshot.messages.filter((message) => message.stage_id === stageId);
    const events = snapshot.events.filter((event) => (event.stage_id ?? "meeting") === stageId);
    const isCollapsed = collapsedStages.has(stageId);
    const currentMark = stageId === currentStageId ? "*" : " ";
    const stageLabel = stage ? `${stage.stage_id} - ${stage.stage_name}` : stageId;
    lines.push(
      `${isCollapsed ? "[+]" : "[-]"}${currentMark} ${stageLabel}  ` +
        `(MSG ${messages.length} / EVT ${events.length})`,
    );

    if (isCollapsed) {
      lines.push("");
      continue;
    }

    const items = [
      ...messages.map((message, index) => ({
        kind: "message" as const,
        createdAt: message.created_at,
        sortKey: `${message.created_at}-m-${index}`,
        message,
      })),
      ...events.map((event, index) => ({
        kind: "event" as const,
        createdAt: event.created_at,
        sortKey: `${event.created_at}-e-${index}`,
        event,
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    if (items.length === 0) {
      lines.push("  暂无消息或事件。");
      lines.push("");
      continue;
    }

    for (const item of items) {
      if (item.kind === "message") {
        const sender = senderName(snapshot, item.message.sender_id, item.message.sender_type);
        lines.push(
          `  ${formatTime(item.createdAt)} MSG ${sender} -> ${stageId}: ` +
            `${item.message.message_type} (${item.message.message_id})`,
        );
        lines.push(`      ${snippet(item.message.content, 120)}`);
        continue;
      }

      const source = item.event.source_agent_id ?? "controller";
      const sourceMessage = item.event.source_message_id
        ? ` <- ${item.event.source_message_id}`
        : "";
      lines.push(
        `  ${formatTime(item.createdAt)} EVT ${source} => EventQueue: ` +
          `${item.event.event_type} [${item.event.priority}]${sourceMessage}`,
      );
      const payload = compactPayload(item.event.payload);
      if (payload) {
        lines.push(`      payload: ${payload}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function timelineStageIds(snapshot: MeetingRuntimeSnapshot): string[] {
  const ids = new Set<string>();
  for (const stage of snapshot.meeting_type.stage_templates) {
    ids.add(stage.stage_id);
  }
  for (const message of snapshot.messages) {
    ids.add(message.stage_id);
  }
  for (const event of snapshot.events) {
    ids.add(event.stage_id ?? "meeting");
  }
  return [...ids];
}

function matchingStages(snapshot: MeetingRuntimeSnapshot, target: string): StageTemplate[] {
  const normalized = target.toLowerCase();
  return snapshot.meeting_type.stage_templates.filter((stage) =>
    [stage.stage_id, stage.stage_name].some((value) => value.toLowerCase().includes(normalized)),
  );
}

function senderName(
  snapshot: MeetingRuntimeSnapshot,
  senderId: string,
  senderType: string,
): string {
  if (senderType === "user") {
    return "用户";
  }
  if (senderType === "controller" || senderId === "controller") {
    return "Controller";
  }
  const agent = snapshot.agents.find((item) => item.instance_id === senderId);
  return agent ? `${agent.name}/${agent.role}` : senderId;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString();
}

function snippet(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function compactPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return snippet(json === "{}" ? "" : json, 120);
}

function parseCommand(rawCommand: string): { command: string; argument: string } {
  const trimmed = rawCommand.trim().replace(/^[/／:：\s]+/, "");
  const [command = "", ...rest] = trimmed.split(/\s+/);
  return {
    command,
    argument: rest.join(" ").trim(),
  };
}

function parseAddAgentArgument(argument: string): { selector: string; name?: string } {
  const [selector = "", ...nameParts] = argument.trim().split(/\s+/);
  if (!selector) {
    throw new Error("新增智能体需要指定模板，例如：add critic_agent");
  }
  const name = nameParts.join(" ").trim();
  return {
    selector,
    name: name || undefined,
  };
}

function normalizeCommand(command: string, argument: string): MenuAction | "unknown" {
  const normalized = command.toLowerCase();
  const normalizedArgument = argument.toLowerCase();

  if (["help", "h", "?", "帮助"].includes(normalized)) {
    return "help";
  }
  if (["select", "use", "选择"].includes(normalized)) {
    return "select_instance";
  }
  if (["load", "加载"].includes(normalized)) {
    return "load_state";
  }
  if (["init", "start", "初始化", "启动", "加载智能体"].includes(normalized)) {
    return "init";
  }
  if (["step", "next", "s", "下一步", "推进", "单步"].includes(normalized)) {
    return "step";
  }
  if (["run", "auto", "g", "运行", "跑完"].includes(normalized)) {
    return "run";
  }
  if (["pause", "暂停"].includes(normalized)) {
    return "pause";
  }
  if (["resume", "恢复", "继续"].includes(normalized)) {
    return "resume";
  }
  if (["stop", "停止"].includes(normalized)) {
    return "stop";
  }
  if (["end", "结束", "总结", "结束并总结"].includes(normalized)) {
    return "end";
  }
  if (["insert", "say", "user", "插入"].includes(normalized)) {
    return "insert";
  }
  if (normalized === "消息") {
    return argument ? "insert" : "messages";
  }
  if (["force", "call", "点名"].includes(normalized)) {
    return "force";
  }
  if (["disable", "禁用"].includes(normalized)) {
    return "disable";
  }
  if (["add", "join", "新增", "加入", "添加"].includes(normalized)) {
    return "add_agent";
  }
  if (["switch", "stage", "切换"].includes(normalized)) {
    return "switch_stage";
  }
  if (["timeline", "sequence", "seq", "时序", "时序图"].includes(normalized)) {
    return "timeline";
  }
  if (["commands", "cmd", "command", "快捷命令", "命令"].includes(normalized)) {
    return "commands";
  }
  if (
    [
      "handlers",
      "handler",
      "event_handlers",
      "event_handler",
      "processor",
      "processors",
      "处理器",
      "事件处理器",
      "event处理器",
    ].includes(normalized)
  ) {
    return "event_handlers";
  }
  if (["expand", "open", "展开", "展开全部"].includes(normalized)) {
    return "expand_timeline";
  }
  if (["collapse", "close", "折叠", "折叠全部"].includes(normalized)) {
    return "collapse_timeline";
  }
  if (["save", "保存"].includes(normalized)) {
    return "save";
  }
  if (["quit", "exit", "q", "退出"].includes(normalized)) {
    return "quit";
  }

  if (["view", "show", "查看"].includes(normalized)) {
    return normalizeViewCommand(normalizedArgument);
  }
  return normalizeViewCommand(normalized);
}

function normalizeViewCommand(value: string): MenuAction | "unknown" {
  if (["overview", "status", "state", "总览", "状态"].includes(value)) {
    return "overview";
  }
  if (["templates", "agent_templates", "模板", "智能体模板"].includes(value)) {
    return "agent_templates";
  }
  if (["agents", "agent", "智能体", "已加载智能体"].includes(value)) {
    return "agents";
  }
  if (["stages", "stage", "阶段"].includes(value)) {
    return "stages";
  }
  if (["messages", "message", "msgs", "msg", "消息"].includes(value)) {
    return "messages";
  }
  if (["events", "event", "事件"].includes(value)) {
    return "events";
  }
  if (
    [
      "handlers",
      "handler",
      "event_handlers",
      "event_handler",
      "processor",
      "processors",
      "处理器",
      "事件处理器",
      "event处理器",
    ].includes(value)
  ) {
    return "event_handlers";
  }
  if (["timeline", "sequence", "seq", "时序", "时序图"].includes(value)) {
    return "timeline";
  }
  if (["commands", "cmd", "command", "快捷命令", "命令"].includes(value)) {
    return "commands";
  }
  if (["outputs", "output", "stage_outputs", "输出", "阶段输出"].includes(value)) {
    return "outputs";
  }
  if (["final", "final_output", "最终", "最终输出"].includes(value)) {
    return "final";
  }
  if (["memory", "mem", "记忆"].includes(value)) {
    return "memory";
  }
  return "unknown";
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const tui = new MeetingTui();
await tui.start();
