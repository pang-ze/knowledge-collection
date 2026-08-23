const knowledge = window.QA_KNOWLEDGE_DATA;
const qaData = knowledge.index.records;
const taxonomy = knowledge.taxonomy.tags;
const PAGE_SIZE = 10;
const dimensions = ["domains", "concepts", "technologies"];
const ANSWER_API_BASE = "https://learning-notes-api.pang-ze.workers.dev";
const answerCache = new Map();
const answerPromises = new Map();
const selected = Object.fromEntries(dimensions.map((dimension) => [dimension, new Set()]));
let tagQuery = "";
let currentPage = 1;
let renderVersion = 0;
let requestedQaOpened = false;

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

if (window.marked) {
  window.marked.use({
    gfm: true,
    extensions: [
      {
        name: "blockMath",
        level: "block",
        start(source) { return source.indexOf("$$"); },
        tokenizer(source) {
          const match = /^\$\$[ \t]*\r?\n?([\s\S]+?)\r?\n?\$\$(?:\r?\n|$)/.exec(source);
          return match ? { type: "blockMath", raw: match[0], text: match[1].trim() } : undefined;
        },
        renderer(token) { return `<div class="math-block">${escapeHtml(token.text)}</div>`; }
      },
      {
        name: "inlineMath",
        level: "inline",
        start(source) { return source.indexOf("$"); },
        tokenizer(source) {
          const match = /^\$([^$\n]+?)\$/.exec(source);
          return match ? { type: "inlineMath", raw: match[0], text: match[1].trim() } : undefined;
        },
        renderer(token) { return `<span class="math-inline">${escapeHtml(token.text)}</span>`; }
      }
    ]
  });
}

function searchText(key) {
  const tag = taxonomy[key];
  return [key, tag.name_zh, tag.name_en, tag.preferred_name, ...tag.aliases].filter(Boolean).join(" ").toLocaleLowerCase();
}

function displayName(key) {
  return taxonomy[key].preferred_name || taxonomy[key].name_en || taxonomy[key].name_zh || key;
}

function matchesSelections(record) {
  return dimensions.every((dimension) => selected[dimension].size === 0 || [...selected[dimension]].some((key) => record[dimension].includes(key)));
}

function availableTags(dimension) {
  const counts = filteredRecords().flatMap((record) => record[dimension]).reduce((result, key) => {
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  selected[dimension].forEach((key) => { if (!counts.has(key)) counts.set(key, 0); });
  const query = tagQuery.trim().toLocaleLowerCase();
  return [...counts].filter(([key, count]) => (count > 0 || selected[dimension].has(key)) && (!query || searchText(key).includes(query))).sort(([a], [b]) => displayName(a).localeCompare(displayName(b)));
}

function filteredRecords() {
  return qaData.filter((record) => matchesSelections(record));
}

function renderFilters() {
  const ids = { domains: "domain-filter", concepts: "concept-filter", technologies: "technology-filter" };
  for (const dimension of dimensions) {
    const tags = availableTags(dimension);
    byId(ids[dimension]).innerHTML = tags.length ? tags.map(([key, count]) => {
      const tag = taxonomy[key];
      const alternate = [tag.name_zh, tag.name_en].filter((name) => name && name !== displayName(key)).join(" · ");
      return `<button class="tag-button ${selected[dimension].has(key) ? "selected" : ""}" data-dimension="${dimension}" data-key="${escapeHtml(key)}" type="button" title="${escapeHtml(alternate)}"><span>${escapeHtml(displayName(key))}</span><strong>${count}</strong></button>`;
    }).join("") : `<span class="no-match">No matching ${dimension}</span>`;
  }
  document.querySelectorAll(".tag-button[data-dimension]").forEach((button) => button.addEventListener("click", () => {
    const values = selected[button.dataset.dimension];
    values.has(button.dataset.key) ? values.delete(button.dataset.key) : values.add(button.dataset.key);
    currentPage = 1;
    render();
  }));
}

function renderQuestion(markdown) {
  if (!window.marked || !window.DOMPurify) return escapeHtml(markdown);
  return window.DOMPurify.sanitize(window.marked.parseInline(markdown), {
    ALLOWED_TAGS: ["strong", "em", "del", "span"],
    ALLOWED_ATTR: ["class"]
  });
}

function renderMarkdown(markdown) {
  if (!window.marked || !window.DOMPurify) return `<p>${escapeHtml(markdown).replace(/\r?\n/g, "<br>")}</p>`;
  return window.DOMPurify.sanitize(window.marked.parse(markdown));
}

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function renderMath(root = document) {
  if (!window.katex) return;
  root.querySelectorAll(".math-inline, .math-block").forEach((element) => {
    window.katex.render(element.textContent, element, {
      displayMode: element.classList.contains("math-block"),
      throwOnError: false
    });
  });
}

async function copyCode(text, button) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 1400);
}

