import type {
  EventHandlingRecord,
  MeetingEvent,
  MeetingRuntimeSnapshot,
  StageTemplate,
} from "../types";
import { makeId, nowIso } from "./ids";

type HandlerType = EventHandlingRecord["handler_type"];

interface HandlerDescriptor {
  handlerId: string;
  handlerName: string;
  handlerType: HandlerType;
  action: string;
  effect: string;
  metadata?: Record<string, unknown>;
}

export class EventProcessor {
  process(params: {
    snapshot: MeetingRuntimeSnapshot;
    stage: StageTemplate;
    events: MeetingEvent[];
    phase: EventHandlingRecord["phase"];
  }): MeetingEvent[] {
    const { snapshot, stage, events, phase } = params;
    if (events.length === 0) {
      return events;
    }

    const records = events.flatMap((event) =>
      this.handlersFor(event, stage, phase).map((handler) =>
        this.toRecord(snapshot, stage, event, handler, phase),
      ),
    );
    snapshot.event_handling_log.push(...records);
    return events;
  }

  private handlersFor(
    event: MeetingEvent,
    stage: StageTemplate,
    phase: EventHandlingRecord["phase"],
  ): HandlerDescriptor[] {
    return [
      this.eventRouter(event, stage, phase),
      ...this.systemHandlers(event),
      ...this.discussionHandlers(event),
      this.speakerSelectionHandler(event, phase),
    ];
  }

  private eventRouter(
    event: MeetingEvent,
    stage: StageTemplate,
    phase: EventHandlingRecord["phase"],
  ): HandlerDescriptor {
    return {
      handlerId: "event_processor",
      handlerName: "EventProcessor",
      handlerType: "controller",
      action: "dispatch_event",
      effect: `从 EventQueue 取出并分发到 ${stage.stage_id} 的 ${phase} 处理链`,
      metadata: {
        priority: event.priority,
        category: event.category,
      },
    };
  }

  private systemHandlers(event: MeetingEvent): HandlerDescriptor[] {
    if (event.category !== "system_event") {
      return [];
    }

    const map: Record<string, HandlerDescriptor[]> = {
      meeting_started: [
        {
          handlerId: "state_machine",
          handlerName: "会议状态机",
          handlerType: "controller",
          action: "open_meeting",
          effect: "会议启动事件进入上下文，后续智能体可据此开始发言",
        },
      ],
      stage_started: [
        {
          handlerId: "stage_manager",
          handlerName: "阶段管理器",
          handlerType: "manager",
          action: "mark_stage_active",
          effect: "当前阶段被标记为活动阶段，智能体 runtime_state 进入 active",
        },
      ],
      stage_completed: [
        {
          handlerId: "stage_manager",
          handlerName: "阶段管理器",
          handlerType: "manager",
          action: "advance_stage",
          effect: "阶段完成信号进入处理链，用于后续阶段衔接和上下文提示",
        },
      ],
      stage_transition_requested: [
        {
          handlerId: "stage_manager",
          handlerName: "阶段管理器",
          handlerType: "manager",
          action: "switch_stage",
          effect: "用户请求切换阶段，当前阶段索引已更新并进入后续调度",
        },
      ],
      user_intervention_received: [
        {
          handlerId: "intervention_manager",
          handlerName: "用户干预管理器",
          handlerType: "manager",
          action: "inject_user_context",
          effect: "用户输入进入 active_events，下一位智能体会在上下文中看到该干预",
        },
      ],
      agent_added: [
        {
          handlerId: "agent_manager",
          handlerName: "智能体管理器",
          handlerType: "manager",
          action: "update_agent_pool",
          effect: "新增智能体已加入候选池，后续 turn 阶段可参与发言",
        },
      ],
      agent_disabled: [
        {
          handlerId: "agent_manager",
          handlerName: "智能体管理器",
          handlerType: "manager",
          action: "disable_candidate",
          effect: "被禁用智能体从候选发言池中排除",
        },
      ],
      meeting_paused: [
        {
          handlerId: "state_machine",
          handlerName: "会议状态机",
          handlerType: "controller",
          action: "pause_meeting",
          effect: "会议进入 paused 状态，step 不再推进发言",
        },
      ],
      meeting_resumed: [
        {
          handlerId: "state_machine",
          handlerName: "会议状态机",
          handlerType: "controller",
          action: "resume_meeting",
          effect: "会议恢复 running 状态，队列事件继续参与调度",
        },
      ],
      meeting_stopped: [
        {
          handlerId: "state_machine",
          handlerName: "会议状态机",
          handlerType: "controller",
          action: "stop_meeting",
          effect: "会议停止，后续 step 返回 stopped",
        },
      ],
      final_summary_requested: [
        {
          handlerId: "state_machine",
          handlerName: "会议状态机",
          handlerType: "controller",
          action: "enter_summary_stage",
          effect: "会议跳转到最终总结阶段，或在没有总结阶段时直接生成最终输出",
        },
      ],
    };

    return map[event.event_type] ?? [
      {
        handlerId: "system_event_handler",
        handlerName: "系统事件处理器",
        handlerType: "controller",
        action: "handle_system_event",
        effect: "系统事件进入控制链，作为本轮调度上下文",
      },
    ];
  }

