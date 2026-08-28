const form = document.querySelector("#jobForm");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#formMessage");
const jobsRoot = document.querySelector("#jobs");
const healthBadge = document.querySelector("#healthBadge");
const dialog = document.querySelector("#detailDialog");
const detailTitle = document.querySelector("#detailTitle");
const detailContent = document.querySelector("#detailContent");
const aiProvider = document.querySelector("#aiProvider");
const aiModel = document.querySelector("#aiModel");
const githubCatalogTools = document.querySelector("#githubCatalogTools");
const githubModelSearch = document.querySelector("#githubModelSearch");
const githubModelFilter = document.querySelector("#githubModelFilter");
const refreshModels = document.querySelector("#refreshModels");
const catalogNote = document.querySelector("#catalogNote");
const primaryModelInfo = document.querySelector("#primaryModelInfo");
const contentStyle = document.querySelector("#contentStyle");
const audience = document.querySelector("#audience");
const detailLevelOptions = document.querySelector("#detailLevelOptions");
const providerNote = document.querySelector("#providerNote");
const ttsProvider = document.querySelector("#ttsProvider");
const refreshVoices = document.querySelector("#refreshVoices");
const voiceGender = document.querySelector("#voiceGender");
const voiceKey = document.querySelector("#voiceKey");
const voiceNote = document.querySelector("#voiceNote");
const sceneEditorDialog = document.querySelector("#sceneEditorDialog");
const sceneEditorTitle = document.querySelector("#sceneEditorTitle");
const sceneEditorList = document.querySelector("#sceneEditorList");
const sceneEditorSummary = document.querySelector("#sceneEditorSummary");
const regenerateSceneEditor = document.querySelector("#regenerateSceneEditor");
const reconfigureSceneEditor = document.querySelector("#reconfigureSceneEditor");
const restoreSceneEditor = document.querySelector("#restoreSceneEditor");
const saveSceneEditor = document.querySelector("#saveSceneEditor");
const approveSceneEditor = document.querySelector("#approveSceneEditor");
const connectionsDialog = document.querySelector("#connectionsDialog");
const openConnections = document.querySelector("#openConnections");
const connectionList = document.querySelector("#connectionList");
const connectionForm = document.querySelector("#connectionForm");
const connectionId = document.querySelector("#connectionId");
const connectionCategory = document.querySelector("#connectionCategory");
const connectionName = document.querySelector("#connectionName");
const connectionAdapter = document.querySelector("#connectionAdapter");
const connectionUrl = document.querySelector("#connectionUrl");
const connectionApiKey = document.querySelector("#connectionApiKey");
const connectionApiHeader = document.querySelector("#connectionApiHeader");
const connectionModels = document.querySelector("#connectionModels");
const connectionVoices = document.querySelector("#connectionVoices");
const connectionHeaderWrap = document.querySelector("#connectionHeaderWrap");
const connectionModelsWrap = document.querySelector("#connectionModelsWrap");
const connectionVoicesWrap = document.querySelector("#connectionVoicesWrap");
const connectionVoiceAdvancedWrap = document.querySelector("#connectionVoiceAdvancedWrap");
const connectionAiAdvancedWrap = document.querySelector("#connectionAiAdvancedWrap");
const connectionAiAuthPrefix = document.querySelector("#connectionAiAuthPrefix");
const connectionAiModelsEndpoint = document.querySelector("#connectionAiModelsEndpoint");
const connectionAiChatEndpoint = document.querySelector("#connectionAiChatEndpoint");
const connectionAiModelsListPath = document.querySelector("#connectionAiModelsListPath");
const connectionAiModelIdField = document.querySelector("#connectionAiModelIdField");
const connectionAiModelNameField = document.querySelector("#connectionAiModelNameField");
const connectionAiRequestMode = document.querySelector("#connectionAiRequestMode");
const connectionAiModelField = document.querySelector("#connectionAiModelField");
const connectionAiMessagesField = document.querySelector("#connectionAiMessagesField");
const connectionAiPromptField = document.querySelector("#connectionAiPromptField");
const connectionAiResponsePath = document.querySelector("#connectionAiResponsePath");
const connectionAiExtraJson = document.querySelector("#connectionAiExtraJson");
const connectionAuthPrefix = document.querySelector("#connectionAuthPrefix");
const connectionVoicesEndpoint = document.querySelector("#connectionVoicesEndpoint");
const connectionTtsEndpoint = document.querySelector("#connectionTtsEndpoint");
const connectionVoiceListPath = document.querySelector("#connectionVoiceListPath");
const connectionVoiceIdField = document.querySelector("#connectionVoiceIdField");
const connectionVoiceNameField = document.querySelector("#connectionVoiceNameField");
const connectionVoiceGenderField = document.querySelector("#connectionVoiceGenderField");
const connectionVoiceDescriptionField = document.querySelector("#connectionVoiceDescriptionField");
const connectionTextField = document.querySelector("#connectionTextField");
const connectionVoiceField = document.querySelector("#connectionVoiceField");
const connectionFilenameField = document.querySelector("#connectionFilenameField");
const connectionTtsModel = document.querySelector("#connectionTtsModel");
const connectionAudioFormat = document.querySelector("#connectionAudioFormat");
const connectionResponseMode = document.querySelector("#connectionResponseMode");
const connectionResponsePath = document.querySelector("#connectionResponsePath");
const connectionExtraJson = document.querySelector("#connectionExtraJson");
const connectionEnabled = document.querySelector("#connectionEnabled");
const connectionMessage = document.querySelector("#connectionMessage");
const cancelJobEdit = document.querySelector("#cancelJobEdit");
const fileReuseNote = document.querySelector("#fileReuseNote");
const tiktokHandlePreview = document.querySelector("#tiktokHandlePreview");
const brandLogoNote = document.querySelector("#brandLogoNote");
const profileAvatarNote = document.querySelector("#profileAvatarNote");
const deleteConnection = document.querySelector("#deleteConnection");
const testConnection = document.querySelector("#testConnection");
const saveConnection = document.querySelector("#saveConnection");
let editingJobId = null;
let editingScript = null;
let editingScriptHasPrevious = false;
let editingScriptDurationSec = null;
let formEditingJobId = null;

// Preview 2.7.0: keep the project list compact even when many jobs exist.
let jobsCache = [];
let jobsPage = 1;
let jobsPageSize = 5;

let appConfig = null;
const providerMap = new Map();
const styleLabels = new Map();
const audienceLabels = new Map();
const detailLabels = new Map();
const ttsSourceMap = new Map();
const voiceMap = new Map();

const statusNames = {
  queued: "Đang chờ",
  running: "Đang chạy",
  script_ready: "Chờ duyệt",
  completed: "Hoàn thành",
  failed: "Thất bại",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[char]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDate(value) {
  try { return new Date(value).toLocaleString("vi-VN"); } catch { return value; }
}

function parseTikTokHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^@[A-Za-z0-9._-]{2,64}$/.test(raw)) return raw;
  const match = raw.match(/@[A-Za-z0-9._-]{2,64}/);
  return match?.[0] || "";
}

function updateTikTokHandlePreview() {
  if (!tiktokHandlePreview) return;
  const handle = parseTikTokHandle(form.elements.tiktokUrl?.value);
  tiktokHandlePreview.textContent = handle || "Chưa có @handle";
  tiktokHandlePreview.classList.toggle("empty", !handle);
}

function jobErrorHtml(job) {
  if (!job.error) return "";
  const title = job.errorTitle || (job.taskMode === "render" ? "Render gặp lỗi" : "Tạo kịch bản gặp lỗi");
  return `<div class="job-error-box">
    <div class="job-error-title"><strong>${escapeHtml(title)}</strong>${job.errorCode ? `<span>${escapeHtml(job.errorCode)}</span>` : ""}</div>
    <p>${escapeHtml(job.error)}</p>
    ${job.errorHint ? `<small>${escapeHtml(job.errorHint)}</small>` : ""}
  </div>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function fillSelect(select, items, selectedValue) {
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id ?? item)}">${escapeHtml(item.label ?? item)}</option>`).join("");
  if (selectedValue && [...select.options].some((option) => option.value === selectedValue)) select.value = selectedValue;
}

function formatTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "?";
  if (number >= 1000000) return `${(number / 1000000).toFixed(number % 1000000 ? 1 : 0)}M`;
  if (number >= 1000) return `${Math.round(number / 1000)}K`;
  return String(number);
}

