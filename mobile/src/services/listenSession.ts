import { ChunkResult, SessionApi, SessionDetail, SessionEndedError } from "../api/sessions";
import { EmailAction } from "../types/context";
import { Reminder } from "../types/reminder";

export type FeedItem =
  | { key: string; kind: "new" | "updated" | "completed"; reminder: Reminder }
  | { key: string; kind: "email"; email: EmailAction };

export type ListenState = {
  status: "idle" | "starting" | "listening" | "ending" | "ended";
  sessionId?: string;
  feed: FeedItem[];
  heard: number;        // phrases accepted by the server
  pendingChunks: number; // phrases the model will retry, not lost
  unsent: string[];     // phrases that never reached the server (offline)
  sending: boolean;
  error: string;
  detail?: SessionDetail;
};

// "write an email to Alex", "send Sam an email saying", "email Priya that"
export const isEmailCommand = (text: string) =>
  /\b(write|send|draft|compose|shoot)\b[^.?!]{0,40}\be-?mail\b/i.test(text) || /^\s*e-?mail\s+\w+/i.test(text);

// Kept here instead of importing Controls so this file has no React Native dependency.
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";

const initial = (): ListenState => ({ status: "idle", feed: [], heard: 0, pendingChunks: 0, unsent: [], sending: false, error: "" });

export function createListenSession(api: SessionApi, now: () => Date = () => new Date()) {
  let state = initial();
  const listeners = new Set<() => void>();
  const set = (changes: Partial<ListenState>) => { state = { ...state, ...changes }; listeners.forEach(listener => listener()); };
  // Phrases go to the server one at a time so updates see the reminders before them.
  let queue = Promise.resolve();

  const absorb = (result: ChunkResult) => {
    const byId = new Map(state.feed.filter((item): item is Extract<FeedItem, { reminder: Reminder }> => "reminder" in item).map(item => [item.reminder.id, item]));
    const feed = [...state.feed];
    for (const reminder of result.reminders) {
      if (!byId.has(reminder.id)) feed.unshift({ key: `new-${reminder.id}`, kind: "new", reminder });
    }
    for (const reminder of result.changed) {
      const kind = reminder.completed ? "completed" : "updated";
      const existing = feed.findIndex(item => "reminder" in item && item.reminder.id === reminder.id);
      // A reminder made earlier in this session stays "new", just with its latest content.
      if (existing >= 0 && feed[existing].kind === "new" && !reminder.completed) feed[existing] = { ...feed[existing], reminder } as FeedItem;
      else { if (existing >= 0) feed.splice(existing, 1); feed.unshift({ key: `${kind}-${reminder.id}-${feed.length}`, kind, reminder }); }
    }
    set({ feed, heard: state.heard + 1, pendingChunks: result.pendingChunks });
  };

  const startSession = async () => {
    const info = await api.start();
    set({ sessionId: info.id });
    return info.id;
  };

  const send = async (text: string, capturedAt: Date) => {
    let sessionId = state.sessionId ?? await startSession();
    if (isEmailCommand(text)) {
      const email = await api.email(sessionId, text);
      set({ feed: [{ key: `email-${email.id}`, kind: "email", email }, ...state.feed], heard: state.heard + 1 });
      return;
    }
    try { absorb(await api.parse(sessionId, text, capturedAt)); }
    catch (error) {
      if (!(error instanceof SessionEndedError)) throw error;
      // The server closed the session after a long pause. Carry on in a fresh one.
      sessionId = await startSession();
      absorb(await api.parse(sessionId, text, capturedAt));
    }
  };

  const enqueue = (text: string, capturedAt: Date) => {
    queue = queue.then(async () => {
      set({ sending: true, error: "" });
      try {
        await send(text, capturedAt);
        // Saying or typing a failed phrase again succeeded, so don't resend the old copy at Stop.
        const i = state.unsent.indexOf(text);
        if (i >= 0) set({ unsent: state.unsent.filter((_, j) => j !== i), error: "" });
      }
      catch (error) {
        // The server read it and said no (e.g. an email with no message): resending won't help.
        const status = (error as { status?: unknown }).status;
        if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          set({ error: isEmailCommand(text)
            ? `Heedly couldn't tell what email to write from "${text}". Say who it's for and what to say in one go.`
            : `Heedly couldn't use "${text}": ${errorMessage(error)}` });
        } else set({ unsent: [...state.unsent, text], error: `${errorMessage(error)} Heedly kept what you said and will try again.` });
      }
      finally { set({ sending: false }); }
    });
    return queue;
  };

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    async start() {
      if (state.status === "listening" || state.status === "starting") return;
      set({ ...initial(), status: "starting" });
      try { await startSession(); set({ status: "listening" }); }
      catch (error) { set({ status: "idle", error: errorMessage(error) }); throw error; }
    },
    say(text: string) {
      const phrase = text.trim();
      if (!phrase || (state.status !== "listening" && state.status !== "starting")) return Promise.resolve();
      return enqueue(phrase, now());
    },
    async stop(): Promise<SessionDetail | undefined> {
      if (state.status !== "listening" && state.status !== "starting") return state.detail;
      set({ status: "ending" });
      await queue;
      // One more try for anything that never reached the server.
      const retry = state.unsent; set({ unsent: [] });
      for (const text of retry) await enqueue(text, now());
      try {
        if (!state.sessionId) { set({ status: "ended" }); return undefined; }
        const detail = await api.end(state.sessionId);
        set({ status: "ended", detail, pendingChunks: detail.pendingChunks });
        return detail;
      } catch (error) {
        set({ status: "listening", error: `${errorMessage(error)} Your reminders are saved; try Stop again.` });
        throw error;
      }
    },
    reset() { set(initial()); },
  };
}

export type ListenSession = ReturnType<typeof createListenSession>;
