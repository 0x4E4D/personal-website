//
//  app.js
//  Personal Website
//
//  Created by Nicolas Moreno on 2026-01-06.
const PAGES = ["about", "photos", "music", "blog", "library", "acknowledgements"];

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
// FETCH HELPERS
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

// -------------------------
// BLOG
// -------------------------
function sortPosts(posts, mode) {
  const copy = [...posts];

  if (mode === "title") {
    copy.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return copy;
  }

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
// PHOTOS
// -------------------------

// Fisher-Yates shuffle (returns a new array)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadPhotos() {
  let data;
  try {
    data = await fetchJson("data/photos.json");
  } catch (e) {
    data = { photos: [] };
  }

  // Build the tag list from the original order so the filter bar stays stable
  const tagSet = new Set();
  (data.photos || []).forEach((p) => (p.tags || []).forEach((t) => tagSet.add(t)));
  const tags = [...tagSet];

  // Shuffle the photos themselves so the wall feels fresh on every visit/reload
  const photos = shuffle(data.photos || []);

  // Render filter buttons
  const filtersEl = document.getElementById("photo-filters");
  if (filtersEl) {
    filtersEl.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "tag-filter is-active";
    allBtn.dataset.tag = "all";
    allBtn.textContent = "All";
    filtersEl.appendChild(allBtn);

    tags.forEach((tag) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-filter";
      btn.dataset.tag = tag;
      btn.textContent = tag;
      filtersEl.appendChild(btn);
    });

    filtersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag-filter");
      if (!btn) return;

      filtersEl.querySelectorAll(".tag-filter").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });

      renderMosaic(photos, btn.dataset.tag);
    });
  }

  renderMosaic(photos, "all");
}

function renderMosaic(photos, activeTag) {
  const mosaic = document.getElementById("photo-mosaic");
  if (!mosaic) return;

  const filtered =
    activeTag === "all"
      ? photos
      : photos.filter((p) => (p.tags || []).includes(activeTag));

  mosaic.innerHTML = "";

  if (!filtered.length) {
    mosaic.innerHTML = '<p style="color: var(--ink-dim); font-size: 13px; grid-column: 1/-1;">No photos yet.</p>';
    return;
  }

  filtered.forEach((photo, idx) => {
    const item = document.createElement("div");

    // A "feature" photo becomes a big 2x2 hero; otherwise its aspect drives size
    const sizeClass = photo.feature
      ? "is-feature"
      : photo.aspect
      ? `is-${photo.aspect}`
      : "";
    item.className = "photo-item" + (sizeClass ? ` ${sizeClass}` : "");

    if (photo.src) {
      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.alt || "";
      img.loading = "lazy";
      img.decoding = "async";
      // Mark the first photo as high-priority so it loads ASAP (helps LCP)
      if (idx === 0) img.setAttribute("fetchpriority", "high");
      item.appendChild(img);
    } else {
      item.dataset.empty = "[ img ]";
    }

    mosaic.appendChild(item);
  });
}

// Inject loading="lazy" into iframe embeds (defers off-screen players,
// big win on the Music page which has 20+ embeds)
function lazyEmbed(html) {
  return (html || "").replace(/<iframe(?![^>]*\bloading=)/i, '<iframe loading="lazy"');
}

// -------------------------
// MUSIC
// -------------------------
async function loadMusic() {
  let data;
  try {
    data = await fetchJson("data/music.json");
  } catch (e) {
    data = { songs: [], sets: [] };
  }

  renderMusicSongs(shuffle(data.songs || []));   // fresh order every load
  renderMusicSets(shuffle(data.sets || []));     // fresh order every load
}

