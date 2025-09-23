import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';
import applyCors from './_cors.js';

function createReq({ method, url, headers = {}, body }) {
  const stream = body !== undefined ? Readable.from([body]) : Readable.from([]);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    host: 'example.com',
    origin: 'http://example.com',
    ...headers,
  };
  return stream;
}
function createRes() {
  const headers = {};
  let statusCode = 200;
  let payload;
  return {
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
    status(code) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      this.body = data;
      return this;
    },
    end(data) {
      if (data !== undefined) {
        payload = data;
        this.body = data;
      }
      return this;
    },
    getStatus() {
      return statusCode;
    },
    getJSON() {
      return payload;
    },
  };
}
test('in-memory handler returns list payload with from alias', async () => {
  delete process.env.base_url;
  process.env.JWT_SECRET = 'secret123';
  const { default: handler } = await import('./messages.js?mem');

    try {
       const token = jwt.sign({ nick: 'nick' }, process.env.JWT_SECRET);
       const postReq = createReq({
         method: 'POST',
         url: '/api/messages?channel=%23wtf',
         headers: {
           'content-type': 'application/json',
           authorization: `Bearer ${token}`,
         },
         body: JSON.stringify({ text: 'hello world', from: 'nick' }),
       });
       const postRes = createRes();
       await handler(postReq, postRes);

test("anonymous readers cannot fetch whispers", () => {
  assert.throws(() => ensureReadPermissions({ headers: {} }, "dm:alice|bob"), (err) => {
    assert.equal(err.status, 401);
    assert.equal(err.code, "auth_required");
    return true;
  });
});

        const getReq = createReq({
              method: 'GET',
              url: '/api/messages?channel=%23wtf',
            });
            const getRes = createRes();
            await handler(getReq, getRes);

        assert.equal(getRes.getStatus(), 200);
           const { list } = getRes.getJSON();
           assert.ok(Array.isArray(list));
           assert.equal(list.length, 1);
           const message = list[0];
           assert.equal(message.id, postBody.id);
           assert.equal(message.channel, '#wtf');
           assert.equal(message.author, 'nick');
           assert.equal(message.from, 'nick');
           assert.equal(message.text, 'hello world');
           assert.equal(typeof message.ts, 'number');
         } finally {
           delete process.env.JWT_SECRET;
         }
});

test('postgres handler returns list payload with from alias', async () => {
  process.env.base_url = 'postgres://example';
  const { default: handler } = await import('./messages.js?db');

    const rows = [
       { id: 'a', author: 'alice', text: 'hi', ts: 111 },
       { id: 'b', author: 'bob', text: 'sup', ts: 222 },
     ];
    const originalConnect = Client.prototype.connect;
    const originalEnd = Client.prototype.end;
    const originalQuery = Client.prototype.query;

    Client.prototype.connect = async () => {};
    Client.prototype.end = async () => {};
    Client.prototype.query = async () => ({ rows });

    try {
      const getReq = createReq({
        method: 'GET',
        url: '/api/messages?channel=%23wtf',
      });
      const getRes = createRes();
      await handler(getReq, getRes);

        assert.equal(getRes.getStatus(), 200);
          assert.deepEqual(getRes.getJSON(), {
            list: rows.map(r => ({
              id: r.id,
              channel: '#wtf',
              author: r.author,
              from: r.author,
              text: r.text,
              ts: r.ts,
            })),
          });
        } finally {
          Client.prototype.connect = originalConnect;
          Client.prototype.end = originalEnd;
          Client.prototype.query = originalQuery;
          delete process.env.base_url;
        }
});
