const IPFS_METADATA_HASH = "bafybeicqjqzixdtawkbcuyaagrmk3vyfweidwzb6hwbucadhoxoe2pd3qm";
const IPFS_IMAGE_HASH = "bafybeiaqmceddfi4y3dyqwepjs6go477x35ypaojwgegcsee2vgy63yobq";
const COLLECTION_SIZE = 10000;
const BATCH_SIZE = 24;
let visibleCount = BATCH_SIZE;
// Prefer ipfs.io for reliability today; keep Cloudflare/zatoshi as fallbacks.
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://dweb.link/ipfs",
  "https://zatoshi.market/ipfs",
];
const IPFS_TIMEOUT = 7000;
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const METADATA_SOURCES = [
  "/claim/metadata/metadata.json",
  "../../zgods-collection/metadata.json",
  `${IPFS_GATEWAYS[0]}/${IPFS_METADATA_HASH}/metadata.json`,
];
const CLAIMED_STORAGE_KEY = 'zgods_global_claimed';

function buildGatewayUrl(hash, path, gatewayIndex) {
  const base = IPFS_GATEWAYS[gatewayIndex] || IPFS_GATEWAYS[0];
  return `${base}/${hash}/${path}`;
}

async function fetchWithTimeout(url, timeout = IPFS_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal, cache: "force-cache" });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithGatewayFallback(hash, filename) {
  let lastError;
  for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
    const url = buildGatewayUrl(hash, filename, i);
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Gateway ${i} responded ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to load from IPFS gateways");
}

async function fetchJsonWithFallback(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Failed ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Metadata unavailable");
}

function attachIpfsImg(img, hash, filename, priority = "low") {
  let gatewayIndex = 0;
  if (priority) img.fetchPriority = priority;
  const load = () => {
    img.src = buildGatewayUrl(hash, filename, gatewayIndex);
  };
  img.onerror = () => {
    gatewayIndex += 1;
    if (gatewayIndex < IPFS_GATEWAYS.length) {
      load();
    } else {
      img.onerror = null;
      img.src = TRANSPARENT_PIXEL;
      img.style.background = "#242424";
      img.style.minHeight = "220px";
      img.classList.add("img-fallback");
    }
  };
  load();
}

function wrapWithSkeleton(img) {
  const shell = document.createElement("div");
  shell.className = "thumb skeleton";
  const clear = () => shell.classList.remove("skeleton");
  img.addEventListener("load", clear, { once: true });
  img.addEventListener("error", clear, { once: true });
  shell.appendChild(img);
  return shell;
}

function renderAttrSkeleton(container) {
  if (!container) return;
  const row = () => `
    <div class="attr">
      <div class="k" style="height:12px;background:#333;border-radius:4px;margin-bottom:6px;"></div>
      <div class="v" style="height:12px;background:#2a2a2a;border-radius:4px;width:70%;"></div>
    </div>
  `;
  container.innerHTML = `${row()}${row()}${row()}${row()}`;
}

