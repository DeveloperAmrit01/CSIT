const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_LENGTH = 8;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/assistant.html", ["assistant.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/TU-BSc-CSIT-Syllabus.json", ["TU-BSc-CSIT-Syllabus.json", "application/json; charset=utf-8"]],
  ["/TU-CSIT-Chapters.json", ["TU-CSIT-Chapters.json", "application/json; charset=utf-8"]],
]);

const syllabus = require("./TU-BSc-CSIT-Syllabus.json");
const chapterCatalog = require("./TU-CSIT-Chapters.json");

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function clientError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBody(request) {
  if (request.body !== undefined) {
    let parsedBody = request.body;
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        throw clientError(400, "Send a valid JSON request.");
      }
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      throw clientError(400, "Send a valid JSON object.");
    }
    if (Buffer.byteLength(JSON.stringify(parsedBody)) > MAX_BODY_BYTES) {
      throw clientError(413, "The message is too large.");
    }
    return parsedBody;
  }

  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    request.resume();
    throw clientError(413, "The message is too large.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      throw clientError(413, "The message is too large.");
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw clientError(400, "Send a valid JSON request.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw clientError(400, "Send a valid JSON object.");
  }
  return body;
}

function normalizeHistory(history) {
  if (history === undefined) return [];
  if (!Array.isArray(history) || history.length > MAX_HISTORY_LENGTH) {
    throw clientError(400, "Chat history must contain no more than 8 messages.");
  }

  return history.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !["user", "assistant"].includes(item.role) ||
      typeof item.text !== "string" ||
      item.text.trim().length === 0 ||
      item.text.length > MAX_MESSAGE_LENGTH
    ) {
      throw clientError(400, "Chat history contains an invalid message.");
    }
    return {
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.text.trim() }],
    };
  });
}

function findCourse(semesterNumber, courseCode) {
  if (!Number.isInteger(semesterNumber) || typeof courseCode !== "string") return null;
  const semester = syllabus.semesters.find((item) => item.number === semesterNumber);
  if (!semester) return null;
  return [
    ...semester.courses,
    ...semester.electives.flatMap((group) => group.courses),
  ].find((course) => course.code === courseCode);
}

function getSystemInstruction(course, semesterNumber, chapters) {
  const unitScope = syllabus.source.detailed_unit_scope;
  const chapterList = chapters.length
    ? `Verified chapter/unit titles in the provided PDF for this course: ${chapters
        .map((chapter) => `Unit ${chapter.number}: ${chapter.title}`)
        .join("; ")}.`
    : "No detailed chapter/unit titles for this course were present in the provided PDF. Do not invent an official chapter list; label any suggested outline as general AI-generated study guidance.";
  return [
    "You are CSIT Study Buddy, a friendly tutor helping a Tribhuvan University B.Sc. CSIT student.",
    "Explain concepts in clear, simple language. Use small steps, concrete examples, and readable formatting.",
    "For practice questions or mock tests, create original questions, label them as practice (not official exam questions), and include a separate answer key with brief explanations.",
    "Keep answers relevant to the selected course. If asked for an exact official unit, marking scheme, or current syllabus detail that is not provided, say you do not have that verified detail instead of inventing it.",
    "The course catalog is from a 2017 curriculum effective from academic year 2074 and has not been verified as current. " + unitScope,
    chapterList,
    `Selected course: Semester ${semesterNumber}, ${course.code} - ${course.title}.`,
  ].join("\n");
}

function validateOrigin(request, isVercel) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const parsedOrigin = new URL(origin);
    const forwardedProtocol = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
    const forwardedHost = request.headers["x-forwarded-host"]?.split(",")[0]?.trim();
    const expectedProtocol = forwardedProtocol || (isVercel ? "https" : "http");
    const expectedHost = forwardedHost || request.headers.host;
    return parsedOrigin.protocol === `${expectedProtocol}:` && parsedOrigin.host === expectedHost;
  } catch {
    return false;
  }
}

