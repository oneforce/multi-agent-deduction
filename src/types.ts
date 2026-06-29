export type AgentType = "participant" | "service";
export type ExecutionMode = "normal" | "turn";
export type EventCategory = "system_event" | "discussion_event" | "domain_event";
export type EventPriority = "low" | "medium" | "high";
export type MeetingStatus =
  | "created"
  | "initialized"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "summarizing"
  | "completed"
  | "stopped"
  | "failed";

export type MessageType =
  | "opinion"
  | "question"
  | "answer"
  | "critique"
  | "support"
  | "clarification"
  | "summary"
  | "decision"
  | "instruction"
  | "system_notice";

export interface GenerationParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface ModelConfig {
  provider: string;
  model: string;
  base_url?: string;
  api_key_env?: string;
  response_format?: "json_object" | "text";
  thinking?: {
    type: "enabled" | "disabled";
    budget_tokens?: number;
  };
  generation_params?: GenerationParams;
}

export interface GoalSchema {
  required?: string[];
  optional?: string[];
}

export interface SpeakingStrategy {
  type:
    | "round_robin"
    | "free_discussion"
    | "event_driven"
    | "reviewer_once_each"
    | "moderator_controlled";
  allow_agent_readiness?: boolean;
}

export interface StageTemplate {
  stage_id: string;
  stage_name: string;
  execution_mode: ExecutionMode;
  stage_goal: string;
  max_turns?: number;
  speaker_roles?: string[];
  participant_rule?: {
    include_roles?: string[];
  };
  speaking_strategy?: SpeakingStrategy;
  completion_condition?: {
    max_turns?: number;
    required_outputs?: string[];
    no_high_priority_events?: boolean;
  };
  output_rule?: {
    type?: string;
    schema?: Record<string, string>;
  };
}

export interface MeetingTypeTemplate {
  type_id: string;
  type_name: string;
  description: string;
  goal_schema?: GoalSchema;
  stage_templates: StageTemplate[];
  default_agent_roles: string[];
  default_controller_policy?: {
    max_total_turns?: number;
    max_events_per_turn?: number;
  };
  default_context_policy?: {
    recent_message_limit?: number;
    include_stage_outputs?: boolean;
  };
  output_schema: string;
}

export interface AgentTemplate {
  agent_id: string;
  agent_name: string;
  agent_type: AgentType;
  agent_role: string;
  description: string;
  profile: {
    goal: string;
    personality?: string;
    speaking_style?: string;
    knowledge_boundary?: string;
    behavior_constraints?: string[];
  };
  capabilities: {
    model_config: ModelConfig;
    tools?: string[];
    memory_access?: Record<string, string>;
    context_access?: Record<string, string>;
    permissions?: Record<string, boolean>;
  };
  runtime_policy: {
    speaking_permission: "selectable" | "controller_triggered";
    activation_rule?: {
      event_subscriptions?: string[];
    };
    visibility?: string;
    output_schema?: string;
  };
}

export interface AgentOverride {
  agent_template_id: string;
  instance_name?: string;
  enabled?: boolean;
  model_config?: ModelConfig;
}

export interface StageOverride {
  stage_id: string;
  max_turns?: number;
  speaking_strategy?: SpeakingStrategy;
}

export interface MeetingInstanceConfig {
  meeting_id: string;
  meeting_type_id: string;
  title: string;
  goal: Record<string, unknown>;
  input_materials?: string[];
  agent_overrides?: AgentOverride[];
  stage_overrides?: StageOverride[];
}

export interface AgentRuntimeState {
  enabled: boolean;
  current_stage_id: string | null;
  current_turn_index: number;
  last_active_at: string | null;
  last_spoken_turn: number | null;
  last_message_ids: string[];
  stage_status: "idle" | "active" | "completed" | "skipped";
  pending_user_request: string | null;
  forced_next_speaker: boolean;
  skip_reason: string | null;
}

export interface AgentInstance {
  instance_id: string;
  template_id: string;
  name: string;
  type: AgentType;
  role: string;
  description: string;
  profile: AgentTemplate["profile"];
  model_config: ModelConfig;
  event_subscriptions: string[];
  runtime_state: AgentRuntimeState;
}

