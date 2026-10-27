import { mockParse, reminderApi, request, timezone, USE_MOCKS } from "./client";
import { actionsApi } from "./actions";
import { EmailAction } from "../types/context";
import { Reminder } from "../types/reminder";

// Wire shapes for the backend's always-listening endpoints (backend/app/models.py).
export type SessionInfo = { id: string; status: "listening" | "ended"; startedAt: string; lastActivityAt: string; endedAt?: string; endReason?: "user" | "silence_timeout" | "max_duration" };
export type SessionDetail = SessionInfo & { reminders: Reminder[]; actions: EmailAction[]; pendingChunks: number; changed: Reminder[] };
export type ChunkResult = { sessionId: string; reminders: Reminder[]; pendingChunks: number; changed: Reminder[] };

export type SessionApi = {
  start(): Promise<SessionInfo>;
  parse(sessionId: string, text: string, capturedAt: Date): Promise<ChunkResult>;
  email(sessionId: string, text: string): Promise<EmailAction>;
  end(sessionId: string): Promise<SessionDetail>;
};

// The backend answers 409 when a session already ended (silence or max duration).
export class SessionEndedError extends Error {}

export function createSessionApi(useMocks = USE_MOCKS): SessionApi {
  if (useMocks) return mockSessionApi();
  return {
    start: () => request<SessionInfo>("/sessions", "POST"),
    async parse(sessionId, text, capturedAt) {
      try {
        return await request<ChunkResult>("/sessions/parse", "POST", { text, sessionId, now: new Date().toISOString(), capturedAt: capturedAt.toISOString(), timezone: timezone() });
      } catch (error) {
        if (error instanceof Error && /already ended/i.test(error.message)) throw new SessionEndedError(error.message);
        throw error;
      }
    },
    email: (sessionId, text) => request<EmailAction>("/actions/email", "POST", { text, sessionId, now: new Date().toISOString(), timezone: timezone() }),
    end: sessionId => request<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}/end`, "POST"),
  };
}

// Demo mode: same flow on local storage, using the simple on-device parser.
function mockSessionApi(): SessionApi {
  const sessions = new Map<string, { info: SessionInfo; reminders: Reminder[]; actions: EmailAction[] }>();
  return {
    async start() {
      const now = new Date().toISOString();
      const info: SessionInfo = { id: `demo-session-${Date.now()}`, status: "listening", startedAt: now, lastActivityAt: now };
      sessions.set(info.id, { info, reminders: [], actions: [] }); return info;
    },
    async parse(sessionId, text) {
      const session = sessions.get(sessionId);
      if (!session || session.info.status === "ended") throw new SessionEndedError("Session already ended.");
      const parsed = mockParse(text);
      const reminder = await reminderApi.create({ id: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: parsed.title, createdAt: new Date().toISOString(), deadline: parsed.deadline, triggerType: parsed.triggerType, location: parsed.location, completed: false });
      session.reminders.push(reminder);
      return { sessionId, reminders: [reminder], pendingChunks: 0, changed: [] };
    },
    async email(sessionId, text) {
      const action = await actionsApi.draft(text);
      sessions.get(sessionId)?.actions.push(action); return action;
    },
    async end(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("Session not found.");
      session.info = { ...session.info, status: "ended", endedAt: new Date().toISOString(), endReason: "user" };
      return { ...session.info, reminders: session.reminders, actions: session.actions, pendingChunks: 0, changed: [] };
    },
  };
}

export const sessionApi = createSessionApi();
