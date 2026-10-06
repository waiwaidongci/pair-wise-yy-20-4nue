import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../pages/timetable-editor.page').then((module) => module.TimetableEditorPageComponent),
  },
  {
    path: 'editor',
    loadComponent: () =>
      import('../pages/timetable-editor.page').then((module) => module.TimetableEditorPageComponent),
  },
  {
    path: 'analysis',
    loadComponent: () =>
      import('../pages/conflict-analysis.page').then((module) => module.ConflictAnalysisPageComponent),
  },
  { path: '**', redirectTo: '' },
];
