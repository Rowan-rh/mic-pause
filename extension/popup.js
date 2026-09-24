// popup.js
(async function () {
  const toggle = document.getElementById("toggle");
  const status = document.getElementById("status");
  const dot = document.getElementById("dot");
  const currentHostLabel = document.getElementById("current-host");
  const toggleCurrentSite = document.getElementById("toggle-current-site");
  const addSiteForm = document.getElementById("add-site-form");
  const siteInput = document.getElementById("site-input");
  const siteList = document.getElementById("site-list");
  const siteMessage = document.getElementById("site-message");

  let excludedSites = [];
  let currentHost = "";

  const [settings, [activeTab]] = await Promise.all([
    chrome.storage.local.get(["enabled", "excludedSites"]),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  setToggle(settings.enabled !== false);
  excludedSites = normalizeSiteList(settings.excludedSites);
  currentHost = normalizeHostFromUrl(activeTab?.url);
  currentHostLabel.textContent = currentHost ? `当前网站：${currentHost}` : "当前页面不支持";
  toggleCurrentSite.disabled = !currentHost;
  renderSites();

  toggle.addEventListener("click", async () => {
    const next = !toggle.classList.contains("on");
    await chrome.storage.local.set({ enabled: next });
    setToggle(next);
  });

  toggleCurrentSite.addEventListener("click", () => {
    if (!currentHost) return;
    const next = excludedSites.includes(currentHost)
      ? excludedSites.filter((site) => site !== currentHost)
      : [...excludedSites, currentHost];
    saveExcludedSites(next);
  });

  addSiteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const site = normalizeSiteInput(siteInput.value);
    if (!site) {
      siteMessage.textContent = "请输入有效的网站域名或网址。";
      return;
    }
    if (excludedSites.includes(site)) {
      siteMessage.textContent = `${site} 已在例外列表中。`;
      return;
    }
    saveExcludedSites([...excludedSites, site]);
    siteInput.value = "";
    siteMessage.textContent = "已添加。";
  });

  siteList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-site]");
    if (!button) return;
    const site = button.dataset.removeSite;
    saveExcludedSites(excludedSites.filter((item) => item !== site));
    siteMessage.textContent = `已移除 ${site}。`;
  });

  chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      status.textContent = "未连接到 background。";
      return;
    }
    setStatus(resp);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) setToggle(changes.enabled.newValue !== false);
    if (changes.excludedSites) {
      excludedSites = normalizeSiteList(changes.excludedSites.newValue);
      renderSites();
    }
  });

  // 保持麦克风状态实时更新；例外网站设置通过 storage 事件同步。
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
      if (resp) setStatus(resp);
    });
  }, 1000);

  function normalizeHost(host) {
    return String(host || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  }

  function normalizeHostFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return normalizeHost(parsed.hostname);
    } catch (_error) {
      return "";
    }
  }

  function normalizeSiteInput(value) {
    const input = String(value || "").trim();
    if (!input || /\s/.test(input)) return "";
    try {
      const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
        return "";
      }
      return normalizeHost(parsed.hostname);
    } catch (_error) {
      return "";
    }
  }

  function normalizeSiteList(sites) {
    return Array.isArray(sites)
      ? [...new Set(sites.map(normalizeSiteInput).filter(Boolean))]
      : [];
  }

  async function saveExcludedSites(sites) {
    excludedSites = normalizeSiteList(sites);
    await chrome.storage.local.set({ excludedSites });
    renderSites();
  }

  function renderSites() {
    const currentIsExcluded = currentHost && excludedSites.includes(currentHost);
    toggleCurrentSite.textContent = currentIsExcluded ? "移出例外" : "加入例外";
    siteList.replaceChildren();
    for (const site of excludedSites) {
      const item = document.createElement("li");
      item.className = "site-item";
      const name = document.createElement("span");
      name.className = "site-name";
      name.textContent = site;
      const remove = document.createElement("button");
      remove.className = "remove-site";
      remove.type = "button";
      remove.textContent = "移除";
      remove.setAttribute("aria-label", `移除 ${site}`);
      remove.dataset.removeSite = site;
      item.append(name, remove);
      siteList.append(item);
    }
  }

  function setToggle(on) {
    toggle.classList.toggle("on", on);
  }

  function setStatus(state) {
    dot.classList.toggle("active", state.micActive && state.enabled);
    if (!state.enabled) {
      status.textContent = "已关闭 — 不会自动暂停";
      return;
    }
    if (state.micActive) {
      status.textContent = `麦克风使用中：${state.sources.join(", ")}`;
    } else {
      status.textContent = "麦克风空闲";
    }
  }
})();
