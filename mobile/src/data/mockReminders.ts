import { Reminder } from "../types/reminder";

// Demo mode only (EXPO_PUBLIC_USE_MOCKS=true). Dates are relative so the samples never look stale.
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();

export const mockReminders: Reminder[] = [
  {
    id: "mock-1",
    title: "Buy milk",
    description: "Pick up milk on the way home.",
    createdAt: hoursFromNow(-2),
    triggerType: "location",
    location: { type: "category", category: "grocery_store" },
    completed: false,
  },
  {
    id: "mock-2",
    title: "Call the dentist",
    createdAt: hoursFromNow(-2),
    deadline: hoursFromNow(20),
    triggerType: "time",
    completed: false,
  },
  {
    id: "mock-3",
    title: "Return library books",
    createdAt: hoursFromNow(-30),
    deadline: hoursFromNow(52),
    triggerType: "time_and_location",
    location: { type: "place", name: "Jones Library" },
    completed: false,
  },
];