export interface Message {
  message_id: string;
  meeting_id: string;
  stage_id: string;
  turn_id: string;
  sender_id: string;
  sender_type: "participant_agent" | "service_agent" | "user" | "controller";
  message_type: MessageType;
  content: string;
  target: {
    type: "stage" | "agent" | "meeting";
    id: string;
  };
  reply_to_message_id?: string | null;
  visibility_scope: "stage" | "meeting" | "private";
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface MeetingEvent {
  event_id: string;
  meeting_id: string;
  stage_id: string | null;
  category: EventCategory;
  event_type: string;
  source_message_id?: string | null;
  source_agent_id?: string | null;
  priority: EventPriority;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface EventHandlingRecord {
  handling_id: string;
  meeting_id: string;
  stage_id: string | null;
  turn_index: number;
  phase: "normal_stage" | "turn_stage";
  event_id: string;
  event_type: string;
  event_category: EventCategory;
  handler_id: string;
  handler_name: string;
  handler_type: "controller" | "manager" | "selector" | "memory" | "output";
  action: string;
  effect: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeErrorRecord {
  message: string;
  action: string;
  stack?: string;
  created_at: string;
}

export interface ContextPackage {
  meeting_context: {
    meeting_id: string;
    meeting_title: string;
    meeting_type: string;
    meeting_goal: Record<string, unknown>;
    input_materials: string[];
  };
  stage_context: {
    stage_id: string;
    stage_name: string;
    stage_goal: string;
    stage_mode: ExecutionMode;
    stage_progress: {
      current_turn: number;
      max_turns: number | null;
    };
  };
  turn_context: {
    current_turn: number;
    active_events: MeetingEvent[];
  };
  visible_messages: {
    recent_visible_messages: Message[];
  };
  agent_context: {
    agent_id: string;
    agent_role: string;
    agent_goal: string;
    runtime_state: AgentRuntimeState;
  };
  memory_context: {
    relevant_public_memory: unknown[];
    relevant_private_memory: unknown[];
    relevant_stage_outputs: StageOutput[];
  };
  output_requirement: {
    expected_message_type: MessageType;
    max_response_length: number;
  };
}

export interface AgentInvocationOutput {
  messages: Array<{
    message_type: MessageType;
    content: string;
    target?: Message["target"];
    metadata?: Record<string, unknown>;
  }>;
  events: Array<{
    event_type: string;
    category: EventCategory;
    priority?: EventPriority;
    payload?: Record<string, unknown>;
    source_message_index?: number;
  }>;
}

export interface StageOutput {
  stage_id: string;
  stage_name: string;
  output: Record<string, unknown>;
  created_at: string;
}

export interface FinalOutput {
  executive_summary: string;
  key_points: string[];
  decisions: string[];
  risks: string[];
  open_questions: string[];
  next_actions: string[];
  stage_outputs: StageOutput[];
  transcript_ref: string;
}

export interface MeetingMemory {
  meeting_goal: Record<string, unknown>;
  key_conclusions: string[];
  open_questions: string[];
  risks: string[];
  stage_summaries: Array<{
    stage_id: string;
    summary: string;
  }>;
}

export interface StageMemory {
  stage_id: string;
  stage_input: {
    stage_goal: string;
  };
  stage_output?: StageOutput;
  key_event_ids: string[];
  key_message_ids: string[];
}

export interface AgentPrivateMemory {
  agent_id: string;
  notes: string[];
}

export interface RuntimePatch {
  kind:
    | "pause_meeting"
    | "resume_meeting"
    | "stop_meeting"
    | "end_and_summarize"
    | "user_message_inserted"
    | "force_agent_speak"
    | "disable_agent"
    | "add_participant_agent"
    | "request_stage_summary"
    | "switch_stage";
  value?: string;
  payload?: Record<string, unknown>;
}

export interface MeetingRuntimeSnapshot {
  version: 1;
  status: MeetingStatus;
  meeting_type: MeetingTypeTemplate;
  meeting_instance: MeetingInstanceConfig;
  agents: AgentInstance[];
  current_stage_index: number;
  current_turn_index: number;
  total_turns: number;
  forced_next_speaker_id: string | null;
  messages: Message[];
  events: MeetingEvent[];
  queued_events: MeetingEvent[];
  event_handling_log: EventHandlingRecord[];
  last_error: RuntimeErrorRecord | null;
  stage_outputs: StageOutput[];
  final_output: FinalOutput | null;
  meeting_memory: MeetingMemory;
  stage_memory: Record<string, StageMemory>;
  agent_private_memory: Record<string, AgentPrivateMemory>;
  created_at: string;
  updated_at: string;
}