function loadClaimedSet() {
  try {
    const raw = localStorage.getItem(CLAIMED_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    claimedSet = new Set(Array.isArray(arr) ? arr : []);
    claimedList = Array.from(claimedSet).sort((a, b) => a - b);
  } catch (err) {
    console.warn('Failed to load claimed set', err);
    claimedSet = new Set();
    claimedList = [];
  }
}

const elStatus = document.getElementById("status");
const elResultCount = document.getElementById("resultCount");
const elGallery = document.getElementById("gallery");
const elSearch = document.getElementById("searchInput");
const elSort = document.getElementById("sortSelect");
const elPrev = document.getElementById("prevPage");
const elNext = document.getElementById("nextPage");
const elPageNumber = document.getElementById("pageNumber");
const elPageTotal = document.getElementById("pageTotal");
const elModal = document.getElementById("modal");
const elModalBody = document.getElementById("modalBody");
const elModalClose = document.getElementById("modalClose");
const elModalPrev = document.getElementById("modalPrev");
const elModalNext = document.getElementById("modalNext");

let currentPage = 1;
let searchQuery = "";
let sortMode = "id-asc";
let density = "grid";
let modalListIndex = -1; // current index in the active list being viewed
let sentinel = null;
let meta = [];
let claimedSet = new Set();
let claimedList = [];
let maxIdSeen = COLLECTION_SIZE;

function getName(id) {
  const entry = meta[id];
  return entry?.name || entry?.meta?.name || `ZGods ${id}`;
}

function buildTile(id) {
  const tile = document.createElement("article");
  tile.className = "tile";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  const displayName = getName(id);
  img.alt = displayName;
  attachIpfsImg(img, IPFS_IMAGE_HASH, `${id}.png`, "low");
  tile.appendChild(wrapWithSkeleton(img));

  const metaBar = document.createElement("div");
  metaBar.className = "meta";

  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = displayName;

  const idBadge = document.createElement("div");
  idBadge.className = "id-badge";
  const idSpan = document.createElement("span");
  idSpan.textContent = `#${id}`;
  idBadge.appendChild(idSpan);

  metaBar.appendChild(nameEl);
  metaBar.appendChild(idBadge);
  tile.appendChild(metaBar);

  tile.addEventListener("click", () => openModal(id));

  return tile;
}

function getActiveList() {
  // If search query is present, filter IDs
  const q = searchQuery.trim();
  let list = [];
  const base = claimedList;

  if (q) {
    // Simple ID search
    // Remove # if present
    const cleanQ = q.replace(/^#/, '');
    const searchId = parseInt(cleanQ, 10);
    if (!isNaN(searchId) && searchId >= 0 && searchId < COLLECTION_SIZE) {
      list = [searchId];
    } else {
      list = [];
    }
  } else {
    list = base.slice();
  }

  // Sort
  if (sortMode === "id-desc") {
    list.reverse();
  }

  return list;
}

function resetVisibleCount() {
  visibleCount = BATCH_SIZE;
}

function applyDensity() {
  if (!elGallery) return;
  let min;
  if (density === "list") {
    elGallery.classList.add("list-view");
    return;
  } else {
    elGallery.classList.remove("list-view");
  }
  switch (density) {
    case "dense": min = "160px"; break;
    default: min = "200px";
  }
  elGallery.style.setProperty("--card-min", min);
}

function renderList() {
  const list = getActiveList();
  const end = Math.min(visibleCount, list.length);
  const frag = document.createDocumentFragment();
  elGallery.innerHTML = "";

  for (let p = 0; p < end; p++) {
    const id = list[p];
    frag.appendChild(buildTile(id));
  }

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No claimed items yet.';
    frag.appendChild(empty);
  }

  elGallery.appendChild(frag);
  if (sentinel) elGallery.appendChild(sentinel);

  const formatNum = n => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.0', '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}K`;
    return n.toString();
  };
  const showing = `${formatNum(end)} of ${formatNum(list.length || 0)}`;
  if (elStatus) elStatus.textContent = list.length === 0 ? `No claimed items` : showing;
  if (elResultCount) elResultCount.textContent = `${formatNum(list.length)} claimed`;
  updateNavState(1);
  syncUrl();
}

async function openModal(id) {
  // Find index in current list for navigation
  const list = getActiveList();
  const listIdx = list.indexOf(id);
  if (listIdx >= 0) modalListIndex = listIdx;
  const baseName = getName(id);

  // Initial render with skeleton state
  elModalBody.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="modalTitle">${baseName}</h2>
    </div>
    <div class="modal-grid">
      <div class="art-frame"><div class="thumb skeleton"><img alt="ZGods ${id}" /></div></div>
      <div class="details">
        <div id="modalAttributes" class="attr-list"></div>
      </div>
    </div>
  `;

  const modalImg = elModalBody.querySelector(".art-frame img");
  const modalShell = elModalBody.querySelector(".art-frame .thumb");
  if (modalImg && modalShell) {
    const clear = () => modalShell.classList.remove("skeleton");
    modalImg.addEventListener("load", clear, { once: true });
    modalImg.addEventListener("error", clear, { once: true });
    modalImg.decoding = "async";
    attachIpfsImg(modalImg, IPFS_IMAGE_HASH, `${id}.png`, "high");
  }

  const attrContainer = document.getElementById("modalAttributes");
  renderAttrSkeleton(attrContainer);

  elModal.classList.remove("hidden");
  elModal.setAttribute("aria-hidden", "false");

  try {
    const data = await fetchJsonWithFallback([
      `/claim/metadata/${id}.json`,
      `${IPFS_GATEWAYS[0]}/${IPFS_METADATA_HASH}/${id}.json`,
      `${IPFS_GATEWAYS[1]}/${IPFS_METADATA_HASH}/${id}.json`,
    ]);

    // Update title if name exists
    if (data.name) {
      const titleEl = document.getElementById("modalTitle");
      if (titleEl) titleEl.textContent = data.name;
    }

    // Render attributes
    const attrs = data.attributes || [];
    const attrContainer = document.getElementById("modalAttributes");
    if (attrContainer) {
      if (attrs.length > 0) {
        attrContainer.innerHTML = attrs.map(a => `
          <div class="attr">
            <div class="k">${a.trait_type}</div>
            <div class="v">${a.value}</div>
          </div>
        `).join("");
      } else {
        attrContainer.innerHTML = `<div class="attr" style="grid-column: 1/-1; text-align: center;">No attributes found</div>`;
      }
    }
  } catch (err) {
    console.error(err);
    renderAttrSkeleton(document.getElementById("modalAttributes"));
  }
}

