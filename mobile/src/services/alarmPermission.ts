export async function exactAlarmsAllowed() { return false; }
export async function requestExactAlarms() { throw new Error("Exact-time alerts require a native development build."); }
