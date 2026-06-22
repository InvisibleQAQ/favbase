export type RowMode = 'array' | 'object';

export interface QueryOptions {
  rowMode?: RowMode;
}

export interface FieldDef {
  name: string;
  dataTypeID: number;
}

export interface QueryResult<R = unknown> {
  rows: R[];
  fields?: FieldDef[];
  affectedRows?: number;
}

export type RpcOp = 'health' | 'query' | 'exec' | 'close';

export interface RpcRequest {
  id: number;
  op: RpcOp;
  payload?: unknown;
}

interface RpcResponseOk<T = unknown> {
  id: number;
  ok: true;
  data: T;
}

interface RpcResponseErr {
  id: number;
  ok: false;
  error: string;
}

export type RpcResponse<T = unknown> = RpcResponseOk<T> | RpcResponseErr;

export interface QueryPayload {
  sql: string;
  params?: unknown[];
  rowMode?: RowMode;
}

export interface ExecPayload {
  sql: string;
}

export interface RpcTransport {
  post(msg: RpcRequest): void;
  subscribe(handler: (msg: RpcResponse) => void): () => void;
}
