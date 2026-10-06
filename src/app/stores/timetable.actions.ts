import { createAction, props } from '@ngrx/store';
import {
  TimetableFilter,
  TrainNetwork,
  TrainStop,
  ViewportState,
} from '../types/timetable';

export const selectTrain = createAction('[Timetable] Select train', props<{ trainId: string | null }>());
export const toggleBatchTrain = createAction('[Timetable] Toggle batch train', props<{ trainId: string }>());
export const clearBatchSelection = createAction('[Timetable] Clear batch selection');
export const updateFilter = createAction('[Timetable] Update filter', props<{ filter: Partial<TimetableFilter> }>());
export const updateViewport = createAction('[Timetable] Update viewport', props<{ viewport: Partial<ViewportState> }>());
export const resetViewport = createAction('[Timetable] Reset viewport');
export const moveTrain = createAction('[Timetable] Move train', props<{ trainId: string; deltaMinutes: number }>());
export const batchShift = createAction('[Timetable] Batch shift', props<{ deltaMinutes: number }>());
export const updateTrainStop = createAction(
  '[Timetable] Update train stop',
  props<{ trainId: string; stationId: string; changes: Partial<TrainStop> }>(),
);
export const setPrintSection = createAction('[Timetable] Set print section', props<{ sectionId: string | null }>());
export const importNetwork = createAction('[Timetable] Import network', props<{ network: TrainNetwork }>());
export const addNotice = createAction('[Timetable] Add notice', props<{ message: string }>());
export const dismissNotice = createAction('[Timetable] Dismiss notice', props<{ index: number }>());
export const restorePersistedState = createAction(
  '[Timetable] Restore persisted state',
  props<{ state: Partial<Pick<TimetableStatePayload, 'filter' | 'viewport'>> }>(),
);

interface TimetableStatePayload {
  filter: TimetableFilter;
  viewport: ViewportState;
}
