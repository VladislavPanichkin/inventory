import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { AppConfig } from "../config/env.js";

/**
 * Node-only client-IP resolver for rate limiting. Behind a trusted reverse proxy, use the
 * LAST X-Forwarded-For entry: it's the one the proxy appended (earlier entries can be
 * forged by the client). Without a proxy, use the socket address.
 */
export function clientIpResolver(
  config: Pick<AppConfig, "TRUST_PROXY">,
  socketAddress: (c: Context) => string | undefined = (c) => getConnInfo(c).remote.address,
) {
  return (c: Context): string | undefined => {
    if (config.TRUST_PROXY) {
      const last = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (last) return last;
    }
    return socketAddress(c);
  };
}
