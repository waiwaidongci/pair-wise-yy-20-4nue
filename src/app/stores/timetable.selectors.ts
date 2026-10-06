import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TimetableState } from '../types/timetable';
import { computeConflicts, filterTrains } from '../utils/timetable-utils';

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

export const selectConflicts = createSelector(selectNetwork, selectVisibleTrains, (network, visible) =>
  computeConflicts(network, new Set(visible.map((train) => train.id))),
);

export const selectConflictSummary = createSelector(selectConflicts, (conflicts) => ({
  total: conflicts.length,
  danger: conflicts.filter((conflict) => conflict.severity === 'danger').length,
  warning: conflicts.filter((conflict) => conflict.severity === 'warning').length,
  headway: conflicts.filter((conflict) => conflict.type === 'headway').length,
  track: conflicts.filter((conflict) => conflict.type === 'track').length,
  overtake: conflicts.filter((conflict) => conflict.type === 'overtake').length,
}));

export const selectSelectedConflicts = createSelector(
  selectConflicts,
  selectSelectedTrainId,
  (conflicts, trainId) => trainId
    ? conflicts.filter((conflict) => conflict.trainIds.includes(trainId)).slice(0, 60)
    : conflicts.slice(0, 60),
);
