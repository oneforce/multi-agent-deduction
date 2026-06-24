import type { AgentInvocationOutput, ContextPackage, MessageType } from "../types";

export class MockLlmProvider {
  async invoke(context: ContextPackage): Promise<AgentInvocationOutput> {
    const role = context.agent_context.agent_role;
    const expected = context.output_requirement.expected_message_type;
    const content = this.contentFor(role, context, expected);
    const event = this.eventFor(role, expected, context);
    return {
      messages: [
        {
          message_type: expected,
          content,
          target: {
            type: "stage",
            id: context.stage_context.stage_id,
          },
          metadata: {
            confidence: this.confidenceFor(role),
            mock: true,
          },
        },
      ],
      events: [event],
    };
  }

  private contentFor(role: string, context: ContextPackage, expected: MessageType): string {
    const topic = String(context.meeting_context.meeting_goal.topic ?? "当前议题");
    const stageGoal = context.stage_context.stage_goal;
    const turn = context.turn_context.current_turn + 1;
    const activeEvent = context.turn_context.active_events[0]?.event_type;
    const constraints = context.meeting_context.meeting_goal.constraints;
    const constraintText = Array.isArray(constraints) ? `约束是：${constraints.join("、")}。` : "";

    if (role === "summarizer") {
      const prior = context.visible_messages.recent_visible_messages
        .slice(-5)
        .map((message) => message.content.replace(/\s+/g, " "))
        .join("；");
      return `阶段总结：围绕“${topic}”，本阶段目标是“${stageGoal}”。已出现的关键内容包括：${prior || "暂无讨论"}。建议保留可验证方向、明确风险，并把下一步拆成小实验。`;
    }

    if (role === "facilitator" || role === "moderator") {
      return `我先把讨论框住：主题是“${topic}”，当前阶段要${stageGoal}。${constraintText}第 ${turn} 轮请优先给出可验证观点；${activeEvent ? `同时回应 ${activeEvent}。` : "如果出现风险或问题，我会把它转成后续发言事件。"}`;
    }

    if (role === "creative_agent") {
      return `我给出三个发散方向：1. 把“${topic}”嵌入用户每周固定工作流；2. 设计一个低门槛的复访触发，比如项目周报或失败测试回看；3. 让用户能把一次成功协作保存成可复用模板。${constraintText}这些想法都应该用两周实验验证。`;
    }

    if (role === "product_manager") {
      if (expected === "answer") {
        return `回应这个问题/风险：用户留存的核心不只是功能数量，而是下一次回来时是否还能接上未完成工作。建议把“${topic}”拆成激活、第二次使用、连续三次使用三个指标，并优先验证第二次使用触发。`;
      }
      if (expected === "decision") {
        return `我的决策建议：优先选择能直接提升第二周回访的方向，先做“保存成功工作流 + 下次继续”的轻量实验；暂缓需要重生态或高运营成本的想法。`;
      }
      return `从产品角度看，“${topic}”需要落到一个重复场景。建议把目标用户的一周工作拆开，找到最容易让他们再次打开产品的时刻，而不是只优化首次体验。`;
    }

    if (role === "engineer") {
      if (expected === "answer") {
        return `技术上可以先走轻实现：记录会话摘要、相关文件、下一步命令和测试状态，形成“继续上次工作”的入口。风险在于上下文恢复质量，所以 MVP 应限制在单项目、短周期内验证。`;
      }
      return `从实现角度，建议先做可观测的小闭环：事件埋点、复访触发、模板保存、摘要恢复。不要一开始做完整插件生态，否则工程投入会明显超过两周验证窗口。`;
    }

    if (role === "market_analyst") {
      return `市场和传播上，独立开发者更容易被“节省下一次启动成本”打动。可以把案例包装成“昨天卡住的测试，今天一键继续修”，用真实工作流内容驱动口碑，而不是泛泛宣传 AI 更聪明。`;
    }

    if (role === "critic_agent") {
      return `我看到一个关键风险：这些方向如果没有明确复访触发，可能只是让首次体验更漂亮，不能真正提高留存。还需要验证用户是否愿意把项目状态交给系统保存，以及这是否会增加隐私顾虑。`;
    }

    return `我围绕“${topic}”补充一个观点：当前阶段应服务于“${stageGoal}”，并把想法转成可验证、可取舍的下一步。`;
  }

  private eventFor(
    role: string,
    expected: MessageType,
    context: ContextPackage,
  ): AgentInvocationOutput["events"][number] {
    const topic = String(context.meeting_context.meeting_goal.topic ?? "topic");
    if (role === "critic_agent" || expected === "critique") {
      return {
        event_type: "risk_identified",
        category: "discussion_event",
        priority: "medium",
        payload: {
          topic,
          risk_type: "assumption_or_validation_gap",
          severity: "medium",
        },
        source_message_index: 0,
      };
    }
    if (expected === "decision") {
      return {
        event_type: "decision_requested",
        category: "discussion_event",
        priority: "medium",
        payload: {
          topic,
        },
        source_message_index: 0,
      };
    }
    if (role === "facilitator" || role === "moderator") {
      return {
        event_type: "question_raised",
        category: "discussion_event",
        priority: "medium",
        payload: {
          topic,
          question: "下一位需要给出可验证观点",
        },
        source_message_index: 0,
      };
    }
    if (role === "summarizer") {
      return {
        event_type: "summary_requested",
        category: "discussion_event",
        priority: "low",
        payload: {
          topic,
        },
        source_message_index: 0,
      };
    }
    if (expected === "answer" || role === "engineer") {
      return {
        event_type: "support_added",
        category: "discussion_event",
        priority: "low",
        payload: {
          topic,
        },
        source_message_index: 0,
      };
    }
    return {
      event_type: "opinion_created",
      category: "discussion_event",
      priority: "low",
      payload: {
        topic,
      },
      source_message_index: 0,
    };
  }

  private confidenceFor(role: string): number {
    if (role === "summarizer") {
      return 0.86;
    }
    if (role === "critic_agent") {
      return 0.78;
    }
    return 0.82;
  }
}