function enhanceAnswers(root = document) {
  renderMath(root);
  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  root.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
  });
  root.querySelectorAll("pre code").forEach((code) => {
    if (window.hljs) window.hljs.highlightElement(code);
    const pre = code.parentElement;
    const button = document.createElement("button");
    button.className = "code-copy";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code block");
    button.addEventListener("click", () => copyCode(code.textContent, button));
    pre.append(button);
  });
}

function referenceLabel(reference) {
  if (reference.comment) return reference.comment;
  try { return new URL(reference.url).hostname; } catch { return reference.url; }
}

function renderResources(item) {
  const related = item.related_qa.length ? `<section class="qa-resources"><h3>Related QA</h3><ul>${item.related_qa.map((relation) => `<li><a href="${escapeHtml(relation.url)}" target="_blank" rel="noopener noreferrer">${renderQuestion(relation.question)} <span aria-hidden="true">↗</span></a></li>`).join("")}</ul></section>` : "";
  const references = item.references.length ? `<section class="qa-resources"><h3>References</h3><ul>${item.references.map((reference) => `<li><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(referenceLabel(reference))} <span aria-hidden="true">↗</span></a></li>`).join("")}</ul></section>` : "";
  return related + references;
}

async function loadAnswer(card, item) {
  const content = card.querySelector(".answer-content");
  if (answerCache.has(item.id)) {
    content.innerHTML = renderMarkdown(answerCache.get(item.id));
    enhanceAnswers(content);
    return;
  }
  content.innerHTML = `<p class="answer-status">Loading answer…</p>`;
  try {
    if (answerPromises.has(item.id)) await answerPromises.get(item.id);
    if (answerCache.has(item.id)) {
      content.innerHTML = renderMarkdown(answerCache.get(item.id));
      enhanceAnswers(content);
      return;
    }
    const response = await fetchWithTimeout(`${ANSWER_API_BASE}/api/answers/${encodeURIComponent(item.id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    answerCache.set(item.id, payload.answer_markdown);
    content.innerHTML = renderMarkdown(payload.answer_markdown);
    enhanceAnswers(content);
  } catch (error) {
    content.innerHTML = `<p class="answer-status">Answer could not be loaded. Close and reopen to retry.</p>`;
    console.error(`Failed to load answer ${item.id}:`, error);
  }
}

async function preloadAnswers(records) {
  const ids = records.map((record) => record.id).filter((id) => !answerCache.has(id));
  if (!ids.length) return true;
  const newIds = ids.filter((id) => !answerPromises.has(id));
  let request = null;
  if (newIds.length) request = (async () => {
    const response = await fetchWithTimeout(`${ANSWER_API_BASE}/api/answers?ids=${newIds.map(encodeURIComponent).join(",")}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    for (const [id, answer] of Object.entries(payload.answers)) answerCache.set(id, answer.answer_markdown);
  })();
  if (request) newIds.forEach((id) => answerPromises.set(id, request));
  try {
    await Promise.all([...new Set(ids.map((id) => answerPromises.get(id)).filter(Boolean))]);
    return records.every((record) => answerCache.has(record.id));
  } catch (error) {
    console.error("Failed to preload page answers:", error);
    return false;
  } finally {
    if (request) newIds.forEach((id) => { if (answerPromises.get(id) === request) answerPromises.delete(id); });
  }
}

