const PROJECT_EMAIL = "mapyclimbs@gmail.com"; // replace with project address once created

interface WhatsNewData {
  version: string;
  entries: {
    en: string[];
    cs: string[];
  };
}

function i18n(key: string, ...substitutions: string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function detectLocale(): "cs" | "en" {
  const lang = chrome.i18n.getUILanguage?.() ?? navigator.language ?? "en";
  return lang.startsWith("cs") ? "cs" : "en";
}

async function loadData(): Promise<WhatsNewData> {
  const url = chrome.runtime.getURL("whats-new-data.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load whats-new-data.json: ${res.status}`);
  return res.json() as Promise<WhatsNewData>;
}

function renderBullets(container: HTMLElement, bullets: string[]): void {
  container.innerHTML = "";
  for (const text of bullets) {
    const li = document.createElement("li");
    li.textContent = text;
    container.appendChild(li);
  }
}

async function init(): Promise<void> {
  const data = await loadData();
  const locale = detectLocale();

  const rawBullets = data.entries[locale];
  const bullets =
    locale === "cs" && rawBullets.every((b) => b === "") ? data.entries.en : rawBullets;

  const versionBadge = document.getElementById("version-badge");
  if (versionBadge) {
    versionBadge.textContent = i18n("whatsNewVersionLabel", data.version);
  }

  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = i18n("whatsNewTitle");

  const subtitleEl = document.getElementById("page-subtitle");
  if (subtitleEl) subtitleEl.textContent = i18n("whatsNewSubtitle");

  const list = document.getElementById("changelog-list");
  if (list) renderBullets(list, bullets);

  const supportHeading = document.getElementById("support-heading");
  if (supportHeading) supportHeading.textContent = i18n("popupBmcHeading");

  const supportDesc = document.getElementById("support-desc");
  if (supportDesc) supportDesc.textContent = i18n("popupBmcDesc");

  const bmcBtn = document.getElementById("bmc-btn");
  if (bmcBtn) bmcBtn.textContent = i18n("popupBmcBtn");

  const contactText = document.getElementById("contact-text");
  if (contactText) contactText.textContent = i18n("whatsNewContact");

  const contactLink = document.getElementById("contact-link") as HTMLAnchorElement | null;
  if (contactLink) {
    contactLink.textContent = PROJECT_EMAIL;
    contactLink.href = `mailto:${PROJECT_EMAIL}`;
  }

  document.documentElement.lang = locale;
}

init().catch(console.error);
