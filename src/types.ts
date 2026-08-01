export interface Env {
  ALERT_COORDINATOR: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  NCBI_API_KEY?: string;
  NCBI_CONTACT_EMAIL?: string;
  APP_NAME?: string;
  SEARCH_WINDOW_DAYS?: string;
  SEARCH_OVERLAP_DAYS?: string;
  MAX_CATCHUP_DAYS?: string;
  MAX_RESULTS?: string;
  REQUEST_TIMEOUT_MS?: string;
}

export interface AlertConfig {
  keyword: string;
  recipient: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PendingNotification {
  idempotencyKey: string;
  pmids: string[];
  keyword: string;
  recipient: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  emailedCount: number;
  createdAt: string;
  /** 已连续发送失败的次数；达到阈值后该批次自动作废。旧数据可能没有此字段，读取时按 0 处理。 */
  failCount?: number;
}

export interface AlertState {
  version: 2;
  initialized: boolean;
  keyword: string;
  seenPmids: string[];
  lastAttemptAt?: string;
  lastSuccessfulCheckAt?: string;
  lastEmailAt?: string;
  lastResultCount?: number;
  lastNewCount?: number;
  lastEmailedCount?: number;
  lastSearchWindowStart?: string;
  lastSearchWindowEnd?: string;
  lastWarnings?: string[];
  lastError?: string;
  lastErrorAt?: string;
  pendingNotification?: PendingNotification;
  /** 连续发送失败后被自动作废的批次信息。 */
  lastDiscarded?: { at: string; count: number; reason: string };
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  journal: string;
  pubdate: string;
  authors: string;
  url: string;
}

export interface PubMedSearchResult {
  pmids: string[];
  totalCount: number;
  windowStart: string;
  windowEnd: string;
  warnings: string[];
}

export interface CheckResult {
  status: "disabled" | "initialized" | "no_new" | "emailed" | "discarded";
  message: string;
  resultCount?: number;
  newCount?: number;
  emailedCount?: number;
  windowStart?: string;
  windowEnd?: string;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}

export interface AlertStore {
  getConfig(): Promise<AlertConfig | null>;
  putConfig(config: AlertConfig): Promise<void>;
  getState(): Promise<AlertState | null>;
  putState(state: AlertState): Promise<void>;
}

export interface PubMedGateway {
  search(keyword: string, lastSuccessfulCheckAt?: string): Promise<PubMedSearchResult>;
  summaries(pmids: string[]): Promise<PubMedArticle[]>;
}

export interface MailGateway {
  sender(): string;
  send(message: EmailMessage): Promise<{ id?: string }>;
}
