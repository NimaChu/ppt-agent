import { NextResponse } from "next/server";
import { createOrUpdateUser, listPublicUsers, requireAdminUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    return NextResponse.json({ users: await listPublicUsers() });
  } catch (error) {
    return authError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = (await request.json().catch(() => null)) as {
      username?: string;
      password?: string;
      name?: string;
      role?: "admin" | "user";
    } | null;
    const user = await createOrUpdateUser({
      username: body?.username ?? "",
      password: body?.password || undefined,
      name: body?.name,
      role: body?.role === "admin" ? "admin" : "user",
    });
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("required") || error.message.includes("Password"))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authError(error);
  }
}

function authError(error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "Forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 500 });
}
