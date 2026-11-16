const tabsElement = document.querySelector("#semester-tabs");
const coursesElement = document.querySelector("#course-list");
const searchElement = document.querySelector("#course-search");
const emptyStateElement = document.querySelector("#empty-state");
const courseDetailElement = document.querySelector("#course-detail");
const aiStatus = document.querySelector("#ai-status");

let syllabus;
let chapterCatalog;
let selectedSemester = null;
let selectedCourse = null;
let searchTerm = "";

function allCoursesForSemester(semester) {
  return [
    ...semester.courses.map((course) => ({ ...course, electiveGroup: null })),
    ...semester.electives.flatMap((group) =>
      group.courses.map((course) => ({ ...course, electiveGroup: group.group })),
    ),
  ];
}

function openAssistant(action, chapterNumber) {
  const params = new URLSearchParams({
    semester: String(selectedSemester),
    courseCode: selectedCourse.code,
    action,
  });
  if (chapterNumber !== undefined) {
    params.set("unitNumber", String(chapterNumber));
  }
  window.location.href = `./assistant.html?${params.toString()}`;
}

function selectCourse(course, semesterNumber) {
  selectedSemester = semesterNumber;
  selectedCourse = course;
  renderTabs();
  renderCourses();
  renderCourseDetail();
  courseDetailElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderTabs() {
  tabsElement.replaceChildren();

  for (const semester of syllabus.semesters) {
    const button = document.createElement("button");
    button.className = "semester-tab";
    button.type = "button";
    button.textContent = `Semester ${semester.number}`;
    button.setAttribute("aria-pressed", String(semester.number === selectedSemester));
    button.addEventListener("click", () => {
      selectedSemester = semester.number;
      const currentSemesterCourses = allCoursesForSemester(semester);
      if (!currentSemesterCourses.some((course) => course.code === selectedCourse?.code)) {
        selectedCourse = semester.courses[0] ?? currentSemesterCourses[0] ?? null;
      }
      renderTabs();
      renderCourses();
      renderCourseDetail();
    });
    tabsElement.append(button);
  }
}

function createCourseCard(course, semesterNumber) {
  const card = document.createElement("article");
  card.className = "course-card";

  const top = document.createElement("div");
  top.className = "course-card-top";

  const code = document.createElement("span");
  code.className = "course-code";
  code.textContent = course.code;

  const badge = document.createElement("span");
  badge.className = course.electiveGroup ? "course-type elective-type" : "course-type";
  badge.textContent = course.electiveGroup ?? "Core";
  top.append(code, badge);

  const title = document.createElement("h3");
  title.textContent = course.title;

  const meta = document.createElement("p");
  meta.className = "course-meta";
  meta.textContent = `${course.credits} credits · ${course.full_marks} full marks`;

  const button = document.createElement("button");
  button.className = "study-button";
  button.type = "button";
  button.textContent = selectedCourse?.code === course.code ? "Selected ✓" : "View chapters";
  button.setAttribute("aria-pressed", String(selectedCourse?.code === course.code));
  button.addEventListener("click", () => selectCourse(course, semesterNumber));

  card.append(top, title, meta, button);
  return card;
}

function renderCourses() {
  const semester = syllabus.semesters.find((item) => item.number === selectedSemester);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const matches = (course) =>
    `${course.code} ${course.title}`.toLowerCase().includes(normalizedSearch);

  coursesElement.replaceChildren();
  let visibleCount = 0;

  for (const course of semester.courses.filter(matches)) {
    coursesElement.append(createCourseCard(course, semester.number));
    visibleCount += 1;
  }

  for (const group of semester.electives) {
    const matchingCourses = group.courses.filter(matches);
    if (matchingCourses.length === 0) continue;

    const details = document.createElement("details");
    details.className = "elective-group";
    details.open = normalizedSearch.length > 0;

    const summary = document.createElement("summary");
    summary.textContent = `${group.group} · ${matchingCourses.length} options`;
    details.append(summary);

    const electiveGrid = document.createElement("div");
    electiveGrid.className = "course-grid elective-grid";
    for (const course of matchingCourses) {
      electiveGrid.append(createCourseCard({ ...course, electiveGroup: group.group }, semester.number));
      visibleCount += 1;
    }

    details.append(electiveGrid);
    coursesElement.append(details);
  }

  emptyStateElement.hidden = visibleCount > 0;
}

function renderCourseDetail() {
  courseDetailElement.replaceChildren();
  courseDetailElement.hidden = false;

  if (!selectedCourse) {
    courseDetailElement.hidden = true;
    return;
  }

  const heading = document.createElement("div");
  heading.className = "chapter-heading";
  const headingCopy = document.createElement("div");

  const label = document.createElement("p");
  label.className = "eyebrow";
  label.textContent = "SUBJECT GUIDE";

  const title = document.createElement("h3");
  title.textContent = selectedCourse.title;
  headingCopy.append(label, title);

  const sourceBadge = document.createElement("span");
  sourceBadge.className = "chapter-source";
  sourceBadge.textContent = "From supplied PDF";
  heading.append(headingCopy, sourceBadge);
  courseDetailElement.append(heading);

  const chapters = chapterCatalog.courses[selectedCourse.code] ?? [];
  if (chapters.length === 0) {
    const unavailable = document.createElement("p");
    unavailable.className = "chapter-notice";
    unavailable.textContent =
      "Chapter details for this course are not in the supplied PDF. Ask the AI assistant for a general study outline; it will be labeled as AI-generated, not an official TU chapter list.";
    courseDetailElement.append(unavailable);

    const outlineLink = document.createElement("a");
    outlineLink.className = "practice-button";
    outlineLink.href = `./assistant.html?semester=${selectedSemester}&courseCode=${encodeURIComponent(selectedCourse.code)}&action=outline`;
    outlineLink.textContent = "Ask AI for a general outline";
    courseDetailElement.append(outlineLink);
    return;
  }

  const chapterNote = document.createElement("p");
  chapterNote.className = "chapter-notice";
  chapterNote.textContent =
    "Unit titles and lecture hours are transcribed from the supplied PDF. Ask the AI assistant to create original practice exercises for a unit.";
  courseDetailElement.append(chapterNote);

  const list = document.createElement("div");
  list.className = "chapter-list";

  for (const chapter of chapters) {
    const item = document.createElement("article");
    item.className = "chapter-card";

    const itemTop = document.createElement("div");
    itemTop.className = "chapter-card-top";

    const chapterNumber = document.createElement("span");
    chapterNumber.className = "chapter-number";
    chapterNumber.textContent = `Unit ${chapter.number}`;

    const hours = document.createElement("span");
    hours.className = "chapter-hours";
    hours.textContent = `${chapter.hours} hours`;
    itemTop.append(chapterNumber, hours);

    const chapterTitle = document.createElement("h4");
    chapterTitle.textContent = chapter.title;

    const practiceLink = document.createElement("a");
    practiceLink.className = "practice-button";
    practiceLink.href = `./assistant.html?semester=${selectedSemester}&courseCode=${encodeURIComponent(selectedCourse.code)}&action=practice&unitNumber=${chapter.number}`;
    practiceLink.textContent = "Practise this unit →";

    item.append(itemTop, chapterTitle, practiceLink);
    list.append(item);
  }

  courseDetailElement.append(list);
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

async function loadSyllabus() {
  try {
    const [syllabusResponse, chaptersResponse] = await Promise.all([
      fetch("./TU-BSc-CSIT-Syllabus.json"),
      fetch("./TU-CSIT-Chapters.json"),
    ]);
    if (!syllabusResponse.ok) {
      throw new Error(`Could not load syllabus (HTTP ${syllabusResponse.status}).`);
    }
    if (!chaptersResponse.ok) {
      throw new Error(`Could not load chapter list (HTTP ${chaptersResponse.status}).`);
    }

    [syllabus, chapterCatalog] = await Promise.all([
      syllabusResponse.json(),
      chaptersResponse.json(),
    ]);
    if (!Array.isArray(syllabus.semesters) || syllabus.semesters.length !== 8) {
      throw new Error("The syllabus file should contain all eight semesters.");
    }
    if (!chapterCatalog.courses || typeof chapterCatalog.courses !== "object") {
      throw new Error("The chapter file does not contain course units.");
    }

    selectedSemester = syllabus.semesters[0].number;
    selectedCourse = syllabus.semesters[0].courses[0] ?? null;
    renderTabs();
    renderCourses();
    renderCourseDetail();
    checkAiStatus();
  } catch (error) {
    const message = document.createElement("p");
    message.className = "load-error";
    message.textContent = `${error.message} Make sure the syllabus JSON file is next to the app files.`;
    coursesElement.replaceChildren(message);
  }
}

searchElement.addEventListener("input", (event) => {
  searchTerm = event.target.value;
  if (syllabus) renderCourses();
});

loadSyllabus();