function providerModelDetails(provider) {
  if (Array.isArray(provider?.modelDetails) && provider.modelDetails.length) return provider.modelDetails;
  return (provider?.models || []).map((id) => ({
    id,
    name: id.split("/").pop(),
    publisher: id.split("/")[0] || "Khác",
    rateLimitTier: "unknown",
    kind: "general",
    recommended: false,
  }));
}

function modelMatchesFilter(model) {
  const filter = githubModelFilter?.value || "recommended";
  if (filter === "all") return true;
  if (filter === "recommended") return Boolean(model.recommended);
  if (["low", "high", "custom"].includes(filter)) return model.rateLimitTier === filter;
  return model.kind === filter;
}

function modelMatchesSearch(model) {
  const query = String(githubModelSearch?.value || "").trim().toLocaleLowerCase("vi");
  if (!query) return true;
  return [model.id, model.name, model.publisher, model.summary, model.kind, model.rateLimitTier]
    .some((value) => String(value || "").toLocaleLowerCase("vi").includes(query));
}

function modelOptionLabel(model) {
  const badges = [];
  if (model.recommended) badges.push("★");
  if (model.rateLimitTier && model.rateLimitTier !== "unknown") badges.push(model.rateLimitTier);
  if (model.maxInputTokens) badges.push(`${formatTokens(model.maxInputTokens)} in`);
  return `${badges.length ? `${badges.join(" · ")} · ` : ""}${model.id}`;
}

