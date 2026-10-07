import {
  ConstructionPlan,
  ConflictCacheState,
  RailSection,
  Station,
  TimetableConflict,
  Train,
  TrainNetwork,
  TrainStop,
} from '../types/timetable';

/** 单方向单区间同时只允许一份施工计划生效。 */
export const CONSTRUCTION_PLAN_CAPACITY = 1;
/** 达到常速的这一比例才视为按限速运行，低于该值提示运行线可能已排点。 */
const USED_LIMIT_RATIO = 0.9;
const MAX_CONFLICTS = 400;

export interface PlanStatus {
  plan: ConstructionPlan;
  active: boolean;
  /** 排队原因：与本计划互斥、当前占用容量的生效计划 */
  blockedBy: ConstructionPlan[];
}

export function directionLabel(direction: ConstructionPlan['direction']): string {
  return direction === 'up' ? '上行' : '下行';
}

function sectionLabel(section: RailSection | undefined, stationMap: Map<string, Station>): string {
  if (!section) return '';
  const from = stationMap.get(section.fromStationId)?.name ?? section.fromStationId;
  const to = stationMap.get(section.toStationId)?.name ?? section.toStationId;
  return `${from}—${to}`;
}

/** 时间区间相交（端点相接视为不冲突，允许一趟车刚出清、下一份计划立即开始）。 */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 同区间、同方向的施工计划容量为一份：按开始时刻排序贪心占容，
 * 未能获得容量的计划进入排队，并记录与它互斥的生效计划。
 */
export function reconcilePlans(network: TrainNetwork): PlanStatus[] {
  const sectionIds = new Set(network.sections.map((section) => section.id));
  const valid = network.constructionPlans
    .filter((plan) => sectionIds.has(plan.sectionId) && plan.end > plan.start && plan.speedLimitKmh > 0)
    .slice()
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  // key = 区间 + 方向，保存当前占用容量的生效计划
  const occupied = new Map<string, ConstructionPlan[]>();
  const activeIds = new Set<string>();

  valid.forEach((plan) => {
    const key = `${plan.sectionId}:${plan.direction}`;
    const holders = (occupied.get(key) ?? []).filter((holder) => rangesOverlap(holder.start, holder.end, plan.start, plan.end));
    if (holders.length < CONSTRUCTION_PLAN_CAPACITY) {
      holders.push(plan);
      occupied.set(key, holders);
      activeIds.add(plan.id);
    } else {
      occupied.set(key, holders);
    }
  });

  return network.constructionPlans
    .filter((plan) => sectionIds.has(plan.sectionId) && plan.end > plan.start && plan.speedLimitKmh > 0)
    .map((plan) => {
      const active = activeIds.has(plan.id);
      const blockedBy = active
        ? []
        : (occupied.get(`${plan.sectionId}:${plan.direction}`) ?? []).filter(
            (holder) =>
              holder.id !== plan.id && rangesOverlap(holder.start, holder.end, plan.start, plan.end),
          );
      return { plan, active, blockedBy };
    });
}

// ---------------------------------------------------------------------------
// 冲突生成器
// ---------------------------------------------------------------------------

interface GeneratorContext {
  network: TrainNetwork;
  stationMap: Map<string, Station>;
  activePlans: Map<string, ConstructionPlan[]>;
}

function createContext(network: TrainNetwork): GeneratorContext {
  const activePlans = new Map<string, ConstructionPlan[]>();
  reconcilePlans(network).forEach((status) => {
    if (!status.active) return;
    const key = `${status.plan.sectionId}:${status.plan.direction}`;
    activePlans.set(key, [...(activePlans.get(key) ?? []), status.plan]);
  });
  return {
    network,
    stationMap: new Map(network.stations.map((station) => [station.id, station])),
    activePlans,
  };
}

function findSection(network: TrainNetwork, fromId: string, toId: string): RailSection | undefined {
  return network.sections.find(
    (section) =>
      (section.fromStationId === fromId && section.toStationId === toId) ||
      (section.toStationId === fromId && section.fromStationId === toId),
  );
}

