import { createRoute, z } from "@hono/zod-openapi";
import { errorBody, errorResponseSchema } from "../../common/http.js";
import { createRouter, nowFrom, type AppDeps } from "../../common/router.js";
import type { AuthService, SessionUser } from "./auth.service.js";
import { MAX_PASSWORD_LENGTH } from "./password.js";
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from "./session-cookie.js";

const adminSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    role: z.enum(["ADMIN", "DEMO"]),
    demo: z
      .object({ changesUsed: z.number().int(), changesLimit: z.number().int() })
      .nullable()
      .openapi({ description: "Change allowance of the demo account; null for the administrator" }),
  })
  .openapi("Admin");

type AdminDto = z.infer<typeof adminSchema>;

const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .openapi("LoginRequest");

const errorContent = { "application/json": { schema: errorResponseSchema } };

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["Authentication"],
  summary: "Log in as the administrator",
  description: "Sets an HTTP-only session cookie. Rate limited per client IP.",
  request: { body: { required: true, content: { "application/json": { schema: loginBodySchema } } } },
  responses: {
    200: { description: "Logged in", content: { "application/json": { schema: z.object({ data: adminSchema }) } } },
    401: { description: "Invalid credentials", content: errorContent },
    429: { description: "Too many attempts", content: errorContent },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["Authentication"],
  summary: "Log out (invalidates the session server-side)",
  responses: { 204: { description: "Logged out" } },
});

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  tags: ["Authentication"],
  summary: "Current administrator",
  security: [{ cookieAuth: [] }],
  responses: {
    200: { description: "Authenticated", content: { "application/json": { schema: z.object({ data: adminSchema }) } } },
    401: { description: "Not authenticated", content: errorContent },
  },
});

export function createAuthRoutes(deps: AppDeps, auth: AuthService) {
  const router = createRouter();

  const toDto = (user: SessionUser): AdminDto => ({
    id: user.id,
    email: user.email,
    role: user.role,
    demo:
      user.role === "DEMO"
        ? { changesUsed: user.demoChangesUsed, changesLimit: deps.config.DEMO_CHANGE_LIMIT }
        : null,
  });

  router.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid("json");
    const result = await auth.login(email, password, c.req.header("User-Agent"));
    if (!result) {
      deps.logger.warn("Failed login attempt", { requestId: c.get("requestId") });
      return c.json(errorBody("INVALID_CREDENTIALS", "Invalid email or password", undefined, c.get("requestId")), 401);
    }
    writeSessionCookie(c, deps.config, result.token, result.expiresAt, nowFrom(deps));
    deps.logger.info("Logged in", { adminId: result.admin.id, role: result.admin.role });
    return c.json({ data: toDto(result.admin) }, 200);
  });

  router.openapi(logoutRoute, async (c) => {
    const token = readSessionCookie(c, deps.config);
    if (token) await auth.logout(token);
    clearSessionCookie(c, deps.config);
    return c.body(null, 204);
  });

  router.openapi(meRoute, (c) => {
    return c.json({ data: toDto(c.get("admin")) }, 200);
  });

  return router;
}
