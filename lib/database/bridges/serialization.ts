interface DateMarker {
  __type: 'Date';
  __value: string;
}

function isDateMarker(v: unknown): v is DateMarker {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as DateMarker).__type === 'Date' &&
    typeof (v as DateMarker).__value === 'string'
  );
}

export function serializeForRpc(data: unknown): unknown {
  if (data instanceof Date) {
    return { __type: 'Date', __value: data.toISOString() } satisfies DateMarker;
  }
  if (Array.isArray(data)) return data.map(serializeForRpc);
  if (typeof data === 'object' && data !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = serializeForRpc(v);
    }
    return out;
  }
  return data;
}

export function deserializeFromRpc(data: unknown): unknown {
  if (isDateMarker(data)) return new Date(data.__value);
  if (Array.isArray(data)) return data.map(deserializeFromRpc);
  if (typeof data === 'object' && data !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = deserializeFromRpc(v);
    }
    return out;
  }
  return data;
}

export function deserializeQueryResult<T>(result: {
  rows: unknown[];
  fields?: { name: string; dataTypeID: number }[];
  affectedRows?: number;
}): { rows: T[]; fields?: { name: string; dataTypeID: number }[]; affectedRows?: number } {
  return {
    rows: result.rows.map((r) => deserializeFromRpc(r)) as T[],
    fields: result.fields,
    affectedRows: result.affectedRows,
  };
}
