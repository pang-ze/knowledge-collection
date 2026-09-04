/* Markdown, math, diagrams and code enhancement, shared by questions and answers. */
(() => {
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11.17.0/dist/mermaid.esm.min.mjs").then(({ default: mermaid }) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      primaryColor: "#84B59F",
      primaryBorderColor: "#69A297",
      primaryTextColor: "#000000",
      secondaryColor: "#A3C9A8",
      tertiaryColor: "#DDD8C4",
      lineColor: "#50808E",
      textColor: "#000000",
      fontSize: "16px",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    }
  });
  return mermaid;
});
let mermaidRenderQueue = Promise.resolve();

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


function normalizeMarkdownEmphasis(markdown) {
  return String(markdown)
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g)
    .map((segment, index) => index % 2 === 0
      ? segment.split(/(\r?\n)/).map((line) => {
          let markerIndex = 0;
          return line.replace(/(?<!\\)(?<!\*)\*\*(?!\*)/g, (marker, offset) => {
            markerIndex += 1;
            const closesStrongText = markerIndex % 2 === 0;
            const followedByText = /^[\p{L}\p{N}]/u.test(line.slice(offset + marker.length));
            return closesStrongText && followedByText ? `${marker} ` : marker;
          });
        }).join("")
      : segment)
    .join("");
}

