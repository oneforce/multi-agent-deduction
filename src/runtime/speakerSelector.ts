import type {
  AgentInstance,
  MeetingEvent,
  MeetingRuntimeSnapshot,
  MessageType,
  StageTemplate,
} from "../types";

export interface SelectedSpeaker {
  agent: AgentInstance;
  reason: string;
  expectedMessageType: MessageType;
}

export class SpeakerSelector {
  select(params: {
    snapshot: MeetingRuntimeSnapshot;
    stage: StageTemplate;
    activeEvents: MeetingEvent[];
    allowServiceAgents?: boolean;
  }): SelectedSpeaker | null {
    const { snapshot, stage, activeEvents, allowServiceAgents = false } = params;
    const candidates = this.candidatesForStage(snapshot, stage, allowServiceAgents);
    if (candidates.length === 0) {
      return null;
    }

    const forced = snapshot.forced_next_speaker_id
      ? candidates.find((agent) => agent.instance_id === snapshot.forced_next_speaker_id)
      : null;
    if (forced) {
      return {
        agent: forced,
        reason: "用户点名优先",
        expectedMessageType: this.expectedMessageType(activeEvents, forced),
      };
    }

    const strategyType = stage.speaking_strategy?.type ?? "round_robin";
    if (strategyType === "reviewer_once_each") {
      const notYetSpoken = candidates.filter(
        (agent) =>
          !snapshot.messages.some(
            (message) =>
              message.stage_id === stage.stage_id && message.sender_id === agent.instance_id,
          ),
      );
      const pool = notYetSpoken.length > 0 ? notYetSpoken : candidates;
      return this.pickBestByScore(pool, snapshot, stage, activeEvents, strategyType);
    }

    if (strategyType === "moderator_controlled") {
      const moderator =
        candidates.find((agent) => ["moderator", "facilitator"].includes(agent.role)) ??
        candidates[0];
      return {
        agent: moderator,
        reason: "主持控制阶段优先选择主持类角色",
        expectedMessageType: this.expectedMessageType(activeEvents, moderator),
      };
    }

    return this.pickBestByScore(candidates, snapshot, stage, activeEvents, strategyType);
  }

  private candidatesForStage(
    snapshot: MeetingRuntimeSnapshot,
    stage: StageTemplate,
    allowServiceAgents: boolean,
  ): AgentInstance[] {
    const explicitRoles = stage.speaker_roles ?? stage.participant_rule?.include_roles;
    const allowedRoles = explicitRoles?.length ? explicitRoles : snapshot.meeting_type.default_agent_roles;
    return snapshot.agents.filter((agent) => {
      if (!agent.runtime_state.enabled) {
        return false;
      }
      if (!allowServiceAgents && agent.type === "service") {
        return false;
      }
      return allowedRoles.includes(agent.role);
    });
  }

  private pickBestByScore(
    candidates: AgentInstance[],
    snapshot: MeetingRuntimeSnapshot,
    stage: StageTemplate,
    activeEvents: MeetingEvent[],
    strategyType: string,
  ): SelectedSpeaker {
    const scored = candidates.map((agent, index) => ({
      agent,
      score: this.scoreAgent(agent, snapshot, stage, activeEvents, strategyType, index),
    }));
    scored.sort((a, b) => b.score - a.score || a.agent.instance_id.localeCompare(b.agent.instance_id));
    const winner = scored[0].agent;
    return {
      agent: winner,
      reason: this.reasonFor(winner, activeEvents, strategyType),
      expectedMessageType: this.expectedMessageType(activeEvents, winner),
    };
  }

  private scoreAgent(
    agent: AgentInstance,
    snapshot: MeetingRuntimeSnapshot,
    stage: StageTemplate,
    activeEvents: MeetingEvent[],
    strategyType: string,
    index: number,
  ): number {
    let score = 10 - index / 10;
    if (strategyType === "round_robin") {
      score += agent.runtime_state.last_spoken_turn == null
        ? 10
        : Math.max(0, snapshot.total_turns - agent.runtime_state.last_spoken_turn);
    }

    for (const event of activeEvents) {
      if (agent.event_subscriptions.includes(event.event_type)) {
        score += event.priority === "high" ? 35 : event.priority === "medium" ? 22 : 12;
      }
      score += this.roleEventFit(agent.role, event.event_type);
      if (event.source_agent_id === agent.instance_id) {
        score -= 16;
      }
    }

    if (strategyType === "free_discussion") {
      score += Math.random() * 2;
    }

    if (agent.runtime_state.last_spoken_turn === snapshot.total_turns) {
      score -= 30;
    }

    const stageMessageCount = snapshot.messages.filter(
      (message) => message.stage_id === stage.stage_id && message.sender_id === agent.instance_id,
    ).length;
    score -= stageMessageCount * 4;
    return score;
  }

  private roleEventFit(role: string, eventType: string): number {
    const fit: Record<string, Record<string, number>> = {
      risk_identified: {
        engineer: 18,
        product_manager: 16,
        facilitator: 10,
        critic_agent: -6,
      },
      question_raised: {
        product_manager: 14,
        engineer: 12,
        creative_agent: 10,
        facilitator: 8,
      },
      opinion_created: {
        critic_agent: 16,
        market_analyst: 12,
        product_manager: 8,
      },
      critique_raised: {
        product_manager: 14,
        engineer: 14,
        creative_agent: 8,
      },
      decision_requested: {
        facilitator: 18,
        product_manager: 14,
        engineer: 8,
      },
      support_added: {
        critic_agent: 10,
        market_analyst: 8,
      },
      summary_requested: {
        facilitator: 12,
      },
    };
    return fit[eventType]?.[role] ?? 0;
  }

  private expectedMessageType(activeEvents: MeetingEvent[], agent: AgentInstance): MessageType {
    const eventType = activeEvents[0]?.event_type;
    if (agent.role === "critic_agent" || eventType === "opinion_created") {
      return "critique";
    }
    if (eventType === "risk_identified" || eventType === "question_raised") {
      return "answer";
    }
    if (eventType === "decision_requested") {
      return "decision";
    }
    if (agent.type === "service" || agent.role === "summarizer") {
      return "summary";
    }
    return "opinion";
  }

  private reasonFor(agent: AgentInstance, activeEvents: MeetingEvent[], strategyType: string): string {
    const event = activeEvents[0];
    if (event) {
      return `${agent.name} 与事件 ${event.event_type} 的订阅/角色相关度最高`;
    }
    if (strategyType === "reviewer_once_each") {
      return "该阶段要求角色逐一覆盖";
    }
    return "基于最近发言、角色覆盖和阶段策略选择";
  }
}
