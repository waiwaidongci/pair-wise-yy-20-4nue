import {
  ConstructionPlan,
  ImportedNetworkFile,
  RailSection,
  Station,
  TimetableConflict,
  Train,
  TrainNetwork,
  TrainStop,
} from '../types/timetable';
import { buildConflictCache, orderedConflicts } from './conflict-engine';

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
  const constructionPlans = buildSeedPlans(sections);
  return { lineName: '江海铁路调度台 · 北岭—终点南', stations, sections, trains, constructionPlans };
}

/** 内置演示计划：含同向同时段互斥排队，以及与运行线时段重叠的限速。 */
function buildSeedPlans(sections: RailSection[]): ConstructionPlan[] {
  if (sections.length < 7) return [];
  return [
    {
      id: 'PLAN-1',
      sectionId: sections[3].id,
      direction: 'up',
      start: 8 * 60 + 30,
      end: 11 * 60 + 30,
      speedLimitKmh: 120,
      note: '换轨施工',
    },
    {
      id: 'PLAN-2',
      sectionId: sections[3].id,
      direction: 'up',
      start: 10 * 60,
      end: 12 * 60 + 30,
      speedLimitKmh: 160,
      note: '接触网检修（待批）',
    },
    {
      id: 'PLAN-3',
      sectionId: sections[6].id,
      direction: 'down',
      start: 13 * 60,
      end: 16 * 60,
      speedLimitKmh: 45,
      note: '线路慢行',
    },
    {
      id: 'PLAN-4',
      sectionId: sections[1].id,
      direction: 'up',
      start: 6 * 60,
      end: 8 * 60,
      speedLimitKmh: 80,
      note: '桥涵检查',
    },
  ];
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
  const sectionIds = new Set(file.sections.map((section) => section.id));
  file.sections.forEach((section) => {
    if (!stationIds.has(section.fromStationId) || !stationIds.has(section.toStationId)) {
      throw new Error(`区间 ${section.id} 引用了不存在的车站`);
    }
  });
  // 旧数据没有施工计划字段，按空计划继续可用；引用了不存在区间的计划直接忽略。
  const constructionPlans = (file.constructionPlans ?? [])
    .filter((plan) => plan && sectionIds.has(plan.sectionId))
    .map((plan, index) => ({
      ...plan,
      id: plan.id || `IMPORT-PLAN-${index + 1}`,
      start: Number(plan.start),
      end: Number(plan.end),
      speedLimitKmh: Number(plan.speedLimitKmh),
      note: plan.note,
    }))
    .filter((plan) => Number.isFinite(plan.start) && Number.isFinite(plan.end) && plan.end > plan.start && plan.speedLimitKmh > 0);
  return {
    lineName: file.lineName || fallback.lineName,
    stations: file.stations,
    sections: file.sections,
    constructionPlans,
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

/**
 * 全量计算冲突（供一次性视图读取）。增量重算在 reducer 中通过
 * buildConflictCache / refreshTrainConflicts / refreshPlanConflicts 完成。
 */
export function computeConflicts(network: TrainNetwork, visibleTrainIds?: Set<string>): TimetableConflict[] {
  const all = orderedConflicts(buildConflictCache(network));
  if (!visibleTrainIds) return all;
  return all.filter(
    (conflict) =>
      conflict.trainIds.length === 0 || conflict.trainIds.some((trainId) => visibleTrainIds.has(trainId)),
  );
}

export function visibleTimeRange(network: TrainNetwork): [number, number] {
  const trainTimes = network.trains.flatMap((train) => train.stops.flatMap((stop) => [stop.arrival, stop.departure]));
  const planTimes = network.constructionPlans.flatMap((plan) => [plan.start, plan.end]);
  const times = [...trainTimes, ...planTimes];
  if (times.length === 0) return [0, 1440];
  return [Math.min(...times) - 10, Math.max(...times) + 10];
}