function renderModelOptions(select, models, selectedValue) {
  const groups = new Map();
  for (const model of models) {
    const publisher = model.publisher || "Khác";
    if (!groups.has(publisher)) groups.set(publisher, []);
    groups.get(publisher).push(model);
  }
  select.innerHTML = [...groups.entries()].map(([publisher, group]) => `
    <optgroup label="${escapeHtml(publisher)}">
      ${group.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(modelOptionLabel(model))}</option>`).join("")}
    </optgroup>
  `).join("");
  if (selectedValue && [...select.options].some((option) => option.value === selectedValue)) select.value = selectedValue;
}

function updateModelInfo(providerSelect, modelSelect, target) {
  const provider = providerMap.get(providerSelect.value);
  const model = providerModelDetails(provider).find((item) => item.id === modelSelect.value);
  if (!target || !model) {
    if (target) target.hidden = true;
    return;
  }
  target.hidden = false;
  target.innerHTML = `
    <div><strong>${escapeHtml(model.name || model.id)}</strong><small>${escapeHtml(model.publisher || "")}</small></div>
    <div class="model-badges">
      ${model.recommended ? '<span class="recommended">Khuyến nghị</span>' : ""}
      <span>Tier ${escapeHtml(model.rateLimitTier || "unknown")}</span>
      <span>${escapeHtml(model.kind || "general")}</span>
      <span>Input ${formatTokens(model.maxInputTokens)}</span>
      <span>Output ${formatTokens(model.maxOutputTokens)}</span>
    </div>
    ${model.summary ? `<p>${escapeHtml(model.summary)}</p>` : ""}`;
}

function filteredModelsForProvider(provider, _selectedModel) {
  // Preview 2: model selection stays compact. The dropdown always shows all
  // models discovered for the selected AI connection; search/filter belongs
  // in Connection Manager rather than the project form.
  return providerModelDetails(provider);
}

function updateModelSelect(providerSelect, modelSelect, selectedModel, infoTarget) {
  const provider = providerMap.get(providerSelect.value);
  const requested = selectedModel || modelSelect.value || provider?.defaultModel;
  const models = filteredModelsForProvider(provider, requested);
  renderModelOptions(modelSelect, models, requested || provider?.defaultModel);
  if (!modelSelect.value && models[0]) modelSelect.value = models[0].id;
  updateModelInfo(providerSelect, modelSelect, infoTarget);
}

function updateCatalogUi() {
  const provider = providerMap.get(aiProvider.value);
  const githubActive = provider?.adapter === "github-models";
  githubCatalogTools.hidden = !githubActive;
  if (!githubActive) { catalogNote.textContent = ""; return; }
  const catalog = provider?.catalog;
  const loaded = catalog?.loadedAt ? formatDate(catalog.loadedAt) : "chưa Test";
  const count = catalog?.totalCount || provider?.models?.length || 0;
  const error = catalog?.error ? ` · ${catalog.error}` : "";
  catalogNote.textContent = `${count} model · cập nhật ${loaded}${error}`;
}

function updateProviderNote() {
  const primary = providerMap.get(aiProvider.value);
  providerNote.textContent = primary ? `Nguồn AI: ${primary.label} · Model: ${aiModel.value || "chưa chọn"}` : "Chưa có nguồn AI. Hãy mở Set API.";
  updateModelInfo(aiProvider, aiModel, primaryModelInfo);
  updateCatalogUi();
}

function selectedTtsSource() {
  return ttsSourceMap.get(ttsProvider.value) || null;
}

function updateVoiceSelect(selectedKey) {
  const source = selectedTtsSource();
  const voices = Array.isArray(source?.voices) ? source.voices : [];
  voiceMap.clear();
  for (const voice of voices) voiceMap.set(voice.id, voice);

  const genders = [...new Set(voices.map((voice) => voice.gender || "Khác").filter(Boolean))];
  const previousGender = voiceGender.value || "all";
  fillSelect(
    voiceGender,
    [{ id: "all", label: "Tất cả" }, ...genders.map((gender) => ({ id: gender, label: gender }))],
    genders.includes(previousGender) || previousGender === "all" ? previousGender : "all",
  );

  const filtered = voiceGender.value === "all"
    ? voices
    : voices.filter((voice) => (voice.gender || "Khác") === voiceGender.value);
  const items = filtered.map((voice) => ({ id: voice.id, label: voice.name || voice.id }));
  const requested = selectedKey || source?.defaultVoiceKey || voiceKey.value;
  fillSelect(voiceKey, items, requested);
  if (!voiceKey.value && items[0]) voiceKey.value = items[0].id;

  const selected = voiceMap.get(voiceKey.value);
  const sourceText = source ? `${source.label}${source.status ? ` · ${source.status}` : ""}` : "Chưa có nguồn giọng";
  voiceNote.textContent = selected
    ? `${sourceText} · ${selected.gender || "Khác"} · ${selected.name || selected.id}`
    : `${sourceText}${source?.error ? ` · ${source.error}` : voices.length ? " · Không có giọng phù hợp bộ lọc." : " · Chưa tải được danh sách giọng."}`;

  voiceKey.disabled = !items.length || !source?.ready;
  voiceGender.disabled = !voices.length || !source?.ready;
}

function updateTtsSource(selectedVoiceKey) {
  const source = selectedTtsSource();
  updateVoiceSelect(selectedVoiceKey || source?.defaultVoiceKey);
}

function updateStyleOptions() {
  const style = contentStyle.value;
  document.querySelectorAll("#styleOptions [data-styles]").forEach((label) => {
    const styles = label.dataset.styles.split(/\s+/);
    const visible = styles.includes(style);
    label.hidden = !visible;
    const input = label.querySelector("input");
    if (!visible) input.checked = false;
  });
  const defaults = {
    tutorial: ["numberedSteps", "includeVerification"],
    "feature-intro": ["emphasizeBenefits", "includeCta"],
    compare: ["compareAlternatives"],
    listicle: ["numberedSteps"],
  }[style] || [];
  for (const name of defaults) {
    const input = form.elements[name];
    if (input && !input.closest("label")?.hidden) input.checked = true;
  }
}

async function loadAppConfig(query = "") {
  appConfig = await api(`/api/config${query}`);
  providerMap.clear();
  for (const provider of appConfig.providers || []) providerMap.set(provider.id, provider);
  fillSelect(aiProvider, appConfig.providers || [], aiProvider.value || appConfig.defaultProvider);
  updateModelSelect(aiProvider, aiModel, aiModel.value, primaryModelInfo);

  styleLabels.clear();
  for (const item of appConfig.contentStyles || []) styleLabels.set(item.id, item.label);
  fillSelect(contentStyle, appConfig.contentStyles || [], contentStyle.value || "summary");
  audienceLabels.clear();
  for (const item of appConfig.audiences || []) audienceLabels.set(item.id, item.label);
  fillSelect(audience, appConfig.audiences || [], audience.value || "general");

  ttsSourceMap.clear();
  for (const source of appConfig.ttsSources || []) ttsSourceMap.set(source.id, source);
  const ttsItems = (appConfig.ttsSources || []).map((source) => ({ id: source.id, label: `${source.label}${source.ready ? "" : " — chưa sẵn sàng"}` }));
  fillSelect(ttsProvider, ttsItems, ttsProvider.value || appConfig.defaultTtsProvider);
  voiceGender.value = "all";
  updateTtsSource();

  detailLabels.clear();
  for (const item of appConfig.detailLevels || []) detailLabels.set(item.id, item.label);
  if (!detailLevelOptions.innerHTML.trim()) {
    detailLevelOptions.innerHTML = (appConfig.detailLevels || []).map((item, index) => `
      <label><input type="radio" name="detailLevel" value="${escapeHtml(item.id)}" ${item.id === "balanced" || (!index && !appConfig.detailLevels.some((x) => x.id === "balanced")) ? "checked" : ""}><span>${escapeHtml(item.label)}</span></label>
    `).join("");
  }
  updateStyleOptions();
  updateProviderNote();
  if (!formEditingJobId) {
    if (form.elements.pageName && !form.elements.pageName.value) form.elements.pageName.value = appConfig.branding?.pageName || "";
    if (form.elements.youtubeUrl && !form.elements.youtubeUrl.value) form.elements.youtubeUrl.value = appConfig.branding?.youtubeUrl || "";
    if (form.elements.tiktokUrl && !form.elements.tiktokUrl.value) form.elements.tiktokUrl.value = appConfig.branding?.tiktokUrl || appConfig.branding?.tiktokHandle || "";
    if (form.elements.facebookUrl && !form.elements.facebookUrl.value) form.elements.facebookUrl.value = appConfig.branding?.facebookUrl || "";
  }
  if (brandLogoNote) {
    brandLogoNote.textContent = appConfig.branding?.hasDefaultLogo
      ? `Đang dùng logo đã lưu${appConfig.branding?.logoName ? `: ${appConfig.branding.logoName}` : ""}. Chọn file mới để thay mặc định cho các dự án sau.`
      : "Chưa có logo đã lưu. Chọn file để đặt làm mặc định cho các dự án sau.";
  }
  if (profileAvatarNote) {
    profileAvatarNote.textContent = appConfig.branding?.hasDefaultAvatar
      ? `Đang dùng avatar đã lưu${appConfig.branding?.avatarName ? `: ${appConfig.branding.avatarName}` : ""}. Chọn file mới để thay mặc định cho các dự án sau.`
      : "Chưa có avatar đã lưu. Chọn file để đặt làm mặc định cho các dự án sau.";
  }
  updateTikTokHandlePreview();
  submitButton.disabled = !(appConfig.providers || []).length;
  message.textContent = (appConfig.providers || []).length ? "" : "Chưa có nguồn AI. Bấm Set API để thêm kết nối.";
}

function setSourceMode(mode) {
  const selectedMode = ["url", "text", "file"].includes(mode) ? mode : "url";
  document.querySelectorAll(".mode-tab").forEach((item) => item.classList.toggle("active", item.dataset.mode === selectedMode));
  document.querySelectorAll(".source-pane").forEach((pane) => pane.classList.toggle("active", pane.dataset.pane === selectedMode));
  document.querySelector("#sourceMode").value = selectedMode;
}

for (const tab of document.querySelectorAll(".mode-tab")) {
  tab.addEventListener("click", () => setSourceMode(tab.dataset.mode));
}

for (const radio of document.querySelectorAll('input[name="duration"]')) {
  radio.addEventListener("change", () => {
    document.querySelector("#customDuration").hidden = radio.value !== "custom" || !radio.checked;
  });
}

aiProvider.addEventListener("change", () => {
  updateModelSelect(aiProvider, aiModel, null, primaryModelInfo);
  updateProviderNote();
});
aiModel.addEventListener("change", updateProviderNote);
githubModelSearch.addEventListener("input", () => {
  updateModelSelect(aiProvider, aiModel, aiModel.value, primaryModelInfo);
  updateProviderNote();
});
githubModelFilter.addEventListener("change", () => {
  updateModelSelect(aiProvider, aiModel, aiModel.value, primaryModelInfo);
  updateProviderNote();
});
refreshModels.addEventListener("click", async () => {
  refreshModels.disabled = true;
  catalogNote.textContent = "Đang tải lại danh sách model…";
  const providerValue = aiProvider.value;
  const modelValue = aiModel.value;
  try {
    await loadAppConfig("?refreshModels=1");
    if ([...aiProvider.options].some((option) => option.value === providerValue)) aiProvider.value = providerValue;
    updateModelSelect(aiProvider, aiModel, modelValue, primaryModelInfo);
    updateProviderNote();
  } catch (error) { catalogNote.textContent = error.message; }
  finally { refreshModels.disabled = false; }
});
contentStyle.addEventListener("change", updateStyleOptions);
ttsProvider.addEventListener("change", () => { voiceGender.value = "all"; updateTtsSource(); });
voiceGender.addEventListener("change", () => updateVoiceSelect());
voiceKey.addEventListener("change", () => updateVoiceSelect(voiceKey.value));
form.elements.tiktokUrl?.addEventListener("input", updateTikTokHandlePreview);
updateTikTokHandlePreview();

refreshVoices.addEventListener("click", async () => {
  refreshVoices.disabled = true;
  const previousProvider = ttsProvider.value;
  const previousVoice = voiceKey.value;
  voiceNote.textContent = "Đang tải lại danh sách giọng…";
  try {
    appConfig = await api("/api/config?refresh=1");
    ttsSourceMap.clear();
    for (const source of appConfig.ttsSources || []) ttsSourceMap.set(source.id, source);
    fillSelect(ttsProvider, (appConfig.ttsSources || []).map((source) => ({ id: source.id, label: `${source.label}${source.ready ? "" : " — chưa sẵn sàng"}` })), previousProvider || appConfig.defaultTtsProvider);
    voiceGender.value = "all";
    updateTtsSource(previousVoice);
  } catch (error) {
    voiceNote.textContent = error.message;
  } finally {
    refreshVoices.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  const editingId = formEditingJobId;
  message.textContent = editingId ? "Đang lưu thay đổi và tạo lại kịch bản…" : "Đang gửi yêu cầu tạo kịch bản…";
  try {
    const endpoint = editingId ? `/api/jobs/${editingId}/reconfigure` : "/api/jobs";
    await api(endpoint, { method: "POST", body: new FormData(form) });
    const successMessage = editingId
      ? "Đã cập nhật dự án và đưa lại vào hàng đợi tạo kịch bản."
      : "Đã thêm tác vụ tạo kịch bản. Thông tin kênh/Branding đã được lưu làm mặc định cho dự án sau.";
    const mode = document.querySelector("#sourceMode").value;
    if (mode === "url") form.elements.url.value = "";
    if (mode === "text") form.elements.text.value = "";
    if (mode === "file") form.elements.file.value = "";
    form.elements.brandLogo.value = "";
    form.elements.profileAvatar.value = "";
    clearProjectEditState({ keepMessage: true });
    await loadAppConfig();
    message.textContent = successMessage;
    await loadJobs();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = !(appConfig?.providers?.length);
  }
});

function clearProjectEditState({ keepMessage = false } = {}) {
  formEditingJobId = null;
  submitButton.textContent = "1. Tạo kịch bản";
  cancelJobEdit.hidden = true;
  fileReuseNote.hidden = true;
  fileReuseNote.textContent = "";
  if (!keepMessage) message.textContent = "";
}

function selectDetailLevel(value) {
  const radio = form.querySelector(`input[name="detailLevel"][value="${CSS.escape(String(value || "balanced"))}"]`);
  if (radio) radio.checked = true;
}

function applyDurationToForm(seconds) {
  const value = Number(seconds);
  const preset = [60, 90, 120, 180].includes(value) ? String(value) : "custom";
  const radio = form.querySelector(`input[name="duration"][value="${preset}"]`);
  if (radio) radio.checked = true;
  const custom = document.querySelector("#customDuration");
  custom.value = Number.isFinite(value) ? Math.max(30, Math.min(240, Math.round(value))) : 120;
  custom.hidden = preset !== "custom";
}

async function loadProjectIntoForm(id) {
  const [job, source] = await Promise.all([api(`/api/jobs/${id}`), api(`/api/jobs/${id}/source`)]);
  if (["queued", "running"].includes(job.status)) throw new Error("Không thể sửa thông tin khi tác vụ đang chạy.");

  formEditingJobId = id;
  submitButton.textContent = "Lưu & tạo lại kịch bản";
  cancelJobEdit.hidden = false;
  message.textContent = `Đang sửa dự án: ${job.projectName || job.sourceTitle || job.requestedTitle || job.inputName || job.id}. Thay đổi thông tin rồi bấm Lưu & tạo lại kịch bản.`;

  setSourceMode(source.sourceType || job.sourceType || "url");
  form.elements.url.value = source.url || job.sourceUrl || "";
  form.elements.text.value = source.text || "";
  form.elements.file.value = "";
  if ((source.sourceType || job.sourceType) === "file") {
    fileReuseNote.hidden = false;
    fileReuseNote.textContent = `File hiện tại: ${source.inputName || job.inputName || "đã lưu"}. Không chọn file mới thì hệ thống sẽ dùng lại file này.`;
  } else {
    fileReuseNote.hidden = true;
    fileReuseNote.textContent = "";
  }

  if ([...aiProvider.options].some((option) => option.value === job.aiProvider)) {
    aiProvider.value = job.aiProvider;
    updateModelSelect(aiProvider, aiModel, job.aiModel, primaryModelInfo);
  }
  if ([...aiModel.options].some((option) => option.value === job.aiModel)) aiModel.value = job.aiModel;
  updateProviderNote();

  if ([...ttsProvider.options].some((option) => option.value === job.ttsConnectionId)) {
    ttsProvider.value = job.ttsConnectionId;
    voiceGender.value = "all";
    updateTtsSource(job.voiceKey);
    if (job.voiceGender && [...voiceGender.options].some((option) => option.value === job.voiceGender)) {
      voiceGender.value = job.voiceGender;
      updateVoiceSelect(job.voiceKey);
    }
  }

  if ([...contentStyle.options].some((option) => option.value === job.contentStyle)) contentStyle.value = job.contentStyle;
  updateStyleOptions();
  if ([...audience.options].some((option) => option.value === job.audience)) audience.value = job.audience;
  selectDetailLevel(job.detailLevel);
  for (const name of ["numberedSteps", "includeWarnings", "includeVerification", "showTerminalCommands", "emphasizeBenefits", "includeCta", "compareAlternatives"]) {
    if (form.elements[name]) form.elements[name].checked = Boolean(job.styleOptions?.[name]);
  }

  if (form.elements.projectName) form.elements.projectName.value = job.projectName || "";
  form.elements.title.value = job.requestedTitle || "";
  if (form.elements.introText) form.elements.introText.value = job.introText || "";
  applyDurationToForm(job.durationSec);
  form.elements.keepTerms.value = job.keepTerms || "";
  form.elements.pronunciationRules.value = job.pronunciationRules || "";
  form.elements.pageName.value = job.pageName || "";
  form.elements.youtubeUrl.value = job.youtubeUrl || "";
  form.elements.tiktokUrl.value = job.tiktokUrl || job.tiktokHandle || "";
  form.elements.facebookUrl.value = job.facebookUrl || "";
  updateTikTokHandlePreview();
  form.elements.theme.value = job.theme || "dark-neon";
  form.elements.renderProfile.value = job.renderProfile || "balanced";
  if (form.elements.backgroundType) form.elements.backgroundType.value = job.backgroundType || "theme";
  if (form.elements.backgroundPreset) form.elements.backgroundPreset.value = job.backgroundPreset || "aurora";
  if (form.elements.backgroundOverlay) form.elements.backgroundOverlay.value = String(job.backgroundOverlay ?? 35);
  if (form.elements.backgroundBlur) form.elements.backgroundBlur.value = String(job.backgroundBlur ?? 0);
  if (form.elements.transition) form.elements.transition.value = job.transition || "fade";
  if (form.elements.transitionDuration) form.elements.transitionDuration.value = String(job.transitionDuration ?? 0.4);
  if (form.elements.motionPreset) form.elements.motionPreset.value = job.motionPreset || "auto";
  if (form.elements.videoBackground) form.elements.videoBackground.value = "";
  form.elements.durationCalibration.checked = Boolean(job.durationCalibration);
  form.elements.brandLogo.value = "";
  form.elements.profileAvatar.value = "";
  if (brandLogoNote) brandLogoNote.textContent = job.brandLogoPath
    ? "Dự án này đang dùng logo đã chốt. Không chọn file mới để giữ nguyên logo của dự án."
    : "Dự án này chưa có logo riêng. Chọn file mới nếu muốn thay đổi.";
  if (profileAvatarNote) profileAvatarNote.textContent = job.profileAvatarPath
    ? "Dự án này đang dùng avatar đã chốt. Không chọn file mới để giữ nguyên avatar của dự án."
    : "Dự án này chưa có avatar riêng. Chọn file mới nếu muốn thay đổi.";

  document.querySelector(".create-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

cancelJobEdit.addEventListener("click", () => {
  clearProjectEditState();
  form.reset();
  updateTikTokHandlePreview();
  setSourceMode("url");
  loadAppConfig().catch((error) => { message.textContent = error.message; });
});


function providerLabel(id) {
  return providerMap.get(id)?.label || id || "AI mặc định";
}

function workflowHtml(job) {
  const taskMode = job.taskMode || (job.resumeFromScript ? "render" : "script");
  const hasScript = Boolean(job.scriptWordCount) || ["script_ready", "completed"].includes(job.status) || taskMode === "render";
  const approved = Boolean(job.scriptApproved) || job.status === "completed" || ["render_queued", "render_running", "completed"].includes(job.workflowStep);
  const renderDone = job.status === "completed";
  const scriptActive = !hasScript && ["queued", "running"].includes(job.status) && taskMode === "script";
  const reviewActive = hasScript && !approved && !["queued", "running"].includes(job.status);
  const renderActive = !renderDone && ["queued", "running"].includes(job.status) && taskMode === "render";
  const renderFailed = job.status === "failed" && taskMode === "render";
  const stepClass = (done, active, failed) => failed ? "failed" : done ? "done" : active ? "active" : "pending";
  return `<div class="job-workflow three-step">
    <div class="job-workflow-step ${stepClass(hasScript, scriptActive, job.status === "failed" && taskMode === "script")}"><span>1</span><div><strong>Kịch bản</strong><small>${hasScript ? "AI đã tạo" : scriptActive ? "Đang tạo" : "Chờ"}</small></div></div>
    <div class="job-workflow-line ${hasScript ? "done" : ""}"></div>
    <div class="job-workflow-step ${stepClass(approved, reviewActive, false)}"><span>2</span><div><strong>Duyệt</strong><small>${approved ? "Đã chốt" : reviewActive ? "Cần chốt" : "Chờ"}</small></div></div>
    <div class="job-workflow-line ${approved ? "done" : ""}"></div>
    <div class="job-workflow-step ${stepClass(renderDone, renderActive, renderFailed)}"><span>3</span><div><strong>Render</strong><small>${renderDone ? "Hoàn thành" : renderFailed ? "Lỗi" : renderActive ? "Đang chạy" : approved ? "Sẵn sàng" : "Chờ"}</small></div></div>
  </div>`;
}

function jobCard(job) {
  const title = job.projectName || job.sourceTitle || job.requestedTitle || job.inputName || job.sourceUrl || job.id;
  const videoFile = job.outputFiles?.find((file) => file.name === "video.mp4");
  const usedProvider = job.aiUsedProvider || job.aiProvider;
  const usedModel = job.aiUsedModel || job.aiModel;
  const style = styleLabels.get(job.contentStyle) || job.contentStyle || "Tóm tắt nội dung";
  const taskMode = job.taskMode || (job.resumeFromScript ? "render" : "script");
  const hasScript = Boolean(job.scriptWordCount) || ["script_ready", "completed"].includes(job.status) || taskMode === "render";
  const approved = Boolean(job.scriptApproved) || job.status === "completed" || ["render_queued", "render_running", "completed"].includes(job.workflowStep);
  const canRender = approved && (job.status === "script_ready" || (job.status === "failed" && taskMode === "render"));
  const canRetryScript = job.status === "failed" && taskMode !== "render";
  const canEditProject = job.status === "failed" && !["queued", "running"].includes(job.status);
  return `<article class="job">
    <div class="job-head">
      <div>
        <div class="job-title">${escapeHtml(title)}</div>
        <div class="job-meta">${job.durationSec}s · ${escapeHtml(job.theme)} · ${formatDate(job.createdAt)}</div>
        <div class="job-tags">
          <span>${escapeHtml(style)}</span>
          <span>${escapeHtml(providerLabel(usedProvider))} · ${escapeHtml(usedModel || "")}</span>
          ${job.voiceName ? `<span>${escapeHtml(job.ttsProviderLabel || "Voice")} · ${escapeHtml(job.voiceGender || "")} · ${escapeHtml(job.voiceName)}</span>` : ""}
          ${job.pageName ? `<span>${escapeHtml(job.pageName)}${job.tiktokHandle ? ` · ${escapeHtml(job.tiktokHandle)}` : ""}</span>` : ""}
          ${job.scriptWordCount ? `<span>${job.scriptWordCount} từ</span>` : ""}
          ${approved ? '<span class="approved-tag">✓ Đã chốt</span>' : hasScript ? '<span class="review-tag">Cần duyệt</span>' : ""}
        </div>
      </div>
      <span class="status ${job.status}">${statusNames[job.status] || job.status}</span>
    </div>
    ${workflowHtml(job)}
    <div class="progress-track"><div class="progress-bar" style="width:${Math.max(0, Math.min(100, job.progress || 0))}%"></div></div>
    <div class="stage"><span>${escapeHtml(job.stage)}</span><strong>${job.progress || 0}%</strong></div>
    ${jobErrorHtml(job)}
    <div class="job-actions">
      <button data-detail="${job.id}">Chi tiết / Log</button>
      ${videoFile ? `<a href="/downloads/${encodeURI(job.downloadKey)}/video.mp4" download>Tải video</a>` : ""}
      ${hasScript && !["queued", "running"].includes(job.status) ? `<button data-edit-scenes="${job.id}">${approved ? "Xem / Sửa kịch bản" : "Duyệt kịch bản"}</button>` : ""}
      ${canRender ? `<button class="render-button" data-render="${job.id}" data-regenerate-voice="0">3. Render</button>` : ""}
      ${job.status === "completed" ? `<button data-render="${job.id}" data-regenerate-voice="1">Render lại</button>` : ""}
      ${canEditProject ? `<button class="edit-project-button" data-edit-job="${job.id}">Sửa dự án</button>` : ""}
      ${canRetryScript ? `<button data-retry="${job.id}" data-regenerate-voice="0">Tạo lại kịch bản</button>` : ""}
      ${!["running", "queued"].includes(job.status) ? `<button class="danger-button" data-delete="${job.id}" data-delete-title="${escapeHtml(title)}">Xóa</button>` : ""}
    </div>
  </article>`;
}

function ensureJobsToolbar() {
  let toolbar = document.querySelector("#jobsToolbar");
  if (toolbar) return toolbar;
  toolbar = document.createElement("div");
  toolbar.id = "jobsToolbar";
  toolbar.className = "jobs-toolbar";
  toolbar.innerHTML = `
    <div class="jobs-toolbar-count" id="jobsToolbarCount">0 dự án</div>
    <div class="jobs-toolbar-controls">
      <label for="jobsPageSize">Hiển thị</label>
      <select id="jobsPageSize" aria-label="Số dự án mỗi trang">
        <option value="5">5</option>
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="0">Tất cả</option>
      </select>
      <button type="button" id="jobsPrev" title="Trang trước">‹</button>
      <span id="jobsPageInfo">1 / 1</span>
      <button type="button" id="jobsNext" title="Trang sau">›</button>
    </div>`;
  jobsRoot.parentNode.insertBefore(toolbar, jobsRoot);
  toolbar.querySelector("#jobsPageSize").value = String(jobsPageSize);
  toolbar.querySelector("#jobsPageSize").addEventListener("change", (event) => {
    jobsPageSize = Number(event.target.value);
    jobsPage = 1;
    renderJobsList();
  });
  toolbar.querySelector("#jobsPrev").addEventListener("click", () => {
    if (jobsPage > 1) { jobsPage -= 1; renderJobsList(); }
  });
  toolbar.querySelector("#jobsNext").addEventListener("click", () => {
    const totalPages = jobsPageSize === 0 ? 1 : Math.max(1, Math.ceil(jobsCache.length / jobsPageSize));
    if (jobsPage < totalPages) { jobsPage += 1; renderJobsList(); }
  });
  return toolbar;
}

function renderJobsList() {
  const toolbar = ensureJobsToolbar();
  const total = jobsCache.length;
  const totalPages = jobsPageSize === 0 ? 1 : Math.max(1, Math.ceil(total / jobsPageSize));
  jobsPage = Math.min(Math.max(1, jobsPage), totalPages);
  const visible = jobsPageSize === 0
    ? jobsCache
    : jobsCache.slice((jobsPage - 1) * jobsPageSize, jobsPage * jobsPageSize);
  jobsRoot.innerHTML = total ? visible.map(jobCard).join("") : '<div class="empty">Chưa có tác vụ.</div>';
  toolbar.querySelector("#jobsToolbarCount").textContent = `${total} dự án${total > visible.length ? ` · đang hiện ${visible.length}` : ""}`;
  toolbar.querySelector("#jobsPageInfo").textContent = `${jobsPage} / ${totalPages}`;
  toolbar.querySelector("#jobsPrev").disabled = jobsPage <= 1;
  toolbar.querySelector("#jobsNext").disabled = jobsPage >= totalPages;
}

async function loadJobs() {
  try {
    jobsCache = await api("/api/jobs");
    renderJobsList();
  } catch (error) {
    jobsRoot.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

async function showDetail(id) {
  const job = await api(`/api/jobs/${id}`);
  detailTitle.textContent = job.projectName || job.sourceTitle || job.requestedTitle || job.inputName || job.id;
  const files = (job.outputFiles || []).map((file) => `<a href="/downloads/${encodeURI(job.downloadKey)}/${encodeURI(file.name)}" download>${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></a>`).join("");
  const hasVideo = job.outputFiles?.some((file) => file.name === "video.mp4");
  const style = styleLabels.get(job.contentStyle) || job.contentStyle || "Tóm tắt nội dung";
  const detail = detailLabels.get(job.detailLevel) || job.detailLevel || "Cân bằng";
  const targetAudience = audienceLabels.get(job.audience) || job.audience || "Đại chúng";
  const requestedAi = `${providerLabel(job.aiProvider)} / ${job.aiModel || ""}`;
  const usedAi = `${providerLabel(job.aiUsedProvider || job.aiProvider)} / ${job.aiUsedModel || job.aiModel || ""}`;
  detailContent.innerHTML = `
    <p class="job-meta">${escapeHtml(job.stage)} · ${job.progress}% · ${formatDate(job.createdAt)}</p>
    <div class="detail-grid">
      <div><small>Phong cách</small><strong>${escapeHtml(style)}</strong></div>
      <div><small>Đối tượng</small><strong>${escapeHtml(targetAudience)}</strong></div>
      <div><small>Mức chi tiết</small><strong>${escapeHtml(detail)}</strong></div>
      <div><small>AI yêu cầu</small><strong>${escapeHtml(requestedAi)}</strong></div>
      <div><small>AI thực tế</small><strong>${escapeHtml(usedAi)}</strong></div>
      <div><small>Giọng đọc</small><strong>${escapeHtml([job.ttsProviderLabel || (job.ttsProvider === "vieneu" ? "VieNeu-TTS" : "LucyLab"), job.voiceGender, job.voiceName].filter(Boolean).join(" · ") || "Mặc định")}</strong></div>
      <div><small>Kịch bản / giọng thật</small><strong>${job.scriptWordCount ? `${job.scriptWordCount} từ` : "—"}${job.measuredVoiceDurationSec ? ` · ${Number(job.measuredVoiceDurationSec).toFixed(1)} giây` : ""}</strong></div>
      <div><small>Logo / Avatar riêng</small><strong>${job.brandLogoPath || job.profileAvatarPath ? "Có" : "Dùng mặc định"}</strong></div>
      <div><small>Kênh / Branding</small><strong>${escapeHtml([job.pageName, job.tiktokHandle].filter(Boolean).join(" · ") || "Mặc định")}</strong></div>
    </div>
    ${jobErrorHtml(job)}
    ${hasVideo ? `<video controls preload="metadata" src="/downloads/${encodeURI(job.downloadKey)}/video.mp4"></video>` : ""}
    ${files ? `<div class="file-list">${files}</div>` : ""}
    <h4>Log gần nhất</h4>
    <pre>${escapeHtml((job.logTail || []).join("\n") || "Chưa có log.")}</pre>`;
  dialog.showModal();
}

function templateFields(scene, index) {
  const data = scene.templateData || {};
  const template = data.template || "callout";
  const field = (path, label, value, multiline = false) => {
    if (multiline) return `<label>${label}<textarea data-scene-index="${index}" data-template-path="${path}" rows="2">${escapeHtml(value || "")}</textarea></label>`;
    return `<label>${label}<input data-scene-index="${index}" data-template-path="${path}" type="text" value="${escapeHtml(value || "")}"></label>`;
  };
  if (template === "hook") return field("headline", "Tiêu đề hook (2-7 từ)", data.headline) + field("subhead", "Dòng phụ", data.subhead || "", true);
  if (template === "comparison") return [
    field("left.label", "Nhãn trái", data.left?.label), field("left.value", "Nội dung trái", data.left?.value, true),
    field("right.label", "Nhãn phải", data.right?.label), field("right.value", "Nội dung phải", data.right?.value, true),
  ].join("");
  if (template === "stat-hero") return field("value", "Số / từ nổi bật", data.value) + field("label", "Nhãn", data.label, true) + field("context", "Bối cảnh", data.context || "", true);
  if (template === "feature-list") return field("title", "Tiêu đề", data.title) + field("bullets", "Các gạch đầu dòng — mỗi dòng một ý", (data.bullets || []).join("\n"), true);
  if (template === "outro") return field("ctaTop", "CTA", data.ctaTop) + field("channelName", "Tên kênh", data.channelName) + field("source", "Nguồn", data.source, true);
  return field("tag", "Nhãn nhỏ", data.tag || "") + field("statement", "Chữ hiển thị", data.statement || "", true);
}

function setNested(object, pathValue, value) {
  const parts = pathValue.split(".");
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] ||= {};
    target = target[key];
  }
  const final = parts[0];
  target[final] = final === "bullets" ? String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean) : value;
}

function updateEditorSummary() {
  if (!editingScript) return;
  const words = editingScript.scenes.reduce((sum, scene) => sum + String(scene.voiceText || "").trim().split(/\s+/).filter(Boolean).length, 0);
  const durationText = Number.isFinite(Number(editingScriptDurationSec)) ? ` · ~${Math.round(Number(editingScriptDurationSec))} giây` : "";
  sceneEditorSummary.textContent = `${editingScript.scenes.length} cảnh · ${words} từ lời đọc${durationText}`;
}

async function openSceneEditor(id) {
  const payload = await api(`/api/jobs/${id}/script`);
  editingJobId = id;
  editingScript = payload.script;
  editingScriptHasPrevious = Boolean(payload.hasPrevious);
  editingScriptDurationSec = payload.durationSec ?? null;
  restoreSceneEditor.disabled = !editingScriptHasPrevious;
  restoreSceneEditor.title = editingScriptHasPrevious ? "Đổi về kịch bản trước đó" : "Chưa có kịch bản trước để khôi phục";
  sceneEditorTitle.textContent = editingScript.metadata?.title || "Nội dung từng frame";
  sceneEditorList.innerHTML = editingScript.scenes.map((scene, index) => `
    <section class="scene-edit-card storyboard-card">
      <div class="scene-edit-head"><div><strong>FRAME ${String(index + 1).padStart(2, "0")}</strong><small>${escapeHtml(scene.id || "")}</small></div><span>${escapeHtml(scene.templateData?.template || scene.type || "callout")}</span></div>
      <div class="storyboard-grid">
        <div class="storyboard-pane display-pane">
          <div class="pane-title"><strong>Nội dung hiển thị</strong><small>Ngắn, rõ, dễ đọc trên video</small></div>
          <div class="scene-template-fields">${templateFields(scene, index)}</div>
        </div>
        <div class="storyboard-pane voice-pane">
          <div class="pane-title"><strong>Nội dung đọc</strong><small>Phần gửi sang Voice Server</small></div>
          <label>Lời đọc frame ${index + 1}<textarea data-scene-index="${index}" data-voice-text rows="7">${escapeHtml(scene.voiceText || "")}</textarea></label>
          <div class="frame-stats"><span>${String(scene.voiceText || "").trim().split(/\s+/).filter(Boolean).length} từ</span><span>${String(scene.voiceText || "").length} ký tự</span></div>
        </div>
      </div>
    </section>`).join("");
  updateEditorSummary();
  sceneEditorDialog.showModal();
}

sceneEditorList.addEventListener("input", (event) => {
  const index = Number(event.target.dataset.sceneIndex);
  if (!Number.isInteger(index) || !editingScript?.scenes?.[index]) return;
  if (event.target.hasAttribute("data-voice-text")) editingScript.scenes[index].voiceText = event.target.value;
  if (event.target.dataset.templatePath) setNested(editingScript.scenes[index].templateData, event.target.dataset.templatePath, event.target.value);
  updateEditorSummary();
});

async function persistCurrentScript() {
  if (!editingJobId || !editingScript) return null;
  return api(`/api/jobs/${editingJobId}/script`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: editingScript }),
  });
}

function setSceneEditorBusy(busy) {
  for (const button of [regenerateSceneEditor, reconfigureSceneEditor, restoreSceneEditor, saveSceneEditor, approveSceneEditor]) {
    if (button) button.disabled = busy || (button === restoreSceneEditor && !editingScriptHasPrevious);
  }
}

async function saveCurrentScript({ approve = false } = {}) {
  if (!editingJobId || !editingScript) return;
  setSceneEditorBusy(true);
  try {
    await persistCurrentScript();
    if (approve) {
      await api(`/api/jobs/${editingJobId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      sceneEditorDialog.close();
    }
    await loadJobs();
  } catch (error) { alert(error.message); }
  finally { setSceneEditorBusy(false); }
}

