import { queryAuditLogs } from '../../../dashboard/dashboardSqliteService.js';
import { type AsyncDataPanel } from '../types.js';
import { getRegistry } from '../registryContext.js';

interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

type SortField = 'provider' | 'url' | 'created_at';
type SortDir = 'asc' | 'desc';

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function createAuditLogPanel(): AsyncDataPanel {
  let searchInput: HTMLInputElement | null = null;
  let providerFilter: HTMLSelectElement | null = null;
  let countEl: HTMLElement | null = null;
  let emptyState: HTMLElement | null = null;
  let tableBody: HTMLElement | null = null;
  let tableWrapper: HTMLElement | null = null;

  let allRows: AuditLogEntry[] = [];
  let filteredRows: AuditLogEntry[] = [];
  let sortField: SortField = 'created_at';
  let sortDir: SortDir = 'desc';

  function applyFiltersAndSort(): void {
    const searchText = (searchInput?.value ?? '').toLowerCase().trim();
    const providerValue = providerFilter?.value ?? '';

    filteredRows = allRows.filter((entry) => {
      if (providerValue && entry.provider !== providerValue) return false;
      if (searchText) {
        const haystack = `${entry.provider} ${entry.url} ${extractDomain(entry.url)}`.toLowerCase();
        return haystack.includes(searchText);
      }
      return true;
    });

    filteredRows.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'provider') {
        cmp = a.provider.localeCompare(b.provider);
      } else if (sortField === 'url') {
        cmp = a.url.localeCompare(b.url);
      } else {
        cmp = a.created_at - b.created_at;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    renderTable();
    updateSortIndicators();
  }

  function renderTable(): void {
    if (!tableBody) return;

    if (filteredRows.length === 0) {
      if (emptyState) emptyState.hidden = false;
      if (tableWrapper) tableWrapper.hidden = true;
    } else {
      if (emptyState) emptyState.hidden = true;
      if (tableWrapper) tableWrapper.hidden = false;
    }

    if (countEl) {
      countEl.textContent = `${filteredRows.length} / ${allRows.length} 件`;
    }

    tableBody.innerHTML = '';

    for (const entry of filteredRows) {
      const tr = document.createElement('tr');
      tr.className = 'audit-log-row';

      const tdProvider = document.createElement('td');
      tdProvider.className = 'audit-log-cell audit-log-provider';
      const providerBadge = document.createElement('span');
      providerBadge.className = 'audit-log-provider-badge';
      providerBadge.textContent = entry.provider;
      tdProvider.appendChild(providerBadge);

      const tdUrl = document.createElement('td');
      tdUrl.className = 'audit-log-cell audit-log-url';
      const urlLink = document.createElement('a');
      urlLink.href = '#';
      urlLink.textContent = entry.url;
      urlLink.className = 'audit-log-url-link';
      urlLink.title = '履歴で検索: ' + extractDomain(entry.url);
      urlLink.addEventListener('click', (e) => {
        e.preventDefault();
        getRegistry().navigateTyped('panel-sqlite-history', { searchDomain: extractDomain(entry.url) });
      });
      tdUrl.appendChild(urlLink);

      const tdTime = document.createElement('td');
      tdTime.className = 'audit-log-cell audit-log-timestamp';
      tdTime.textContent = formatTimestamp(entry.created_at);

      tr.appendChild(tdProvider);
      tr.appendChild(tdUrl);
      tr.appendChild(tdTime);
      tableBody.appendChild(tr);
    }
  }

  function updateSortIndicators(): void {
    const container = document.getElementById('panel-audit-log');
    if (!container) return;

    container.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) => {
      const field = th.getAttribute('data-sort') as SortField;
      const btn = th.querySelector('.audit-log-sort-btn');
      if (!btn) return;

      th.setAttribute('aria-sort',
        field === sortField ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      );

      const icon = btn.querySelector('.sort-icon');
      if (icon) {
        if (field === sortField) {
          icon.textContent = sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
        } else {
          icon.textContent = '';
        }
      }
    });
  }

  function populateProviderFilter(rows: AuditLogEntry[]): void {
    if (!providerFilter) return;

    const providers = [...new Set(rows.map((r) => r.provider))].sort();
    const currentValue = providerFilter.value;

    providerFilter.innerHTML = '<option value="">すべてのプロバイダー</option>';
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerFilter.appendChild(opt);
    }

    if (currentValue && providers.includes(currentValue)) {
      providerFilter.value = currentValue;
    }
  }

  return {
    id: 'panel-audit-log',
    category: 'async-data',
    mount(container) {
      searchInput = container.querySelector('#auditLogSearch');
      providerFilter = container.querySelector('#auditLogProviderFilter');
      countEl = container.querySelector('#auditLogCount');
      emptyState = container.querySelector('#auditLogEmptyState');
      tableBody = container.querySelector('#auditLogBody');
      tableWrapper = container.querySelector('#auditLogTableWrapper');

      searchInput?.addEventListener('input', () => applyFiltersAndSort());
      providerFilter?.addEventListener('change', () => applyFiltersAndSort());

      container.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) => {
        const field = th.getAttribute('data-sort') as SortField;
        th.querySelector('.audit-log-sort-btn')?.addEventListener('click', () => {
          if (sortField === field) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortField = field;
            sortDir = field === 'created_at' ? 'desc' : 'asc';
          }
          applyFiltersAndSort();
        });
      });
    },
    async loadData() {
      const result = await queryAuditLogs({ limit: 500, offset: 0 });
      allRows = result?.rows ?? [];

      populateProviderFilter(allRows);
      applyFiltersAndSort();
    },
  };
}
