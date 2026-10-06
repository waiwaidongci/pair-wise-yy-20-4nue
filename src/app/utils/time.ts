export function formatTime(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const value = Math.abs(Math.round(minutes));
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return hour > 0 ? `${sign}${hour}小时${minute}分` : `${sign}${minute}分`;
}

export function minutesFromClock(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}
