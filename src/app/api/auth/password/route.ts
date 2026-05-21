import { NextResponse } from "next/server";
import { changeOwnPassword, requireCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as {
      currentPassword?: string;
      nextPassword?: string;
    } | null;
    const currentPassword = body?.currentPassword ?? "";
    const nextPassword = body?.nextPassword ?? "";
    if (!currentPassword || nextPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    await changeOwnPassword(user.id, currentPassword, nextPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Invalid current password") {
      return NextResponse.json({ error: "Invalid current password" }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change password" }, { status: 500 });
  }
}