function renderQuestions(records, totalRecords, disabled = true) {
  const active = dimensions.flatMap((dimension) => [...selected[dimension]]);
  byId("active-filter").textContent = active.length ? `${totalRecords} records · ${active.map(displayName).join(", ")}` : `All topics · ${totalRecords}`;
  byId("qa-list").innerHTML = records.length ? records.map((item) => `<article class="qa-card" data-id="${escapeHtml(item.id)}"><button class="question" type="button" aria-expanded="false" ${disabled ? "disabled" : ""}><span class="question-text">${renderQuestion(item.question)}</span><span class="question-toggle" aria-hidden="true">+</span></button><div class="answer"><div class="answer-content"></div>${renderResources(item)}<div class="meta">${item.direct_tags.map((tag) => `<span class="tag">${escapeHtml(displayName(tag))}</span>`).join("")}<span class="tag">${escapeHtml(item.answered_by)}</span></div></div></article>`).join("") : `<p class="empty">No questions match these filters.</p>`;
  document.querySelectorAll(".question").forEach((button) => button.addEventListener("click", () => {
    const card = button.parentElement;
    const open = card.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    button.querySelector(".question-toggle").textContent = open ? "−" : "+";
    if (open) loadAnswer(card, records.find((item) => item.id === card.dataset.id));
  }));
}

function renderPagination(totalRecords) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const pagination = byId("pagination");
  if (totalPages <= 1) { pagination.innerHTML = ""; return; }
  const pageButtons = Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => `<button type="button" class="page-button ${page === currentPage ? "selected" : ""}" data-page="${page}" aria-label="Page ${page}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`).join("");
  pagination.innerHTML = `<button type="button" class="page-button" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>Previous</button>${pageButtons}<button type="button" class="page-button" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
  pagination.querySelectorAll(".page-button:not([disabled])").forEach((button) => button.addEventListener("click", () => {
    currentPage = Number(button.dataset.page);
    render();
    byId("questions-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

async function render() {
  const version = ++renderVersion;
  const records = filteredRecords();
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const pageRecords = records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  renderFilters();
  renderQuestions(pageRecords, records.length, pageRecords.length > 0);
  renderPagination(records.length);
  byId("page-status").innerHTML = pageRecords.length ? `<span class="loading-dot" aria-hidden="true"></span> Loading page ${currentPage} answers…` : "";
  const ready = await preloadAnswers(pageRecords);
  if (version !== renderVersion) return;
  document.querySelectorAll(".question").forEach((button) => { button.disabled = false; });
  if (ready) byId("page-status").textContent = "";
  else {
    byId("page-status").innerHTML = `Page answers could not be preloaded. Questions will retry individually. <button id="retry-page" class="text-button" type="button">Retry</button>`;
    byId("retry-page").addEventListener("click", () => render());
  }
  if (requestedQa && !requestedQaOpened) {
    const card = document.querySelector(`.qa-card[data-id="${CSS.escape(requestedQa)}"]`);
    if (card) {
      requestedQaOpened = true;
      card.querySelector(".question").click();
      requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }
}

byId("record-count").textContent = qaData.length;
byId("tag-search").addEventListener("input", (event) => { tagQuery = event.target.value; renderFilters(); });
byId("clear-filter").addEventListener("click", () => {
  dimensions.forEach((dimension) => selected[dimension].clear());
  tagQuery = "";
  currentPage = 1;
  byId("tag-search").value = "";
  render();
});
const requestedQa = new URLSearchParams(window.location.search).get("qa");
if (requestedQa) {
  const requestedIndex = qaData.findIndex((record) => record.id === requestedQa);
  if (requestedIndex >= 0) currentPage = Math.floor(requestedIndex / PAGE_SIZE) + 1;
}
render();
