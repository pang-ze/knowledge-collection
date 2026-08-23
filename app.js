const knowledge = window.QA_KNOWLEDGE_DATA;
const qaData = knowledge.index.records;
const taxonomy = knowledge.taxonomy.tags;
const CHART_LIMIT = 8;
const dimensions = ["domains", "concepts", "technologies"];
const ANSWER_API_BASE = "https://learning-notes-api.pang-ze.workers.dev";
const answerCache = new Map();
const selected = Object.fromEntries(dimensions.map((dimension) => [dimension, new Set()]));
let tagQuery = "";
let showAllChartTags = false;

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

function availableTags(dimension) {
  const keys = new Set(qaData.flatMap((record) => record[dimension]));
  const query = tagQuery.trim().toLocaleLowerCase();
  return [...keys].filter((key) => !query || searchText(key).includes(query)).sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

function filteredRecords() {
  return qaData.filter((record) => dimensions.every((dimension) => selected[dimension].size === 0 || [...selected[dimension]].some((key) => record[dimension].includes(key))));
}

function renderFilters() {
  const ids = { domains: "domain-filter", concepts: "concept-filter", technologies: "technology-filter" };
  for (const dimension of dimensions) {
    const keys = availableTags(dimension);
    byId(ids[dimension]).innerHTML = keys.length ? keys.map((key) => {
      const tag = taxonomy[key];
      const alternate = [tag.name_zh, tag.name_en].filter((name) => name && name !== displayName(key)).join(" · ");
      return `<button class="tag-button ${selected[dimension].has(key) ? "selected" : ""}" data-dimension="${dimension}" data-key="${escapeHtml(key)}" type="button" title="${escapeHtml(alternate)}">${escapeHtml(displayName(key))}</button>`;
    }).join("") : `<span class="no-match">No matching ${dimension}</span>`;
  }
  document.querySelectorAll(".tag-button[data-dimension]").forEach((button) => button.addEventListener("click", () => {
    const values = selected[button.dataset.dimension];
    values.has(button.dataset.key) ? values.delete(button.dataset.key) : values.add(button.dataset.key);
    render();
  }));
}

function directTagCounts(records) {
  return records.flatMap((record) => record.direct_tags).reduce((counts, tag) => { counts[tag] = (counts[tag] || 0) + 1; return counts; }, {});
}

function renderChart(records) {
  const matches = Object.entries(directTagCounts(records)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chartItems = showAllChartTags ? matches : matches.slice(0, CHART_LIMIT);
  const max = Math.max(1, ...chartItems.map(([, count]) => count));
  byId("tag-chart").innerHTML = chartItems.length ? chartItems.map(([tag, count]) => `<div class="bar-row" title="${escapeHtml(tag)}: ${count}"><span class="bar-label">${escapeHtml(displayName(tag))}</span><span class="bar-track"><span class="bar-fill" style="width:${count / max * 100}%"></span></span><strong>${count}</strong></div>`).join("") : `<p class="empty">No QA records match the selected filters.</p>`;
  const toggle = byId("toggle-chart");
  toggle.hidden = matches.length <= CHART_LIMIT;
  toggle.textContent = showAllChartTags ? "Show top tags" : `Show all ${matches.length} direct tags`;
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
    const response = await fetch(`${ANSWER_API_BASE}/api/answers/${encodeURIComponent(item.id)}`);
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

function renderQuestions(records) {
  const active = dimensions.flatMap((dimension) => [...selected[dimension]]);
  byId("active-filter").textContent = active.length ? `${records.length} records · ${active.map(displayName).join(", ")}` : `All topics · ${records.length}`;
  byId("filter-summary").textContent = `${records.length} of ${qaData.length} QA records`;
  byId("qa-list").innerHTML = records.length ? records.map((item) => `<article class="qa-card" data-id="${escapeHtml(item.id)}"><button class="question" type="button" aria-expanded="false"><span class="question-text">${renderQuestion(item.question)}</span><span class="question-toggle" aria-hidden="true">+</span></button><div class="answer"><div class="answer-content"></div>${renderResources(item)}<div class="meta">${item.direct_tags.map((tag) => `<span class="tag">${escapeHtml(displayName(tag))}</span>`).join("")}<span class="tag">${escapeHtml(item.answered_by)}</span></div></div></article>`).join("") : `<p class="empty">No questions match these filters.</p>`;
  document.querySelectorAll(".question").forEach((button) => button.addEventListener("click", () => {
    const card = button.parentElement;
    const open = card.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    button.querySelector(".question-toggle").textContent = open ? "−" : "+";
    if (open) loadAnswer(card, records.find((item) => item.id === card.dataset.id));
  }));
}

function render() {
  const records = filteredRecords();
  renderFilters();
  renderChart(records);
  renderQuestions(records);
}

byId("record-count").textContent = qaData.length;
byId("tag-search").addEventListener("input", (event) => { tagQuery = event.target.value; renderFilters(); });
byId("toggle-chart").addEventListener("click", () => { showAllChartTags = !showAllChartTags; renderChart(filteredRecords()); });
byId("clear-filter").addEventListener("click", () => {
  dimensions.forEach((dimension) => selected[dimension].clear());
  tagQuery = "";
  showAllChartTags = false;
  byId("tag-search").value = "";
  render();
});
render();

const requestedQa = new URLSearchParams(window.location.search).get("qa");
if (requestedQa) {
  const card = document.querySelector(`.qa-card[data-id="${CSS.escape(requestedQa)}"]`);
  if (card) {
    card.querySelector(".question").click();
    requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
}
