//
//  app.js
//  Personal Website
//
//  Created by Nicolas Moreno on 2026-01-06.
const PAGES = ["about", "photos", "music", "blog", "map", "library", "timeline", "acknowledgements"];

function getPageFromHash() {
  const raw = (location.hash || "").replace("#", "").trim().toLowerCase();

  // Support routes like: #blog/my-post
  if (raw.startsWith("blog/")) return "blog";

  return PAGES.includes(raw) ? raw : "about";
}

function setActiveButton(page) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const isActive = btn.dataset.page === page;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

// -------------------------
// BLOG: file-based index + per-post html
// -------------------------
async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function fetchText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.text();
}

function sortPosts(posts, mode) {
  const copy = [...posts];

  if (mode === "title") {
    copy.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return copy;
  }

  // date should be YYYY-MM-DD
  copy.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (mode === "newest") copy.reverse();
  return copy;
}

function renderBlogList(posts) {
  const list = document.getElementById("blog-list");
  if (!list) return;

  list.innerHTML = "";

  posts.forEach((p) => {
    const card = document.createElement("article");
    card.className = "blog-card";

    const imgHtml = p.image
      ? `<img src="${p.image}" alt="" loading="lazy" />`
      : "";

    const emptyClass = p.image ? "" : "is-empty";

    card.innerHTML = `
      <div class="blog-card-inner">
        <div class="blog-card-text">
          <h2 class="blog-card-title">
            <a href="#blog/${p.slug}" class="blog-open" data-slug="${p.slug}">${p.title}</a>
          </h2>

          <div class="blog-card-body">
            <p class="blog-card-excerpt">${p.excerpt || ""}</p>
          </div>

          <p class="blog-card-date">${p.date || ""}</p>
        </div>

        <div class="blog-card-media ${emptyClass}">
          ${imgHtml}
        </div>
      </div>
    `;

    list.appendChild(card);
  });
}

async function renderSinglePost(slug) {
  const content = document.getElementById("content");
  if (!content) return;

  const index = await fetchJson("posts/index.json");
  const post = (index.posts || []).find((p) => p.slug === slug);

  const bodyHtml = await fetchText(`posts/${slug}.html`);

  content.innerHTML = `
    <a class="blog-back" href="#blog" data-page="blog">← Back</a>
    <h1>${post?.title || "Post"}</h1>
    ${post?.date ? `<p class="blog-post-date">${post.date}</p>` : ""}
    <hr />
    <div class="blog-post-body">
      ${bodyHtml}
    </div>
  `;

  content.scrollTop = 0;
}

// -------------------------
// MAP: ASCII world map
// Grid: 88 cols × 24 rows  |  lat 72°N → -55°S  |  lon -180° → 180°
// -------------------------
const MAP_COLS = 88;
const MAP_ROWS = 24;
const MAP_LAT_TOP = 72;
const MAP_LAT_BOTTOM = -55;

// Per-row land ranges as [startCol, endCol] (inclusive)
const MAP_LAND = [
  [[31,38],[70,86]],                                            // 0  ~72°N
  [[0,9],[30,39],[45,51],[52,87]],                              // 1  ~67°N
  [[0,10],[9,24],[29,38],[41,43],[44,51],[48,87]],              // 2  ~62°N
  [[12,35],[31,37],[41,44],[44,52],[47,82]],                    // 3  ~57°N
  [[15,33],[41,44],[43,53],[47,77],[78,82]],                    // 4  ~52°N  ← EU cities
  [[11,17],[19,34],[41,43],[43,47],[46,53],[49,74],[77,80]],    // 5  ~47°N  ← PNW, E Canada, Paris
  [[11,18],[20,31],[43,52],[53,57],[52,72],[64,75],[73,76],[77,80]], // 6  ~42°N
  [[11,30],[42,45],[44,52],[53,58],[57,63],[65,76],[77,79]],    // 7  ~37°N
  [[12,17],[19,23],[22,30],[43,57],[53,59],[58,64],[65,75]],    // 8  ~32°N  ← Orlando
  [[18,24],[23,27],[43,57],[54,62],[61,65],[64,73],[69,78]],    // 9  ~27°N
  [[17,24],[24,28],[43,56],[55,63],[61,67],[68,78]],            // 10 ~22°N  ← Cancun
  [[17,21],[20,22],[24,27],[43,48],[44,58],[57,64],[62,66],[67,78]], // 11 ~17°N
  [[19,22],[24,27],[43,48],[44,60],[59,63],[62,65],[66,78]],    // 12 ~12°N
  [[20,22],[24,27],[43,47],[47,61],[63,65],[65,77]],            // 13  ~7°N  ← Bogota
  [[22,25],[43,46],[47,62],[64,76],[69,73]],                    // 14  ~2°N
  [[22,31],[43,45],[48,61],[69,72],[70,77]],                    // 15  ~-3°S
  [[23,31],[48,54],[52,62],[68,78],[68,80]],                    // 16  ~-8°S
  [[24,31],[48,54],[55,61],[69,76],[68,82]],                    // 17  ~-13°S
  [[24,30],[48,53],[56,61],[68,83]],                            // 18  ~-18°S
  [[25,30],[49,58],[57,61],[68,83]],                            // 19  ~-23°S
  [[26,30],[49,56],[69,81]],                                    // 20  ~-28°S
  [[24,29],[50,55],[70,79]],                                    // 21  ~-33°S
  [[23,28],[51,53],[70,77]],                                    // 22  ~-38°S
  [[22,27],[81,83]],                                            // 23  ~-43°S
];

