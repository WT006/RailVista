import { trainSource } from './cr12306.js';
import { enrichStopsCoords } from './geocode.js';

const STOPS_AUTOCOMPLETE_MIN = Number(process.env.STOPS_AUTOCOMPLETE_MIN || 5);
const AUTOCOMPLETE_TIMEOUT_MS = Number(process.env.AUTOCOMPLETE_TIMEOUT_MS || 20000);

type StopInput = { name?: string; lng?: number; lat?: number };

export type EnsureFullStopsResult = {
  stops: StopInput[];
  completed: boolean;
  reason?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function tomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function ensureFullStops(
  stops: StopInput[],
  trainCode?: string,
): Promise<EnsureFullStopsResult> {
  if (!trainCode || stops.length >= STOPS_AUTOCOMPLETE_MIN) {
    return { stops, completed: false, reason: 'skip' };
  }

  const from = stops[0]?.name;
  const to = stops[stops.length - 1]?.name;
  if (!from || !to) {
    return { stops, completed: false, reason: 'missing_od' };
  }

  const date = tomorrowDate();

  try {
    const trains = await withTimeout(
      trainSource.searchTrains(from, to, date),
      AUTOCOMPLETE_TIMEOUT_MS,
    );
    const match = trains.find((t) => t.trainCode === trainCode);
    if (!match) {
      return { stops, completed: false, reason: 'train_not_found' };
    }

    const fullStops = await withTimeout(
      trainSource.getStops({
        trainNo: match.trainNo,
        trainCode: match.trainCode,
        from,
        to,
        date,
      }),
      AUTOCOMPLETE_TIMEOUT_MS,
    );

    if (fullStops.length < STOPS_AUTOCOMPLETE_MIN) {
      return { stops, completed: false, reason: 'too_few_stops' };
    }

    const enriched = await enrichStopsCoords(
      fullStops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
      { trainCode },
    );

    return {
      stops: enriched.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
      completed: true,
    };
  } catch (e) {
    const reason = e instanceof Error && e.message === 'timeout' ? 'timeout' : 'error';
    return { stops, completed: false, reason };
  }
}