function createServer(config = {}) {
  const apiKey = Object.hasOwn(config, "apiKey") ? config.apiKey : process.env.GEMINI_API_KEY;
  const model = config.model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const apiBaseUrl = (config.geminiApiBaseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const isVercel = config.isVercel === true;
  const requestTimeout = isVercel ? 8000 : 45000;

  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) {
    throw new Error("GEMINI_MODEL contains unsupported characters.");
  }

  return http.createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");

    const pathname = new URL(request.url, "http://127.0.0.1").pathname;

    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { configured: typeof apiKey === "string" && apiKey.trim().length > 0 });
      return;
    }

    if (pathname === "/api/chat") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "Use POST to send a chat message." });
        return;
      }

      if (!validateOrigin(request, isVercel)) {
        sendJson(response, 403, { error: "Requests must come from this app." });
        return;
      }

      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, { error: "Send the message as JSON." });
        return;
      }

      try {
        const body = await readJsonBody(request);
        if (typeof body.message !== "string" || body.message.trim().length === 0 || body.message.length > MAX_MESSAGE_LENGTH) {
          throw clientError(400, "Enter a message up to 2,000 characters.");
        }

        const course = findCourse(body.semester, body.courseCode);
        if (!course) {
          throw clientError(400, "Choose a course from the syllabus before chatting.");
        }
        const chapters = chapterCatalog.courses[course.code] ?? [];

        const messages = normalizeHistory(body.history);
        messages.push({ role: "user", parts: [{ text: body.message.trim() }] });

        if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
          sendJson(response, 503, {
            error: isVercel
              ? "Gemini is not configured. Add GEMINI_API_KEY in Vercel project settings and redeploy."
              : "Gemini is not configured yet. Add your key to the local .env file and restart the app.",
          });
          return;
        }

        const endpoint = new URL(
          `${apiBaseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        );
        endpoint.searchParams.set("key", apiKey.trim());

        let providerResponse;
        try {
          providerResponse = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: getSystemInstruction(course, body.semester, chapters) }],
              },
              contents: messages,
              generationConfig: { temperature: 0.6, maxOutputTokens: 1200 },
            }),
            signal: AbortSignal.timeout(requestTimeout),
          });
        } catch (error) {
          if (error.name === "TimeoutError" || error.name === "AbortError") {
            sendJson(response, 504, { error: "The study tutor took too long to respond. Please try again." });
          } else {
            sendJson(response, 502, { error: "Could not connect to Gemini. Check your internet connection and try again." });
          }
          return;
        }

        let providerData = null;
        try {
          providerData = await providerResponse.json();
        } catch {
          providerData = null;
        }

        if (!providerResponse.ok) {
          if (providerResponse.status === 429) {
            sendJson(response, 429, { error: "Gemini is temporarily rate-limited. Wait a little and try again." });
          } else if (providerResponse.status === 401 || providerResponse.status === 403) {
            sendJson(response, 502, {
              error: isVercel
                ? "Gemini rejected the API key. Check GEMINI_API_KEY in Vercel project settings."
                : "Gemini rejected the API key. Check GEMINI_API_KEY in your local .env file.",
            });
          } else {
            sendJson(response, 502, { error: "Gemini could not complete that request. Please try again." });
          }
          return;
        }

        const reply = providerData?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text)
          .filter((text) => typeof text === "string")
          .join("")
          .trim();

        if (!reply) {
          const blocked = providerData?.promptFeedback?.blockReason;
          sendJson(
            response,
            502,
            { error: blocked ? "Gemini could not answer that prompt. Try rephrasing it." : "Gemini returned no answer. Please try again." },
          );
          return;
        }

        sendJson(response, 200, { reply });
      } catch (error) {
        if (error.statusCode) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        console.error("Chat request failed:", error.message);
        sendJson(response, 500, { error: "The app could not process that message. Please try again." });
      }
      return;
    }

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "This method is not supported." });
      return;
    }

    const file = STATIC_FILES.get(pathname);
    if (!file) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    try {
      const contents = fs.readFileSync(path.join(ROOT, file[0]));
      response.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-store",
      });
      response.end(contents);
    } catch (error) {
      console.error("Could not read app file:", error.message);
      sendJson(response, 500, { error: "The app could not load a required file." });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }

  createServer().listen(port, "127.0.0.1", () => {
    console.log(`CSIT Study Buddy is running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
