import type { EventPriority, MeetingEvent } from "../types";

const priorityWeight: Record<EventPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export class EventQueue {
  private events: MeetingEvent[];

  constructor(initialEvents: MeetingEvent[] = []) {
    this.events = [...initialEvents];
  }

  enqueue(event: MeetingEvent): void {
    if (this.shouldSuppress(event)) {
      return;
    }
    this.events.push(event);
    this.events.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);
  }

  enqueueMany(events: MeetingEvent[]): void {
    for (const event of events) {
      this.enqueue(event);
    }
  }

  nextBatch(maxEvents: number): MeetingEvent[] {
    const batch = this.events.slice(0, maxEvents);
    this.events = this.events.slice(maxEvents);
    return batch;
  }

  peek(): MeetingEvent[] {
    return [...this.events];
  }

  hasHighPriorityEvents(): boolean {
    return this.events.some((event) => event.priority === "high");
  }

  private shouldSuppress(event: MeetingEvent): boolean {
    const topic = event.payload.topic ?? event.payload.command ?? "";
    return this.events.some((existing) => {
      const existingTopic = existing.payload.topic ?? existing.payload.command ?? "";
      return (
        existing.event_type === event.event_type &&
        existing.stage_id === event.stage_id &&
        String(existingTopic) === String(topic) &&
        event.priority === "low"
      );
    });
  }
}
