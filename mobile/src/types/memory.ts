// What Heedly remembers about the person (backend Module 11): who someone is, and where
// they usually do an errand. Each fact links to reminders by its words.
export type Memory = {
  id: string;
  kind: "person" | "place";
  label: string;
  alias?: string;
  email?: string;
  placeName?: string;
  placeType?: "place" | "saved_place";
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
};
export type MemoryInput = Pick<Memory, "kind" | "label" | "alias" | "email" | "placeName" | "placeType">;
