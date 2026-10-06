import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectConflictSummary, selectNetwork } from './stores/timetable.selectors';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet, RouterLink, RouterLinkActive, ButtonModule],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <span class="brand__mark"><i class="pi pi-compass"></i></span>
          <div>
            <strong>铁路调度运行图</strong>
            <small>{{ (network$ | async)?.lineName }}</small>
          </div>
        </div>
        <nav aria-label="主导航">
          <a routerLink="/editor" routerLinkActive="active">运行图编辑</a>
          <a routerLink="/analysis" routerLinkActive="active">冲突分析</a>
        </nav>
        <div class="header-status">
          <span class="status-dot" [class.status-dot--danger]="(summary$ | async)?.danger"></span>
          <span>安全监控</span>
          <strong>{{ (summary$ | async)?.danger || 0 }} 项严重</strong>
        </div>
      </header>
      <main><router-outlet></router-outlet></main>
    </div>
  `,
})
export class AppComponent {
  private readonly store = inject(Store);
  readonly network$ = this.store.select(selectNetwork);
  readonly summary$ = this.store.select(selectConflictSummary);
}
