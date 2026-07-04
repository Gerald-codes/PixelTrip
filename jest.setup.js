// Polyfill fetch globals for jsdom environment
// Node 18+ has these natively but jest-environment-jsdom may not expose them
const { TextEncoder, TextDecoder } = require("util");

if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder;
}

// Ensure fetch API globals are available (Node 18+ provides them)
const nodeFetch = globalThis.fetch;
const nodeResponse = globalThis.Response;
const nodeRequest = globalThis.Request;
const nodeHeaders = globalThis.Headers;

if (!global.fetch) global.fetch = nodeFetch;
if (!global.Response) global.Response = nodeResponse;
if (!global.Request) global.Request = nodeRequest;
if (!global.Headers) global.Headers = nodeHeaders;
