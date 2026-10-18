// GitHub Actions 등에서 Express 서버 없이 뉴스 → trend_signals 수집을 1회 실행합니다.
// 수집 로직은 server/newsSignalCollector.js의 runNewsSignalCollection()을 그대로 씁니다.
//
// runNewsSignalCollection()은 실패해도 throw하지 않고 결과 객체만 반환하므로,
// 여기서 결과를 종료 코드로 바꿔야 실패가 Actions에서 실패로 표시됩니다.
// 비밀값은 출력하지 않습니다(누락된 환경변수는 이름만 출력).
import { pathToFileURL } from "node:url";

export const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

export function findMissingEnv(env = process.env) {
  return REQUIRED_ENV.filter((name) => typeof env[name] !== "string" || env[name].trim() === "");
}

// 성공, 또는 "직전 수집 후 주기 절반 이내라 건너뜀"만 정상(0)입니다.
export function toExitCode(result) {
  if (result?.success === true) return 0;
  if (result?.skipped === true && result.reason === "too_soon") return 0;
  return 1;
}

export function summarize(result) {
  if (result?.success === true) {
    return {
      status: "success",
      collectedAt: result.collectedAt,
      windowStart: result.windowStart,
      fetchedArticles: result.fetchedArticles,
      newArticles: result.newArticles,
      keywordRows: result.keywordRowCount,
      alreadyCounted: result.alreadyCounted,
      failedQueries: result.failedQueries,
    };
  }
  return {
    status: result?.skipped ? "skipped" : "failed",
    reason: result?.reason ?? "unknown",
    previousRunAt: result?.previousRunAt,
    failedQueries: result?.failedQueries,
    message: result?.message,
  };
}

async function main() {
  const missing = findMissingEnv();
  if (missing.length > 0) {
    console.error(`[collect-news-signals] 필수 환경변수 누락: ${missing.join(", ")} - 수집을 실행하지 않습니다.`);
    return 1;
  }

  const { runNewsSignalCollection } = await import("../server/newsSignalCollector.js");
  const result = await runNewsSignalCollection();
  const exitCode = toExitCode(result);
  const line = `[collect-news-signals] ${JSON.stringify(summarize(result))}`;
  if (exitCode === 0) {
    console.log(line);
  } else {
    console.error(line);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("[collect-news-signals] 예기치 못한 오류:", error?.message ?? error);
      process.exitCode = 1;
    });
}
