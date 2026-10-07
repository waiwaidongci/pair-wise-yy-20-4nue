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
import { formatTime } from './time';

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
  return { lineName: '江海铁路调度台 · 北岭—终点南', stations, sections, trains, plans: [] };
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
  const plans = Array.isArray(file.plans) ? file.plans : [];
  plans.forEach((plan) => {
    if (!sectionIds.has(plan.sectionId)) {
      throw new Error(`施工计划 ${plan.id} 引用了不存在的区间 ${plan.sectionId}`);
    }
    if (plan.direction !== 'up' && plan.direction !== 'down') {
      throw new Error(`施工计划 ${plan.id} 的方向无效`);
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
    plans: plans.map((plan, index) => ({
      ...plan,
      id: plan.id || `PLAN-${index + 1}`,
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

export function computeConflicts(network: TrainNetwork): TimetableConflict[] {
  const queuedIds = getQueuedPlanIds(network);
  const conflicts: TimetableConflict[] = [
    ...network.trains.flatMap((train) => computeTrainConflicts(train, network, queuedIds)),
    ...network.plans.flatMap((plan) => computePlanConflicts(plan, network, queuedIds)),
  ];
  return dedupeAndSort(conflicts);
}

/**
 * 增量重算冲突：仅重算与变更列车/施工计划相关的记录，其余照旧保留。
 * 运行线或施工计划一变，相关冲突立即失效重算，未受影响的记录照旧保留。
 * 施工影响依赖生效/排队划分，计划变更可能改变其他计划的排队状态，需一并重算。
 */
export function recomputeConflicts(
  previous: TimetableConflict[],
  oldNetwork: TrainNetwork,
  newNetwork: TrainNetwork,
  changedTrainIds: string[] = [],
  changedPlanIds: string[] = [],
): TimetableConflict[] {
  const dirtyTrains = new Set(changedTrainIds);
  const dirtyPlans = new Set(changedPlanIds);

  const oldQueued = getQueuedPlanIds(oldNetwork);
  const newQueued = getQueuedPlanIds(newNetwork);
  const statusChangedPlans = new Set<string>();
  oldQueued.forEach((id) => {
    if (!newQueued.has(id)) statusChangedPlans.add(id);
  });
  newQueued.forEach((id) => {
    if (!oldQueued.has(id)) statusChangedPlans.add(id);
  });

  const isDirty = (conflict: TimetableConflict): boolean => {
    if (conflict.trainIds.some((id) => dirtyTrains.has(id))) return true;
    if (conflict.planId && (dirtyPlans.has(conflict.planId) || statusChangedPlans.has(conflict.planId))) {
      return true;
    }
    if (
      conflict.relatedPlanIds?.some(
        (id) => dirtyPlans.has(id) || statusChangedPlans.has(id),
      )
    ) {
      return true;
    }
    return false;
  };

  const kept = previous.filter((conflict) => !isDirty(conflict));
  const recomputed: TimetableConflict[] = [];

  newNetwork.trains
    .filter((train) => dirtyTrains.has(train.id))
    .forEach((train) => recomputed.push(...computeTrainConflicts(train, newNetwork, newQueued)));

  newNetwork.plans
    .filter((plan) => dirtyPlans.has(plan.id))
    .forEach((plan) => recomputed.push(...computePlanConflicts(plan, newNetwork, newQueued)));

  newNetwork.plans
    .filter((plan) => statusChangedPlans.has(plan.id) && !dirtyPlans.has(plan.id))
    .forEach((plan) => {
      if (!newQueued.has(plan.id)) {
        recomputed.push(...computeConstructionConflictsForPlan(plan, newNetwork));
      }
    });

  return dedupeAndSort([...kept, ...recomputed]);
}

/** 计算单趟列车相关的全部冲突（追踪、越行、到发线占用、施工影响）。 */
function computeTrainConflicts(
  train: Train,
  network: TrainNetwork,
  queuedIds: Set<string>,
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  const stationMap = new Map(network.stations.map((station) => [station.id, station]));
  const sectionMap = new Map(network.sections.map((section) => [section.id, section]));

  train.stops.forEach((stop, stopIndex) => {
    const nextStop = train.stops[stopIndex + 1];
    if (!nextStop) return;
    const section = findSectionBetween(network, stop.stationId, nextStop.stationId);
    if (!section) return;
    const departure = Math.min(stop.departure, nextStop.arrival);
    const arrival = Math.max(stop.departure, nextStop.arrival);

    const peers = network.trains.filter(
      (candidate) => candidate.id !== train.id && candidate.direction === train.direction,
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
          id: `headway:${section.id}:${[train.id, peer.id].sort().join(':')}`,
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

  conflicts.push(...computeTrackConflictsForTrain(train, network, stationMap));
  conflicts.push(...computeConstructionConflictsForTrain(train, network, queuedIds));
  return conflicts;
}

/** 计算单个施工计划相关的全部冲突（区间容量互斥、对列车的施工影响）。 */
function computePlanConflicts(
  plan: ConstructionPlan,
  network: TrainNetwork,
  queuedIds: Set<string>,
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  conflicts.push(...computeCapacityConflictsForPlan(plan, network));
  if (!queuedIds.has(plan.id)) {
    conflicts.push(...computeConstructionConflictsForPlan(plan, network));
  }
  return conflicts;
}

/** 到发线占用冲突（仅计算与该列车相邻的占用）。 */
function computeTrackConflictsForTrain(
  train: Train,
  network: TrainNetwork,
  stationMap: Map<string, Station>,
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  train.stops.forEach((stop) => {
    const station = stationMap.get(stop.stationId);
    const track = station?.tracks.find((candidate) => candidate.id === stop.trackId);
    if (!station || !track) return;

    const others = network.trains
      .filter((candidate) => candidate.id !== train.id)
      .map((candidate) => ({
        train: candidate,
        stop: candidate.stops.find((item) => item.stationId === stop.stationId && item.trackId === stop.trackId),
      }))
      .filter((item): item is { train: Train; stop: TrainStop } => !!item.stop)
      .sort((a, b) => a.stop.arrival - b.stop.arrival);

    const predecessor = [...others].reverse().find((item) => item.stop.arrival <= stop.arrival);
    const successor = others.find((item) => item.stop.arrival >= stop.arrival);

    [predecessor, successor].forEach((neighbor) => {
      if (!neighbor) return;
      const neighborIsEarlier = neighbor.stop.arrival <= stop.arrival;
      const earlier = neighborIsEarlier ? neighbor : { train, stop };
      const later = neighborIsEarlier ? { train, stop } : neighbor;
      const gap = later.stop.arrival - earlier.stop.departure;
      if (gap < 2) {
        conflicts.push({
          id: `track:${stop.stationId}:${stop.trackId}:${earlier.train.id}:${later.train.id}`,
          type: 'track',
          severity: gap < 0 ? 'danger' : 'warning',
          title: `${station.name} ${track.name} 占用冲突`,
          detail: `${earlier.train.number} 与 ${later.train.number} 的到发线占用重叠 ${Math.max(0, -gap).toFixed(1)} 分，需要改股道或错开时刻。`,
          trainIds: [earlier.train.id, later.train.id],
          stationId: stop.stationId,
          timeRange: {
            start: Math.min(earlier.stop.arrival, later.stop.arrival),
            end: Math.max(earlier.stop.departure, later.stop.departure),
          },
          suggestedShift: { start: Math.max(1, 2 - gap), end: Math.max(5, 8 - gap) },
        });
      }
    });
  });
  return conflicts;
}

/** 施工计划对列车的影响（仅生效中的计划）。 */
function computeConstructionConflictsForTrain(
  train: Train,
  network: TrainNetwork,
  queuedIds: Set<string>,
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  network.plans
    .filter((plan) => !queuedIds.has(plan.id))
    .forEach((plan) => {
      const traversal = planAffectsTrain(plan, train, network);
      if (!traversal) return;
      conflicts.push(buildConstructionConflict(plan, train, traversal, network));
    });
  return conflicts;
}

function computeConstructionConflictsForPlan(plan: ConstructionPlan, network: TrainNetwork): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  network.trains.forEach((train) => {
    const traversal = planAffectsTrain(plan, train, network);
    if (!traversal) return;
    conflicts.push(buildConstructionConflict(plan, train, traversal, network));
  });
  return conflicts;
}

function buildConstructionConflict(
  plan: ConstructionPlan,
  train: Train,
  traversal: { start: number; end: number },
  network: TrainNetwork,
): TimetableConflict {
  const section = network.sections.find((item) => item.id === plan.sectionId);
  const from = section ? network.stations.find((item) => item.id === section.fromStationId) : undefined;
  const to = section ? network.stations.find((item) => item.id === section.toStationId) : undefined;
  const overlapStart = Math.max(traversal.start, plan.startTime);
  const overlapEnd = Math.min(traversal.end, plan.endTime);
  return {
    id: `construction:${plan.id}:${train.id}`,
    type: 'construction',
    severity: 'warning',
    title: `${train.number} 受施工限速影响`,
    detail: `${from?.name ?? ''}—${to?.name ?? ''}区间${plan.direction === 'up' ? '上行' : '下行'}施工（${formatTime(plan.startTime)}–${formatTime(plan.endTime)}），限速 ${plan.speedLimitKmh} km/h，${train.number} 在 ${formatTime(overlapStart)}–${formatTime(overlapEnd)} 时段通过该区间，需按限速运行。`,
    trainIds: [train.id],
    sectionId: plan.sectionId,
    planId: plan.id,
    timeRange: { start: overlapStart, end: overlapEnd },
    suggestedShift: { start: 1, end: Math.max(3, plan.endTime - traversal.start) },
  };
}

/** 区间容量互斥：同一区间同一方向时段重叠的计划，超出的排队。 */
function computeCapacityConflictsForPlan(plan: ConstructionPlan, network: TrainNetwork): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  network.plans.forEach((peer) => {
    if (peer.id === plan.id) return;
    if (peer.sectionId !== plan.sectionId || peer.direction !== plan.direction) return;
    if (peer.startTime >= plan.endTime || peer.endTime <= plan.startTime) return;
    const planIsLater =
      plan.startTime !== peer.startTime
        ? plan.startTime > peer.startTime
        : plan.id.localeCompare(peer.id) > 0;
    const queued = planIsLater ? plan : peer;
    const active = planIsLater ? peer : plan;
    conflicts.push({
      id: `capacity:${plan.sectionId}:${plan.direction}:${[plan.id, peer.id].sort().join(':')}`,
      type: 'construction',
      severity: 'warning',
      title: `施工容量冲突：${queued.id} 排队`,
      detail: `${active.id} 与 ${queued.id} 在同一区间同一方向（${plan.direction === 'up' ? '上行' : '下行'}）时段重叠（${formatTime(active.startTime)}–${formatTime(active.endTime)} 与 ${formatTime(queued.startTime)}–${formatTime(queued.endTime)}），区间容量仅一份，${queued.id} 排队等候，互斥原因：时段重叠。`,
      trainIds: [],
      sectionId: plan.sectionId,
      planId: queued.id,
      relatedPlanIds: [active.id],
      timeRange: {
        start: Math.max(plan.startTime, peer.startTime),
        end: Math.min(plan.endTime, peer.endTime),
      },
      suggestedShift: { start: 1, end: 60 },
    });
  });
  return conflicts;
}

/** 判断施工计划是否影响列车，返回列车通过区间的起止时刻（不影响返回 null）。 */
function planAffectsTrain(
  plan: ConstructionPlan,
  train: Train,
  network: TrainNetwork,
): { start: number; end: number } | null {
  if (train.direction !== plan.direction) return null;
  const section = network.sections.find((item) => item.id === plan.sectionId);
  if (!section) return null;
  const fromStop = train.stops.find((item) => item.stationId === section.fromStationId);
  const toStop = train.stops.find((item) => item.stationId === section.toStationId);
  if (!fromStop || !toStop) return null;
  const fromIndex = train.stops.indexOf(fromStop);
  const toIndex = train.stops.indexOf(toStop);
  if (train.direction === 'up' && fromIndex > toIndex) return null;
  if (train.direction === 'down' && fromIndex < toIndex) return null;
  const start = Math.min(fromStop.departure, toStop.arrival);
  const end = Math.max(fromStop.departure, toStop.arrival);
  if (start >= plan.endTime || end <= plan.startTime) return null;
  return { start, end };
}

/** 同一区间同一方向仅保留一份生效计划，其余排队。返回排队计划 id 集合。 */
export function getQueuedPlanIds(network: TrainNetwork): Set<string> {
  const queued = new Set<string>();
  const groups = new Map<string, ConstructionPlan[]>();
  network.plans.forEach((plan) => {
    const key = `${plan.sectionId}:${plan.direction}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(plan);
    groups.set(key, bucket);
  });
  groups.forEach((plans) => {
    const sorted = [...plans].sort((a, b) =>
      a.startTime !== b.startTime ? a.startTime - b.startTime : a.id.localeCompare(b.id),
    );
    const active: ConstructionPlan[] = [];
    sorted.forEach((current) => {
      const overlapsActive = active.some((item) => item.endTime > current.startTime);
      if (overlapsActive) {
        queued.add(current.id);
      } else {
        active.push(current);
      }
    });
  });
  return queued;
}

/** 返回生效中的施工计划（未排队）。 */
export function getActivePlans(network: TrainNetwork): ConstructionPlan[] {
  const queued = getQueuedPlanIds(network);
  return network.plans.filter((plan) => !queued.has(plan.id));
}

function findSectionBetween(
  network: TrainNetwork,
  fromStationId: string,
  toStationId: string,
): RailSection | undefined {
  return network.sections.find(
    (section) =>
      (section.fromStationId === fromStationId && section.toStationId === toStationId) ||
      (section.toStationId === fromStationId && section.fromStationId === toStationId),
  );
}

function dedupeAndSort(conflicts: TimetableConflict[]): TimetableConflict[] {
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
