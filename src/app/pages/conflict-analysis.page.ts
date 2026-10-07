import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { combineLatest, map } from 'rxjs';
import { selectConflicts, selectNetwork } from '../stores/timetable.selectors';
import { ConflictType, TimetableConflict } from '../types/timetable';
import { formatTime } from '../utils/time';

@Component({
  selector: 'app-conflict-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, SelectModule, TableModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="analysis-page" *ngIf="viewModel$ | async as vm">
      <header class="analysis-header">
        <div>
          <span>安全分析中心</span>
          <h1>冲突明细与调整窗口</h1>
          <p>按具体区间、车站和列车列出冲突原因，并给出可执行的时间调整范围。</p>
        </div>
        <div class="analysis-kpis">
          <div><small>严重</small><strong class="danger">{{ vm.danger }}</strong></div>
          <div><small>警告</small><strong class="warning">{{ vm.warning }}</strong></div>
          <div><small>冲突总数</small><strong>{{ vm.conflicts.length }}</strong></div>
        </div>
      </header>

      <div class="analysis-toolbar">
        <p-select
          [options]="typeOptions"
          [(ngModel)]="typeFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="冲突类型"
          size="small"
        ></p-select>
        <span>共 {{ filteredConflicts(vm.conflicts).length }} 条，点击行可定位到列车</span>
        <div class="spacer"></div>
        <p-button icon="pi pi-download" label="导出分析 CSV" size="small" (onClick)="exportCsv(vm.conflicts)"></p-button>
      </div>

      <p-table
        [value]="filteredConflicts(vm.conflicts)"
        [paginator]="true"
        [rows]="12"
        [rowsPerPageOptions]="[12, 24, 50]"
        dataKey="id"
        selectionMode="single"
        (onRowSelect)="selectConflict($event.data)"
        styleClass="analysis-table"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>等级</th>
            <th>类型</th>
            <th>位置</th>
            <th>受影响列车/计划</th>
            <th>冲突说明</th>
            <th>时间范围</th>
            <th>建议平移</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-conflict>
          <tr [pSelectableRow]="conflict">
            <td>
              <p-tag
                [value]="conflict.severity === 'danger' ? '严重' : '警告'"
                [severity]="conflict.severity === 'danger' ? 'danger' : 'warn'"
              ></p-tag>
            </td>
            <td>{{ typeLabel(conflict.type) }}</td>
            <td>
              <strong>{{ location(conflict, vm.network.stations, vm.network.sections) }}</strong>
            </td>
            <td class="related-cell">
              <div *ngFor="let trainId of conflict.trainIds" class="related-train">
                <i class="pi pi-train"></i>
                {{ trainNumber(trainId, vm.network.trains) }}
              </div>
              <div *ngIf="conflict.planId" class="related-plan">
                <i class="pi pi-calendar-times"></i>
                {{ conflict.planId }}
              </div>
              <span *ngIf="!conflict.trainIds.length && !conflict.planId" class="related-none">—</span>
            </td>
            <td class="detail-cell">{{ conflict.detail }}</td>
            <td>{{ formatTime(conflict.timeRange.start) }}–{{ formatTime(conflict.timeRange.end) }}</td>
            <td class="suggest-cell">
              {{ conflict.suggestedShift.start }}–{{ conflict.suggestedShift.end }} 分钟
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7">当前没有冲突记录。</td>
          </tr>
        </ng-template>
      </p-table>
    </section>
  `,
})
export class ConflictAnalysisPageComponent {
  private readonly store = inject(Store);
  readonly typeOptions = [
    { label: '全部类型', value: 'all' },
    { label: '区间追踪', value: 'headway' },
    { label: '到发线占用', value: 'track' },
    { label: '越行风险', value: 'overtake' },
    { label: '施工影响', value: 'construction' },
  ];
  typeFilter: ConflictType | 'all' = 'all';

  readonly viewModel$ = combineLatest({
    conflicts: this.store.select(selectConflicts),
    network: this.store.select(selectNetwork),
  }).pipe(
    map(({ conflicts, network }) => ({
      conflicts,
      network,
      danger: conflicts.filter((conflict) => conflict.severity === 'danger').length,
      warning: conflicts.filter((conflict) => conflict.severity === 'warning').length,
    })),
  );

  filteredConflicts(conflicts: TimetableConflict[]): TimetableConflict[] {
    return this.typeFilter === 'all'
      ? conflicts
      : conflicts.filter((conflict) => conflict.type === this.typeFilter);
  }

  typeLabel(type: ConflictType): string {
    if (type === 'headway') return '区间追踪';
    if (type === 'track') return '到发线占用';
    if (type === 'overtake') return '越行风险';
    return '施工影响';
  }

  trainNumber(trainId: string, trains: Array<{ id: string; number: string }>): string {
    return trains.find((train) => train.id === trainId)?.number ?? trainId;
  }

  location(
    conflict: TimetableConflict,
    stations: Array<{ id: string; name: string }>,
    sections: Array<{ id: string; fromStationId: string; toStationId: string }>,
  ): string {
    if (conflict.stationId) {
      return stations.find((station) => station.id === conflict.stationId)?.name ?? conflict.stationId;
    }
    const section = sections.find((candidate) => candidate.id === conflict.sectionId);
    if (!section) return conflict.sectionId ?? '—';
    const from = stations.find((station) => station.id === section.fromStationId)?.name;
    const to = stations.find((station) => station.id === section.toStationId)?.name;
    return `${from ?? ''}—${to ?? ''}`;
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  selectConflict(conflict: TimetableConflict | TimetableConflict[] | null | undefined): void {
    if (!conflict) return;
    if (Array.isArray(conflict)) {
      conflict = conflict[0];
      if (!conflict) return;
    }
    const trainId = conflict.trainIds[0];
    if (trainId) {
      this.store.dispatch({ type: '[Timetable] Select train', trainId });
    }
  }

  exportCsv(conflicts: TimetableConflict[]): void {
    const header = ['等级', '类型', '列车', '施工计划', '位置', '原因', '建议开始分钟', '建议结束分钟'];
    const lines = conflicts.map((conflict) => [
      conflict.severity,
      this.typeLabel(conflict.type),
      conflict.trainIds.join(' / '),
      conflict.planId ?? '',
      conflict.sectionId ?? conflict.stationId ?? '',
      conflict.detail.replaceAll(',', '，'),
      conflict.suggestedShift.start,
      conflict.suggestedShift.end,
    ]);
    const csv = [header, ...lines].map((row) => row.join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '运行图冲突分析.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