const MAP_CITIES = [
  {name: "London, UK",        lat: 51.5,  lon:  -0.1},
  {name: "Cambridge, UK",     lat: 52.2,  lon:   0.1},
  {name: "Warsaw, Poland",    lat: 52.2,  lon:  21.0},
  {name: "Paris, France",     lat: 48.8,  lon:   2.3},
  {name: "Cancun, Mexico",    lat: 21.2,  lon: -86.8},
  {name: "Bogota, Colombia",  lat:  4.7,  lon: -74.1},
  {name: "Portland, US",      lat: 45.5,  lon:-122.7},
  {name: "Orlando, FL",       lat: 28.5,  lon: -81.4},
  {name: "Seattle, US",       lat: 47.6,  lon:-122.3},
  {name: "London, Canada",    lat: 43.0,  lon: -81.2},
  {name: "Montreal, Canada",  lat: 45.5,  lon: -73.6},
  {name: "Niagara Falls, CA", lat: 43.1,  lon: -79.1},
];

function renderAsciiMap() {
  const el = document.getElementById("ascii-map");
  if (!el) return;

  const LAT_RANGE = MAP_LAT_TOP - MAP_LAT_BOTTOM;
  const grid = Array.from({length: MAP_ROWS}, () => new Array(MAP_COLS).fill(" "));

  MAP_LAND.forEach((ranges, r) => {
    ranges.forEach(([c1, c2]) => {
      for (let c = c1; c <= c2; c++) {
        if (c < MAP_COLS) grid[r][c] = ".";
      }
    });
  });

  function toGrid(lat, lon) {
    return {
      r: Math.round((MAP_LAT_TOP - lat) / LAT_RANGE * MAP_ROWS),
      c: Math.round((lon + 180) / 360 * MAP_COLS),
    };
  }

  const pins = new Map();
  MAP_CITIES.forEach(({name, lat, lon}) => {
    const {r, c} = toGrid(lat, lon);
    if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) {
      const key = `${r},${c}`;
      if (!pins.has(key)) pins.set(key, []);
      pins.get(key).push(name);
    }
  });

  const lines = grid.map((row, r) =>
    row.map((ch, c) => {
      const key = `${r},${c}`;
      if (pins.has(key)) {
        const names = pins.get(key).join(" · ");
        return `<span class="map-pin" title="${names}">●</span>`;
      }
      return ch === "." ? "." : " ";
    }).join("")
  );

  el.innerHTML = lines.join("\n");
}

// -------------------------
// RENDER
// -------------------------
async function render(page) {
  const content = document.getElementById("content");
  if (!content) return;

  // Only treat #blog/<slug> as a single-post route IF we're rendering the Blog page
  const rawHash = (location.hash || "").replace("#", "").trim();
  if (page === "blog" && rawHash.startsWith("blog/")) {
    setActiveButton("blog");
    const slug = rawHash.split("/")[1];
    try {
      await renderSinglePost(slug);
    } catch (e) {
      content.innerHTML = `<h1>Blog</h1><p>Could not load post.</p>`;
    }
    return;
  }

  const tpl = document.getElementById(`tpl-${page}`);
  if (!tpl) return;

  content.innerHTML = "";
  content.appendChild(tpl.content.cloneNode(true));
  content.scrollTop = 0;

  setActiveButton(page);

  // Keep URL in sync
  if (location.hash !== `#${page}`) {
    history.replaceState(null, "", `#${page}`);
  }

  // If on Map, render the ASCII world map
  if (page === "map") {
    renderAsciiMap();
  }

  // If on Blog list view, load posts
  if (page === "blog") {
    let data;
    try {
      data = await fetchJson("posts/index.json");
    } catch (e) {
      data = { posts: [] };
    }

    const sortEl = document.getElementById("blog-sort");
    const mode = sortEl ? sortEl.value : "newest";
    renderBlogList(sortPosts(data.posts || [], mode));

    if (sortEl) {
      sortEl.onchange = () => {
        renderBlogList(sortPosts(data.posts || [], sortEl.value));
      };
    }
  }
}

function init() {
  // Top nav buttons
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => render(btn.dataset.page));
  });

  // Delegate clicks inside content (back links, acknowledgements link, blog titles)
  const contentEl = document.getElementById("content");
  if (contentEl) {
    contentEl.addEventListener("click", async (e) => {
      // Any link that declares a page should update hash + render that page
      const pageLink = e.target.closest("a[data-page]");
      if (pageLink) {
        e.preventDefault();
        const page = pageLink.dataset.page;

        if (location.hash !== `#${page}`) {
          history.replaceState(null, "", `#${page}`);
        }
        await render(page);
        return;
      }

      // In-page tab buttons
      const tabBtn = e.target.closest(".tab-btn[data-tab]");
      if (tabBtn) {
        const tabId = tabBtn.dataset.tab;
        content.querySelectorAll(".tab-btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.tab === tabId);
        });
        content.querySelectorAll(".tab-pane").forEach((p) => {
          p.hidden = p.id !== `tab-${tabId}`;
        });
        return;
      }

      // Blog post open links
      const blogLink = e.target.closest("a.blog-open[data-slug]");
      if (blogLink) {
        e.preventDefault();
        const slug = blogLink.dataset.slug;

        history.replaceState(null, "", `#blog/${slug}`);
        await render("blog");
      }
    });
  }

  // Back/forward navigation
  window.addEventListener("hashchange", () => render(getPageFromHash()));

  // Initial render
  render(getPageFromHash());
}

init();
