import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withObservedRequest } from "./observability.ts";

Deno.test("observability adds a request id without changing the response", async () => {
  const response = await withObservedRequest("test", new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "health" }),
  }), async () => new Response("ok", { status: 200 }));
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertMatch(String(response.headers.get("x-request-id")), /^[a-f0-9-]{16,}$/i);
});

Deno.test("observability normalizes unhandled failures", async () => {
  const response = await withObservedRequest("test", new Request("https://example.test"), async () => {
    throw new Error("sensitive details are not returned");
  });
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error, "Internal server error");
});