function closeModal() {
  elModal.classList.add("hidden");
  elModal.setAttribute("aria-hidden", "true");
}

elModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeModal();
});
elModalClose.addEventListener("click", closeModal);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
window.addEventListener("keydown", (e) => {
  if (elModal.classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") modalStep(-1);
  if (e.key === "ArrowRight") modalStep(1);
});
if (elModalPrev) elModalPrev.addEventListener("click", () => modalStep(-1));
if (elModalNext) elModalNext.addEventListener("click", () => modalStep(1));

function modalStep(delta) {
  const list = getActiveList();
  if (modalListIndex < 0) return;

  let nextIdx = modalListIndex + delta;
  if (nextIdx < 0 || nextIdx >= list.length) return;

  modalListIndex = nextIdx;
  openModal(list[modalListIndex]);
}

// Pagination controls
function updateNavState(totalPages) {
  if (!elPrev || !elNext) return;
  elPrev.disabled = true;
  elNext.disabled = true;
  if (elPageNumber) elPageNumber.textContent = "1";
  if (elPageTotal) elPageTotal.textContent = "1";
}

function setPage() {
  // pagination disabled in virtual mode
}

function setPageFromURLOrDefault() {
  const url = new URL(window.location.href);
  searchQuery = url.searchParams.get('q') || "";
  sortMode = url.searchParams.get('sort') || "id-asc";
  density = url.searchParams.get('density') || "grid";

  if (elSearch) elSearch.value = searchQuery;
  if (elSort) elSort.value = sortMode;

  updateViewButtons();
  applyDensity();
}

function syncUrl() {
  const url = new URL(window.location.href);
  if (searchQuery) url.searchParams.set('q', searchQuery); else url.searchParams.delete('q');
  url.searchParams.set('sort', sortMode);
  url.searchParams.set('density', density);
  window.history.replaceState({}, '', url);
}

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

function showSkeletons(n) {
  if (!elGallery) return;
  elGallery.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const tile = document.createElement('article');
    tile.className = 'tile';
    const thumb = document.createElement('div');
    thumb.className = 'thumb skeleton';
    tile.appendChild(thumb);
    frag.appendChild(tile);
  }
  elGallery.appendChild(frag);
}

async function loadMetadata() {
  if (elStatus) elStatus.textContent = "Loading metadata…";
  showSkeletons(BATCH_SIZE);
  const formatNum = n => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.0', '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}K`;
    return n.toString();
  };
  try {
    loadClaimedSet();
    const maxClaimed = claimedList.length ? claimedList[claimedList.length - 1] : 0;
    maxIdSeen = Math.max(COLLECTION_SIZE, maxClaimed + 1);
    const data = await fetchJsonWithFallback(METADATA_SOURCES);
    if (Array.isArray(data)) {
      meta = data;
    } else if (data && typeof data === "object") {
      meta = Object.values(data);
    }
    if (!Array.isArray(meta) || meta.length === 0) throw new Error("Empty metadata");
    if (elStatus) elStatus.textContent = `${formatNum(meta.length)} items ready`;
  } catch (err) {
    const SIZE = maxIdSeen;
    meta = Array.from({ length: SIZE }, (_, i) => ({ name: `ZGods ${i}`, attributes: [] }));
    console.warn("Metadata fallback active", err);
    if (elStatus) elStatus.textContent = `${formatNum(meta.length)} items ready (fallback)`;
  }
}

if (elSearch) {
  elSearch.addEventListener('input', debounce(() => {
    searchQuery = elSearch.value || "";
    resetVisibleCount();
    renderList();
  }, 200));
}

if (elSort) {
  elSort.addEventListener('change', () => {
    sortMode = elSort.value;
    resetVisibleCount();
    renderList();
  });
}

// View buttons
function updateViewButtons() {
  const buttons = document.querySelectorAll('.view-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === density);
  });
}

function setupViewButtons() {
  const buttons = document.querySelectorAll('.view-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      density = btn.dataset.view;
      updateViewButtons();
      applyDensity();
      syncUrl();
    });
  });
}

function setupInfiniteScroll() {
  if (!elGallery) return;
  sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const list = getActiveList();
        if (visibleCount < list.length) {
          visibleCount += BATCH_SIZE;
          renderList();
        }
      }
    });
  }, { root: null, rootMargin: '800px 0px 800px 0px', threshold: 0 });
  observer.observe(sentinel);
}

// Initial boot
(async () => {
  try {
    setupViewButtons();
    await loadMetadata();
    setPageFromURLOrDefault();
    resetVisibleCount();
    setupInfiniteScroll();
    renderList();
  } catch (err) {
    console.error(err);
    if (elStatus) elStatus.textContent = String(err.message || err);
  }
})();
