import {
  ImportedNetworkFile,
  RailSection,
  Station,
  TimetableConflict,
  Train,
  TrainNetwork,
  TrainStop,
} from '../types/timetable';

const COLORS = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f'];
const STATION_NAMES = [
  '北岭',
  '清河',
  '松江',
  '东港',
  '西陵',
  '南川',
  '云台',
  '临江',
  '白塔',
  '海州',
  '新城',
  '终点南',
];
const SHORT_NAMES = ['BL', 'QH', 'SJ', 'DG', 'XL', 'NC', 'YT', 'LJ', 'BT', 'HZ', 'XC', 'ZD'];

export function createMockNetwork(): TrainNetwork {
  const stations: Station[] = STATION_NAMES.map((name, index) => ({
    id: `S${String(index + 1).padStart(2, '0')}`,
    name,
    shortName: SHORT_NAMES[index],
    km: index * 31 + (index > 5 ? 2 : 0),
    tracks: [
      { id: `S${String(index + 1).padStart(2, '0')}-1`, name: 'I道', main: true },
      { id: `S${String(index + 1).padStart(2, '0')}-2`, name: 'II道', main: true },
      ...(index % 3 === 0
        ? [{ id: `S${String(index + 1).padStart(2, '0')}-3`, name: '3道', main: false }]
        : []),
    ],
  }));

  const sections: RailSection[] = stations.slice(0, -1).map((station, index) => {
    const next = stations[index + 1];
    const distanceKm = next.km - station.km;
    return {
      id: `SEC-${index + 1}`,
      fromStationId: station.id,
      toStationId: next.id,
      distanceKm,
      minHeadwayMin: distanceKm > 32 ? 5 : 4,
      baseRunningMin: Math.round(distanceKm * 1.35),
    };
  });

  const trains: Train[] = [];
  const categories: Train['category'][] = ['高铁', '动车', '普速', '货运'];
  const startTimes = [330, 390, 450, 510, 570, 630, 690];

  startTimes.forEach((baseStart, routeIndex) => {
    for (let offset = 0; offset < 38; offset += 1) {
      const direction = (offset + routeIndex) % 2 === 0 ? 'up' : 'down';
      const category = categories[(offset + routeIndex) % categories.length];
      const numberPrefix = category === '高铁' ? 'G' : category === '动车' ? 'D' : category === '货运' ? 'X' : 'K';
      const trainIndex = routeIndex * 38 + offset + 1;
      const departureBase = baseStart + offset * 7 + routeIndex * 3;
      trains.push(
        buildTrain({
          index: trainIndex,
          number: `${numberPrefix}${1200 + trainIndex}`,
          category,
          direction,
          departureBase,
          stations,
          sections,
        }),
      );
    }
  });

  applyMeetRelations(trains, stations);
  return { lineName: '江海铁路调度台 · 北岭—终点南', stations, sections, trains };
}

interface BuildTrainInput {
  index: number;
  number: string;
  category: Train['category'];
  direction: Train['direction'];
  departureBase: number;
  stations: Station[];
  sections: RailSection[];
}

function buildTrain(input: BuildTrainInput): Train {
  const speedFactor: Record<Train['category'], number> = {
    高铁: 0.76,
    动车: 0.86,
    普速: 1,
    货运: 1.18,
  };
  const orderedStations = input.direction === 'up' ? input.stations : [...input.stations].reverse();
  const orderedSections = input.direction === 'up' ? input.sections : [...input.sections].reverse();
  const stops: TrainStop[] = [];
  let cursor = input.departureBase;

  orderedStations.forEach((station, stationIndex) => {
    const isTerminal = stationIndex === 0 || stationIndex === orderedStations.length - 1;
    const skip = !isTerminal && (stationIndex + input.index) % 5 === 0;
    const dwell = isTerminal ? 4 : skip ? 0 : 3 + ((stationIndex + input.index) % 6);
    const arrival = stationIndex === 0 ? cursor : cursor;
    if (stationIndex > 0) {
      const section = orderedSections[stationIndex - 1];
      cursor += Math.max(2, Math.round(section.baseRunningMin * speedFactor[input.category]));
    }
    const actualArrival = stationIndex === 0 ? cursor : cursor;
    const departure = actualArrival + dwell;
    const track = station.tracks[input.index % station.tracks.length];
    stops.push({
      stationId: station.id,
      kind: skip ? 'pass' : 'stop',
      arrival: actualArrival,
      departure,
      trackId: track.id,
    });
    cursor = departure;
  });

  return {
    id: `T${input.index}`,
    number: input.number,
    category: input.category,
    direction: input.direction,
    color: COLORS[input.index % COLORS.length],
    selected: false,
    stops,
  };
}