function unorderedPairKey(first: string, second: string): string {
  return [first, second].sort().join('|');
}

/**
 * 区间追踪间隔与越行冲突。
 * affectedTrainIds 给出时只生成与这些运行线相关的记录（供局部重算）。
 */
function generateSectionConflicts(ctx: GeneratorContext, affectedTrainIds?: Set<string>): TimetableConflict[] {
  const { network, stationMap } = ctx;
  const conflicts: TimetableConflict[] = [];

  network.trains.forEach((train) => {
    if (affectedTrainIds && !affectedTrainIds.has(train.id)) return;
    train.stops.forEach((stop, stopIndex) => {
      const nextStop = train.stops[stopIndex + 1];
      if (!nextStop) return;
      const section = findSection(network, stop.stationId, nextStop.stationId);
      if (!section) return;
      const departure = Math.min(stop.departure, nextStop.arrival);
      const arrival = Math.max(stop.departure, nextStop.arrival);
      // 局部重算时外层只遍历受影响列车，对端仍取全部同方向列车，
      // 保证“受影响 × 未受影响”的组合也被重新检查。
      const peers = network.trains.filter(
        (candidate) => candidate.id !== train.id && candidate.direction === train.direction,
      );
      peers.forEach((peer) => {
        const peerStart = peer.stops.find((item) => item.stationId === stop.stationId);
        const peerEnd = peer.stops.find((item) => item.stationId === nextStop.stationId);
        if (!peerStart || !peerEnd) return;
        const peerStopsInOrder =
          peer.stops.findIndex((item) => item.stationId === stop.stationId) <
          peer.stops.findIndex((item) => item.stationId === nextStop.stationId);
        if (!peerStopsInOrder) return;
        const pairKey = unorderedPairKey(train.id, peer.id);
        const peerDeparture = Math.min(peerStart.departure, peerEnd.arrival);
        const peerArrival = Math.max(peerStart.departure, peerEnd.arrival);
        const gap = Math.abs(peerDeparture - departure);
        if (gap < section.minHeadwayMin) {
          conflicts.push({
            id: `headway:${section.id}:${pairKey}`,
            type: 'headway',
            severity: gap < section.minHeadwayMin * 0.55 ? 'danger' : 'warning',
            title: `${sectionLabel(section, stationMap)} 追踪间隔不足`,
            detail: `${train.number} 与 ${peer.number} 在${sectionLabel(section, stationMap)}区间发车相差 ${gap.toFixed(1)} 分，要求不少于 ${section.minHeadwayMin} 分。`,
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
            id: `overtake:${section.id}:${pairKey}`,
            type: 'overtake',
            severity: 'warning',
            title: `${train.number} 将在区间追及 ${peer.number}`,
            detail: `${train.category}列车在${sectionLabel(section, stationMap)}区间形成越行风险，建议在前方站安排会让或调整发车时刻。`,
            trainIds: [train.id, peer.id],
            sectionId: section.id,
            timeRange: { start: departure, end: arrival },
            suggestedShift: { start: 2, end: 12 },
          });
        }
      });
    });
  });

  return conflicts;
}

