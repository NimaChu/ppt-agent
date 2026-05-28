import { requireCurrentUser } from "@/lib/auth";
import { safeSegment } from "@/lib/fs-utils";
import { readEvents, readManifestForUser } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = safeSegment(id);
  const user = await requireCurrentUser().catch(() => null);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const initialManifest = await readManifestForUser(jobId, user.id).catch(() => null);
  if (!initialManifest) return new Response("Not found", { status: 404 });
  let offset = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("status", { connected: true });
      const interval = setInterval(async () => {
        try {
          const result = await readEvents(jobId, offset, true);
          offset = result.offset;
          for (const line of result.events) {
            const parsed = JSON.parse(line);
            send(parsed.type ?? "log", parsed);
          }
          const manifest = await readManifestForUser(jobId, user.id);
          if (!manifest) throw new Error("Job not found");
          if (manifest.status === "complete" || manifest.status === "failed" || manifest.status === "cancelled") {
            send(manifest.status === "complete" || manifest.status === "cancelled" ? "done" : "error", {
              jobId,
              status: manifest.status,
              stage: manifest.stage,
              message: manifest.status === "failed" ? manifest.error : undefined,
            });
            clearInterval(interval);
            controller.close();
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "SSE stream failed" });
          clearInterval(interval);
          controller.close();
        }
      }, 800);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
