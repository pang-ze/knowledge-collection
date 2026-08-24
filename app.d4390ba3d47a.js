const knowledge = window.KNOWLEDGE_DATA;
const qaData = knowledge.index.records;
const taxonomy = knowledge.taxonomy.tags;
const collections = knowledge.index.collections;
const PAGE_SIZE = 10;
const TAG_PREVIEW_LIMIT = 10;
const dimensions = ["topics", "concepts", "keywords", "publications", "difficulties"];
const dimensionByType = { topic: "topics", concept: "concepts", keyword: "keywords", publication: "publications", difficulty: "difficulties" };
const parameterByDimension = { topics: "topic", concepts: "concept", keywords: "keyword", publications: "publication", difficulties: "difficulty" };
const legacyParameterByDimension = { topics: "domain", keywords: "technology" };
const ANSWER_API_BASE = "https://learning-notes-api.pang-ze.workers.dev";
const mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11.17.0/dist/mermaid.esm.min.mjs").then(({ default: mermaid }) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      primaryColor: "#A1C1A1",
      primaryBorderColor: "#8BA995",
      primaryTextColor: "#000000",
      secondaryColor: "#D2C4B2",
      tertiaryColor: "#DFDAD3",
      lineColor: "#000000",
      textColor: "#000000"
    }
  });
  return mermaid;
});
let mermaidRenderQueue = Promise.resolve();
const answerCache = new Map();
const answerPromises = new Map();
const selected = Object.fromEntries(dimensions.map((dimension) => [dimension, new Set()]));
const expandedDimensions = new Set();
let tagQuery = "";
let tagLanguage = loadTagLanguage();
let selectedCollection = "All";
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

