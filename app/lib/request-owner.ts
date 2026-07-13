const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const EXPECTED_OWNER_HEADER = "x-songsong-expected-owner";
export const EXPECTED_OWNER_QUERY = "expectedOwner";
export const SESSION_CHANGED_HEADER = "x-songsong-session-status";
export const SESSION_CHANGED_VALUE = "changed";

const VALID_OWNER_BINDING = /^[0-9a-f]{64}$/;

export function localDevelopmentOwner(hostname: string) {
  return LOCAL_HOSTS.has(hostname) ? "local-development" : null;
}

export function ownerForRequest(request: Request): string | null {
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase();
  if (email) return email;

  const hostname = new URL(request.url).hostname;
  return localDevelopmentOwner(hostname);
}

export function unauthorizedJson() {
  return Response.json(
    { error: "Authentication is required for private wardrobe data" },
    { status: 401, headers: { "cache-control": "private, no-store" } },
  );
}

export async function ownerBindingForOwner(owner: string) {
  const normalizedOwner = owner.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`songsong-owner:${normalizedOwner}`),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function sessionChangedJson() {
  return Response.json(
    {
      error: "The authenticated account changed; reload before accessing private data",
      code: "SESSION_CHANGED",
    },
    {
      status: 409,
      headers: {
        "cache-control": "private, no-store",
        [SESSION_CHANGED_HEADER]: SESSION_CHANGED_VALUE,
      },
    },
  );
}

export async function requireExpectedOwner(
  request: Request,
  { allowQuery = false }: { allowQuery?: boolean } = {},
) {
  const headerBinding = request.headers.get(EXPECTED_OWNER_HEADER)?.trim().toLowerCase();
  const queryBinding = allowQuery
    ? new URL(request.url).searchParams.get(EXPECTED_OWNER_QUERY)?.trim().toLowerCase()
    : undefined;
  if (headerBinding && queryBinding && headerBinding !== queryBinding) {
    return { response: sessionChangedJson() } as const;
  }
  const expectedOwner = headerBinding || queryBinding;
  const owner = ownerForRequest(request);
  if (!owner) {
    return expectedOwner
      ? { response: sessionChangedJson() } as const
      : { response: unauthorizedJson() } as const;
  }
  const currentOwner = await ownerBindingForOwner(owner);
  if (
    !expectedOwner ||
    !VALID_OWNER_BINDING.test(expectedOwner) ||
    expectedOwner !== currentOwner
  ) {
    return { response: sessionChangedJson() } as const;
  }

  return { owner, expectedOwner: currentOwner } as const;
}