function applyMeetRelations(trains: Train[], stations: Station[]): void {
  for (let index = 0; index < Math.min(trains.length, 180); index += 1) {
    const train = trains[index];
    const counterpart = trains[(index + 11) % trains.length];
    if (!train || !counterpart || train.direction === counterpart.direction) continue;
    const station = stations[(index * 3) % stations.length];
    const stop = train.stops.find((item) => item.stationId === station.id);
    if (stop && stop.kind === 'stop' && index % 4 === 0) {
      stop.kind = 'meet';
      stop.meetTrainNumber = counterpart.number;
    }
    const otherStop = counterpart.stops.find((item) => item.stationId === station.id);
    if (otherStop && otherStop.kind === 'stop' && index % 5 === 0) {
      otherStop.kind = 'meet';
      otherStop.meetTrainNumber = train.number;
    }
  }
}

export function normalizeImportedNetwork(file: ImportedNetworkFile, fallback: TrainNetwork): TrainNetwork {
  if (!Array.isArray(file.stations) || file.stations.length < 2) {
    throw new Error('JSON 数据缺少有效 stations 数组');
  }
  if (!Array.isArray(file.sections) || file.sections.length < 1) {
    throw new Error('JSON 数据缺少有效 sections 数组');
  }
  if (!Array.isArray(file.trains) || file.trains.length < 1) {
    throw new Error('JSON 数据缺少有效 trains 数组');
  }
  const stationIds = new Set(file.stations.map((station) => station.id));
  file.sections.forEach((section) => {
    if (!stationIds.has(section.fromStationId) || !stationIds.has(section.toStationId)) {
      throw new Error(`区间 ${section.id} 引用了不存在的车站`);
    }
  });
  return {
    lineName: file.lineName || fallback.lineName,
    stations: file.stations,
    sections: file.sections,
    trains: file.trains.map((train, index) => ({
      ...train,
      id: train.id || `IMPORT-${index + 1}`,
      color: train.color || COLORS[index % COLORS.length],
      selected: false,
    })),
  };
}

export function filterTrains(network: TrainNetwork, query: string, categories: string[], direction: string): Train[] {
  const normalizedQuery = query.trim().toLowerCase();
  return network.trains.filter((train) => {
    const queryMatches = !normalizedQuery || train.number.toLowerCase().includes(normalizedQuery);
    const categoryMatches = categories.length === 0 || categories.includes(train.category);
    const directionMatches = direction === 'all' || train.direction === direction;
    return queryMatches && categoryMatches && directionMatches;
  });
}

export function shiftTrain(train: Train, deltaMinutes: number): Train {
  return {
    ...train,
    stops: train.stops.map((stop) => ({
      ...stop,
      arrival: stop.arrival + deltaMinutes,
      departure: stop.departure + deltaMinutes,
    })),
  };
}

export function updateStop(train: Train, stationId: string, changes: Partial<TrainStop>): Train {
  return {
    ...train,
    stops: train.stops.map((stop) => (stop.stationId === stationId ? { ...stop, ...changes } : stop)),
  };
}

export function getSectionEndpoints(section: RailSection, network: TrainNetwork): [Station, Station] | null {
  const from = network.stations.find((station) => station.id === section.fromStationId);
  const to = network.stations.find((station) => station.id === section.toStationId);
  return from && to ? [from, to] : null;
}