function renderMarkdown(markdown) {
  const normalizedMarkdown = normalizeMarkdownEmphasis(markdown);
  if (!window.marked || !window.DOMPurify) return `<p>${escapeHtml(normalizedMarkdown).replace(/\r?\n/g, "<br>")}</p>`;
  return window.DOMPurify.sanitize(window.marked.parse(normalizedMarkdown));
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
      if (nodes.length) {
        await mermaid.run({ nodes, suppressErrors: true });
        nodes.forEach((container) => {
          const svg = container.querySelector("svg");
          const naturalWidth = svg?.viewBox?.baseVal?.width;
          if (naturalWidth > 0) svg.style.setProperty("--mermaid-natural-width", `${Math.ceil(naturalWidth)}px`);
        });
      }
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

function enhanceAnswerSections(root) {
  const sectionNames = new Map([
    ["summary", { className: "answer-summary", label: "SUMMARY" }],
    ["details", { className: "answer-details", label: "DETAILS" }]
  ]);
  const sections = [];
  let currentSection = null;
  for (const node of [...root.childNodes]) {
    const name = node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName)
      ? node.textContent.trim().toLocaleLowerCase()
      : null;
    if (sectionNames.has(name)) {
      currentSection = { name, nodes: [node] };
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.nodes.push(node);
    }
  }
  if (!sections.length) return;

  const insertionPoint = document.createComment("ordered answer sections");
  sections[0].nodes[0].before(insertionPoint);
  const orderedSections = ["summary", "details"].flatMap((name) => sections.filter((section) => section.name === name));
  for (const { name, nodes } of orderedSections) {
    const heading = nodes[0];
    const definition = sectionNames.get(name);
    const section = document.createElement("section");
    section.className = `answer-section ${definition.className}`;
    const label = document.createElement(name === "details" ? "button" : "span");
    label.className = "answer-section-label";
    heading.classList.add("answer-section-title");
    if (name === "details") {
      const content = document.createElement("div");
      content.className = "answer-details-content";
      content.append(...nodes);
      label.type = "button";
      label.classList.add("answer-details-toggle");
      label.setAttribute("aria-expanded", "false");
      label.innerHTML = `${definition.label}<svg class="details-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      section.classList.add("is-collapsed");
      label.addEventListener("click", () => {
        const expanded = section.classList.toggle("is-collapsed") === false;
        label.setAttribute("aria-expanded", String(expanded));
      });
      section.append(label, content);
    } else {
      label.textContent = definition.label;
      section.append(label, ...nodes);
    }
    insertionPoint.parentNode.insertBefore(section, insertionPoint);
  }
  insertionPoint.remove();
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

function codeLanguageLabel(code) {
  const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
  if (!languageClass) return "";
  const language = languageClass.slice("language-".length).toLowerCase();
  const labels = {
    bash: "Bash",
    c: "C",
    cpp: "C++",
    cs: "C#",
    css: "CSS",
    html: "HTML",
    java: "Java",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    markdown: "Markdown",
    md: "Markdown",
    plaintext: "Plain Text",
    text: "Plain Text",
    python: "Python",
    py: "Python",
    rust: "Rust",
    shell: "Shell",
    sql: "SQL",
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML"
  };
  return labels[language] || language.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

function resolveImageSource(source, baseUri, pathname) {
  const match = source.match(/^(?:(?:\.\.?\/)+|\/)?(?:Data\/Images\/webp|Images\/webp|Assets\/images)\/(.+)$/);
  if (!match) return source;
  const prefix = pathname.includes("/Frontend/") ? "../" : "./";
  return new URL(`${prefix}Data/Images/webp/${match[1]}`, baseUri).href;
}

function enhanceContent(root = document) {
  if (root.classList?.contains("answer-content")) enhanceAnswerSections(root);
  renderMath(root);
  renderMermaid(root);
  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  root.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src") || "";
    image.src = resolveImageSource(source, document.baseURI, window.location.pathname);
    image.loading = "lazy";
    image.decoding = "async";
  });
  root.querySelectorAll("pre code:not(.language-mermaid)").forEach((code) => {
    const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
    const languageName = languageClass?.slice("language-".length).toLowerCase();
    if (!languageClass) code.classList.add("language-plaintext");
    if (window.hljs && languageName && !["plaintext", "text"].includes(languageName)) window.hljs.highlightElement(code);
    const pre = code.parentElement;
    const language = codeLanguageLabel(code);
    if (language && !pre.querySelector(":scope > .code-language")) {
      const label = document.createElement("span");
      label.className = "code-language";
      label.textContent = language;
      pre.append(label);
    }
    if (!pre.querySelector(":scope > .code-copy")) {
      const button = document.createElement("button");
      button.className = "code-copy";
      button.type = "button";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code block");
      button.addEventListener("click", (event) => { event.stopPropagation(); copyCode(code.textContent, button); });
      pre.append(button);
    }
  });
}


window.KnowledgeMarkdown = { renderMarkdown, enhanceContent };
})();

const knowledge = window.KNOWLEDGE_DATA;
const { renderMarkdown, enhanceContent } = window.KnowledgeMarkdown;
const qaData = knowledge.index.records;
const taxonomy = knowledge.taxonomy.tags;
const collectionNames = knowledge.index.collection;
const PAGE_SIZE = 10;
const TAG_PREVIEW_LIMIT = 10;
const TAG_LANGUAGE_STORAGE_KEY = "knowledge-tag-language-v3";
const definitions = knowledge.configuration.dimensions;
const dimensions = definitions.map((item) => item.key);
const dimensionByType = Object.fromEntries(definitions.map((item) => [item.type, item.key]));
const parameterByDimension = Object.fromEntries(definitions.map((item) => [item.key, item.type]));
const legacyParameterByDimension = Object.fromEntries(definitions.filter((item) => item.legacy_parameter).map((item) => [item.key, item.legacy_parameter]));
const ANSWER_API_BASE = "https://learning-notes-api.pang-ze.workers.dev";
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

function normalizeSearchText(value) {
  return String(value).toLocaleLowerCase().replace(/-+/g, " ").replace(/\s+/g, " ").trim();
}

function searchText(key) {
  const tag = taxonomy[key];
  return normalizeSearchText([key, tag.name_zh, tag.name_en, ...tag.aliases].filter(Boolean).join(" "));
}

function loadTagLanguage() {
  try { return localStorage.getItem(TAG_LANGUAGE_STORAGE_KEY) === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}

function saveTagLanguage() {
  try { localStorage.setItem(TAG_LANGUAGE_STORAGE_KEY, tagLanguage); }
  catch { /* Storage can be unavailable in privacy-restricted contexts. */ }
}

function displayName(key) {
  const tag = taxonomy[key];
  return tagLanguage === "zh"
    ? tag.name_zh || tag.name_en || key
    : tag.name_en || key;
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
  return [...counts]
    .filter(([key, count]) => count > 0 || selected[dimension].has(key))
    .sort(([a, countA], [b, countB]) => countB - countA || displayName(a).localeCompare(displayName(b)));
}

function filteredRecords() {
  const query = normalizeSearchText(tagQuery);
  return qaData
    .filter((record) => matchesSelections(record))
    .filter((record) => !query
      || normalizeSearchText(record.id).includes(query)
      || normalizeSearchText(record.question).includes(query)
      || dimensions.some((dimension) => record.tag_dimensions[dimension].some((key) => searchText(key).includes(query))))
    .sort((a, b) => {
      const frequentDifference = Number(b.is_frequent) - Number(a.is_frequent);
      if (frequentDifference) return frequentDifference;
      const modifiedA = Date.parse(a.modified_at);
      const modifiedB = Date.parse(b.modified_at);
      return (Number.isNaN(modifiedB) ? 0 : modifiedB) - (Number.isNaN(modifiedA) ? 0 : modifiedA);
    });
}

function renderFilters() {
  const ids = Object.fromEntries(definitions.map((item) => [item.key, `${item.type}-filter`]));
  for (const dimension of dimensions) {
    const tags = availableTags(dimension);
    const showAllTags = Boolean(tagQuery) || expandedDimensions.has(dimension);
    const tagMarkup = tags.map(([key, count], index) => {
      const tag = taxonomy[key];
      const alternate = [tag.name_zh, tag.name_en].filter((name) => name && name !== displayName(key)).join(" · ");
      const isOverflow = index >= TAG_PREVIEW_LIMIT && !selected[dimension].has(key);
      return `<button class="tag-button tag-${dimension} ${selected[dimension].has(key) ? "selected" : ""} ${isOverflow ? "tag-overflow" : ""}" data-dimension="${dimension}" data-key="${escapeHtml(key)}" type="button" title="${escapeHtml(alternate)}" ${isOverflow && !showAllTags ? "hidden" : ""}><span>${escapeHtml(displayName(key))}</span><strong>${count}</strong></button>`;
    }).join("");
    const expandMarkup = !tagQuery && tags.length > TAG_PREVIEW_LIMIT ? `<button class="tag-expand text-button" data-expand="${dimension}" type="button">${expandedDimensions.has(dimension) ? "Collapse" : `Show all ${tags.length}`}</button>` : "";
    const row = document.querySelector(`[data-taxonomy-row="${dimension}"]`);
    const definition = definitions.find((item) => item.key === dimension);
    row.hidden = definition.collection !== "all" && !definition.collection.includes(selectedCollection);
    byId(ids[dimension]).innerHTML = tags.length
      ? tagMarkup + expandMarkup
      : `<span class="no-match">${tagQuery ? "No matching tags." : "No tags in this collection."}</span>`;
  }
  document.querySelectorAll(".tag-button[data-dimension]").forEach((button) => button.addEventListener("click", () => {
    const values = selected[button.dataset.dimension];
    values.has(button.dataset.key) ? values.delete(button.dataset.key) : values.add(button.dataset.key);
    currentPage = 1;
    render();
  }));
  document.querySelectorAll(".tag-expand").forEach((button) => button.addEventListener("click", () => {
    const dimension = button.dataset.expand;
    const expanded = !expandedDimensions.has(dimension);
    expanded ? expandedDimensions.add(dimension) : expandedDimensions.delete(dimension);
    const container = byId(ids[dimension]);
    container.querySelectorAll(".tag-overflow").forEach((tag) => { tag.hidden = !expanded; });
    container.scrollTop = 0;
    requestAnimationFrame(() => { container.scrollTop = 0; });
    button.textContent = expanded ? "Collapse" : `Show all ${availableTags(dimension).length}`;
  }));
}

function renderCollectionFilter() {
  const options = ["All", ...collectionNames];
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

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function renderResources(item) {
  const related = item.related_entries.length ? `<div class="resource-group related-group"><h3>Related Entries</h3><ul>${item.related_entries.map((relation) => `<li><div class="related-link" role="link" tabindex="0" data-url="${escapeHtml(relation.url)}"><span class="collection-badge">${escapeHtml(relation.collection)}</span><div class="related-question markdown-content">${renderMarkdown(relation.question)}</div><span aria-hidden="true">↗</span></div>${relation.comment ? `<small>${escapeHtml(relation.comment)}</small>` : ""}</li>`).join("")}</ul></div>` : "";
  const references = item.references.length ? `<div class="resource-group reference-group"><h3>References</h3><ul>${item.references.map((reference) => `<li><a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.url)} <span aria-hidden="true">↗</span></a></li>`).join("")}</ul></div>` : "";
  return related || references ? `<section class="qa-resources combined-resources">${related}${references}</section>` : "";
}

function tagFilterUrl(key, collection) {
  const dimension = dimensionByType[taxonomy[key].instance_of];
  return `?collection=${encodeURIComponent(collection)}&${parameterByDimension[dimension]}=${encodeURIComponent(key)}`;
}

function formatUtcDate(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? String(value)
    : timestamp.toISOString().slice(0, 10);
}

function sortedDirectTags(tags) {
  const name = (key) => taxonomy[key].name_en || key;
  return [...tags].sort((left, right) =>
    name(left).localeCompare(name(right), undefined, { sensitivity: "base" }) || left.localeCompare(right)
  );
}

function cacheLocalAnswer(item) {
  if (answerCache.has(item.id) || typeof item.answer !== "string") return false;
  answerCache.set(item.id, item.answer);
  return true;
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
    if (cacheLocalAnswer(item)) {
      content.innerHTML = renderMarkdown(answerCache.get(item.id));
      enhanceContent(content);
      console.warn(`Loaded local fallback answer for ${item.id}:`, error);
      return;
    }
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
    records.forEach(cacheLocalAnswer);
  })();
  if (request) newIds.forEach((id) => answerPromises.set(id, request));
  try {
    await Promise.all([...new Set(ids.map((id) => answerPromises.get(id)).filter(Boolean))]);
    return records.every((record) => answerCache.has(record.id));
  } catch (error) {
    let usedLocalFallback = false;
    records.forEach((record) => { usedLocalFallback = cacheLocalAnswer(record) || usedLocalFallback; });
    if (usedLocalFallback) console.warn("Remote page answers could not be preloaded; using local answers.", error);
    else console.error("Failed to preload page answers:", error);
    return records.every((record) => answerCache.has(record.id));
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
    return `<article class="qa-card" data-id="${escapeHtml(item.id)}"><div class="question ${item.is_frequent ? "frequent" : ""} ${disabled ? "disabled" : ""}" data-number="${entryNumber}" role="button" tabindex="${disabled ? "-1" : "0"}" aria-expanded="false" aria-disabled="${disabled}"><div class="question-content markdown-content">${renderMarkdown(item.question)}</div>${item.is_frequent ? `<span class="frequent-icon" role="img" aria-label="Frequent" title="Frequent">★</span>` : ""}<span class="question-toggle" aria-hidden="true">+</span></div><div class="answer"><div class="answer-content markdown-content"></div>${renderResources(item)}<div class="meta">${sortedDirectTags(item.direct_tags).map((tag) => `<a class="tag" href="${tagFilterUrl(tag, item.collection)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName(tag))} <span aria-hidden="true">↗</span></a>`).join("")}</div><div class="entry-details"><span class="entry-author">Answered by ${escapeHtml(item.answered_by)}</span><span class="entry-id">${escapeHtml(item.id)}</span><span class="entry-modified">${escapeHtml(formatUtcDate(item.modified_at))} UTC</span></div></div></article>`;
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
  await preloadAnswers(pageRecords);
  if (version !== renderVersion) return;
  document.querySelectorAll(".question").forEach((button) => { button.classList.remove("disabled"); button.tabIndex = 0; button.setAttribute("aria-disabled", "false"); });
  if (requestedQa && !requestedQaOpened) {
    const card = document.querySelector(`.qa-card[data-id="${CSS.escape(requestedQa)}"]`);
    if (card) {
      requestedQaOpened = true;
      const question = card.querySelector(".question");
      question.click();
      requestAnimationFrame(() => question.scrollIntoView({ behavior: "auto", block: "start" }));
    }
  }
}

document.querySelector(".taxonomy-filters").innerHTML = definitions.map((item) =>
  `<div class="taxonomy-row" data-taxonomy-row="${item.key}"><div class="taxonomy-label"><strong>${escapeHtml(item.label)}</strong><span class="zh-taxonomy">${escapeHtml(item.name_zh)}</span></div><div id="${item.type}-filter" class="taxonomy-options"></div></div>`
).join("");
byId("record-count").textContent = qaData.length;
document.querySelectorAll("[data-tag-language]").forEach((button) => button.addEventListener("click", () => {
  if (tagLanguage === button.dataset.tagLanguage) return;
  tagLanguage = button.dataset.tagLanguage;
  saveTagLanguage();
  render();
}));
byId("tag-search").addEventListener("input", (event) => {
  tagQuery = event.target.value;
  currentPage = 1;
  render();
});
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
if (collectionParameter && collectionNames.includes(collectionParameter)) selectedCollection = collectionParameter;
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