function loadTagLanguage() {
  try { return localStorage.getItem("knowledge-tag-language") === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}

function saveTagLanguage() {
  try { localStorage.setItem("knowledge-tag-language", tagLanguage); }
  catch { /* Storage can be unavailable in privacy-restricted contexts. */ }
}

function displayName(key) {
  const tag = taxonomy[key];
  return tagLanguage === "zh"
    ? tag.name_zh || tag.preferred_name || tag.name_en || key
    : tag.name_en || tag.preferred_name || key || tag.name_zh;
}

function renderTagLanguageControl() {
  document.querySelectorAll("[data-tag-language]").forEach((button) => {
    const active = button.dataset.tagLanguage === tagLanguage;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function matchesSelections(record) {
  return (selectedCollection === "All" || record.collection === selectedCollection)
    && dimensions.every((dimension) => selected[dimension].size === 0 || [...selected[dimension]].some((key) => record.tag_dimensions[dimension].includes(key)));
}

function availableTags(dimension) {
  const counts = filteredRecords().flatMap((record) => record.tag_dimensions[dimension]).reduce((result, key) => {
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  selected[dimension].forEach((key) => { if (!counts.has(key)) counts.set(key, 0); });
  const query = tagQuery.trim().toLocaleLowerCase();
  const candidates = query
    ? Object.keys(taxonomy).filter((key) => dimensionByType[taxonomy[key].instance_of] === dimension).map((key) => [key, counts.get(key) || 0])
    : [...counts];
  return candidates
    .filter(([key, count]) => (count > 0 || selected[dimension].has(key)) && (!query || searchText(key).includes(query)))
    .sort(([a, countA], [b, countB]) => countB - countA || displayName(a).localeCompare(displayName(b)));
}

function filteredRecords() {
  return qaData
    .filter((record) => matchesSelections(record))
    .sort((a, b) => Number(b.is_frequent) - Number(a.is_frequent));
}

function renderFilters() {
  const ids = { topics: "topic-filter", concepts: "concept-filter", keywords: "keyword-filter", publications: "publication-filter", difficulties: "difficulty-filter" };
  for (const dimension of dimensions) {
    const tags = availableTags(dimension);
    const visibleTags = tagQuery || expandedDimensions.has(dimension) ? tags : tags.slice(0, TAG_PREVIEW_LIMIT);
    const tagMarkup = visibleTags.map(([key, count]) => {
      const tag = taxonomy[key];
      const alternate = [tag.name_zh, tag.name_en].filter((name) => name && name !== displayName(key)).join(" · ");
      return `<button class="tag-button tag-${dimension} ${selected[dimension].has(key) ? "selected" : ""}" data-dimension="${dimension}" data-key="${escapeHtml(key)}" type="button" title="${escapeHtml(alternate)}"><span>${escapeHtml(displayName(key))}</span><strong>${count}</strong></button>`;
    }).join("");
    const expandMarkup = !tagQuery && tags.length > TAG_PREVIEW_LIMIT ? `<button class="tag-expand text-button" data-expand="${dimension}" type="button">${expandedDimensions.has(dimension) ? "Collapse" : `Show all ${tags.length}`}</button>` : "";
    const row = document.querySelector(`[data-taxonomy-row="${dimension}"]`);
    row.hidden = tags.length === 0 || (selectedCollection === "All" && (dimension === "publications" || dimension === "difficulties"));
    byId(ids[dimension]).innerHTML = tags.length ? tagMarkup + expandMarkup : "";
  }
  document.querySelectorAll(".tag-button[data-dimension]").forEach((button) => button.addEventListener("click", () => {
    const values = selected[button.dataset.dimension];
    values.has(button.dataset.key) ? values.delete(button.dataset.key) : values.add(button.dataset.key);
    currentPage = 1;
    render();
  }));
  document.querySelectorAll(".tag-expand").forEach((button) => button.addEventListener("click", () => {
    expandedDimensions.has(button.dataset.expand) ? expandedDimensions.delete(button.dataset.expand) : expandedDimensions.add(button.dataset.expand);
    renderFilters();
  }));
}

function renderCollectionFilter() {
  const options = ["All", ...collections];
  byId("collection-filter").innerHTML = options.map((collection) => {
    const count = collection === "All" ? qaData.length : qaData.filter((record) => record.collection === collection).length;
    return `<button class="collection-button ${selectedCollection === collection ? "selected" : ""}" type="button" data-collection="${collection}"><span>${collection}</span><strong>${count}</strong></button>`;
  }).join("");
  document.querySelectorAll(".collection-button").forEach((button) => button.addEventListener("click", () => {
    selectedCollection = button.dataset.collection;
    dimensions.forEach((dimension) => selected[dimension].clear());
    currentPage = 1;
    render();
  }));
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

function renderMermaid(root = document) {
  const diagrams = [...root.querySelectorAll("pre code.language-mermaid")].map((code) => {
    const source = code.textContent;
    const container = document.createElement("div");
    container.className = "mermaid-diagram mermaid";
    container.textContent = source;
    code.parentElement.replaceWith(container);
    return { container, source };
  });
  if (!diagrams.length) return;
  mermaidRenderQueue = mermaidRenderQueue
    .then(async () => {
      const mermaid = await mermaidPromise;
      const nodes = diagrams.map(({ container }) => container).filter((container) => container.isConnected);
      if (nodes.length) await mermaid.run({ nodes, suppressErrors: true });
    })
    .catch((error) => {
      diagrams.forEach(({ container, source }) => {
        if (!container.isConnected) return;
        container.className = "mermaid-diagram mermaid-error";
        container.textContent = source;
      });
      console.error("Failed to render Mermaid diagram:", error);
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

function enhanceContent(root = document) {
  renderMath(root);
  renderMermaid(root);
  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  root.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src") || "";
    const assetMatch = source.match(/^(?:\.\.\/){1,2}(Assets\/images\/.*)$/);
    if (assetMatch) image.src = new URL(`./${assetMatch[1]}`, document.baseURI).href;
    image.loading = "lazy";
    image.decoding = "async";
  });
  root.querySelectorAll("pre code:not(.language-mermaid)").forEach((code) => {
    if (window.hljs) window.hljs.highlightElement(code);
    const pre = code.parentElement;
    if (pre.querySelector(":scope > .code-copy")) return;
    const button = document.createElement("button");
    button.className = "code-copy";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code block");
    button.addEventListener("click", (event) => { event.stopPropagation(); copyCode(code.textContent, button); });
    pre.append(button);
  });
}

function referenceLabel(reference) {
  if (reference.comment) return reference.comment;
  try { return new URL(reference.url).hostname; } catch { return reference.url; }
}

function renderResources(item) {
  const related = item.related_entries.length ? `<section class="qa-resources related-resources"><h3>Related Entries</h3><ul>${item.related_entries.map((relation) => `<li><div class="related-link" role="link" tabindex="0" data-url="${escapeHtml(relation.url)}"><span class="collection-badge">${escapeHtml(relation.collection)}</span><div class="related-question markdown-content">${renderMarkdown(relation.question)}</div><span aria-hidden="true">↗</span></div>${relation.comment ? `<small>${escapeHtml(relation.comment)}</small>` : ""}</li>`).join("")}</ul></section>` : "";
  const references = item.references.length ? `<section class="qa-resources reference-resources"><h3>References</h3><ul>${item.references.map((reference) => `<li><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.title || referenceLabel(reference))} <span aria-hidden="true">↗</span></a>${reference.comment ? `<small>${escapeHtml(reference.comment)}</small>` : ""}</li>`).join("")}</ul></section>` : "";
  return related + references;
}

function tagFilterUrl(key, collection) {
  const dimension = dimensionByType[taxonomy[key].instance_of];
  return `?collection=${encodeURIComponent(collection)}&${parameterByDimension[dimension]}=${encodeURIComponent(key)}`;
}

async function loadAnswer(card, item) {
  const content = card.querySelector(".answer-content");
  if (answerCache.has(item.id)) {
    content.innerHTML = renderMarkdown(answerCache.get(item.id));
    enhanceContent(content);
    return;
  }
  content.innerHTML = `<p class="answer-status">Loading answer…</p>`;
  try {
    if (answerPromises.has(item.id)) await answerPromises.get(item.id);
    if (answerCache.has(item.id)) {
      content.innerHTML = renderMarkdown(answerCache.get(item.id));
      enhanceContent(content);
      return;
    }
    const response = await fetchWithTimeout(`${ANSWER_API_BASE}/api/entries/${encodeURIComponent(item.id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    answerCache.set(item.id, payload.answer_markdown);
    content.innerHTML = renderMarkdown(payload.answer_markdown);
    enhanceContent(content);
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
    const response = await fetchWithTimeout(`${ANSWER_API_BASE}/api/entries?ids=${newIds.map(encodeURIComponent).join(",")}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    for (const [id, answer] of Object.entries(payload.entries)) answerCache.set(id, answer.answer_markdown);
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
  const scope = selectedCollection === "All" ? "Entries" : selectedCollection;
  byId("active-filter").textContent = active.length ? `${scope} · ${totalRecords} · ${active.map(displayName).join(", ")}` : `${scope} · ${totalRecords}`;
  byId("qa-list").innerHTML = records.length ? records.map((item, index) => {
    const entryNumber = String((currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, "0");
    return `<article class="qa-card" data-id="${escapeHtml(item.id)}"><div class="question ${item.is_frequent ? "frequent" : ""} ${disabled ? "disabled" : ""}" data-number="${entryNumber}" role="button" tabindex="${disabled ? "-1" : "0"}" aria-expanded="false" aria-disabled="${disabled}"><div class="question-content markdown-content">${renderMarkdown(item.question)}</div>${item.is_frequent ? `<span class="frequent-icon" role="img" aria-label="Frequent" title="Frequent">✦</span>` : ""}<span class="question-toggle" aria-hidden="true">+</span></div><div class="answer"><div class="answer-content markdown-content"></div><p class="answer-attribution">This answer is generated by ${escapeHtml(item.answered_by)}.</p>${renderResources(item)}<div class="meta">${item.direct_tags.map((tag) => `<a class="tag" href="${tagFilterUrl(tag, item.collection)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName(tag))} <span aria-hidden="true">↗</span></a>`).join("")}</div></div></article>`;
  }).join("") : `<p class="empty">No entries match these filters.</p>`;
  document.querySelectorAll(".question").forEach((button) => {
    const toggle = (event) => {
      if (button.classList.contains("disabled") || event.target.closest("a, .code-copy")) return;
      const card = button.parentElement;
    const open = card.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    button.querySelector(".question-toggle").textContent = open ? "−" : "+";
    if (open) loadAnswer(card, records.find((item) => item.id === card.dataset.id));
    };
    button.addEventListener("click", toggle);
    button.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(event); } });
  });
  document.querySelectorAll(".related-link").forEach((link) => {
    const open = () => window.open(link.dataset.url, "_blank", "noopener,noreferrer");
    link.addEventListener("click", (event) => { if (!event.target.closest("a, .code-copy")) open(); });
    link.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
  document.querySelectorAll(".question-content, .related-question").forEach((content) => enhanceContent(content));
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
  renderTagLanguageControl();
  renderCollectionFilter();
  renderFilters();
  renderQuestions(pageRecords, records.length, pageRecords.length > 0);
  renderPagination(records.length);
  byId("page-status").innerHTML = pageRecords.length ? `<span class="loading-dot" aria-hidden="true"></span> Loading page ${currentPage} answers…` : "";
  const ready = await preloadAnswers(pageRecords);
  if (version !== renderVersion) return;
  document.querySelectorAll(".question").forEach((button) => { button.classList.remove("disabled"); button.tabIndex = 0; button.setAttribute("aria-disabled", "false"); });
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
document.querySelectorAll("[data-tag-language]").forEach((button) => button.addEventListener("click", () => {
  if (tagLanguage === button.dataset.tagLanguage) return;
  tagLanguage = button.dataset.tagLanguage;
  saveTagLanguage();
  render();
}));
byId("tag-search").addEventListener("input", (event) => { tagQuery = event.target.value; renderFilters(); });
byId("clear-filter").addEventListener("click", () => {
  dimensions.forEach((dimension) => selected[dimension].clear());
  selectedCollection = "All";
  tagQuery = "";
  currentPage = 1;
  byId("tag-search").value = "";
  render();
});
const urlParameters = new URLSearchParams(window.location.search);
const collectionParameter = urlParameters.get("collection");
if (collectionParameter && collections.includes(collectionParameter)) selectedCollection = collectionParameter;
for (const [dimension, parameter] of Object.entries(parameterByDimension)) {
  const key = urlParameters.get(parameter) || urlParameters.get(legacyParameterByDimension[dimension]);
  if (key && taxonomy[key] && dimensionByType[taxonomy[key].instance_of] === dimension) selected[dimension].add(key);
}
const requestedQa = urlParameters.get("entry") || urlParameters.get("qa");
if (requestedQa) {
  const requestedIndex = filteredRecords().findIndex((record) => record.id === requestedQa);
  if (requestedIndex >= 0) currentPage = Math.floor(requestedIndex / PAGE_SIZE) + 1;
}
render();
