// 21-2 (2-3B단계): Google Gemini client 생성/export
//
// server/anthropicClient.js(2-3단계)를 대체합니다. supabase.js/기존
// anthropicClient.js와 정확히 동일한 패턴 - 환경변수가 없으면 client를
// 만들지 않고 명확히 "설정 안 됨" 상태를 노출합니다.
//
// 패키지 확인 근거: npm의 @google/generative-ai는 공식적으로 Deprecated
// 상태이며(README: "[Deprecated] Google AI JavaScript SDK", End-of-Life
// 2025-11-30) 공식 후속 SDK인 @google/genai(GitHub: googleapis/js-genai,
// npm 배포자: google-wombot = Google 공식 계정)로 마이그레이션이
// 안내되어 있어 @google/genai를 사용합니다.
import { GoogleGenAI } from "@google/genai";

let cachedClient = null;
let cachedClientKey = null;

/**
 * GEMINI_API_KEY가 환경변수에 설정되어 있는지 확인합니다.
 * @returns {boolean}
 */
export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Gemini client를 반환합니다. 환경변수가 없으면 client를 만들지 않고
 * null을 반환합니다(네트워크 시도 자체를 하지 않음).
 * @returns {import('@google/genai').GoogleGenAI|null}
 */
export function getGeminiClient() {
  if (!isGeminiConfigured()) {
    return null;
  }

  const key = process.env.GEMINI_API_KEY;

  if (cachedClient && cachedClientKey === key) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({ apiKey: key });
  cachedClientKey = key;

  return cachedClient;
}
