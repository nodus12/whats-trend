// 18-4: SQLite 연결 및 스키마 관리
//
// Node.js 내장 node:sqlite(DatabaseSync)를 사용합니다. 별도 npm 패키지를
// 추가하지 않기 위해서입니다(현재 Node 버전에서 안정적으로 동작 확인함).
// ORM은 사용하지 않고, 각 repository 모듈(pushSubscriptions.js,
// trendHistory.js, pushDedupeStore.js)이 이 모듈의 getDb()를 통해서만
// SQLite에 접근합니다 - SQL 연결 코드가 여러 파일에 흩어지지 않도록 합니다.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 프로젝트 루트 기준 server/data/whatstrend.sqlite
export const DEFAULT_DB_PATH = path.join(__dirname, "data", "whatstrend.sqlite");

let db = null;

/**
 * SQLite 연결을 생성하고 필요한 테이블을 준비합니다.
 * 이미 초기화된 상태라면 기존 연결을 닫고 새로 엽니다(테스트에서 재초기화할 때 사용).
 *
 * @param {string} [dbPath] - 생략하면 DEFAULT_DB_PATH 사용. ':memory:'를 넘기면
 *   프로세스 메모리에만 존재하는 임시 DB(테스트 전용)를 사용합니다.
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function initializeDatabase(dbPath = DEFAULT_DB_PATH) {
  if (db) {
    try {
      db.close();
    } catch {
      // 이미 닫혀있거나 오류가 나도 재초기화는 계속 진행합니다.
    }
    db = null;
  }

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_type_settings (
      subscription_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      PRIMARY KEY (subscription_id, type),
      FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trend_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trend_history_keyword_ts
      ON trend_history(keyword, timestamp);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS push_dedupe (
      dedupe_key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      trend_id TEXT NOT NULL,
      notification_date TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // 19-3: 검색/수치형 Trend Signal(Naver DataLab 등)의 시계열 스냅샷 저장소.
  // 기존 trend_history(뉴스 mentionCount 전용)와 완전히 분리된 새 테이블입니다.
  // source 컬럼을 두어 같은 keyword라도 소스가 다르면 서로 다른 스냅샷 계열로
  // 취급합니다(추후 google_trends 등이 추가돼도 오염되지 않도록).
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      keyword TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_signal_history_source_keyword_ts
      ON signal_history(source, keyword, timestamp);
  `);

  console.log("[Database] SQLite initialized");
  console.log("[Database] Schema ready");

  return db;
}

/**
 * 현재 활성화된 DB 연결을 반환합니다. initializeDatabase()가 먼저 호출되어야 합니다.
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function getDb() {
  if (!db) {
    throw new Error(
      "Database has not been initialized. Call initializeDatabase() before using repository functions."
    );
  }
  return db;
}

/**
 * DB 연결을 닫습니다(테스트 정리 또는 서버 종료 시 사용).
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
