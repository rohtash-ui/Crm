import { addMinutes, isBefore, isAfter } from "date-fns";

interface BusyPeriod {
  start: string | Date;
  end: string | Date;
}

interface AvailabilityWindow {
  startTime: string; // "09:00"
  endTime: string;   // "17:00"
}

export function generateTimeSlots(
  date: Date,
  duration: number,
  availability: AvailabilityWindow,
  busyPeriods: BusyPeriod[],
  existingBookings: { startTime: Date; endTime: Date }[]
): string[] {
  const slots: string[] = [];
  const [startHour, startMin] = availability.startTime.split(":").map(Number);
  const [endHour, endMin] = availability.endTime.split(":").map(Number);

  const windowStart = new Date(date);
  windowStart.setHours(startHour, startMin, 0, 0);

  const windowEnd = new Date(date);
  windowEnd.setHours(endHour, endMin, 0, 0);

  // Buffer: slots must start at least 2 hours from now
  const minStart = new Date(Date.now() + 2 * 60 * 60 * 1000);

  let current = new Date(windowStart);

  while (isBefore(current, windowEnd)) {
    const slotEnd = addMinutes(current, duration);

    // Slot must fully fit within the window
    if (isAfter(slotEnd, windowEnd)) break;

    // Don't allow booking in the past or within 2h buffer
    if (isBefore(current, minStart)) {
      current = addMinutes(current, 30);
      continue;
    }

    const isConflict =
      busyPeriods.some(
        (b) =>
          isBefore(current, new Date(b.end)) &&
          isAfter(slotEnd, new Date(b.start))
      ) ||
      existingBookings.some(
        (b) =>
          isBefore(current, new Date(b.endTime)) &&
          isAfter(slotEnd, new Date(b.startTime))
      );

    if (!isConflict) {
      slots.push(current.toISOString());
    }

    current = addMinutes(current, 30);
  }

  return slots;
}