function renderMusicSongs(items) {
  const list = document.getElementById("music-songs-list");
  if (!list) return;
  list.innerHTML = "";

  items.forEach((item, i) => {
    if (i > 0) list.appendChild(document.createElement("hr"));

    const noteHtml = item.note ? `<p class="music-note">${item.note}</p>` : "";

    const linksHtml = (item.links || [])
      .map(
        (l) =>
          `<a class="music-link" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`
      )
      .join("");
    const linksBlock = linksHtml ? `<div class="music-links">${linksHtml}</div>` : "";

    const article = document.createElement("article");
    article.className = "music-item";

    if (item.embed) {
      // Playable embedded Bandcamp player (artwork lives inside the embed)
      article.innerHTML = `
        <div class="music-meta">
          <h2 class="music-title">${item.title}</h2>
          <div class="music-sub">${item.sub || ""}</div>
          ${noteHtml}
          <div class="bc-embed">${lazyEmbed(item.embed)}</div>
          ${linksBlock}
        </div>
      `;
    } else {
      // Fallback: cover art + links
      const artHtml = item.art
        ? `<div class="art-frame"><img class="art" src="${item.art}" alt="${item.title} cover art" loading="lazy" /></div>`
        : "";
      article.innerHTML = `
        <div class="music-row">
          ${artHtml}
          <div class="music-meta">
            <h2 class="music-title">${item.title}</h2>
            <div class="music-sub">${item.sub || ""}</div>
            ${noteHtml}
            ${linksBlock}
          </div>
        </div>
      `;
    }

    list.appendChild(article);
  });
}

function renderMusicSets(items) {
  const list = document.getElementById("music-sets-list");
  if (!list) return;
  list.innerHTML = "";

  items.forEach((item, i) => {
    if (i > 0) list.appendChild(document.createElement("hr"));

    const noteHtml = item.note ? `<p class="music-note">${item.note}</p>` : "";

    const embedHtml = item.embed
      ? `<div class="sc-embed">${lazyEmbed(item.embed)}</div>`
      : `<div class="sc-embed"><div class="sc-embed-placeholder">[ SoundCloud embed ]</div></div>`;

    const linkHtml = item.link
      ? `<div class="music-links"><a class="music-link" href="${item.link}" target="_blank" rel="noopener">SoundCloud</a></div>`
      : "";

    const article = document.createElement("article");
    article.className = "music-item";
    article.innerHTML = `
      <div class="music-meta">
        <h2 class="music-title">${item.title}</h2>
        <div class="music-sub">${item.sub || ""}</div>
        ${noteHtml}
        ${embedHtml}
        ${linkHtml}
      </div>
    `;
    list.appendChild(article);
  });
}

// -------------------------
// LIBRARY
// -------------------------
async function loadLibrary() {
  let data;
  try {
    data = await fetchJson("data/library.json");
  } catch (e) {
    data = { shelves: [] };
  }

  renderLibrary(data.shelves || []);
}

function renderLibrary(shelves) {
  const bookshelf = document.getElementById("bookshelf");
  if (!bookshelf) return;
  bookshelf.innerHTML = "";

  shelves.forEach((books) => {
    const shelf = document.createElement("div");
    shelf.className = "shelf";

    books.forEach((book) => {
      const classes = ["book"];
      if (book.height === "tall")  classes.push("book--tall");
      if (book.height === "short") classes.push("book--short");
      if (book.width  === "wide")  classes.push("book--wide");
      if (book.width  === "thin")  classes.push("book--thin");
      if (book.status === "wishlist") classes.push("book--wishlist");
      if (book.status === "reading")  classes.push("book--reading");

      const div = document.createElement("div");
      div.className = classes.join(" ");
      div.title = `${book.title} — ${book.author}`;
      div.innerHTML = `
        <span class="book-title">${book.title}</span>
        <span class="book-author">${book.author}</span>
      `;
      shelf.appendChild(div);
    });

    bookshelf.appendChild(shelf);
  });
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

  // Page-specific data loading
  if (page === "photos")   await loadPhotos();
  if (page === "music")    await loadMusic();
  if (page === "library")  await loadLibrary();

  // Blog list view
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
  // Top nav buttons — defer the heavy render so the button's active state
  // paints first (keeps INP snappy)
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      requestAnimationFrame(() => render(btn.dataset.page));
    });
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
        requestAnimationFrame(() => render(page));
        return;
      }

      // In-page tab buttons
      const tabBtn = e.target.closest(".tab-btn[data-tab]");
      if (tabBtn) {
        const tabId = tabBtn.dataset.tab;
        contentEl.querySelectorAll(".tab-btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.tab === tabId);
        });
        contentEl.querySelectorAll(".tab-pane").forEach((p) => {
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
        requestAnimationFrame(() => render("blog"));
      }
    });
  }

  // Back/forward navigation
  window.addEventListener("hashchange", () => render(getPageFromHash()));

  // Initial render
  render(getPageFromHash());
}

init();
