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

// The follow-on to an email command: "Write an email to Alex." "Tell him I'm late."
const EMAIL_CONTINUES = /^\s*(tell|say|saying|let|mention|ask|and (tell|say|let|ask))\b/i;
// One request must finish inside the backend's 12 s budget; four commitments took ~10 s
// live, so long talks go in small pieces. Later pieces still see the reminders made
// earlier in the session, so "actually move it to Friday" still works across a split.
const CHUNK_CHARS = 600;

export type TranscriptPlan = { reminders: string[]; emails: string[] };

// Text with no sentence breaks at all, cut between words so no piece passes the limit.
function splitLong(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = []; let piece = "";
  for (const word of text.split(/\s+/)) {
    if (piece && piece.length + word.length + 1 > CHUNK_CHARS) { out.push(piece); piece = ""; }
    piece = piece ? `${piece} ${word}` : word.slice(0, CHUNK_CHARS);
  }
  if (piece) out.push(piece);
  return out;
}

// The whole talk, split for sending: email commands (with their follow-on) go to the
// email drafter, everything else goes to the reminder parser in sentence-aligned chunks.
export function planTranscript(phrases: string[]): TranscriptPlan {
  const emails: string[] = []; const rest: string[] = [];
  const clean = phrases.map(p => p.trim()).filter(Boolean);
  for (let i = 0; i < clean.length; i++) {
    if (!isEmailCommand(clean[i])) { rest.push(clean[i]); continue; }
    let email = clean[i];
    while (i + 1 < clean.length && EMAIL_CONTINUES.test(clean[i + 1])) email = `${email}. ${clean[++i]}`;
    emails.push(email);
  }
  const reminders: string[] = []; let chunk = "";
  for (const phrase of rest) {
    const sentence = /[.!?]$/.test(phrase) ? phrase : `${phrase}.`;
    if (chunk && chunk.length + sentence.length + 1 > CHUNK_CHARS) { reminders.push(chunk); chunk = ""; }
    chunk = chunk ? `${chunk} ${sentence}` : sentence;
  }
  if (chunk) reminders.push(chunk);
  return { reminders, emails };
}

// What became of one phrase: it made or changed reminders, the model found nothing in it,
// the model will retry it, it never reached the server (kept for Stop), the server
// refused it, or there was no session to send it to.
export type SayOutcome = "saved" | "nothing" | "pending" | "kept" | "refused" | "not_listening";

// Kept here instead of importing Controls so this file has no React Native dependency.
// A dropped connection shows up as the browser's own words ("Failed to fetch"), which mean nothing to people.
const errorMessage = (error: unknown) =>
  error instanceof TypeError || (error instanceof Error && /failed to fetch|network request failed|load failed|networkerror/i.test(error.message))
    ? "Heedly can't be reached. Check your connection."
    : error instanceof Error ? error.message : "Something went wrong.";

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

  // One start at a time: words sent while the session is still starting wait for it,
  // instead of opening a second session that Stop would never close.
  let starting: Promise<string> | undefined;
  const startSession = () => {
    starting ??= api.start().then(info => { set({ sessionId: info.id }); return info.id; }).finally(() => { starting = undefined; });
    return starting;
  };

  const send = async (text: string, capturedAt: Date) => {
    let sessionId = state.sessionId ?? await (starting ?? startSession());
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

  const enqueue = (text: string, capturedAt: Date): Promise<SayOutcome> => {
    const run = queue.then(async (): Promise<SayOutcome> => {
      set({ sending: true, error: "" });
      const feedBefore = state.feed, pendingBefore = state.pendingChunks;
      try {
        await send(text, capturedAt);
        // Saying or typing a failed phrase again succeeded, so don't resend the old copy at Stop.
        const i = state.unsent.indexOf(text);
        if (i >= 0) set({ unsent: state.unsent.filter((_, j) => j !== i), error: "" });
        const changed = state.feed.length !== feedBefore.length || state.feed.some((item, j) => item !== feedBefore[j]);
        return changed ? "saved" : state.pendingChunks > pendingBefore ? "pending" : "nothing";
      }
      catch (error) {
        // The server read it and said no (e.g. an email with no message): resending won't help.
        const status = (error as { status?: unknown }).status;
        if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          set({ error: isEmailCommand(text)
            ? `Heedly couldn't tell what email to write from "${text}". Say who it's for and what to say in one go.`
            : `Heedly couldn't use "${text}": ${errorMessage(error)}` });
          return "refused";
        }
        set({ unsent: [...state.unsent, text], error: `${errorMessage(error)} Heedly kept what you said and will try again when you review.` });
        return "kept";
      }
      finally { set({ sending: false }); }
    });
    queue = run.then(() => {});
    return run;
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
    say(text: string): Promise<SayOutcome> {
      const phrase = text.trim();
      if (!phrase) return Promise.resolve("nothing");
      if (state.status !== "listening" && state.status !== "starting") return Promise.resolve("not_listening");
      if (phrase.length <= CHUNK_CHARS) return enqueue(phrase, now());
      // A pasted list goes in pieces like a long talk does, or it would run out of time.
      const capturedAt = now();
      const sentences = phrase.split(/(?<=[.!?])\s+|\n+/).flatMap(splitLong);
      const plan = planTranscript(sentences);
      return Promise.all([...plan.reminders, ...plan.emails].map(t => enqueue(t, capturedAt))).then(outcomes =>
        (["saved", "kept", "pending", "refused"] as const).find(o => outcomes.includes(o)) ?? "nothing");
    },
    // Send a whole spoken talk at once, so the model sees every correction in context.
    async sayAll(phrases: string[], capturedAt: Date = now()) {
      if (state.status !== "listening" && state.status !== "starting") return;
      const plan = planTranscript(phrases);
      for (const text of plan.reminders) void enqueue(text, capturedAt);
      for (const text of plan.emails) void enqueue(text, capturedAt);
      await queue;
    },
    async stop(): Promise<SessionDetail | undefined> {
      if (state.status !== "listening" && state.status !== "starting") return state.detail;
      set({ status: "ending" });
      await starting?.catch(() => {});
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
