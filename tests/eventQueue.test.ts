import { describe, expect, it } from "vitest";
import { EventQueue } from "../src/runtime/eventQueue";
import type { MeetingEvent } from "../src/types";

describe("EventQueue", () => {
  it("orders events by priority and suppresses duplicate low value events", () => {
    const queue = new EventQueue();
    queue.enqueue(event("low", "opinion_created"));
    queue.enqueue(event("high", "meeting_paused"));
    queue.enqueue(event("medium", "risk_identified"));
    queue.enqueue(event("low", "opinion_created"));

    const batch = queue.nextBatch(5);

    expect(batch.map((item) => item.event_type)).toEqual([
      "meeting_paused",
      "risk_identified",
      "opinion_created",
    ]);
  });
});

function event(priority: MeetingEvent["priority"], eventType: string): MeetingEvent {
  return {
    event_id: `${eventType}_${priority}`,
    meeting_id: "meeting_test",
    stage_id: "stage_test",
    category: priority === "high" ? "system_event" : "discussion_event",
    event_type: eventType,
    source_message_id: null,
    source_agent_id: null,
    priority,
    payload: {
      topic: "same-topic",
    },
    created_at: "2026-06-24T00:00:00.000Z",
  };
}
