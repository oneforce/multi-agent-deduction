import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { AgentTemplate, MeetingInstanceConfig, MeetingTypeTemplate } from "../types";

export interface ResolvedMeetingConfig {
  configRoot: string;
  instancePath: string;
  meetingType: MeetingTypeTemplate;
  meetingInstance: MeetingInstanceConfig;
  agentTemplates: AgentTemplate[];
}

export class ConfigLoader {
  constructor(private readonly configRoot = path.resolve("configs")) {}

  async loadMeetingInstance(instancePath: string): Promise<MeetingInstanceConfig> {
    return readYaml<MeetingInstanceConfig>(path.resolve(instancePath));
  }

  async loadMeetingType(typeId: string): Promise<MeetingTypeTemplate> {
    return readYaml<MeetingTypeTemplate>(
      path.join(this.configRoot, "templates", "meeting_types", `${typeId}.yaml`),
    );
  }

  async loadAgentTemplateByFileName(fileName: string): Promise<AgentTemplate> {
    return readYaml<AgentTemplate>(
      path.join(this.configRoot, "templates", "agents", `${fileName}.yaml`),
    );
  }

  async loadAgentTemplates(): Promise<AgentTemplate[]> {
    const names = [
      "facilitator",
      "moderator",
      "creative_agent",
      "product_manager",
      "engineer",
      "market_analyst",
      "critic",
      "summarizer",
    ];
    return Promise.all(names.map((name) => this.loadAgentTemplateByFileName(name)));
  }

  async resolve(instancePath: string): Promise<ResolvedMeetingConfig> {
    const meetingInstance = await this.loadMeetingInstance(instancePath);
    const meetingType = await this.loadMeetingType(meetingInstance.meeting_type_id);
    const agentTemplates = await this.loadAgentTemplates();
    return {
      configRoot: this.configRoot,
      instancePath: path.resolve(instancePath),
      meetingType,
      meetingInstance,
      agentTemplates,
    };
  }
}

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return parse(raw) as T;
}
