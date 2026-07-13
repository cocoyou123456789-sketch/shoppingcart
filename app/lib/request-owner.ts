const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function ownerForRequest(request: Request): string | null {
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase();
  if (email) return email;

  const hostname = new URL(request.url).hostname;
  return LOCAL_HOSTS.has(hostname) ? "local-development" : null;
}

export function unauthorizedJson() {
  return Response.json(
    { error: "Authentication is required for private wardrobe data" },
    { status: 401 },
  );
}
