import assert from "node:assert/strict";
import test from "node:test";
import {
  getBearerToken,
  isLoopbackHost,
  isOriginAllowed,
  parseAllowedOrigins,
  resolveMcpHttpSecurityConfig,
  tokensMatch,
} from "../http-security.js";

test("defaults the MCP HTTP server to IPv4 loopback", () => {
  const config = resolveMcpHttpSecurityConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.isLoopback, true);
  assert.equal(config.token, "");
});

test("recognizes supported loopback host spellings", () => {
  for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.1.20"), false);
});

test("refuses non-loopback binding without an authentication token", () => {
  assert.throws(
    () => resolveMcpHttpSecurityConfig({ MAGIC_NS_MCP_HOST: "0.0.0.0" }),
    /Refusing to expose the MCP HTTP server beyond loopback without MAGIC_NS_MCP_TOKEN/,
  );
});

test("allows an explicit non-loopback binding when a token is configured", () => {
  const config = resolveMcpHttpSecurityConfig({
    MAGIC_NS_MCP_HOST: "0.0.0.0",
    MAGIC_NS_MCP_TOKEN: "a-strong-random-token",
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.isLoopback, false);
  assert.equal(config.token, "a-strong-random-token");
});

test("rejects an empty configured host", () => {
  assert.throws(
    () => resolveMcpHttpSecurityConfig({ MAGIC_NS_MCP_HOST: "   " }),
    /MAGIC_NS_MCP_HOST cannot be empty/,
  );
});

test("parses an explicit origin allowlist and rejects unlisted browser origins", () => {
  const origins = parseAllowedOrigins(
    "https://claude.ai, https://example.test,https://claude.ai",
  );

  assert.deepEqual(
    [...origins],
    ["https://claude.ai", "https://example.test"],
  );
  assert.equal(isOriginAllowed("https://claude.ai", origins), true);
  assert.equal(isOriginAllowed("https://attacker.test", origins), false);
  assert.equal(isOriginAllowed(undefined, origins), true);
});

test("refuses to allow the opaque null browser origin", () => {
  assert.throws(
    () => parseAllowedOrigins("null"),
    /cannot allow the opaque "null" origin/,
  );
});

test("extracts bearer tokens case-insensitively and rejects malformed headers", () => {
  assert.equal(getBearerToken("Bearer secret"), "secret");
  assert.equal(getBearerToken("bearer secret"), "secret");
  assert.equal(getBearerToken("  Bearer secret"), "");
  assert.equal(getBearerToken("Basic secret"), "");
  assert.equal(getBearerToken("Bearer two tokens"), "");
  assert.equal(getBearerToken(undefined), "");
});

test("compares bearer tokens without accepting length or value mismatches", () => {
  assert.equal(tokensMatch("same-token", "same-token"), true);
  assert.equal(tokensMatch("same-tokeN", "same-token"), false);
  assert.equal(tokensMatch("short", "a-much-longer-token"), false);
});
