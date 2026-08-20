import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Dán URL này vào "Your backend URL" trong Monetag SSP → Postbacks (mỗi zone
 * cấu hình riêng, dán y hệt, KHÔNG sửa tên macro):
 *
 *   https://<APP_URL>/api/postback/monetag?ymid={ymid}&event_type={event_type}&reward_event_type={reward_event_type}&estimated_price={estimated_price}&secret=YOUR_POSTBACK_SECRET
 *
 * Monetag sẽ tự thay {ymid}, {event_type}... bằng giá trị thật khi gọi.
 * ymid = requestId chúng ta tạo lúc claim và truyền vào show_XXX({ ymid }).
 *
 * Theo Macro Reference chính thức:
 *   reward_event_type = "valued"      -> sự kiện ĐÃ được tính tiền, được thưởng
 *   reward_event_type = "not_valued"  -> bị lọc (spam/gian lận/fallback), KHÔNG thưởng
 * Chỉ cộng tiền khi reward_event_type === "valued" — bỏ qua điều kiện này là lỗ hổng
 * cho phép cộng tiền cho lượt xem không hợp lệ.
 */
export async function GET(req: NextRequest) {
  const ymid = req.nextUrl.searchParams.get("ymid");
  const eventType = req.nextUrl.searchParams.get("event_type");
  const rewardEventType = req.nextUrl.searchParams.get("reward_event_type");
  const estimatedPrice = req.nextUrl.searchParams.get("estimated_price");
  const secret = req.nextUrl.searchParams.get("secret");

  if (!ymid || secret !== process.env.POSTBACK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const completion = await prisma.taskCompletion.findUnique({ where: { requestId: ymid } });
  if (!completion) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (completion.status !== "PENDING") {
    // already processed — respond 200 so Monetag doesn't retry forever (idempotent per ymid)
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  console.log("[postback:monetag]", { ymid, eventType, rewardEventType, estimatedPrice });

  // Rewarded Interstitial: the "impression" event is what completes the ad view.
  // A "click" postback is a separate, secondary event — crediting on it too would
  // double-pay for a single ad view.
  const isValidRewardEvent = eventType === "impression" && rewardEventType === "valued";

  if (!isValidRewardEvent) {
    await prisma.taskCompletion.update({
      where: { id: completion.id },
      data: { status: "REJECTED" },
    });
    return NextResponse.json({ ok: true, rewarded: false, reason: "not_valued_or_wrong_event" });
  }

  await prisma.$transaction([
    prisma.taskCompletion.update({
      where: { id: completion.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: completion.userId },
      data: { balance: { increment: completion.reward } },
    }),
  ]);

  return NextResponse.json({ ok: true, rewarded: true });
}
