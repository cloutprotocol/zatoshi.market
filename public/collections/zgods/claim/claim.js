const WHITELIST_URL = "./whitelist.csv";
const IPFS_METADATA_HASH = "bafybeicqjqzixdtawkbcuyaagrmk3vyfweidwzb6hwbucadhoxoe2pd3qm";
const IPFS_IMAGE_HASH = "bafybeiaqmceddfi4y3dyqwepjs6go477x35ypaojwgegcsee2vgy63yobq";
const COLLECTION_SIZE = 10000;
// Prefer ipfs.io for reliability today; keep Cloudflare/dweb/zatoshi as fallbacks.
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://dweb.link/ipfs",
  "https://zatoshi.market/ipfs",
];
const IPFS_TIMEOUT = 7000;
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

// DOM Elements
const connectSection = document.getElementById("connectSection");
const claimSection = document.getElementById("claimSection");
const inscribingSection = document.getElementById("inscribingSection");
const revealSection = document.getElementById("revealSection");

const walletInput = document.getElementById("walletInput");
const checkWalletBtn = document.getElementById("checkWalletBtn");
const disconnectWalletBtn = document.getElementById("disconnectWallet");
const walletAddressEl = document.getElementById("walletAddress");

const availableClaimEl = document.getElementById("availableClaim");
const alreadyClaimedEl = document.getElementById("alreadyClaimed");
const totalAllocationEl = document.getElementById("totalAllocation");

const claimQuantityInput = document.getElementById("claimQuantity");
const sliderValue = document.getElementById("sliderValue");
const inscribeBtn = document.getElementById("inscribeBtn");
const inscribeQtySpan = document.getElementById("inscribeQty");

const inscribingTextEl = document.getElementById("inscribingText");
const inscribingQtySpan = document.getElementById("inscribingQty");

const revealedItemsEl = document.getElementById("revealedItems");
const claimMoreBtn = document.getElementById("claimMoreBtn");

const collectionPreview = document.getElementById("collectionPreview");
const collectionGrid = document.getElementById("collectionGrid");

// Modal Elements
const elModal = document.getElementById("modal");
const elModalBody = document.getElementById("modalBody");
const elModalClose = document.getElementById("modalClose");

// State
let whitelist = [];
let connectedWallet = null;
let userAllocation = null; // { count, claimedIds: [] }
let globalClaimed = new Set(); // Set of all IDs claimed by anyone

function resetUiState() {
  revealedItemsEl.innerHTML = "";
  collectionGrid.innerHTML = "";
  collectionPreview.classList.add("hidden");
  revealSection.classList.add("hidden");
  inscribingSection.classList.add("hidden");
  claimSection.classList.add("hidden");
}

// IPFS Helpers
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

function createIpfsImg(id, priority = "low") {
  const img = document.createElement("img");
  img.alt = `ZGods ${id}`;
  img.loading = "lazy";
  img.decoding = "async";
  attachIpfsImg(img, IPFS_IMAGE_HASH, `${id}.png`, priority);
  return img;
}

function makeImageShell(id, priority) {
  const shell = document.createElement("div");
  shell.className = "img-shell skeleton";
  const img = createIpfsImg(id, priority);
  const clear = () => shell.classList.remove("skeleton");
  img.addEventListener("load", clear, { once: true });
  img.addEventListener("error", clear, { once: true });
  shell.appendChild(img);
  return { shell, img };
}

function createPreviewCard(id, priority = "low", type = "revealed") {
  const card = document.createElement("div");
  card.className = type === "collection" ? "collection-item" : "revealed-item";
  const { shell } = makeImageShell(id, priority);
  card.appendChild(shell);

  const info = document.createElement("div");
  info.className = type === "collection" ? "collection-item-info" : "revealed-item-info";
  const nameEl = document.createElement("div");
  nameEl.className = type === "collection" ? "collection-item-name" : "revealed-item-name";
  nameEl.textContent = `ZGods ${id}`;
  const idEl = document.createElement("div");
  idEl.className = type === "collection" ? "collection-item-id" : "revealed-item-id";
  idEl.textContent = `#${id}`;
  info.appendChild(nameEl);
  info.appendChild(idEl);
  card.appendChild(info);

  return card;
}

