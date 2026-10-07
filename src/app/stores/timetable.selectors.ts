import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TimetableState } from '../types/timetable';
import { orderedConflicts, PlanStatus, reconcilePlans } from '../utils/conflict-engine';
import { filterTrains } from '../utils/timetable-utils';

export const selectTimetableState = createFeatureSelector<TimetableState>('timetable');

export const selectNetwork = createSelector(selectTimetableState, (state) => state.network);
export const selectFilter = createSelector(selectTimetableState, (state) => state.filter);
export const selectViewport = createSelector(selectTimetableState, (state) => state.viewport);
export const selectSelectedTrainId = createSelector(selectTimetableState, (state) => state.selectedTrainId);
export const selectBatchSelection = createSelector(selectTimetableState, (state) => state.batchSelection);
export const selectPrintSectionId = createSelector(selectTimetableState, (state) => state.printSectionId);
export const selectNotices = createSelector(selectTimetableState, (state) => state.notices);

export const selectVisibleTrains = createSelector(
  selectNetwork,
  selectFilter,
  (network, filter) => filterTrains(network, filter.query, filter.categories, filter.direction),
);

export const selectSelectedTrain = createSelector(
  selectNetwork,
  selectSelectedTrainId,
  (network, trainId) => network.trains.find((train) => train.id === trainId) ?? null,
);

/** 施工计划容量状态：哪些生效、哪些排队以及互斥原因 */
export const selectPlanStatuses = createSelector(selectNetwork, (network): PlanStatus[] =>
  reconcilePlans(network),
);

export const selectQueuedPlanStatuses = createSelector(selectPlanStatuses, (statuses) =>
  statuses.filter((status) => !status.active),
);

/** 全部冲突记录（缓存增量维护），按当前可见运行线过滤；计划互斥记录无列车、始终保留 */
export const selectConflicts = createSelector(
  selectTimetableState,
  selectVisibleTrains,
  (state, visible) => {
    const visibleIds = new Set(visible.map((train) => train.id));
    return orderedConflicts(state.conflictCache).filter(
      (conflict) =>
        conflict.trainIds.length === 0 || conflict.trainIds.some((trainId) => visibleIds.has(trainId)),
    );
  },
);

export const selectConflictSummary = createSelector(selectConflicts, (conflicts) => ({
  total: conflicts.length,
  danger: conflicts.filter((conflict) => conflict.severity === 'danger').length,
  warning: conflicts.filter((conflict) => conflict.severity === 'warning').length,
  headway: conflicts.filter((conflict) => conflict.type === 'headway').length,
  track: conflicts.filter((conflict) => conflict.type === 'track').length,
  overtake: conflicts.filter((conflict) => conflict.type === 'overtake').length,
  construction: conflicts.filter((conflict) => conflict.type === 'construction').length,
  planQueue: conflicts.filter((conflict) => conflict.type === 'plan-overlap').length,
}));

export const selectSelectedConflicts = createSelector(
  selectConflicts,
  selectSelectedTrainId,
  (conflicts, trainId) => trainId
    ? conflicts.filter((conflict) => conflict.trainIds.includes(trainId)).slice(0, 60)
    : conflicts.slice(0, 60),
);
