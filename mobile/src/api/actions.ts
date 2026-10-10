import { request, stamp, USE_MOCKS } from "./client";
import { EmailAction, PrivacyInfo, PrivacySettings } from "../types/context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MOCK_REMINDERS_KEY } from "./client";
export const actionsApi = {
  async draft(text: string): Promise<EmailAction> {
    if (!USE_MOCKS) return request("/actions/email", "POST", { text, ...stamp() });
    return { id: `mock-email-${Date.now()}`, type: "email", status: "needs_approval", createdAt: new Date().toISOString(), email: { toName: "Alex", subject: "Running late", body: "Hi Alex, I'll be 10 minutes late." } };
  },
  async edit(id: string, email: EmailAction["email"]): Promise<void> { if (!USE_MOCKS) await request(`/actions/${encodeURIComponent(id)}`, "PATCH", email); },
  async approve(id: string): Promise<void> { if (!USE_MOCKS) await request(`/actions/${encodeURIComponent(id)}/approve`, "POST"); },
  async cancel(id: string): Promise<void> { if (!USE_MOCKS) await request(`/actions/${encodeURIComponent(id)}/cancel`, "POST"); },
};
export const privacyApi = {
  async info(): Promise<PrivacyInfo> { return USE_MOCKS ? { audioStored: false, storeTranscripts: false, transcriptRetentionDays: 0 } : request("/privacy"); },
  async settings(): Promise<PrivacySettings> { return USE_MOCKS ? { keepTranscripts: false, serverKeepsTranscripts: false, serverRetentionDays: 0 } : request("/settings"); },
  async update(settings: { keepTranscripts?: boolean; deleteTranscriptsAfterDays?: number | null }) {
    if (!USE_MOCKS) return request<PrivacySettings>("/settings", "PATCH", settings);
  },
  async deleteHistory() {
    if (!USE_MOCKS) await request("/history?confirm=delete-everything", "DELETE");
    else await AsyncStorage.setItem(MOCK_REMINDERS_KEY, "[]");
  },
};
