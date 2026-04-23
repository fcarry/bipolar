import { NextRequest } from "next/server";
import { apiErrorResponse, publicUser, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    return Response.json({ user: publicUser(user) });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
