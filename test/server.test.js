const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { createServer } = require("../server");
const vercelChatFunction = require("../api/chat");
const vercelHealthFunction = require("../api/health");

let geminiServer;
let appServer;
let appUrl;
let geminiRequests = [];
let geminiStatus = 200;
let geminiPayload;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

before(async () => {
  geminiRequests = [];
  geminiStatus = 200;
  geminiPayload = {
    candidates: [
      {
        content: {
          parts: [{ text: "A database index is like a book index." }],
        },
      },
    ],
  };

  geminiServer = http.createServer(async (request, response) => {
    geminiRequests.push({
      url: new URL(request.url, "http://127.0.0.1"),
      body: await readRequestBody(request),
    });
    response.writeHead(geminiStatus, { "Content-Type": "application/json" });
    response.end(JSON.stringify(geminiPayload));
  });
  const geminiPort = await listen(geminiServer);

  appServer = createServer({
    apiKey: "test-key-not-a-real-secret",
    model: "test-model",
    geminiApiBaseUrl: `http://127.0.0.1:${geminiPort}`,
  });
  const appPort = await listen(appServer);
  appUrl = `http://127.0.0.1:${appPort}`;
});

after(async () => {
  await Promise.all([close(appServer), close(geminiServer)]);
});

test("serves separate courses and assistant pages with clear navigation", async () => {
  const [pageResponse, assistantResponse, chatScriptResponse, healthResponse, secretResponse, chapterResponse] = await Promise.all([
    fetch(appUrl),
    fetch(`${appUrl}/assistant.html`),
    fetch(`${appUrl}/chat.js`),
    fetch(`${appUrl}/api/health`),
    fetch(`${appUrl}/.env`),
    fetch(`${appUrl}/TU-CSIT-Chapters.json`),
  ]);
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /CSIT Study Buddy/);
  assert.match(page, /Ask AI Assistant/);
  assert.match(page, /href="\.\/assistant\.html"/);
  assert.doesNotMatch(page, /id="chat-form"/);
  assert.equal(assistantResponse.status, 200);
  const assistantPage = await assistantResponse.text();
  assert.match(assistantPage, /Ask the AI Assistant/);
  assert.match(assistantPage, /assistant-semester/);
  assert.match(assistantPage, /assistant-course/);
  assert.match(assistantPage, /id="chat-form"/);
  assert.equal(chatScriptResponse.status, 200);
  assert.match(await chatScriptResponse.text(), /getLinkedPrompt/);
  assert.deepEqual(await healthResponse.json(), { configured: true });
  assert.equal(secretResponse.status, 404);
  const chapterCatalog = await chapterResponse.json();
  assert.equal(chapterCatalog.courses.MTH112.length, 10);
  assert.equal(chapterCatalog.courses.MTH112[0].title, "Function of One Variable");
});

test("provides PDF unit lists for every core course in semesters I-IV", async () => {
  const [syllabusResponse, chaptersResponse] = await Promise.all([
    fetch(`${appUrl}/TU-BSc-CSIT-Syllabus.json`),
    fetch(`${appUrl}/TU-CSIT-Chapters.json`),
  ]);
  const courseSyllabus = await syllabusResponse.json();
  const chapterCatalog = await chaptersResponse.json();

  for (const semester of courseSyllabus.semesters.slice(0, 4)) {
    for (const course of semester.courses) {
      assert.ok(
        chapterCatalog.courses[course.code]?.length > 0,
        `Expected PDF unit titles for ${course.code} ${course.title}`,
      );
    }
  }

  assert.equal(chapterCatalog.courses.MTH163.length, 10);
  assert.equal(chapterCatalog.courses.STA164[4].title, "Random Variables and Mathematical Expectation");
});

test("validates chat input before calling Gemini", async () => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Explain indexes",
      semester: 4,
      courseCode: "NOT-A-COURSE",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(geminiRequests.length, 0);
});

test("sends selected course context and extracts Gemini's nested text response", async () => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Explain database indexes simply",
      semester: 4,
      courseCode: "CSC260",
      history: [{ role: "assistant", text: "We are studying DBMS." }],
    }),
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result, { reply: "A database index is like a book index." });
  assert.equal(geminiRequests.length, 1);
  assert.equal(geminiRequests[0].url.pathname, "/v1beta/models/test-model:generateContent");
  assert.equal(geminiRequests[0].url.searchParams.get("key"), "test-key-not-a-real-secret");
  assert.equal(geminiRequests[0].body.contents[0].role, "model");
  assert.equal(geminiRequests[0].body.contents[1].role, "user");
  assert.match(geminiRequests[0].body.systemInstruction.parts[0].text, /Database Management System/);
  assert.match(geminiRequests[0].body.systemInstruction.parts[0].text, /Unit 6: SQL/);
  assert.deepEqual(geminiRequests[0].body.generationConfig, {
    temperature: 0.6,
    maxOutputTokens: 1200,
  });
  assert.doesNotMatch(JSON.stringify(result), /test-key-not-a-real-secret/);
});

test("returns a clear rate-limit response from Gemini", async () => {
  geminiStatus = 429;
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Create a practice quiz",
      semester: 4,
      courseCode: "CSC260",
    }),
  });

  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /rate-limited/);
});

test("rejects cross-origin chat requests", async () => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://example.com",
    },
    body: JSON.stringify({
      message: "Explain indexes",
      semester: 4,
      courseCode: "CSC260",
    }),
  });
  assert.equal(response.status, 403);
});

test("does not call Gemini when no server key is configured", async () => {
  const unconfiguredServer = createServer({ apiKey: "" });
  const port = await listen(unconfiguredServer);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Explain indexes",
        semester: 4,
        courseCode: "CSC260",
      }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /local \.env file/);
  } finally {
    await close(unconfiguredServer);
  }
  assert.equal(geminiRequests.length, 2);
});

test("accepts Vercel-parsed JSON bodies and same-origin HTTPS chat requests", async () => {
  const vercelApp = createServer({ apiKey: "", isVercel: true });
  const adapter = http.createServer(async (request, response) => {
    if (request.method === "POST") {
      request.body = await readRequestBody(request);
    }
    vercelApp.emit("request", request, response);
  });
  const port = await listen(adapter);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `https://127.0.0.1:${port}`,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        message: "Explain functions",
        semester: 1,
        courseCode: "CSC110",
      }),
    });

    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Vercel project settings/);
  } finally {
    await close(adapter);
  }
});

test("Vercel function entry points serve the health and chat routes", async () => {
  const functions = http.createServer((request, response) => {
    if (request.url.startsWith("/api/chat")) {
      vercelChatFunction(request, response);
    } else {
      vercelHealthFunction(request, response);
    }
  });
  const port = await listen(functions);

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { configured: false });

    const chat = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `https://127.0.0.1:${port}`,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        message: "Explain arrays",
        semester: 1,
        courseCode: "CSC110",
      }),
    });
    assert.equal(chat.status, 503);
    assert.match((await chat.json()).error, /Vercel project settings/);
  } finally {
    await close(functions);
  }
});

test("Vercel deployment excludes the local Gemini environment file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const ignoreRules = fs.readFileSync(path.join(__dirname, "..", ".vercelignore"), "utf8");
  assert.match(ignoreRules, /^\.env$/m);
  assert.match(ignoreRules, /^\.env\.\*$/m);
  assert.match(ignoreRules, /^!\.env\.example$/m);
});
