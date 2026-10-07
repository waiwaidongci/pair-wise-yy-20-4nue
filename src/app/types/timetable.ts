export type TrainDirection = 'up' | 'down';
export type TrainCategory = '高铁' | '动车' | '普速' | '货运';
export type StopKind = 'stop' | 'pass' | 'meet' | 'overtake';

export interface StationTrack {
  id: string;
  name: string;
  main: boolean;
}

export interface Station {
  id: string;
  name: string;
  shortName: string;
  km: number;
  tracks: StationTrack[];
}

export interface RailSection {
  id: string;
  fromStationId: string;
  toStationId: string;
  distanceKm: number;
  minHeadwayMin: number;
  baseRunningMin: number;
}

export interface TrainStop {
  stationId: string;
  kind: StopKind;
  arrival: number;
  departure: number;
  trackId: string;
  meetTrainNumber?: string;
}

export interface Train {
  id: string;
  number: string;
  category: TrainCategory;
  direction: TrainDirection;
  color: string;
  stops: TrainStop[];
  selected: boolean;
}

/**
 * 区间施工（临时限速）计划。
 * start/end 为一天内的分钟数；同一区间同一方向同一时段只允许一份计划生效，
 * 容量冲突的计划保持排队状态（见 construction-utils.reconcilePlans）。
 */
export interface ConstructionPlan {
  id: string;
  sectionId: string;
  direction: TrainDirection;
  start: number;
  end: number;
  speedLimitKmh: number;
  note?: string;
}

export interface TrainNetwork {
  lineName: string;
  stations: Station[];
  sections: RailSection[];
  trains: Train[];
  constructionPlans: ConstructionPlan[];
}

export type ConflictType = 'headway' | 'track' | 'overtake' | 'construction' | 'plan-overlap';
export type ConflictSeverity = 'danger' | 'warning';

export interface TimeRange {
  start: number;
  end: number;
}

export interface TimetableConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  trainIds: string[];
  sectionId?: string;
  stationId?: string;
  /** 施工限速类冲突对应的计划 id */
  planId?: string;
  timeRange: TimeRange;
  suggestedShift: TimeRange;
}

/**
 * 冲突缓存：记录按稳定 id 存放，order 保留既有排列。
 * 运行线或施工计划变化时只重建受影响的记录，其余记录原样保留。
 */
export interface ConflictCacheState {
  byId: Record<string, TimetableConflict>;
  order: string[];
}

export interface ViewportState {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface TimetableFilter {
  query: string;
  categories: TrainCategory[];
  direction: TrainDirection | 'all';
}

export interface TimetableState {
  network: TrainNetwork;
  filter: TimetableFilter;
  viewport: ViewportState;
  selectedTrainId: string | null;
  batchSelection: string[];
  printSectionId: string | null;
  notices: string[];
  conflictCache: ConflictCacheState;
}

export interface ImportedNetworkFile {
  lineName?: string;
  stations?: Station[];
  sections?: RailSection[];
  trains?: Train[];
  /** 旧版本导出数据中缺少该字段，导入时按空计划继续可用 */
  constructionPlans?: ConstructionPlan[];
}