// CSV Parser
async function loadWhitelist() {
  try {
    const res = await fetch(WHITELIST_URL);
    if (!res.ok) throw new Error("Failed to load whitelist");
    const text = await res.text();
    parseWhitelist(text);
  } catch (err) {
    console.error("Failed to load whitelist:", err);
    alert("Error loading whitelist data. Please try refreshing.");
  }
}

function parseWhitelist(csvText) {
  const lines = csvText.trim().split('\n');
  whitelist = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [address, countStr] = line.split(',');
    const count = parseInt(countStr, 10);

    if (address && !isNaN(count)) {
      whitelist.push({
        address: address.trim(),
        count: count
      });
    }
  }
  console.log(`Loaded ${whitelist.length} whitelist entries.`);
}

// Global State Management
function loadGlobalState() {
  const stored = localStorage.getItem('zgods_global_claimed');
  if (stored) {
    globalClaimed = new Set(JSON.parse(stored));
  } else {
    globalClaimed = new Set();
  }
}

function saveGlobalState() {
  localStorage.setItem('zgods_global_claimed', JSON.stringify(Array.from(globalClaimed)));
}

// Check Wallet
checkWalletBtn.addEventListener("click", async () => {
  const address = walletInput.value.trim();
  if (!address) return;

  resetUiState();
  userAllocation = null;
  connectedWallet = null;

  checkWalletBtn.disabled = true;
  checkWalletBtn.textContent = "Checking...";

  // Ensure whitelist is loaded
  if (whitelist.length === 0) await loadWhitelist();
  loadGlobalState();

  const allocation = whitelist.find(w => w.address === address);

  if (allocation) {
    connectedWallet = address;

    // Load user's specific claimed IDs
    const storedUserClaimed = JSON.parse(localStorage.getItem(`zgods_user_claimed_${address}`) || "[]");

    userAllocation = {
      count: allocation.count,
      claimedIds: storedUserClaimed
    };

    showClaimSection();
  } else {
    alert("Address not found in whitelist.");
    checkWalletBtn.disabled = false;
    checkWalletBtn.textContent = "Check";
  }
});

// Show Claim Section
function showClaimSection() {
  connectSection.classList.add("hidden");
  claimSection.classList.remove("hidden");

  walletAddressEl.textContent = connectedWallet;
  updateStats();
  renderCollection();

  // Reset input
  walletInput.value = "";
  checkWalletBtn.disabled = false;
  checkWalletBtn.textContent = "Check";
}

function updateStats() {
  const claimedCount = userAllocation.claimedIds.length;
  const available = userAllocation.count - claimedCount;

  availableClaimEl.textContent = available;
  alreadyClaimedEl.textContent = claimedCount;
  totalAllocationEl.textContent = userAllocation.count;

  // Update Slider Max
  const maxMint = Math.min(5, available);
  claimQuantityInput.max = maxMint;

  if (available === 0) {
    claimQuantityInput.value = 0;
    claimQuantityInput.disabled = true;
    sliderValue.textContent = "0";
    inscribeBtn.disabled = true;
    inscribeBtn.textContent = "All Claimed";
  } else {
    claimQuantityInput.disabled = false;
    if (parseInt(claimQuantityInput.value) > maxMint) {
      claimQuantityInput.value = maxMint;
    }
    if (parseInt(claimQuantityInput.value) < 1) {
      claimQuantityInput.value = 1;
    }
    updateInscribeButton();
  }
}

// Disconnect
disconnectWalletBtn.addEventListener("click", () => {
  connectedWallet = null;
  userAllocation = null;
  resetUiState();
  connectSection.classList.remove("hidden");
});

// Slider Controls
claimQuantityInput.addEventListener("input", () => {
  updateInscribeButton();
});

