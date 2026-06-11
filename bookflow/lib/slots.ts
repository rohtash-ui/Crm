import { addMinutes, format, isBefore, isAfter, parseISO } from "date-fns";

interface BusyPeriod {
  start: string;
  end: string;
}

interface AvailabilityWindow {
  startTime: string;
  endTime: string;
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

  let current = new Date(windowStart);
  const now = new Date();

  while (isBefore(current, windowEnd)) {
    const slotEnd = addMinutes(current, duration);
    if (isAfter(slotEnd, windowEnd)) break;

    if (isBefore(current, now)) {
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
