import AsyncStorage from "@react-native-async-storage/async-storage";
import { request, USE_MOCKS } from "./client";
import { Memory, MemoryInput } from "../types/memory";

// Demo mode keeps facts on the device; it never learns on its own, but the screen still works.
const KEY = "mock-memories";
const load = async (): Promise<Memory[]> => JSON.parse(await AsyncStorage.getItem(KEY) ?? "[]");
const save = (rows: Memory[]) => AsyncStorage.setItem(KEY, JSON.stringify(rows));

export const memoryApi = {
  async list(): Promise<Memory[]> { return USE_MOCKS ? load() : request("/memories"); },
  async add(input: MemoryInput): Promise<Memory> {
    if (!USE_MOCKS) return request("/memories", "POST", input);
    const now = new Date().toISOString();
    const row: Memory = { ...input, id: `mock-memory-${Date.now()}`, createdAt: now, updatedAt: now };
    await save([...(await load()), row]); return row;
  },
  async update(id: string, changes: Partial<MemoryInput>): Promise<Memory> {
    if (!USE_MOCKS) return request(`/memories/${encodeURIComponent(id)}`, "PATCH", changes);
    const rows = await load(); const row = { ...rows.find(m => m.id === id)!, ...changes, updatedAt: new Date().toISOString() };
    await save(rows.map(m => m.id === id ? row : m)); return row;
  },
  async forget(id: string): Promise<void> {
    if (!USE_MOCKS) return request<void>(`/memories/${encodeURIComponent(id)}`, "DELETE");
    await save((await load()).filter(m => m.id !== id));
  },
};
