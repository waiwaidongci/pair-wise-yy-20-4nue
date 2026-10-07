import { createReducer, on } from '@ngrx/store';
import {
  TimetableState,
  ViewportState,
} from '../types/timetable';
import {
  addConstructionPlan,
  addNotice,
  batchShift,
  clearBatchSelection,
  dismissNotice,
  importNetwork,
  moveTrain,
  removeConstructionPlan,
  resetViewport,
  restorePersistedState,
  selectTrain,
  setPrintSection,
  toggleBatchTrain,
  updateConstructionPlan,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import { createMockNetwork, shiftTrain, updateStop } from '../utils/timetable-utils';
import {
  buildConflictCache,
  refreshPlanConflicts,
  refreshTrainConflicts,
} from '../utils/conflict-engine';

const INITIAL_VIEWPORT: ViewportState = {
  scaleX: 1.25,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

const INITIAL_NETWORK = createMockNetwork();

export const initialState: TimetableState = {
  network: INITIAL_NETWORK,
  filter: {
    query: '',
    categories: [],
    direction: 'all',
  },
  viewport: INITIAL_VIEWPORT,
  selectedTrainId: 'T1',
  batchSelection: [],
  printSectionId: null,
  notices: [],
  conflictCache: buildConflictCache(INITIAL_NETWORK),
};

function withTrainChange(state: TimetableState, network: TimetableState['network'], trainIds: string[]): TimetableState {
  return {
    ...state,
    network,
    conflictCache: refreshTrainConflicts(state.conflictCache, network, new Set(trainIds)),
  };
}

function withPlanChange(state: TimetableState, network: TimetableState['network']): TimetableState {
  return {
    ...state,
    network,
    conflictCache: refreshPlanConflicts(state.conflictCache, network),
  };
}

export const timetableReducer = createReducer(
  initialState,
  on(selectTrain, (state, { trainId }) => ({
    ...state,
    selectedTrainId: trainId,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) => ({ ...train, selected: train.id === trainId })),
    },
  })),
  on(toggleBatchTrain, (state, { trainId }) => ({
    ...state,
    batchSelection: state.batchSelection.includes(trainId)
      ? state.batchSelection.filter((id) => id !== trainId)
      : [...state.batchSelection, trainId],
  })),
  on(clearBatchSelection, (state) => ({ ...state, batchSelection: [] })),
  on(updateFilter, (state, { filter }) => ({
    ...state,
    filter: { ...state.filter, ...filter },
  })),
  on(updateViewport, (state, { viewport }) => ({
    ...state,
    viewport: { ...state.viewport, ...viewport },
  })),
  on(resetViewport, (state) => ({ ...state, viewport: INITIAL_VIEWPORT })),
  on(moveTrain, (state, { trainId, deltaMinutes }) => {
    const network = {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? shiftTrain(train, deltaMinutes) : train,
      ),
    };
    return withTrainChange(state, network, [trainId]);
  }),
  on(batchShift, (state, { deltaMinutes }) => {
    const ids = state.batchSelection.length > 0
      ? new Set(state.batchSelection)
      : new Set(state.selectedTrainId ? [state.selectedTrainId] : []);
    const network = {
      ...state.network,
      trains: state.network.trains.map((train) =>
        ids.has(train.id) ? shiftTrain(train, deltaMinutes) : train,
      ),
    };
    return withTrainChange(state, network, [...ids]);
  }),
  on(updateTrainStop, (state, { trainId, stationId, changes }) => {
    const network = {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? updateStop(train, stationId, changes) : train,
      ),
    };
    return withTrainChange(state, network, [trainId]);
  }),
  on(addConstructionPlan, (state, { plan }) =>
    withPlanChange(state, {
      ...state.network,
      constructionPlans: [...state.network.constructionPlans, plan],
    }),
  ),
  on(updateConstructionPlan, (state, { planId, changes }) =>
    withPlanChange(state, {
      ...state.network,
      constructionPlans: state.network.constructionPlans.map((plan) =>
        plan.id === planId ? { ...plan, ...changes } : plan,
      ),
    }),
  ),
  on(removeConstructionPlan, (state, { planId }) =>
    withPlanChange(state, {
      ...state.network,
      constructionPlans: state.network.constructionPlans.filter((plan) => plan.id !== planId),
    }),
  ),
  on(setPrintSection, (state, { sectionId }) => ({ ...state, printSectionId: sectionId })),
  on(importNetwork, (state, { network }) => ({
    ...state,
    network,
    conflictCache: buildConflictCache(network),
    selectedTrainId: network.trains[0]?.id ?? null,
    batchSelection: [],
    viewport: INITIAL_VIEWPORT,
    notices: [
      ...state.notices,
      `已导入 ${network.trains.length} 趟列车、${network.stations.length} 个车站、${network.constructionPlans.length} 份施工计划`,
    ],
  })),
  on(addNotice, (state, { message }) => ({ ...state, notices: [...state.notices, message] })),
  on(dismissNotice, (state, { index }) => ({
    ...state,
    notices: state.notices.filter((_, noticeIndex) => noticeIndex !== index),
  })),
  on(restorePersistedState, (state, { state: persisted }) => ({
    ...state,
    filter: persisted.filter ? { ...state.filter, ...persisted.filter } : state.filter,
    viewport: persisted.viewport ? { ...state.viewport, ...persisted.viewport } : state.viewport,
  })),
);
