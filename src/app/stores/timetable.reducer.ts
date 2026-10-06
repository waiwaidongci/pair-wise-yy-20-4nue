import { createReducer, on } from '@ngrx/store';
import {
  TimetableState,
  ViewportState,
} from '../types/timetable';
import {
  addNotice,
  batchShift,
  clearBatchSelection,
  dismissNotice,
  importNetwork,
  moveTrain,
  resetViewport,
  restorePersistedState,
  selectTrain,
  setPrintSection,
  toggleBatchTrain,
  updateFilter,
  updateTrainStop,
  updateViewport,
} from './timetable.actions';
import { createMockNetwork, shiftTrain, updateStop } from '../utils/timetable-utils';

const INITIAL_VIEWPORT: ViewportState = {
  scaleX: 1.25,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

export const initialState: TimetableState = {
  network: createMockNetwork(),
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
};

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
  on(moveTrain, (state, { trainId, deltaMinutes }) => ({
    ...state,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? shiftTrain(train, deltaMinutes) : train,
      ),
    },
  })),
  on(batchShift, (state, { deltaMinutes }) => {
    const ids = state.batchSelection.length > 0
      ? new Set(state.batchSelection)
      : new Set(state.selectedTrainId ? [state.selectedTrainId] : []);
    return {
      ...state,
      network: {
        ...state.network,
        trains: state.network.trains.map((train) =>
          ids.has(train.id) ? shiftTrain(train, deltaMinutes) : train,
        ),
      },
    };
  }),
  on(updateTrainStop, (state, { trainId, stationId, changes }) => ({
    ...state,
    network: {
      ...state.network,
      trains: state.network.trains.map((train) =>
        train.id === trainId ? updateStop(train, stationId, changes) : train,
      ),
    },
  })),
  on(setPrintSection, (state, { sectionId }) => ({ ...state, printSectionId: sectionId })),
  on(importNetwork, (state, { network }) => ({
    ...state,
    network,
    selectedTrainId: network.trains[0]?.id ?? null,
    batchSelection: [],
    viewport: INITIAL_VIEWPORT,
    notices: [...state.notices, `已导入 ${network.trains.length} 趟列车、${network.stations.length} 个车站`],
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