/** 到发线（车站股道）占用冲突。局部重算时只重建受影响列车占用过的股道。 */
function generateTrackConflicts(ctx: GeneratorContext, affectedTrainIds?: Set<string>): TimetableConflict[] {
  const { network, stationMap } = ctx;
  const affectedTrackKeys = new Set<string>();
  if (affectedTrainIds) {
    network.trains
      .filter((train) => affectedTrainIds.has(train.id))
      .forEach((train) =>
        train.stops.forEach((stop) => affectedTrackKeys.add(`${stop.stationId}:${stop.trackId}`)),
      );
  }

  const occupancy = new Map<string, Array<{ train: Train; stop: TrainStop }>>();
  network.trains.forEach((train) => {
    train.stops.forEach((stop) => {
      const key = `${stop.stationId}:${stop.trackId}`;
      if (affectedTrainIds && !affectedTrackKeys.has(key)) return;
      const bucket = occupancy.get(key) ?? [];
      bucket.push({ train, stop });
      occupancy.set(key, bucket);
    });
  });

  const conflicts: TimetableConflict[] = [];
  occupancy.forEach((occupants, key) => {
    occupants.sort((a, b) => a.stop.arrival - b.stop.arrival);
    for (let index = 1; index < occupants.length; index += 1) {
      const previous = occupants[index - 1];
      const current = occupants[index];
      // 局部重算时，同股道上两辆“都未变动”的列车的记录不在失效范围内，跳过
      if (
        affectedTrainIds &&
        !affectedTrainIds.has(previous.train.id) &&
        !affectedTrainIds.has(current.train.id)
      ) {
        continue;
      }
      const gap = current.stop.arrival - previous.stop.departure;
      if (gap >= 2) continue;
      const [stationId, trackId] = key.split(':');
      const station = stationMap.get(stationId);
      const track = station?.tracks.find((candidate) => candidate.id === trackId);
      conflicts.push({
        id: `track:${stationId}:${trackId}:${unorderedPairKey(previous.train.id, current.train.id)}`,
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
  });
  return conflicts;
}

const FREE_RUNNING_KMH: Record<Train['category'], number> = {
  高铁: 310,
  动车: 250,
  普速: 140,
  货运: 90,
};

/**
 * 施工限速对运行线的影响：列车在生效计划时段内按对应方向进入该区间时，
 * 若实际旅行速度高于限速，说明排点未考虑限速。
 */
function generateConstructionConflicts(ctx: GeneratorContext, affectedTrainIds?: Set<string>): TimetableConflict[] {
  const { network, stationMap, activePlans } = ctx;
  const conflicts: TimetableConflict[] = [];

  network.trains.forEach((train) => {
    if (affectedTrainIds && !affectedTrainIds.has(train.id)) return;
    train.stops.forEach((stop, stopIndex) => {
      const nextStop = train.stops[stopIndex + 1];
      if (!nextStop) return;
      const section = findSection(network, stop.stationId, nextStop.stationId);
      if (!section) return;
      const plans = activePlans.get(`${section.id}:${train.direction}`) ?? [];
      const departure = Math.min(stop.departure, nextStop.arrival);
      const arrival = Math.max(stop.departure, nextStop.arrival);
      plans.forEach((plan) => {
        if (!rangesOverlap(departure, arrival, plan.start, plan.end)) return;
        const runningMinutes = Math.max(0.5, arrival - departure);
        const runningSpeed = (section.distanceKm / runningMinutes) * 60;
        const usedLimit = runningSpeed <= plan.speedLimitKmh * USED_LIMIT_RATIO;
        const expectedMinutes = (section.distanceKm / plan.speedLimitKmh) * 60;
        const extraMinutes = Math.max(1, Math.round(runningMinutes - expectedMinutes));
        const label = sectionLabel(section, stationMap);
        const timeWindow = `${formatClock(plan.start)}–${formatClock(plan.end)}`;
        conflicts.push({
          id: `construction:${plan.id}:${train.id}`,
          type: 'construction',
          severity: usedLimit ? 'warning' : 'danger',
          title: `${train.number} 受 ${label} 施工限速影响`,
          detail: usedLimit
            ? `${label}${directionLabel(train.direction)}线 ${timeWindow} 限速 ${plan.speedLimitKmh} km/h，${train.number} 当前按限速排点，请关注计划取消或延后时的恢复条件。${plan.note ? `（${plan.note}）` : ''}`
            : `${label}${directionLabel(train.direction)}线 ${timeWindow} 施工限速 ${plan.speedLimitKmh} km/h，${train.number} 该区间实际旅行速度约 ${Math.round(runningSpeed)} km/h，超出限速，须至少增加 ${extraMinutes} 分钟运行时分。${plan.note ? `（${plan.note}）` : ''}`,
          trainIds: [train.id],
          sectionId: section.id,
          planId: plan.id,
          timeRange: { start: Math.max(departure, plan.start), end: Math.min(arrival, plan.end) },
          suggestedShift: { start: extraMinutes, end: extraMinutes + 8 },
        });
      });
    });
  });

  return conflicts;
}

/** 容量互斥：排队计划与占用容量的生效计划的冲突。 */
function generatePlanOverlapConflicts(ctx: GeneratorContext): TimetableConflict[] {
  const { network, stationMap } = ctx;
  const statuses = reconcilePlans(network);
  const byId = new Map(statuses.map((status) => [status.plan.id, status]));
  const conflicts: TimetableConflict[] = [];

  statuses
    .filter((status) => !status.active)
    .forEach((status) => {
      const { plan } = status;
      const section = network.sections.find((candidate) => candidate.id === plan.sectionId);
      const label = sectionLabel(section, stationMap);
      status.blockedBy.forEach((holder) => {
        const holderStatus = byId.get(holder.id);
        if (holderStatus && !holderStatus.active) return;
        const overlapStart = Math.max(plan.start, holder.start);
        const overlapEnd = Math.min(plan.end, holder.end);
        conflicts.push({
          id: `plan-overlap:${plan.id}:${holder.id}`,
          type: 'plan-overlap',
          severity: 'warning',
          title: `${label} 施工计划排队等待容量`,
          detail: `计划${plan.note ? `「${plan.note}」` : ''} ${formatClock(plan.start)}–${formatClock(plan.end)} ${directionLabel(plan.direction)}线限速 ${plan.speedLimitKmh} km/h 与已生效计划 ${formatClock(holder.start)}–${formatClock(holder.end)}（限速 ${holder.speedLimitKmh} km/h）在 ${formatClock(overlapStart)}–${formatClock(overlapEnd)} 时段互斥：同一区间同一方向同一时段只有 ${CONSTRUCTION_PLAN_CAPACITY} 份容量。`,
          trainIds: [],
          sectionId: plan.sectionId,
          planId: plan.id,
          // 时间范围取占用容量计划的窗口：无关计划增删时该记录内容保持稳定
          timeRange: { start: holder.start, end: holder.end },
          suggestedShift: { start: Math.max(1, Math.round(holder.end - plan.start)), end: Math.max(10, Math.round(holder.end - plan.start) + 15) },
        });
      });
    });

  return conflicts;
}

// ---------------------------------------------------------------------------
// 缓存与增量重算
// ---------------------------------------------------------------------------

function sortConflicts(conflicts: TimetableConflict[]): TimetableConflict[] {
  return conflicts.slice().sort((a, b) => a.timeRange.start - b.timeRange.start || a.id.localeCompare(b.id));
}

/**
 * 施工/互斥类记录在每次计划变更时都会重算，但其内容可能完全相同。
 * 内容一致时保留旧记录引用，兑现“未受影响的记录照旧保留”。
 */
function isSameConflict(a: TimetableConflict, b: TimetableConflict): boolean {
  return (
    a.type === b.type &&
    a.severity === b.severity &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.sectionId === b.sectionId &&
    a.stationId === b.stationId &&
    a.planId === b.planId &&
    JSON.stringify(a.trainIds) === JSON.stringify(b.trainIds) &&
    a.timeRange.start === b.timeRange.start &&
    a.timeRange.end === b.timeRange.end &&
    a.suggestedShift.start === b.suggestedShift.start &&
    a.suggestedShift.end === b.suggestedShift.end
  );
}

export function buildConflictCache(network: TrainNetwork): ConflictCacheState {
  const ctx = createContext(network);
  const generated = [...generateSectionConflicts(ctx), ...generateTrackConflicts(ctx), ...generateConstructionConflicts(ctx), ...generatePlanOverlapConflicts(ctx)];
  const generatedIds = new Set<string>();
  const byId: ConflictCacheState['byId'] = {};
  const order: string[] = [];
  generated.forEach((conflict) => {
    if (generatedIds.has(conflict.id)) return;
    generatedIds.add(conflict.id);
    byId[conflict.id] = conflict;
    order.push(conflict.id);
  });
  return { byId, order };
}

function upsertConflicts(
  cache: ConflictCacheState,
  generated: TimetableConflict[],
  baseline: ConflictCacheState = cache,
): void {
  const seen = new Set<string>();
  generated.forEach((conflict) => {
    if (seen.has(conflict.id)) return;
    seen.add(conflict.id);
    const existing = baseline.byId[conflict.id];
    cache.byId[conflict.id] = existing && isSameConflict(existing, conflict) ? existing : conflict;
    if (!cache.order.includes(conflict.id)) cache.order.push(conflict.id);
  });
}

/**
 * 运行线变化：失效并重建只涉及这些列车的 headway/track/construction 记录；
 * plan-overlap（计划间互斥）与不相关的记录照旧保留。
 */
export function refreshTrainConflicts(
  cache: ConflictCacheState,
  network: TrainNetwork,
  affectedTrainIds: Set<string>,
): ConflictCacheState {
  const invalidated = new Set<string>();
  cache.order.forEach((id) => {
    const conflict = cache.byId[id];
    if (!conflict) return;
    if (conflict.type === 'plan-overlap') return;
    if (conflict.trainIds.some((trainId) => affectedTrainIds.has(trainId))) {
      invalidated.add(id);
    }
  });

  const next: ConflictCacheState = { byId: { ...cache.byId }, order: cache.order.filter((id) => !invalidated.has(id)) };
  invalidated.forEach((id) => delete next.byId[id]);

  if (affectedTrainIds.size > 0) {
    const ctx = createContext(network);
    upsertConflicts(
      next,
      [
        ...generateSectionConflicts(ctx, affectedTrainIds),
        ...generateTrackConflicts(ctx, affectedTrainIds),
        ...generateConstructionConflicts(ctx, affectedTrainIds),
      ],
      cache,
    );
  }
  return next;
}

/**
 * 施工计划变化：计划间互斥、计划—运行线记录整体重建；
 * 运行线之间的 headway/track/overtake 记录完全不受影响、原样保留。
 * 重算后内容未变的记录保留旧引用（由 upsertConflicts 对照旧缓存做内容比对）。
 */
export function refreshPlanConflicts(cache: ConflictCacheState, network: TrainNetwork): ConflictCacheState {
  const next: ConflictCacheState = { byId: {}, order: [] };

  // 非计划衍生记录原样保留（含引用与排序位置）
  cache.order.forEach((id) => {
    const conflict = cache.byId[id];
    if (!conflict) return;
    if (conflict.type === 'construction' || conflict.type === 'plan-overlap') return;
    next.byId[id] = conflict;
    next.order.push(id);
  });

  // 计划衍生记录重新生成；已消失的记录不写入，内容相同的复用旧对象
  const ctx = createContext(network);
  upsertConflicts(
    next,
    [...generateConstructionConflicts(ctx), ...generatePlanOverlapConflicts(ctx)],
    cache,
  );
  return next;
}

/**
 * 输出冲突列表（缓存本身保持完整）。
 * 施工限速与计划互斥记录全部保留（不能因数量上限把关键的放车依据截掉），
 * 列车间记录按时序截取余量；order 不重排，未受影响记录位置稳定。
 */
export function orderedConflicts(cache: ConflictCacheState): TimetableConflict[] {
  const present = cache.order.filter((id) => cache.byId[id]).map((id) => cache.byId[id]);
  const safetyCritical = present.filter(
    (conflict) => conflict.type === 'construction' || conflict.type === 'plan-overlap',
  );
  const trainConflicts = sortConflicts(present.filter((conflict) => conflict.type !== 'construction' && conflict.type !== 'plan-overlap'));
  const remainingSlots = Math.max(0, MAX_CONFLICTS - safetyCritical.length);
  return [...sortConflicts(safetyCritical), ...trainConflicts.slice(0, remainingSlots)];
}

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