regenerateSceneEditor.addEventListener("click", async () => {
  if (!editingJobId || !editingScript) return;
  if (!confirm("Tạo một kịch bản khác với cùng thiết lập? Bản hiện tại sẽ được giữ lại để có thể Khôi phục bản trước.")) return;
  setSceneEditorBusy(true);
  try {
    await persistCurrentScript();
    await api(`/api/jobs/${editingJobId}/regenerate-script`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    sceneEditorDialog.close();
    await loadJobs();
  } catch (error) { alert(error.message); }
  finally { setSceneEditorBusy(false); }
});

reconfigureSceneEditor.addEventListener("click", async () => {
  if (!editingJobId || !editingScript) return;
  setSceneEditorBusy(true);
  try {
    await persistCurrentScript();
    const id = editingJobId;
    sceneEditorDialog.close();
    await loadProjectIntoForm(id);
  } catch (error) { alert(error.message); }
  finally { setSceneEditorBusy(false); }
});

restoreSceneEditor.addEventListener("click", async () => {
  if (!editingJobId || !editingScriptHasPrevious) return;
  if (!confirm("Khôi phục kịch bản trước? Kịch bản hiện tại sẽ được giữ lại để có thể đổi lại nếu cần.")) return;
  setSceneEditorBusy(true);
  try {
    const id = editingJobId;
    await api(`/api/jobs/${id}/restore-script`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    sceneEditorDialog.close();
    await openSceneEditor(id);
    await loadJobs();
  } catch (error) { alert(error.message); }
  finally { setSceneEditorBusy(false); }
});

saveSceneEditor.addEventListener("click", () => saveCurrentScript({ approve: false }));
approveSceneEditor.addEventListener("click", () => saveCurrentScript({ approve: true }));

document.querySelector("#closeSceneEditor").addEventListener("click", () => sceneEditorDialog.close());
sceneEditorDialog.addEventListener("click", (event) => { if (event.target === sceneEditorDialog) sceneEditorDialog.close(); });

document.addEventListener("click", async (event) => {
  const detail = event.target.closest("[data-detail]");
  if (detail) {
    try { await showDetail(detail.dataset.detail); } catch (error) { alert(error.message); }
  }
  const editScenes = event.target.closest("[data-edit-scenes]");
  if (editScenes) {
    try { await openSceneEditor(editScenes.dataset.editScenes); } catch (error) { alert(error.message); }
  }
  const editJob = event.target.closest("[data-edit-job]");
  if (editJob) {
    editJob.disabled = true;
    try { await loadProjectIntoForm(editJob.dataset.editJob); }
    catch (error) { alert(error.message); }
    finally { editJob.disabled = false; }
  }
  const renderButton = event.target.closest("[data-render]");
  if (renderButton) {
    if (!confirm("Bắt đầu tạo giọng và render video theo kịch bản đã lưu?")) return;
    renderButton.disabled = true;
    const originalText = renderButton.textContent;
    renderButton.textContent = "Đang đưa vào hàng đợi…";
    try {
      await api(`/api/jobs/${renderButton.dataset.render}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerateVoice: renderButton.dataset.regenerateVoice === "1" }),
      });
      await loadJobs();
    } catch (error) {
      alert(error.message);
      renderButton.disabled = false;
      renderButton.textContent = originalText;
    }
  }
  const retry = event.target.closest("[data-retry]");
  if (retry) {
    retry.disabled = true;
    try {
      await api(`/api/jobs/${retry.dataset.retry}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerateVoice: retry.dataset.regenerateVoice === "1" }),
      });
      await loadJobs();
    } catch (error) {
      alert(error.message);
      retry.disabled = false;
    }
  }
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    const deleteTitle = remove.dataset.deleteTitle || "dự án này";
    if (!confirm(`Xóa "${deleteTitle}"? Kịch bản, log, video và các file riêng của dự án sẽ bị xóa. Thao tác này không thể hoàn tác.`)) return;
    remove.disabled = true;
    try {
      await api(`/api/jobs/${remove.dataset.delete}`, { method: "DELETE" });
      await loadJobs();
    } catch (error) {
      alert(error.message);
      remove.disabled = false;
    }
  }
});

