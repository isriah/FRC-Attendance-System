export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...init.headers
    }
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}

export function errorResponse(error: unknown): Response {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: number }).status) : 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  return json({ error: message }, { status });
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-admin-email"
  };
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
