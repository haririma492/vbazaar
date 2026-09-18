export function isAdminTokenValid(token: string) {
  const expected = (process.env.ADMIN_TOKEN || "").trim();
  return Boolean(expected && token.trim() && token.trim() === expected);
}

export function requireAdminOrThrow(req: Request) {
  const token = req.headers.get("x-admin-token") || "";
  if (!isAdminTokenValid(token)) {
    const error = new Error("Unauthorized");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
}
