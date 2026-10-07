import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { addPlan, removePlan, updatePlan } from '../stores/timetable.actions';
import { selectNetwork, selectPlans, selectQueuedPlanIds } from '../stores/timetable.selectors';
import { ConstructionPlan, TrainDirection } from '../types/timetable';
import { formatTime, minutesFromClock } from '../utils/time';

interface PlanFormModel {
  id: string | null;
  sectionId: string;
  direction: TrainDirection;
  startTime: string;
  endTime: string;
  speedLimitKmh: number;
  reason: string;
}

@Component({
  selector: 'app-construction-plan-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="区间施工计划"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '860px' }"
      [draggable]="false"
      (onHide)="hide()"
    >
      <div class="plan-dialog">
        <section class="plan-form">
          <h3>{{ form.id ? '编辑施工计划' : '新增施工计划' }}</h3>
          <div class="plan-form__grid">
            <label>
              <span>区间</span>
              <p-select
                [options]="(sections$ | async) ?? []"
                [(ngModel)]="form.sectionId"
                optionLabel="id"
                optionValue="id"
                placeholder="选择区间"
                size="small"
              ></p-select>
            </label>
            <label>
              <span>方向</span>
              <p-select
                [options]="directionOptions"
                [(ngModel)]="form.direction"
                optionLabel="label"
                optionValue="value"
                size="small"
              ></p-select>
            </label>
            <label>
              <span>开始时刻</span>
              <input type="time" [(ngModel)]="form.startTime" />
            </label>
            <label>
              <span>结束时刻</span>
              <input type="time" [(ngModel)]="form.endTime" />
            </label>
            <label>
              <span>限速 (km/h)</span>
              <p-inputNumber
                [(ngModel)]="form.speedLimitKmh"
                [min]="5"
                [max]="350"
                [step]="5"
                size="small"
              ></p-inputNumber>
            </label>
            <label>
              <span>施工原因</span>
              <input type="text" pInputText [(ngModel)]="form.reason" placeholder="可选" />
            </label>
          </div>
          <div class="plan-form__actions">
            <p-button
              [label]="form.id ? '保存修改' : '添加计划'"
              size="small"
              [disabled]="!canSubmit()"
              (onClick)="submit()"
            ></p-button>
            <p-button
              *ngIf="form.id"
              label="取消编辑"
              severity="secondary"
              size="small"
              (onClick)="resetForm()"
            ></p-button>
          </div>
          <p class="plan-form__hint">
            同一区间同一方向同一时段仅容纳一份计划，超出的计划将排队并列出互斥原因。
          </p>
        </section>

        <section class="plan-list">
          <h3>已登记计划（{{ (plans$ | async)?.length ?? 0 }}）</h3>
          <p-table [value]="(plans$ | async) ?? []" dataKey="id" styleClass="plan-table">
            <ng-template pTemplate="header">
              <tr>
                <th>编号</th>
                <th>区间</th>
                <th>方向</th>
                <th>起止时刻</th>
                <th>限速</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-plan>
              <tr>
                <td>{{ plan.id }}</td>
                <td>{{ sectionLabel(plan.sectionId) }}</td>
                <td>{{ plan.direction === 'up' ? '上行' : '下行' }}</td>
                <td>{{ formatTime(plan.startTime) }}–{{ formatTime(plan.endTime) }}</td>
                <td>{{ plan.speedLimitKmh }} km/h</td>
                <td>
                  <p-tag
                    [value]="isQueued(plan.id) ? '排队' : '生效'"
                    [severity]="isQueued(plan.id) ? 'warn' : 'success'"
                  ></p-tag>
                </td>
                <td class="plan-row-actions">
                  <p-button icon="pi pi-pencil" [text]="true" size="small" (onClick)="edit(plan)"></p-button>
                  <p-button
                    icon="pi pi-trash"
                    [text]="true"
                    size="small"
                    severity="danger"
                    (onClick)="remove(plan.id)"
                  ></p-button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7">暂无施工计划。</td>
              </tr>
            </ng-template>
          </p-table>
        </section>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .plan-dialog {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .plan-form h3,
      .plan-list h3 {
        margin: 0 0 10px;
        color: #17324d;
        font-size: 14px;
      }

      .plan-form__grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
      }

      .plan-form__grid label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: #667386;
        font-size: 11px;
      }

      .plan-form__grid input[type='time'],
      .plan-form__grid input[type='text'] {
        padding: 6px 8px;
        border: 1px solid #d0d7e0;
        border-radius: 4px;
        font-size: 12px;
      }

      .plan-form__actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      .plan-form__hint {
        margin: 10px 0 0;
        color: #8a96a4;
        font-size: 11px;
        line-height: 1.6;
      }

      .plan-table {
        border: 1px solid #e1e6ed;
        border-radius: 6px;
      }

      .plan-row-actions {
        white-space: nowrap;
      }
    `,
  ],
})
export class ConstructionPlanDialogComponent {
  private readonly store = inject(Store);
  visible = false;

  readonly sections$ = this.store.select(selectNetwork).pipe(map((network) => network.sections));
  readonly stations$ = this.store.select(selectNetwork).pipe(map((network) => network.stations));
  readonly plans$ = this.store.select(selectPlans);
  readonly queuedIds$ = this.store.select(selectQueuedPlanIds);

  readonly directionOptions = [
    { label: '上行', value: 'up' as TrainDirection },
    { label: '下行', value: 'down' as TrainDirection },
  ];

  form: PlanFormModel = this.emptyForm();

  private queuedIds = new Set<string>();
  private stations: Array<{ id: string; name: string }> = [];
  private sections: Array<{ id: string; fromStationId: string; toStationId: string }> = [];

  constructor() {
    this.queuedIds$.subscribe((ids) => (this.queuedIds = ids));
    this.stations$.subscribe((stations) => (this.stations = stations));
    this.sections$.subscribe((sections) => (this.sections = sections));
  }

  open(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.resetForm();
  }

  isQueued(planId: string): boolean {
    return this.queuedIds.has(planId);
  }

  sectionLabel(sectionId: string): string {
    const section = this.sections.find((item) => item.id === sectionId);
    if (!section) return sectionId;
    const from = this.stations.find((item) => item.id === section.fromStationId);
    const to = this.stations.find((item) => item.id === section.toStationId);
    return `${from?.name ?? ''}—${to?.name ?? ''}`;
  }

  edit(plan: ConstructionPlan): void {
    this.form = {
      id: plan.id,
      sectionId: plan.sectionId,
      direction: plan.direction,
      startTime: this.toClock(plan.startTime),
      endTime: this.toClock(plan.endTime),
      speedLimitKmh: plan.speedLimitKmh,
      reason: plan.reason ?? '',
    };
  }

  remove(planId: string): void {
    this.store.dispatch(removePlan({ planId }));
    if (this.form.id === planId) this.resetForm();
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const plan: ConstructionPlan = {
      id: this.form.id ?? `PLAN-${Date.now()}`,
      sectionId: this.form.sectionId,
      direction: this.form.direction,
      startTime: minutesFromClock(this.form.startTime),
      endTime: minutesFromClock(this.form.endTime),
      speedLimitKmh: this.form.speedLimitKmh,
      reason: this.form.reason.trim() || undefined,
    };
    if (this.form.id) {
      this.store.dispatch(updatePlan({ plan }));
    } else {
      this.store.dispatch(addPlan({ plan }));
    }
    this.resetForm();
  }

  canSubmit(): boolean {
    return (
      !!this.form.sectionId &&
      !!this.form.startTime &&
      !!this.form.endTime &&
      this.form.speedLimitKmh > 0 &&
      minutesFromClock(this.form.endTime) > minutesFromClock(this.form.startTime)
    );
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  private emptyForm(): PlanFormModel {
    return {
      id: null,
      sectionId: '',
      direction: 'up',
      startTime: '08:00',
      endTime: '10:00',
      speedLimitKmh: 80,
      reason: '',
    };
  }

  resetForm(): void {
    this.form = this.emptyForm();
  }

  private toClock(minutes: number): string {
    const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
}
