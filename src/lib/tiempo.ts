// Minute math for the paseador flow: reception time + walk duration → delivery time.
// Returns an ISO string that Muten's built-in time()/isPast() can parse.
export function addMinutes(iso: string, mins: number): string {
  const base = iso ? new Date(iso) : new Date();
  base.setMinutes(base.getMinutes() + (mins || 0));
  return base.toISOString();
}
