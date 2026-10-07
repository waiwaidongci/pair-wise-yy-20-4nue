import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TimetableConflict } from '../types/timetable';
import { formatTime } from '../utils/time';

@Component({
  selector: 'app-conflict-panel',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel conflicts">
      <header class="panel__header">
        <div>
          <span class="eyebrow">安全校验</span>
          <h2>冲突与调整建议</h2>
        </div>
        <p-tag [value]="conflicts.length + ' 项'" [severity]="conflicts.length ? 'danger' : 'success'"></p-tag>
      </header>
      <div class="conflict-scroll" *ngIf="conflicts.length; else clearState">
        <article
          class="conflict-card"
          *ngFor="let conflict of conflicts"
          [class.conflict-card--danger]="conflict.severity === 'danger'"
          (click)="conflictSelected.emit(conflict)"
        >
          <div class="conflict-card__top">
            <span class="conflict-kind">
              <i
                class="pi"
                [class.pi-exclamation-triangle]="conflict.severity === 'danger'"
                [class.pi-info-circle]="conflict.severity !== 'danger'"
              ></i>
              {{ typeLabel(conflict) }}
            </span>
            <span>{{ formatTime(conflict.timeRange.start) }}</span>
          </div>
          <strong>{{ conflict.title }}</strong>
          <p>{{ conflict.detail }}</p>
          <div class="conflict-meta" *ngIf="conflict.planId">
            <i class="pi pi-calendar-times"></i>
            <span>施工计划 {{ conflict.planId }}</span>
          </div>
          <div class="suggestion">
            <span>建议调整</span>
            <strong>
              {{ conflict.suggestedShift.start }}–{{ conflict.suggestedShift.end }} 分钟
            </strong>
          </div>
        </article>
      </div>
      <ng-template #clearState>
        <div class="clear-state">
          <i class="pi pi-check-circle"></i>
          <strong>当前筛选范围无冲突</strong>
          <p>区间追踪间隔、到发线占用与越行条件均已满足。</p>
        </div>
      </ng-template>
    </section>
  `,
  styles: [
    `
      .conflicts {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 14px 11px;
        border-bottom: 1px solid #e5e9ef;
      }

      .eyebrow {
        color: #738094;
        font-size: 11px;
      }

      h2 {
        margin: 3px 0 0;
        color: #18324a;
        font-size: 15px;
      }

      .conflict-scroll {
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        gap: 8px;
        overflow: auto;
        padding: 10px;
      }

      .conflict-card {
        padding: 10px;
        border: 1px solid #f0c36d;
        border-left: 3px solid #d97706;
        border-radius: 5px;
        background: #fffdf7;
        cursor: pointer;
      }

      .conflict-card:hover {
        box-shadow: 0 4px 12px rgba(33, 48, 71, 0.08);
      }

      .conflict-card--danger {
        border-color: #f2b8b5;
        border-left-color: #c92734;
        background: #fffafa;
      }

      .conflict-card__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #7b8797;
        font-size: 10px;
      }

      .conflict-kind {
        display: inline-flex;
        gap: 5px;
        align-items: center;
        color: #8a4b08;
        font-weight: 700;
      }

      .conflict-card--danger .conflict-kind {
        color: #b42318;
      }

      .conflict-card > strong {
        display: block;
        margin-top: 7px;
        color: #283d52;
        font-size: 12px;
      }

      .conflict-card p {
        margin: 5px 0 8px;
        color: #67758a;
        font-size: 11px;
        line-height: 1.55;
      }

      .conflict-meta {
        display: flex;
        gap: 5px;
        align-items: center;
        margin-bottom: 8px;
        color: #8a4b08;
        font-size: 10px;
      }

      .suggestion {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 7px;
        border-top: 1px dashed #e6d6b4;
        color: #66758a;
        font-size: 10px;
      }

      .suggestion strong {
        color: #194f7a;
      }

      .clear-state {
        display: grid;
        flex: 1;
        place-items: center;
        align-content: center;
        padding: 24px;
        text-align: center;
      }

      .clear-state i {
        color: #138a63;
        font-size: 28px;
      }

      .clear-state strong {
        margin-top: 10px;
        color: #2a4c45;
        font-size: 13px;
      }

      .clear-state p {
        margin: 6px 0 0;
        color: #77858f;
        font-size: 11px;
        line-height: 1.6;
      }
    `,
  ],
})
export class ConflictPanelComponent {
  @Input() conflicts: TimetableConflict[] = [];
  @Output() conflictSelected = new EventEmitter<TimetableConflict>();

  typeLabel(conflict: TimetableConflict): string {
    if (conflict.type === 'headway') return '区间追踪';
    if (conflict.type === 'track') return '到发线占用';
    if (conflict.type === 'overtake') return '越行风险';
    return '施工影响';
  }

  formatTime(value: number): string {
    return formatTime(value);
  }
}
