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

export type RpcOp =
  | 'health'
  | 'query'
  | 'exec'
  | 'transaction-begin'
  | 'transaction-commit'
  | 'transaction-rollback'
  | 'close';

export interface RpcRequest {
  id: number;
  op: RpcOp;
  transactionId?: string;
  /** Caller timeout expressed in the shared extension-page clock domain. */
  deadlineAt?: number;
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
