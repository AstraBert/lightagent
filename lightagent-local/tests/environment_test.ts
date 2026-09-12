import { assert, assertEquals, assertFalse } from "@std/assert";
import { LocalEnvironment } from "../src/environment.ts";

const TEST_KEY = "LIGHTAGENT_TEST_ENV_VAR";

function cleanup() {
  try {
    Deno.env.delete(TEST_KEY);
  } catch {
    // ignore
  }
}

Deno.test("LocalEnvironment - get returns undefined for missing keys", () => {
  cleanup();
  const env = new LocalEnvironment();
  assertEquals(env.get(TEST_KEY), undefined);
});

Deno.test("LocalEnvironment - set and get round-trip", () => {
  cleanup();
  const env = new LocalEnvironment();
  env.set(TEST_KEY, "hello");
  assertEquals(env.get(TEST_KEY), "hello");
  cleanup();
});

Deno.test("LocalEnvironment - contains reflects presence", () => {
  cleanup();
  const env = new LocalEnvironment();
  assertFalse(env.contains(TEST_KEY));
  env.set(TEST_KEY, "x");
  assert(env.contains(TEST_KEY));
  cleanup();
});

Deno.test("LocalEnvironment - delete removes the key", () => {
  cleanup();
  const env = new LocalEnvironment();
  env.set(TEST_KEY, "x");
  env.delete(TEST_KEY);
  assertFalse(env.contains(TEST_KEY));
  assertEquals(env.get(TEST_KEY), undefined);
});

Deno.test("LocalEnvironment - os returns a known OS type", () => {
  const env = new LocalEnvironment();
  const os = env.os();
  const known = [
    "windows",
    "darwin",
    "linux",
    "android",
    "freebsd",
    "netbsd",
    "aix",
    "solaris",
    "illumos",
  ];
  assert(known.includes(os), `unexpected os: ${os}`);
  assertEquals(os, Deno.build.os);
});
