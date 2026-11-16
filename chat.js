const semesterSelect = document.querySelector("#assistant-semester");
const courseSelect = document.querySelector("#assistant-course");
const messagesElement = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const courseContext = document.querySelector("#course-context");
const aiStatus = document.querySelector("#ai-status");
const pageParams = new URLSearchParams(window.location.search);

let syllabus;
let chapterCatalog;
let selectedSemester = null;
let selectedCourse = null;
let conversation = [];
let isSending = false;

function coursesForSemester(semester) {
  return [
    ...semester.courses.map((course) => ({ ...course, electiveGroup: null })),
    ...semester.electives.flatMap((group) =>
      group.courses.map((course) => ({ ...course, electiveGroup: group.group })),
    ),
  ];
}

function renderSemesterOptions(initialSemester) {
  semesterSelect.replaceChildren();
  for (const semester of syllabus.semesters) {
    const option = document.createElement("option");
    option.value = String(semester.number);
    option.textContent = `Semester ${semester.number}`;
    semesterSelect.append(option);
  }
  semesterSelect.value = String(initialSemester);
}

function renderCourseOptions(preferredCourseCode) {
  const semester = syllabus.semesters.find((item) => item.number === selectedSemester);
  courseSelect.replaceChildren();

  const coreGroup = document.createElement("optgroup");
  coreGroup.label = "Core subjects";
  for (const course of semester.courses) {
    coreGroup.append(createCourseOption(course));
  }
  courseSelect.append(coreGroup);

  for (const group of semester.electives) {
    const electiveGroup = document.createElement("optgroup");
    electiveGroup.label = group.group;
    for (const course of group.courses) {
      electiveGroup.append(createCourseOption(course));
    }
    courseSelect.append(electiveGroup);
  }

  const allCourses = coursesForSemester(semester);
  selectedCourse = allCourses.find((course) => course.code === preferredCourseCode) ??
    semester.courses[0] ??
    allCourses[0] ??
    null;
  courseSelect.value = selectedCourse?.code ?? "";
  updateCourseContext();
}

function createCourseOption(course) {
  const option = document.createElement("option");
  option.value = course.code;
  option.textContent = `${course.code} · ${course.title}`;
  return option;
}

function updateCourseContext() {
  courseContext.textContent = selectedCourse
    ? `Semester ${selectedSemester} · ${selectedCourse.code} ${selectedCourse.title}`
    : "Choose a semester and subject to begin";
}

function appendMessage(role, text, pending = false) {
  const message = document.createElement("div");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Study Assistant";

  const bubble = document.createElement("p");
  bubble.className = pending ? "message-text typing-indicator" : "message-text";
  bubble.textContent = text;

  message.append(label, bubble);
  messagesElement.append(message);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return bubble;
}

function resetConversation() {
  conversation = [];
  messagesElement.replaceChildren();
  updateCourseContext();
  appendMessage(
    "assistant",
    `Hi! Ask me anything about ${selectedCourse.title}. You can request a simple explanation, an example, or practice questions.`,
  );
}

async function checkAiStatus() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Status check failed.");
    const status = await response.json();
    aiStatus.className = status.configured ? "status-pill status-ready" : "status-pill status-missing";
    aiStatus.textContent = status.configured ? "AI ready" : "AI setup needed";
  } catch {
    aiStatus.className = "status-pill status-missing";
    aiStatus.textContent = "Start app server";
  }
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || isSending || !selectedCourse) return;

  isSending = true;
  sendButton.disabled = true;
  chatInput.disabled = true;
  conversation.push({ role: "user", text: message });
  const userBubble = appendMessage("user", message);
  const pendingBubble = appendMessage("assistant", "Thinking...", true);
  chatInput.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        semester: selectedSemester,
        courseCode: selectedCourse.code,
        history: conversation.slice(-9, -1),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "The assistant could not answer. Please try again.");
    }

    conversation.push({ role: "assistant", text: result.reply });
    pendingBubble.textContent = result.reply;
    pendingBubble.classList.remove("typing-indicator");
  } catch (error) {
    conversation.pop();
    userBubble.parentElement.remove();
    pendingBubble.textContent = error.message || "Could not reach the assistant. Please try again.";
    pendingBubble.classList.remove("typing-indicator");
    pendingBubble.classList.add("message-error");
    checkAiStatus();
  } finally {
    isSending = false;
    sendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }
}

function getLinkedPrompt() {
  const action = pageParams.get("action");
  if (action === "outline") {
    return `Suggest a general study outline of useful topics for ${selectedCourse.title}. Clearly label this as AI-generated study guidance, not the official TU syllabus. Do not invent or claim official unit or chapter numbers.`;
  }
  if (action !== "practice") return null;

  const unitNumber = Number(pageParams.get("unitNumber"));
  const chapter = (chapterCatalog.courses[selectedCourse.code] ?? [])
    .find((unit) => unit.number === unitNumber);
  if (!chapter) {
    appendMessage(
      "assistant",
      "That unit link is invalid or the unit is not in the supplied chapter list. Choose a subject again from the courses page.",
    );
    return null;
  }

  return `Create 5 original practice exercises for Unit ${chapter.number}: ${chapter.title} in ${selectedCourse.title}. Give the questions first, then provide an answer key with step-by-step explanations. Label them as AI-generated practice, not official TU questions.`;
}

async function loadAssistant() {
  try {
    const [syllabusResponse, chaptersResponse] = await Promise.all([
      fetch("./TU-BSc-CSIT-Syllabus.json"),
      fetch("./TU-CSIT-Chapters.json"),
    ]);
    if (!syllabusResponse.ok || !chaptersResponse.ok) {
      throw new Error("Could not load the course catalog. Return to the Courses page and restart the app if needed.");
    }
    [syllabus, chapterCatalog] = await Promise.all([
      syllabusResponse.json(),
      chaptersResponse.json(),
    ]);

    const requestedSemester = Number(pageParams.get("semester"));
    selectedSemester = syllabus.semesters.some((semester) => semester.number === requestedSemester)
      ? requestedSemester
      : syllabus.semesters[0].number;
    renderSemesterOptions(selectedSemester);
    renderCourseOptions(pageParams.get("courseCode"));
    resetConversation();
    checkAiStatus();

    const linkedPrompt = getLinkedPrompt();
    if (linkedPrompt) sendMessage(linkedPrompt);
  } catch (error) {
    appendMessage("assistant", error.message);
  }
}

semesterSelect.addEventListener("change", () => {
  selectedSemester = Number(semesterSelect.value);
  renderCourseOptions(null);
  resetConversation();
});

courseSelect.addEventListener("change", () => {
  const semester = syllabus.semesters.find((item) => item.number === selectedSemester);
  selectedCourse = coursesForSemester(semester)
    .find((course) => course.code === courseSelect.value) ?? null;
  resetConversation();
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(chatInput.value);
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

loadAssistant();