function updateInscribeButton() {
  const qty = parseInt(claimQuantityInput.value);
  sliderValue.textContent = qty;
  inscribeQtySpan.textContent = qty;
  inscribeBtn.textContent = `Inscribe ${qty} ZGODS`;
  inscribeBtn.disabled = false;
}

// Random ID Picker
function pickRandomIds(count) {
  const availableIds = [];
  // Generate pool of ALL IDs that are NOT in globalClaimed
  for (let i = 0; i < COLLECTION_SIZE; i++) {
    if (!globalClaimed.has(i)) {
      availableIds.push(i);
    }
  }

  if (availableIds.length < count) {
    throw new Error("Not enough ZGODS remaining in the global pool!");
  }

  // Shuffle and pick
  const picked = [];
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * availableIds.length);
    const id = availableIds[randomIndex];
    picked.push(id);
    // Remove from available to avoid duplicates in same batch
    availableIds.splice(randomIndex, 1);
  }

  return picked;
}

// Inscribe
inscribeBtn.addEventListener("click", async () => {
  const quantity = parseInt(claimQuantityInput.value);

  claimSection.classList.add("hidden");
  inscribingSection.classList.remove("hidden");
  inscribingQtySpan.textContent = quantity;

  // Simulate delay
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // Pick Random IDs
    const newIds = pickRandomIds(quantity);

    // Update Global State
    newIds.forEach(id => globalClaimed.add(id));
    saveGlobalState();

    // Update User State
    userAllocation.claimedIds.push(...newIds);
    localStorage.setItem(`zgods_user_claimed_${connectedWallet}`, JSON.stringify(userAllocation.claimedIds));

    showRevealSection(newIds);
  } catch (err) {
    alert(err.message);
    showClaimSection();
  }
});

// Reveal
function showRevealSection(ids) {
  inscribingSection.classList.add("hidden");
  revealSection.classList.remove("hidden");

  revealedItemsEl.innerHTML = "";

  ids.forEach((id, idx) => {
    const card = createPreviewCard(id, "high", "revealed");
    card.style.animationDelay = `${idx * 0.1}s`;
    card.addEventListener("click", () => {
      card.style.borderColor = "#4caf50";
      openModal(id);
    });
    revealedItemsEl.appendChild(card);
  });
}

// Claim More
claimMoreBtn.addEventListener("click", () => {
  revealSection.classList.add("hidden");
  showClaimSection();
});

// Render Collection
function renderCollection() {
  if (userAllocation.claimedIds.length > 0) {
    collectionPreview.classList.remove("hidden");
    collectionGrid.innerHTML = "";

    // Sort IDs for display
    const sortedIds = [...userAllocation.claimedIds].sort((a, b) => a - b);

    sortedIds.forEach(id => {
      const card = createPreviewCard(id, "low", "collection");
      card.addEventListener("click", () => {
        card.style.borderColor = "#4caf50";
        openModal(id);
      });
      collectionGrid.appendChild(card);
    });
  } else {
    collectionPreview.classList.add("hidden");
    collectionGrid.innerHTML = "";
  }
}

// Modal Logic
async function openModal(id) {
  console.log("Opening modal for:", id);

  // Initial render with loading state
  elModalBody.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title" id="modalTitle">ZGods ${id}</h2>
    </div>
    <div class="modal-grid">
      <div class="art-frame"><img alt="ZGods ${id}" /></div>
      <div class="details">
        <div id="modalAttributes" class="attr-list"></div>
      </div>
    </div>
  `;

  const modalImg = elModalBody.querySelector(".art-frame img");
  if (modalImg) {
    modalImg.decoding = "async";
    attachIpfsImg(modalImg, IPFS_IMAGE_HASH, `${id}.png`, "high");
  }
  renderAttrSkeleton(document.getElementById("modalAttributes"));

  elModal.classList.remove("hidden");
  elModal.setAttribute("aria-hidden", "false");

  try {
    const data = await fetchJsonWithGatewayFallback(IPFS_METADATA_HASH, `${id}.json`);

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

// Init
loadWhitelist();