document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });


const AI_ADAPTERS = [
  { id: "github-models", label: "GitHub Models" },
  { id: "gemini", label: "Google Gemini" },
  { id: "anthropic", label: "Claude / Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "local-ai", label: "Local AI" },
  { id: "openai-compatible", label: "OpenAI-compatible" },
  { id: "custom-ai", label: "Custom AI REST" },
];
const VOICE_ADAPTERS = [
  { id: "vieneu", label: "VieNeu-compatible" },
  { id: "lucylab", label: "LucyLab" },
  { id: "openai-tts", label: "OpenAI-compatible TTS" },
  { id: "custom-voice", label: "Custom Voice REST (OmniVoice / Other)" },
];
let connectionCategoryValue = "ai";
let publicConnections = [];

function connectionStatusHtml(item) {
  const test = item.lastTest;
  if (test?.ok) return `<span class="connection-state ok">● ${escapeHtml(test.message || "Sẵn sàng")}</span>`;
  if (test && !test.ok) return `<span class="connection-state bad">● ${escapeHtml(test.message || "Lỗi")}</span>`;
  return `<span class="connection-state pending">○ Chưa Test</span>`;
}

function renderConnectionList() {
  const items = publicConnections.filter((item) => item.category === connectionCategoryValue);
  connectionList.innerHTML = items.length ? items.map((item) => `
    <button type="button" class="connection-card ${item.id === connectionId.value ? "selected" : ""}" data-connection-id="${escapeHtml(item.id)}">
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.adapter)}${item.baseUrl ? ` · ${escapeHtml(item.baseUrl)}` : ""}</small></div>
      <div>${connectionStatusHtml(item)}<small>${item.category === "ai" ? `${item.models?.length || 0} model` : `${item.voices?.length || 0} giọng`}</small></div>
    </button>`).join("") : '<div class="empty compact-empty">Chưa có kết nối trong nhóm này.</div>';
}

function adapterItems() { return connectionCategoryValue === "ai" ? AI_ADAPTERS : VOICE_ADAPTERS; }

function defaultUrlForAdapter(adapter) {
  return {
    "github-models": "https://models.github.ai/inference",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    anthropic: "https://api.anthropic.com",
    lucylab: "https://api.lucylab.io/json-rpc",
    "openai-tts": "https://api.openai.com/v1",
  }[adapter] || "";
}

function updateConnectionFormMode() {
  fillSelect(connectionAdapter, adapterItems(), connectionAdapter.value || adapterItems()[0]?.id);
  const adapter = connectionAdapter.value;
  const isVoice = connectionCategoryValue === "voice";
  const isCustomAi = !isVoice && adapter === "custom-ai";
  connectionHeaderWrap.hidden = (!isVoice || adapter === "lucylab") && !isCustomAi;
  connectionModelsWrap.hidden = isVoice;
  connectionAiAdvancedWrap.hidden = !isCustomAi;
  connectionVoicesWrap.hidden = !isVoice || !["lucylab", "openai-tts", "custom-voice"].includes(adapter);
  connectionVoiceAdvancedWrap.hidden = !isVoice || !["openai-tts", "custom-voice"].includes(adapter);
  if (!connectionUrl.value) connectionUrl.value = defaultUrlForAdapter(adapter);
  connectionApiHeader.placeholder = adapter === "vieneu" ? "x-api-key" : "Authorization";
  if (isCustomAi && !connectionApiHeader.value) connectionApiHeader.value = "Authorization";
  if (isCustomAi && !connectionAiAuthPrefix.value) connectionAiAuthPrefix.value = "Bearer ";
  if (isCustomAi && !connectionAiModelsEndpoint.value) connectionAiModelsEndpoint.value = "/models";
  if (isCustomAi && !connectionAiChatEndpoint.value) connectionAiChatEndpoint.value = "/generate";
  if (isCustomAi && !connectionAiModelsListPath.value) connectionAiModelsListPath.value = "data";
  if (isCustomAi && !connectionAiModelIdField.value) connectionAiModelIdField.value = "id";
  if (isCustomAi && !connectionAiModelNameField.value) connectionAiModelNameField.value = "name";
  if (isCustomAi && !connectionAiModelField.value) connectionAiModelField.value = "model";
  if (isCustomAi && !connectionAiMessagesField.value) connectionAiMessagesField.value = "messages";
  if (isCustomAi && !connectionAiPromptField.value) connectionAiPromptField.value = "prompt";
  if (isCustomAi && !connectionAiResponsePath.value) connectionAiResponsePath.value = "choices.0.message.content";
  if (adapter === "openai-tts" && !connectionApiHeader.value) connectionApiHeader.value = "Authorization";
  if (adapter === "openai-tts" && !connectionAuthPrefix.value) connectionAuthPrefix.value = "Bearer ";
  if (adapter === "openai-tts" && !connectionTtsEndpoint.value) connectionTtsEndpoint.value = "/audio/speech";
  if (adapter === "openai-tts" && !connectionTtsModel.value) connectionTtsModel.value = "tts-1";
  if (adapter === "openai-tts" && !connectionAudioFormat.value) connectionAudioFormat.value = "wav";
  testConnection.disabled = !connectionId.value;
  deleteConnection.hidden = !connectionId.value;
}

function resetConnectionForm() {
  connectionForm.reset();
  connectionId.value = "";
  connectionCategory.value = connectionCategoryValue;
  connectionEnabled.checked = true;
  connectionApiHeader.value = connectionCategoryValue === "voice" ? "x-api-key" : "";
  for (const field of [connectionAiAuthPrefix, connectionAiModelsEndpoint, connectionAiChatEndpoint, connectionAiModelsListPath, connectionAiModelIdField, connectionAiModelNameField, connectionAiModelField, connectionAiMessagesField, connectionAiPromptField, connectionAiResponsePath, connectionAiExtraJson, connectionAuthPrefix, connectionVoicesEndpoint, connectionTtsEndpoint, connectionVoiceListPath, connectionVoiceIdField, connectionVoiceNameField, connectionVoiceGenderField, connectionVoiceDescriptionField, connectionTextField, connectionVoiceField, connectionFilenameField, connectionTtsModel, connectionAudioFormat, connectionResponsePath, connectionExtraJson]) field.value = "";
  connectionAiRequestMode.value = "messages";
  connectionResponseMode.value = "binary";
  connectionMessage.textContent = "";
  fillSelect(connectionAdapter, adapterItems(), adapterItems()[0]?.id);
  connectionUrl.value = defaultUrlForAdapter(connectionAdapter.value);
  updateConnectionFormMode();
  renderConnectionList();
}

function editConnection(item) {
  connectionId.value = item.id;
  connectionCategory.value = item.category;
  connectionCategoryValue = item.category;
  connectionName.value = item.name || "";
  fillSelect(connectionAdapter, adapterItems(), item.adapter);
  connectionUrl.value = item.baseUrl || "";
  connectionApiKey.value = "";
  connectionApiKey.placeholder = item.hasApiKey ? "Đã lưu · để trống để giữ nguyên" : "Nhập API key";
  connectionApiHeader.value = item.apiHeader || "";
  connectionModels.value = (item.models || []).join("\n");
  connectionVoices.value = (item.voices || []).map((voice) => `${voice.id}|${voice.gender || "Khác"}|${voice.name}|${voice.voiceId || voice.id}`).join("\n");
  const settings = item.settings || {};
  connectionAiAuthPrefix.value = settings.aiAuthPrefix || "";
  connectionAiModelsEndpoint.value = settings.aiModelsEndpoint || "";
  connectionAiChatEndpoint.value = settings.aiChatEndpoint || "";
  connectionAiModelsListPath.value = settings.aiModelsListPath || "";
  connectionAiModelIdField.value = settings.aiModelIdField || "";
  connectionAiModelNameField.value = settings.aiModelNameField || "";
  connectionAiRequestMode.value = settings.aiRequestMode || "messages";
  connectionAiModelField.value = settings.aiModelField || "";
  connectionAiMessagesField.value = settings.aiMessagesField || "";
  connectionAiPromptField.value = settings.aiPromptField || "";
  connectionAiResponsePath.value = settings.aiResponsePath || "";
  connectionAiExtraJson.value = settings.aiExtraJson || "";
  connectionAuthPrefix.value = settings.authPrefix || "";
  connectionVoicesEndpoint.value = settings.voicesEndpoint || "";
  connectionTtsEndpoint.value = settings.ttsEndpoint || "";
  connectionVoiceListPath.value = settings.voiceListPath || "";
  connectionVoiceIdField.value = settings.voiceIdField || "";
  connectionVoiceNameField.value = settings.voiceNameField || "";
  connectionVoiceGenderField.value = settings.voiceGenderField || "";
  connectionVoiceDescriptionField.value = settings.voiceDescriptionField || "";
  connectionTextField.value = settings.textField || "";
  connectionVoiceField.value = settings.voiceField || "";
  connectionFilenameField.value = settings.filenameField || "";
  connectionTtsModel.value = settings.ttsModel || "";
  connectionAudioFormat.value = settings.audioFormat || "";
  connectionResponseMode.value = settings.responseMode || "binary";
  connectionResponsePath.value = settings.responsePath || "";
  connectionExtraJson.value = settings.extraJson || "";
  connectionEnabled.checked = item.enabled !== false;
  connectionMessage.textContent = item.lastTest ? `${item.lastTest.ok ? "✓" : "✕"} ${item.lastTest.message || ""}` : "Chưa Test kết nối";
  updateConnectionFormMode();
  renderConnectionList();
}

async function loadConnections() {
  const payload = await api("/api/connections");
  publicConnections = payload.connections || [];
  renderConnectionList();
}

async function refreshEverything() {
  await loadConnections();
  await loadAppConfig();
  await loadHealth();
}

openConnections.addEventListener("click", async () => {
  try { await loadConnections(); resetConnectionForm(); connectionsDialog.showModal(); }
  catch (error) { alert(error.message); }
});
document.querySelector("#closeConnections").addEventListener("click", () => connectionsDialog.close());
connectionsDialog.addEventListener("click", (event) => { if (event.target === connectionsDialog) connectionsDialog.close(); });
document.querySelector("#newConnection").addEventListener("click", resetConnectionForm);

document.querySelectorAll("[data-connection-category]").forEach((button) => button.addEventListener("click", () => {
  connectionCategoryValue = button.dataset.connectionCategory;
  document.querySelectorAll("[data-connection-category]").forEach((item) => item.classList.toggle("active", item === button));
  resetConnectionForm();
}));

connectionAdapter.addEventListener("change", () => {
  const current = connectionUrl.value.trim();
  const knownDefaults = AI_ADAPTERS.concat(VOICE_ADAPTERS).map((item) => defaultUrlForAdapter(item.id)).filter(Boolean);
  if (!current || knownDefaults.includes(current)) connectionUrl.value = defaultUrlForAdapter(connectionAdapter.value);
  updateConnectionFormMode();
});

connectionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-connection-id]");
  if (!button) return;
  const item = publicConnections.find((connection) => connection.id === button.dataset.connectionId);
  if (item) editConnection(item);
});