  private discussionHandlers(event: MeetingEvent): HandlerDescriptor[] {
    if (event.category !== "discussion_event") {
      return [];
    }

    const handlers: HandlerDescriptor[] = [
      {
        handlerId: "discussion_event_handler",
        handlerName: "讨论事件处理器",
        handlerType: "manager",
        action: "route_discussion_signal",
        effect: "讨论事件被路由到发言选择和上下文构造流程",
      },
    ];

    if (event.event_type === "risk_identified") {
      handlers.push({
        handlerId: "memory_manager",
        handlerName: "会议记忆管理器",
        handlerType: "memory",
        action: "track_risk",
        effect: "风险信号进入 meeting_memory.risks 与阶段 key_event_ids",
      });
    }

    if (event.event_type === "question_raised") {
      handlers.push({
        handlerId: "memory_manager",
        handlerName: "会议记忆管理器",
        handlerType: "memory",
        action: "track_open_question",
        effect: "问题信号进入 meeting_memory.open_questions 与阶段 key_event_ids",
      });
    }

    if (event.event_type === "summary_requested") {
      handlers.push({
        handlerId: "service_agent_router",
        handlerName: "服务智能体路由器",
        handlerType: "selector",
        action: "prefer_summary_agent",
        effect: "提高 summarizer/facilitator 等总结类角色的发言优先级",
      });
    }

    if (event.event_type === "decision_requested") {
      handlers.push({
        handlerId: "decision_router",
        handlerName: "决策信号路由器",
        handlerType: "selector",
        action: "prefer_decision_owner",
        effect: "提高 facilitator、product_manager 等决策相关角色的发言优先级",
      });
    }

    return handlers;
  }

  private speakerSelectionHandler(
    event: MeetingEvent,
    phase: EventHandlingRecord["phase"],
  ): HandlerDescriptor {
    return {
      handlerId: "speaker_selector",
      handlerName: "发言者选择器",
      handlerType: "selector",
      action: "score_candidates",
      effect:
        phase === "normal_stage"
          ? "事件作为 active_events 输入，用于 normal 阶段选择可发言智能体"
          : "事件作为 active_events 输入，用订阅关系、角色相关度和优先级影响下一位发言者",
      metadata: {
        source_agent_id: event.source_agent_id,
        source_message_id: event.source_message_id,
      },
    };
  }

  private toRecord(
    snapshot: MeetingRuntimeSnapshot,
    stage: StageTemplate,
    event: MeetingEvent,
    handler: HandlerDescriptor,
    phase: EventHandlingRecord["phase"],
  ): EventHandlingRecord {
    return {
      handling_id: makeId("hdl"),
      meeting_id: snapshot.meeting_instance.meeting_id,
      stage_id: event.stage_id ?? stage.stage_id ?? null,
      turn_index: snapshot.current_turn_index,
      phase,
      event_id: event.event_id,
      event_type: event.event_type,
      event_category: event.category,
      handler_id: handler.handlerId,
      handler_name: handler.handlerName,
      handler_type: handler.handlerType,
      action: handler.action,
      effect: handler.effect,
      created_at: nowIso(),
      metadata: handler.metadata,
    };
  }
}
