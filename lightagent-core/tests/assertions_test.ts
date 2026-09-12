import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertFileWithinWorkspace,
  assertOnlyOneDefined,
  assertUniqueString,
  assertValidSkillName,
} from "../src/assertions.ts";

Deno.test("assertValidSkillName - accepts valid names", () => {
  const validNames = [
    "a",
    "ab",
    "a-b",
    "skill-name",
    "skill123",
    "123skill",
    "0",
    "a1b2c3",
    "my-skill-name-123",
    "a".repeat(64), // exactly 64 chars
    "a" + "-".repeat(62) + "b", // 64 chars with hyphens inside
  ];
  for (const name of validNames) {
    assertValidSkillName(name); // should not throw
  }
});

Deno.test("assertValidSkillName - rejects empty string", () => {
  assertThrows(
    () => assertValidSkillName(""),
    Error,
    "Invalid skill name",
  );
});

Deno.test("assertValidSkillName - rejects names longer than 64 chars", () => {
  assertThrows(
    () => assertValidSkillName("a".repeat(65)),
    Error,
    "Invalid skill name",
  );
});

Deno.test("assertValidSkillName - rejects leading hyphen", () => {
  assertThrows(
    () => assertValidSkillName("-skill"),
    Error,
    "Invalid skill name",
  );
  assertThrows(
    () => assertValidSkillName("-"),
    Error,
    "Invalid skill name",
  );
});

Deno.test("assertValidSkillName - rejects trailing hyphen", () => {
  assertThrows(
    () => assertValidSkillName("skill-"),
    Error,
    "Invalid skill name",
  );
});

Deno.test("assertValidSkillName - rejects uppercase letters", () => {
  assertThrows(
    () => assertValidSkillName("Skill"),
    Error,
    "Invalid skill name",
  );
  assertThrows(
    () => assertValidSkillName("SKILL"),
    Error,
    "Invalid skill name",
  );
});

Deno.test("assertValidSkillName - rejects special characters", () => {
  const invalidNames = [
    "skill_name",
    "skill.name",
    "skill name",
    "skill/name",
    "skill\\name",
    "skill@name",
    "skill!name",
    "skill\tname",
    "skill\nname",
  ];
  for (const name of invalidNames) {
    assertThrows(
      () => assertValidSkillName(name),
      Error,
      "Invalid skill name",
      `expected "${name}" to be rejected`,
    );
  }
});

Deno.test("assertFileWithinWorkspace - resolves relative paths against base", () => {
  const resolved = assertFileWithinWorkspace("src/file.ts", "/workspace");
  assertEquals(resolved, "/workspace/src/file.ts");
});

Deno.test("assertFileWithinWorkspace - accepts nested relative paths", () => {
  const resolved = assertFileWithinWorkspace(
    "a/b/c/file.ts",
    "/workspace",
  );
  assertEquals(resolved, "/workspace/a/b/c/file.ts");
});

Deno.test("assertFileWithinWorkspace - accepts absolute paths inside base", () => {
  const resolved = assertFileWithinWorkspace(
    "/workspace/src/file.ts",
    "/workspace",
  );
  assertEquals(resolved, "/workspace/src/file.ts");
});

Deno.test("assertFileWithinWorkspace - accepts the base path itself", () => {
  const resolved = assertFileWithinWorkspace("/workspace", "/workspace");
  assertEquals(resolved, "/workspace");
});

Deno.test("assertFileWithinWorkspace - rejects absolute paths outside base", () => {
  assertThrows(
    () => assertFileWithinWorkspace("/etc/passwd", "/workspace"),
    Error,
    "outside of current working directory",
  );
});

Deno.test("assertFileWithinWorkspace - rejects relative paths escaping base", () => {
  assertThrows(
    () => assertFileWithinWorkspace("../outside.ts", "/workspace"),
    Error,
    "outside of current working directory",
  );
  assertThrows(
    () => assertFileWithinWorkspace("../../etc/passwd", "/workspace"),
    Error,
    "outside of current working directory",
  );
});

Deno.test("assertFileWithinWorkspace - rejects sibling directory with common prefix", () => {
  // "/workspace-other" shares a string prefix with "/workspace" but is not
  // inside it.
  assertThrows(
    () => assertFileWithinWorkspace("/workspace-other/file.ts", "/workspace"),
    Error,
    "outside of current working directory",
  );
});

Deno.test("assertFileWithinWorkspace - normalizes relative paths with inner traversal", () => {
  // "a/../b" normalizes to "b", which stays inside the workspace.
  const resolved = assertFileWithinWorkspace("a/../b/file.ts", "/workspace");
  assertEquals(resolved, "/workspace/b/file.ts");
});

Deno.test("assertUniqueString - passes when contained appears exactly once", () => {
  assertUniqueString("hello world", "hello");
  assertUniqueString("hello world", "world");
  assertUniqueString("abc", "abc");
});

Deno.test("assertUniqueString - passes when contained does not appear", () => {
  // indexOf === lastIndexOf === -1 when absent
  assertUniqueString("hello world", "goodbye");
});

Deno.test("assertUniqueString - throws when contained appears multiple times", () => {
  assertThrows(
    () => assertUniqueString("hello hello hello", "hello"),
    Error,
    "non-unique string",
  );
  assertThrows(
    () => assertUniqueString("abab", "ab"),
    Error,
    "non-unique string",
  );
  // overlapping occurrences: "aa" is found at index 0 and index 1
  assertThrows(
    () => assertUniqueString("aaa", "aa"),
    Error,
    "non-unique string",
  );
});

Deno.test("assertOnlyOneDefined - exactly one defined", () => {
  const result = assertOnlyOneDefined([undefined, "value", undefined]);
  assertEquals(result, { exact: true, none: false, excess: false });
});

Deno.test("assertOnlyOneDefined - none defined", () => {
  const result = assertOnlyOneDefined([undefined, undefined, undefined]);
  assertEquals(result, { exact: false, none: true, excess: false });
});

Deno.test("assertOnlyOneDefined - excess defined", () => {
  const result = assertOnlyOneDefined(["a", "b", undefined]);
  assertEquals(result, { exact: false, none: false, excess: true });
});

Deno.test("assertOnlyOneDefined - all defined", () => {
  const result = assertOnlyOneDefined(["a", "b", "c"]);
  assertEquals(result, { exact: false, none: false, excess: true });
});

Deno.test("assertOnlyOneDefined - empty array counts as none", () => {
  const result = assertOnlyOneDefined([]);
  assertEquals(result, { exact: false, none: true, excess: false });
});

Deno.test("assertOnlyOneDefined - null counts as defined", () => {
  // Only `undefined` is treated as "not defined"; null is a real value.
  const result = assertOnlyOneDefined([null, undefined]);
  assertEquals(result, { exact: true, none: false, excess: false });
});

Deno.test("assertOnlyOneDefined - falsy values count as defined", () => {
  const result = assertOnlyOneDefined([0, false, ""]);
  assertEquals(result, { exact: false, none: false, excess: true });
  const single = assertOnlyOneDefined([0, undefined]);
  assert(single.exact);
});
