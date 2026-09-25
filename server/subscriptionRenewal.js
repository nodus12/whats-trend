// Phase D: 자동결제 갱신 스케줄러 로직.
//
// server/scheduler.js(트렌드 수집)와 완전히 별개의 스케줄러입니다 - 목적,
// 주기, 트리거 방식이 다르므로 통합하지 않습니다(CLAUDE.md 24번 섹션의
// "서로 다른 스케줄러를 통합하지 않는다" 원칙과 동일).
//
// 이 파일은 "누구를 재청구할지"(subscriptions.js) + "어떻게 청구할지"
// (tossPayments.js)만 조합하는 오케스트레이션 레이어입니다 - 두 파일의
// 기존 함수를 그대로 재사용하고 복제하지 않습니다.
import {
  listSubscriptionsDueForRenewal,
  extendSubscriptionPeriod,
  markSubscriptionPastDueById,
  generateOrderId,
  PLAN_PRICES,
  PLAN_ORDER_NAMES,
} from "./subscriptions.js";
import { chargeBillingKey } from "./tossPayments.js";

let isRunning = false;

export function isRenewalRunning() {
  return isRunning;
}

/**
 * current_period_end가 지난 active 구독을 전부 재청구합니다. 한 구독의
 * 재청구 실패가 나머지 구독 처리를 막지 않도록 각 건을 개별적으로
 * try/catch합니다(scheduler.js의 failure isolation과 동일한 원칙).
 * @returns {Promise<{processed:number, succeeded:number, failed:number}>}
 */
export async function chargeSubscriptionsDueForRenewal() {
  if (isRunning) {
    console.log("[Subscription Renewal] 이전 작업이 아직 실행 중이라 이번 주기는 건너뜁니다.");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  isRunning = true;
  let succeeded = 0;
  let failed = 0;

  try {
    const dueSubscriptions = await listSubscriptionsDueForRenewal();
    console.log(`[Subscription Renewal] 재청구 대상 ${dueSubscriptions.length}건`);

    for (const subscription of dueSubscriptions) {
      try {
        if (!subscription.billing_key) {
          console.error(`[Subscription Renewal] id=${subscription.id} billing_key 없음 - 건너뜀`);
          await markSubscriptionPastDueById(subscription.id);
          failed += 1;
          continue;
        }

        const result = await chargeBillingKey({
          billingKey: subscription.billing_key,
          customerKey: subscription.customer_key,
          amount: PLAN_PRICES[subscription.plan],
          orderId: generateOrderId(subscription.user_id),
          orderName: PLAN_ORDER_NAMES[subscription.plan],
        });

        if (result.success) {
          await extendSubscriptionPeriod(subscription.id, subscription.plan);
          succeeded += 1;
        } else {
          console.error(`[Subscription Renewal] id=${subscription.id} 재청구 실패:`, result.message || result.error);
          await markSubscriptionPastDueById(subscription.id);
          failed += 1;
        }
      } catch (error) {
        console.error(`[Subscription Renewal] id=${subscription.id} 처리 중 예외(다음 구독으로 계속 진행):`, error.message);
        failed += 1;
      }
    }

    console.log(`[Subscription Renewal] 완료 - 성공 ${succeeded}건, 실패 ${failed}건`);
    return { processed: dueSubscriptions.length, succeeded, failed };
  } finally {
    isRunning = false;
  }
}
