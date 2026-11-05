export interface TableSort {
  readonly column: number | null;
  readonly dir: 'asc' | 'desc';
}

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly group?: string;
  readonly numeric?: boolean;
  /** Significant digits for display only; cells retain exact values. */
  readonly precision?: number;
}

export interface TableRow {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly string[];
}

export interface TableWindow {
  readonly rows: readonly TableRow[];
  readonly total: number;
}

export interface TableSource {
  window(
    query: string,
    sort: TableSort | null,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): TableWindow | Promise<TableWindow>;
  locate?(
    key: string,
    query: string,
    sort: TableSort | null,
    signal?: AbortSignal,
  ): number | null | Promise<number | null>;
}

/** Compact numeric display without changing the values used for sorting, editing or exporting. */
export function displayCell(value: string, precision?: number): string {
  const number = Number(value);
  return precision && value !== '' && Number.isFinite(number) ? String(Number(number.toPrecision(precision))) : value;
}
