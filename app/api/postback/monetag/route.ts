import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Configure this URL in Monetag dashboard as the postback endpoint, with the
 * {ymid} macro mapped to our own requestId — this is the exact identifier we
 * pass into show_<zoneId>({ ymid: requestId }) on the client, per Monetag's
 * Rewarded Interstitial docs:
 *   https://your-app.up.railway.app/api/postback/monetag?requestId={ymid}&secret=YOUR_SECRET
 *
 * requestId must be the value we generated in /api/tasks/[id]/claim and
 * passed into Monetag's show_<zoneId>() call as `ymid` — this is what ties
 * the postback back to the correct PENDING completion.
 */
export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  const secret = req.nextUrl.searchParams.get("secret");

  if (!requestId || secret !== process.env.POSTBACK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const completion = await prisma.taskCompletion.findUnique({ where: { requestId } });
  if (!completion) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (completion.status !== "PENDING") {
    // already processed — respond 200 so the ad network doesn't retry forever
    return NextResponse.json({ ok: true, alreadyProcessed: true });
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

  return NextResponse.json({ ok: true });
}
