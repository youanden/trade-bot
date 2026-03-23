import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

/**
 * Auth middleware — simple bearer token for dev, CF Access for prod.
 * Apply to routes that need protection.
 */
export function authMiddleware() {
  return new Hono<{ Bindings: Env }>().use("*", async (c, next) => {
    const token = c.env.AUTH_TOKEN;

    // Skip auth in dev if no token configured
    if (!token) {
      return next();
    }

    const middleware = bearerAuth({ token });
    return middleware(c, next);
  });
}