function connectionPayload() {
  return {
    category: connectionCategoryValue,
    name: connectionName.value.trim(),
    adapter: connectionAdapter.value,
    baseUrl: connectionUrl.value.trim(),
    apiKey: connectionApiKey.value ? connectionApiKey.value : "__KEEP__",
    apiHeader: connectionApiHeader.value.trim(),
    models: connectionModels.value,
    aiAuthPrefix: connectionAiAuthPrefix.value,
    aiModelsEndpoint: connectionAiModelsEndpoint.value.trim(),
    aiChatEndpoint: connectionAiChatEndpoint.value.trim(),
    aiModelsListPath: connectionAiModelsListPath.value.trim(),
    aiModelIdField: connectionAiModelIdField.value.trim(),
    aiModelNameField: connectionAiModelNameField.value.trim(),
    aiRequestMode: connectionAiRequestMode.value,
    aiModelField: connectionAiModelField.value.trim(),
    aiMessagesField: connectionAiMessagesField.value.trim(),
    aiPromptField: connectionAiPromptField.value.trim(),
    aiResponsePath: connectionAiResponsePath.value.trim(),
    aiExtraJson: connectionAiExtraJson.value.trim(),
    voiceDefinitions: connectionVoices.value,
    authPrefix: connectionAuthPrefix.value,
    voicesEndpoint: connectionVoicesEndpoint.value.trim(),
    ttsEndpoint: connectionTtsEndpoint.value.trim(),
    voiceListPath: connectionVoiceListPath.value.trim(),
    voiceIdField: connectionVoiceIdField.value.trim(),
    voiceNameField: connectionVoiceNameField.value.trim(),
    voiceGenderField: connectionVoiceGenderField.value.trim(),
    voiceDescriptionField: connectionVoiceDescriptionField.value.trim(),
    textField: connectionTextField.value.trim(),
    voiceField: connectionVoiceField.value.trim(),
    filenameField: connectionFilenameField.value.trim(),
    ttsModel: connectionTtsModel.value.trim(),
    audioFormat: connectionAudioFormat.value.trim(),
    responseMode: connectionResponseMode.value,
    responsePath: connectionResponsePath.value.trim(),
    extraJson: connectionExtraJson.value.trim(),
    enabled: connectionEnabled.checked,
  };
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveConnection.disabled = true;
  testConnection.disabled = true;
  connectionMessage.textContent = "Đang lưu…";
  try {
    const id = connectionId.value;
    const result = await api(id ? `/api/connections/${id}` : "/api/connections", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload()),
    });
    connectionId.value = result.connection.id;
    connectionMessage.textContent = "Đã lưu. Đang Test kết nối…";
    try {
      await api(`/api/connections/${connectionId.value}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      connectionMessage.textContent = "✓ Đã lưu và kết nối hoạt động";
    } catch (testError) {
      connectionMessage.textContent = `Đã lưu nhưng Test lỗi: ${testError.message}`;
    }

    // Reload connection list + runtime config so newly discovered models/voices
    // are immediately available in the project form.
    await loadConnections();
    await loadAppConfig("?refresh=1");
    await loadHealth();
    const updated = publicConnections.find((item) => item.id === connectionId.value);
    if (updated) editConnection(updated);
  } catch (error) {
    connectionMessage.textContent = error.message;
  } finally {
    saveConnection.disabled = false;
    testConnection.disabled = !connectionId.value;
  }
});

testConnection.addEventListener("click", async () => {
  if (!connectionId.value) return;
  testConnection.disabled = true;
  connectionMessage.textContent = "Đang Test…";
  try {
    await api(`/api/connections/${connectionId.value}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await refreshEverything();
    const updated = publicConnections.find((item) => item.id === connectionId.value);
    if (updated) editConnection(updated);
  } catch (error) { connectionMessage.textContent = error.message; await loadConnections(); }
  finally { testConnection.disabled = false; }
});

