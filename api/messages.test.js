import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "testsecret";
process.env.UPSTASH_REDIS_REST_URL = "https://example.com";
process.env.UPSTASH_REDIS_REST_TOKEN = "test";

const {
  ensureReadPermissions,
  ensureWritePermissions
} = await import("./messages.js");

const tokenFor = (nick) => jwt.sign({ nick }, process.env.JWT_SECRET);
const reqWithToken = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

test("anonymous posts to public channel are allowed", () => {
  const res = ensureWritePermissions({ headers: {} }, "#wtf", "anon");
  assert.equal(res.author, "anon");
  assert.equal(res.channel, "#wtf");
});

test("anonymous readers cannot fetch whispers", () => {
  assert.throws(() => ensureReadPermissions({ headers: {} }, "dm:alice|bob"), (err) => {
    assert.equal(err.status, 401);
    assert.equal(err.code, "auth_required");
    return true;
  });
});

test("non participants cannot read whispers", () => {
  const req = reqWithToken(tokenFor("mallory"));
  assert.throws(() => ensureReadPermissions(req, "dm:alice|bob"), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, "dm_forbidden");
    return true;
  });
});

test("participants can read their whispers", () => {
  const req = reqWithToken(tokenFor("alice"));
  const res = ensureReadPermissions(req, "dm:alice|bob");
  assert.equal(res.channel, "dm:alice|bob");
  assert.equal(res.nick, "alice");
});

test("named posts require authentication", () => {
  assert.throws(() => ensureWritePermissions({ headers: {} }, "#wtf", "alice"), (err) => {
    assert.equal(err.status, 401);
    assert.equal(err.code, "auth_required");
    return true;
  });
});

test("token nick must match named posts", () => {
  const req = reqWithToken(tokenFor("bob"));
  assert.throws(() => ensureWritePermissions(req, "#wtf", "alice"), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, "author_mismatch");
    return true;
  });
});

test("dm posts adopt the verified nick", () => {
  const req = reqWithToken(tokenFor("alice"));
  const res = ensureWritePermissions(req, "dm:alice|bob", "anon");
  assert.equal(res.channel, "dm:alice|bob");
  assert.equal(res.author, "alice");
});

test("outsiders cannot post to others' whispers", () => {
  const req = reqWithToken(tokenFor("mallory"));
  assert.throws(() => ensureWritePermissions(req, "dm:alice|bob", "mallory"), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, "dm_forbidden");
    return true;
  });
});
