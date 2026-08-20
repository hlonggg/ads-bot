import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInitData } from "@/lib/verifyInitData";

export async function GET(req: NextRequest) {
  const initData = req.nextUrl.searchParams.get("initData") || "";
  const verified = verifyInitData(initData, process.env.BOT_TOKEN || "");
  if (!verified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only expose keys the client Mini App actually needs — never leak admin-only
  // secrets like monetagApiKey through this public-facing endpoint.
  // monetagZoneId is NOT secret — it's embedded directly in the client-side
  // SDK script tag anyway, so it's safe (and required) to expose here.
  const PUBLIC_KEYS = ["guideText", "minWithdraw", "groupLink", "supportUrl", "monetagZoneId", "monetagZoneScript"];

  const rows = await prisma.setting.findMany({ where: { key: { in: PUBLIC_KEYS } } });
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;

  return NextResponse.json({ settings });
}
