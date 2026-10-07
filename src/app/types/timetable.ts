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

export interface TrainNetwork {
  lineName: string;
  stations: Station[];
  sections: RailSection[];
  trains: Train[];
  plans: ConstructionPlan[];
}

export type ConflictType = 'headway' | 'track' | 'overtake' | 'construction';
export type ConflictSeverity = 'danger' | 'warning';

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * 区间施工计划。登记区间、方向、起止时刻与限速值。
 * 同一区间同一方向同一时段只容纳一份计划，超出的计划排队并记录互斥原因。
 */
export interface ConstructionPlan {
  id: string;
  sectionId: string;
  direction: TrainDirection;
  /** 施工开始时刻（分钟，自 0 点起） */
  startTime: number;
  /** 施工结束时刻（分钟，自 0 点起） */
  endTime: number;
  /** 限速值 km/h */
  speedLimitKmh: number;
  /** 施工原因/备注 */
  reason?: string;
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
  planId?: string;
  /** 与施工计划冲突相关的另一计划（用于区间容量互斥） */
  relatedPlanIds?: string[];
  timeRange: TimeRange;
  suggestedShift: TimeRange;
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
  conflicts: TimetableConflict[];
}

export interface ImportedNetworkFile {
  lineName?: string;
  stations?: Station[];
  sections?: RailSection[];
  trains?: Train[];
  plans?: ConstructionPlan[];
}
