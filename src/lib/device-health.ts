export const HEARTBEAT_STALE_SECONDS = 90;
export const HEARTBEAT_STALE_MILLISECONDS = HEARTBEAT_STALE_SECONDS * 1000;

export type DeviceLifecycleStatus = "active" | "inactive" | "disabled";
export type DeviceRuntimeStatus = "online" | "offline" | "disabled";

export function isDeviceOnline(
  lastSeen: string | null,
  staleMilliseconds = HEARTBEAT_STALE_MILLISECONDS,
): boolean {
  if (!lastSeen) return false;
  const reportedAt = new Date(lastSeen).getTime();
  if (Number.isNaN(reportedAt)) return false;
  return Date.now() - reportedAt <= staleMilliseconds;
}

export function deriveDeviceRuntimeStatus(
  status: DeviceLifecycleStatus,
  lastSeen: string | null,
  staleMilliseconds = HEARTBEAT_STALE_MILLISECONDS,
): DeviceRuntimeStatus {
  if (status === "disabled") return "disabled";
  return isDeviceOnline(lastSeen, staleMilliseconds) ? "online" : "offline";
}

export function formatLastSeen(lastSeen: string | null): string {
  return lastSeen ? new Date(lastSeen).toLocaleString() : "never";
}
