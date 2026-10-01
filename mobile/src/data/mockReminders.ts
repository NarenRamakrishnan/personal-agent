import { Reminder } from "../types/reminder";

export const mockReminders: Reminder[] = [
  {
    id: "mock-1",
    title: "Buy milk",
    description: "Pick up milk on the way home.",
    createdAt: "2026-09-30T08:00:00.000Z",
    deadline: "2026-09-30T18:00:00.000Z",
    triggerType: "time",
    completed: false,
  },
  {
    id: "mock-2",
    title: "Return library books",
    createdAt: "2026-09-29T16:30:00.000Z",
    deadline: "2026-10-02T17:00:00.000Z",
    triggerType: "location",
    location: { type: "place", name: "Public Library" },
    completed: false,
  },
];