deleteConnection.addEventListener("click", async () => {
  if (!connectionId.value || !confirm("Xóa kết nối này? Các dự án cũ dùng kết nối này sẽ không render được cho đến khi chọn lại nguồn.")) return;
  try {
    await api(`/api/connections/${connectionId.value}`, { method: "DELETE" });
    resetConnectionForm();
    await refreshEverything();
  } catch (error) { connectionMessage.textContent = error.message; }
});

async function loadHealth() {
  try {
    const health = await api("/api/health");
    healthBadge.className = `health ${health.ok ? "ok" : "bad"}`;
    healthBadge.textContent = `${health.providerCount || 0} AI · ${health.ttsProviderCount || 0} Voice đã kết nối`;
    healthBadge.title = health.ok
      ? [
          ...(health.providers || []).map((provider) => `${provider.label}: ${provider.models.join(", ")}`),
          ...(health.ttsSources || []).map((source) => `${source.label}: ${source.ready ? "sẵn sàng" : source.status || "chưa sẵn sàng"}`),
        ].join("\n")
      : health.issues.join(" · ");
  } catch (error) {
    healthBadge.className = "health bad";
    healthBadge.textContent = error.message;
  }
}

(async () => {
  try { await loadAppConfig(); } catch (error) { message.textContent = error.message; submitButton.disabled = true; }
  await loadHealth();
  await loadJobs();
  setInterval(loadJobs, 2000);
  setInterval(loadHealth, 30000);
})();