export function computeConflicts(network: TrainNetwork, visibleTrainIds?: Set<string>): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  const stationMap = new Map(network.stations.map((station) => [station.id, station]));
  const sectionMap = new Map(network.sections.map((section) => [section.id, section]));
  const stationOccupancy = new Map<string, Array<{ train: Train; stop: TrainStop }>>();

  network.trains.forEach((train) => {
    if (visibleTrainIds && !visibleTrainIds.has(train.id)) return;
    train.stops.forEach((stop, stopIndex) => {
      const key = `${stop.stationId}:${stop.trackId}`;
      const bucket = stationOccupancy.get(key) ?? [];
      bucket.push({ train, stop });
      stationOccupancy.set(key, bucket);

      const nextStop = train.stops[stopIndex + 1];
      if (!nextStop) return;
      const section = network.sections.find(
        (candidate) =>
          (candidate.fromStationId === stop.stationId && candidate.toStationId === nextStop.stationId) ||
          (candidate.toStationId === stop.stationId && candidate.fromStationId === nextStop.stationId),
      );
      if (!section) return;
      const departure = Math.min(stop.departure, nextStop.arrival);
      const arrival = Math.max(stop.departure, nextStop.arrival);
      const peers = network.trains.filter(
        (candidate) =>
          candidate.id !== train.id &&
          candidate.direction === train.direction &&
          (!visibleTrainIds || visibleTrainIds.has(candidate.id)),
      );
      peers.forEach((peer) => {
        const peerStopsInOrder =
          peer.stops.findIndex((item) => item.stationId === stop.stationId) <
          peer.stops.findIndex((item) => item.stationId === nextStop.stationId);
        if (!peerStopsInOrder) return;
        const peerStart = peer.stops.find((item) => item.stationId === stop.stationId);
        const peerEnd = peer.stops.find((item) => item.stationId === nextStop.stationId);
        if (!peerStart || !peerEnd) return;
        const peerDeparture = Math.min(peerStart.departure, peerEnd.arrival);
        const peerArrival = Math.max(peerStart.departure, peerEnd.arrival);
        const gap = Math.abs(peerDeparture - departure);
        if (gap < section.minHeadwayMin) {
          conflicts.push({
            id: `headway:${section.id}:${train.id}:${peer.id}`,
            type: 'headway',
            severity: gap < section.minHeadwayMin * 0.55 ? 'danger' : 'warning',
            title: `${sectionMap.get(section.id)?.id ?? section.id} 追踪间隔不足`,
            detail: `${train.number} 与 ${peer.number} 在${stationMap.get(stop.stationId)?.name}—${stationMap.get(nextStop.stationId)?.name}区间发车相差 ${gap.toFixed(1)} 分，要求不少于 ${section.minHeadwayMin} 分。`,
            trainIds: [train.id, peer.id],
            sectionId: section.id,
            timeRange: { start: Math.min(departure, peerDeparture), end: Math.max(arrival, peerArrival) },
            suggestedShift: {
              start: Math.max(1, section.minHeadwayMin - gap),
              end: Math.max(4, section.minHeadwayMin - gap + 10),
            },
          });
        }

        const highSpeedAhead =
          departure < peerDeparture &&
          arrival > peerArrival &&
          (train.category === '高铁' || train.category === '动车') &&
          (peer.category === '普速' || peer.category === '货运');
        if (highSpeedAhead) {
          conflicts.push({
            id: `overtake:${section.id}:${train.id}:${peer.id}`,
            type: 'overtake',
            severity: 'warning',
            title: `${train.number} 将在区间追及 ${peer.number}`,
            detail: `${train.category}列车在${stationMap.get(stop.stationId)?.name}—${stationMap.get(nextStop.stationId)?.name}区间形成越行风险，建议在前方站安排会让或调整发车时刻。`,
            trainIds: [train.id, peer.id],
            sectionId: section.id,
            timeRange: { start: departure, end: arrival },
            suggestedShift: { start: 2, end: 12 },
          });
        }
      });
    });
  });

  stationOccupancy.forEach((occupants, key) => {
    occupants.sort((a, b) => a.stop.arrival - b.stop.arrival);
    for (let index = 1; index < occupants.length; index += 1) {
      const previous = occupants[index - 1];
      const current = occupants[index];
      const gap = current.stop.arrival - previous.stop.departure;
      if (gap < 2) {
        const [stationId, trackId] = key.split(':');
        const station = stationMap.get(stationId);
        const track = station?.tracks.find((candidate) => candidate.id === trackId);
        conflicts.push({
          id: `track:${stationId}:${trackId}:${previous.train.id}:${current.train.id}`,
          type: 'track',
          severity: gap < 0 ? 'danger' : 'warning',
          title: `${station?.name ?? stationId} ${track?.name ?? trackId} 占用冲突`,
          detail: `${previous.train.number} 与 ${current.train.number} 的到发线占用重叠 ${Math.max(0, -gap).toFixed(1)} 分，需要改股道或错开时刻。`,
          trainIds: [previous.train.id, current.train.id],
          stationId,
          timeRange: {
            start: Math.min(previous.stop.arrival, current.stop.arrival),
            end: Math.max(previous.stop.departure, current.stop.departure),
          },
          suggestedShift: { start: Math.max(1, 2 - gap), end: Math.max(5, 8 - gap) },
        });
      }
    }
  });

  return conflicts
    .filter((conflict, index, all) => all.findIndex((item) => item.id === conflict.id) === index)
    .sort((a, b) => a.timeRange.start - b.timeRange.start)
    .slice(0, 400);
}

export function visibleTimeRange(network: TrainNetwork): [number, number] {
  const times = network.trains.flatMap((train) => train.stops.flatMap((stop) => [stop.arrival, stop.departure]));
  if (times.length === 0) return [0, 1440];
  return [Math.min(...times) - 10, Math.max(...times) + 10];
}
