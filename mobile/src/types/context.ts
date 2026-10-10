export type SavedPlace = { name: string; latitude: number; longitude: number; radiusMeters: number };
export type NearbyPlace = { name?: string; types: string[]; latitude?: number; longitude?: number; distanceMeters?: number };
export type EvalContext = { now: string; timezone: string; latitude?: number; longitude?: number; nearbyPlaces: NearbyPlace[] };
export type Evaluation = { reminderId: string; notify: boolean; score: number; timeStatus: string; quietUntil?: string; reasons: { label: string; points: number }[] };
export type EmailAction = { id: string; type: "email"; status: "needs_approval" | "approved" | "cancelled"; email: { to?: string; toName?: string; subject: string; body: string }; createdAt: string };
export type PrivacyInfo = { audioStored: boolean; storeTranscripts: boolean; transcriptRetentionDays: number };
export type PrivacySettings = { keepTranscripts: boolean; deleteTranscriptsAfterDays?: number | null; serverKeepsTranscripts: boolean; serverRetentionDays: number };
