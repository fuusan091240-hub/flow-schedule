"use strict";

// =====================
// Config
// =====================
console.log("FLOW script.js loaded", new Date().toISOString());

// ★あなたの方で XXXXX に置き換えOK
const GAS_EXEC_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AY5xjrQd3Z3vpMequzfVAVny3KiWGxvW4oujSBZzn1OXni7YbNpbHPYkGw16ToV7OIuRHOP4qMvj5gtiBxWdWt5aDg5UzYU4wIgUuoHwWZQ3_yn9bIXcV8wmTiF3iaZSAsnMSG-uxHQSxpnrx-UI06RctKEcOAJiVsXti8A7YADbc2LN6I8PvfpxFXxRsroeQCczEZ7artTWu8HpBtA5y4PSOS7LQuCrNoh2x1gZT8g4AwpYSOIuWl46w7z5AMu7A4G9YTijej2RFqSq20qVj_HvyrQ-ajvnk0q55LNEtmwVc7rIa1s0MPM&lib=MiD0L96dLXag0lRHKSz6xxmDs_wf-hvwW";

/**
 * URLへクエリを安全に付与する（? / & 二重事故を防止）
 */
function appendParam(url, key, value) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}
function withAction(url, action) {
  return appendParam(url, "action", action);
}

// =====================
// Passphrase (合言葉)
// =====================
const FLOW_PASSPHRASE_KEY = "flow_passphrase";

function getPassphrase() {
  return localStorage.getItem(FLOW_PASSPHRASE_KEY) || "";
}
function setPassphrase(pass) {
  localStorage.setItem(FLOW_PASSPHRASE_KEY, pass);
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getKeyHash() {
  const pass = getPassphrase();
  if (!pass) throw new Error("合言葉が未設定です");
  return await sha256Hex(pass);
}

function refreshPassBanner() {
  const banner = document.getElementById("passBanner");
  const btn = document.getElementById("setPassBtn");
  if (!banner || !btn) return;

  const has = !!getPassphrase();
  banner.style.display = has ? "none" : "block";

  btn.onclick = async () => {
    const pass = prompt("クラウド同期用の合言葉を入力（この端末に保存されます）:");
    if (!pass) return;
    setPassphrase(pass);
    refreshPassBanner();
    // 初回だけ軽く同期を走らせる（失敗しても落とさない）
    try { await pullIfNewer(); } catch {}
  };
}

// =====================
// State
// =====================
function safeJsonParse(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

let tasks = safeJsonParse("tasks", []);
let daily = safeJsonParse("daily", [
  { id: "d1", title: "5分リセット", done: false },
  { id: "d2", title: "ちょい動き", done: false },
]);

let currentMood = Number(localStorage.getItem("mood") || 2);
let viewMode = localStorage.getItem("viewMode") || "today";

let dailyLastReset = localStorage.getItem("dailyLastReset") || "";

function loadManuscriptSafe() {
  const m = safeJsonParse("manuscript", {});
  const ok =
    m && typeof m === "object" &&
    typeof m.title === "string" &&
    typeof m.deadline === "string" &&
    Number.isFinite(Number(m.total)) &&
    Number.isFinite(Number(m.progress));

  return ok ? {
    title: m.title,
    deadline: m.deadline,
    total: Number(m.total),
    progress: Number(m.progress),
  } : {
    title: "原稿",
    deadline: "2026-04-28",
    total: 60,
    progress: 0
  };
}

let manuscript = loadManuscriptSafe();
let manuscriptEditMode = false;

const capacityMap = { 0:2, 1:3, 2:5, 3:3, 4:6, 5:5 };

function saveTasks() { localStorage.setItem("tasks", JSON.stringify(tasks)); }
function saveDaily() {
  localStorage.setItem("daily", JSON.stringify(daily));
  localStorage.setItem("dailyLastReset", dailyLastReset);
}
function saveManuscript() { localStorage.setItem("manuscript", JSON.stringify(manuscript)); }

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resetDailyIfNeeded() {
  const t = todayKey();
  if (dailyLastReset !== t) {
    daily = daily.map(item => ({ ...item, done:false }));
    dailyLastReset = t;
    saveDaily();
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// =====================
// Render
// =====================
function renderDaily() {
  const dailyList = document.getElementById("dailyList");
  if (!dailyList) return;
  dailyList.innerHTML = "";

  daily.forEach((item) => {
    const li = document.createElement("li");
    li.className = "task-row";
    if (item.done) li.classList.add("task-done");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!item.done;
    checkbox.addEventListener("change", () => {
      item.done = checkbox.checked;
      saveDaily();
      renderDaily();
      scheduleCloudSave();
      renderTasks();
    });

    const text = document.createElement("span");
    text.innerHTML = `<strong>${escapeHtml(item.title)}</strong>`;

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.title = "削除";
    delBtn.addEventListener("click", () => {
      daily = daily.filter(d => d.id !== item.id);
      saveDaily();
      renderDaily();
      scheduleCloudSave();
    });

    li.appendChild(checkbox);
    li.appendChild(text);
    li.appendChild(delBtn);
    dailyList.appendChild(li);
  });
}

function renderTasks() {
  const taskList = document.getElementById("taskList");
  if (!taskList) return;
  taskList.innerHTML = "";

  const capacity = capacityMap[currentMood] ?? 0;

  // 今日の使用ポイント（完了タスクのみ）
  const used = (tasks || [])
    .filter(t => t && t.done)
    .reduce((sum, t) => sum + Number(t.energy || 0), 0);

  const display = document.getElementById("capacityDisplay");
  if (display) {
    const today = new Date();
    const formatted = today.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    });
    display.textContent = `${formatted} ｜ 許容量：${capacity} / 使用：${used}`;
    display.style.color = (used > capacity) ? "red" : "black";
  }

  // 締切順（締切なしは最後）
  const sorted = [...(tasks || [])].sort((a, b) => {
    const ad = a?.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b?.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ad - bd;
  });

  // 表示モード
  let filteredTasks = sorted;
  if (viewMode === "today") {
    filteredTasks = sorted.filter(t => !t.done);
  }

  filteredTasks.forEach((task) => {
    const canDo = Number(task.energy || 0) <= capacity;

    const li = document.createElement("li");
    li.className = "task-row";
    if (!canDo) li.classList.add("task-disabled");
    if (task.done) li.classList.add("task-done");

    // 完了チェック
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      saveTasks();
      renderTasks();
      scheduleCloudSave();
    });

    // 表示用
    const viewBox = document.createElement("div");
    viewBox.style.flex = "1";

    const deadlineText = task.deadline ? task.deadline : "締切なし";
    viewBox.innerHTML = `
      <strong>${escapeHtml(task.title)}</strong>
      <span class="task-meta">（締切: ${deadlineText} / 消耗度: ${Number(task.energy || 0)}）</span>
    `;

    // 編集
    const editBtn = document.createElement("button");
    editBtn.textContent = "✏";
    editBtn.title = "編集";

    // 削除
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "削除";
    deleteBtn.addEventListener("click", () => {
      tasks = tasks.filter(t => t.id !== task.id);
      saveTasks();
      renderTasks();
      scheduleCloudSave();
    });

    editBtn.addEventListener("click", () => {
      const editBox = document.createElement("div");
      editBox.style.flex = "1";

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.value = task.title;

      const deadlineInput = document.createElement("input");
      deadlineInput.type = "date";
      deadlineInput.value = task.deadline || "";

      const energyInput = document.createElement("input");
      energyInput.type = "number";
      energyInput.min = "0";
      energyInput.max = "5";
      energyInput.value = String(Number(task.energy || 0));

      const clearDeadlineBtn = document.createElement("button");
      clearDeadlineBtn.textContent = "締切なし";
      clearDeadlineBtn.addEventListener("click", () => {
        deadlineInput.value = "";
      });

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "保存";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "取消";

      saveBtn.addEventListener("click", () => {
        const newTitle = titleInput.value.trim();
        const newDeadline = deadlineInput.value; // 空なら締切なし
        const newEnergy = Number(energyInput.value);

        if (!newTitle) return;
        if (!Number.isFinite(newEnergy) || newEnergy < 0 || newEnergy > 5) return;

        task.title = newTitle;
        task.deadline = newDeadline;
        task.energy = newEnergy;

        saveTasks();
        renderTasks();
        scheduleCloudSave();
      });

      cancelBtn.addEventListener("click", () => renderTasks());

      editBox.appendChild(titleInput);
      editBox.appendChild(deadlineInput);
      editBox.appendChild(clearDeadlineBtn);
      editBox.appendChild(energyInput);
      editBox.appendChild(saveBtn);
      editBox.appendChild(cancelBtn);

      li.innerHTML = "";
      li.appendChild(checkbox);
      li.appendChild(editBox);
      li.appendChild(deleteBtn);
    });

    li.appendChild(checkbox);
    li.appendChild(viewBox);
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);

    taskList.appendChild(li);
  });

  renderManuscript();
}

function renderManuscript() {
  const container = document.getElementById("manuscript-section");
  if (!container) return;

  const today = new Date();
  const deadlineDate = new Date(manuscript.deadline);
  const remaining = manuscript.total - manuscript.progress;

  let daysLeft = Math.ceil((deadlineDate - today) / (1000*60*60*24));
  daysLeft = Math.max(daysLeft, 1);

  const pagesPerDay = (remaining / daysLeft).toFixed(1);

  if (!manuscriptEditMode) {
    container.innerHTML = `
      <div class="manuscript-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 style="margin:0;">${escapeHtml(manuscript.title)}（${manuscript.deadline}締切）</h3>
          <button id="manuscriptEdit" type="button">✏</button>
        </div>

        <div>進捗：${manuscript.progress} / ${manuscript.total}</div>
        <div>残り：${remaining}</div>
        <div style="opacity:0.6;font-size:0.9em;">
          目安：あと${daysLeft}日 → 1日あたり ${pagesPerDay}p
        </div>

        <div style="margin-top:8px;">
          <button id="manuscriptMinus" type="button">−1</button>
          <button id="manuscriptPlus" type="button">+1</button>
        </div>
      </div>
    `;

    document.getElementById("manuscriptEdit")?.addEventListener("click", () => {
      manuscriptEditMode = true;
      renderManuscript();
    });

    document.getElementById("manuscriptMinus")?.addEventListener("click", () => {
      manuscript.progress = Math.max(manuscript.progress - 1, 0);
      saveManuscript();
      renderManuscript();
      scheduleCloudSave();
    });

    document.getElementById("manuscriptPlus")?.addEventListener("click", () => {
      manuscript.progress = Math.min(manuscript.progress + 1, manuscript.total);
      saveManuscript();
      renderManuscript();
      scheduleCloudSave();
    });

    return;
  }

  container.innerHTML = `
    <div class="manuscript-card">
      <h3 style="margin:0 0 8px 0;">原稿設定</h3>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <label>タイトル
          <input id="msTitle" type="text" value="${escapeHtml(manuscript.title)}" />
        </label>

        <label>締切
          <input id="msDeadline" type="date" value="${manuscript.deadline}" />
        </label>

        <label>総ページ
          <input id="msTotal" type="number" min="1" max="9999" value="${manuscript.total}" />
        </label>

        <label>進捗
          <input id="msProgress" type="number" min="0" max="9999" value="${manuscript.progress}" />
        </label>
      </div>

      <div style="margin-top:10px;">
        <button id="msSave" type="button">保存</button>
        <button id="msCancel" type="button">取消</button>
      </div>
    </div>
  `;

  document.getElementById("msCancel")?.addEventListener("click", () => {
    manuscriptEditMode = false;
    renderManuscript();
  });

  document.getElementById("msSave")?.addEventListener("click", () => {
    const title = document.getElementById("msTitle")?.value.trim() || "原稿";
    const deadline = document.getElementById("msDeadline")?.value || todayKey();
    const total = Number(document.getElementById("msTotal")?.value);
    let progress = Number(document.getElementById("msProgress")?.value);

    if (!Number.isFinite(total) || total < 1) return;
    if (!Number.isFinite(progress) || progress < 0) progress = 0;
    progress = Math.min(progress, total);

    manuscript.title = title;
    manuscript.deadline = deadline;
    manuscript.total = total;
    manuscript.progress = progress;

    saveManuscript();
    scheduleCloudSave();
    manuscriptEditMode = false;
    renderManuscript();
  });
}

// =====================
// Cloud sync (keyHash required)
// =====================
function exportState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    data: {
      mood: Number(localStorage.getItem("mood") || 2),
      tasks: safeJsonParse("tasks", []),
      daily: safeJsonParse("daily", []),
      manuscript: safeJsonParse("manuscript", {}),
      viewMode: localStorage.getItem("viewMode") || "today"
    }
  };
}

function importState(state) {
  const d = (state && state.data) || {};
  localStorage.setItem("mood", String(d.mood ?? 2));
  localStorage.setItem("tasks", JSON.stringify(d.tasks ?? []));
  localStorage.setItem("daily", JSON.stringify(d.daily ?? []));
  localStorage.setItem("viewMode", d.viewMode ?? "today");

  const m = d.manuscript || {};
  const safeManuscript = {
    title: typeof m.title === "string" ? m.title : "原稿",
    deadline: typeof m.deadline === "string" ? m.deadline : todayKey(),
    total: Number.isFinite(Number(m.total)) ? Number(m.total) : 60,
    progress: Number.isFinite(Number(m.progress)) ? Number(m.progress) : 0,
  };
  if (safeManuscript.progress < 0) safeManuscript.progress = 0;
  if (safeManuscript.progress > safeManuscript.total) safeManuscript.progress = safeManuscript.total;

  localStorage.setItem("manuscript", JSON.stringify(safeManuscript));
}

function parseIso(t) {
  const n = Date.parse(t || "");
  return Number.isFinite(n) ? n : 0;
}

let __syncTimer = null;
let __isRestoring = false;

/**
 * ★保存は「redirect/CORSに強い」順に試す
 * 1) sendBeacon（最優先：レスポンス不要で送れる）
 * 2) fetch keepalive（beacon失敗時の保険）
 */
async function cloudSave() {
  if (!getPassphrase()) {
    refreshPassBanner();
    return false;
  }

  const payload = exportState();
  const keyHash = await getKeyHash();
  const url = withAction(GAS_EXEC_URL, "save");
  const body = JSON.stringify({ ...payload, keyHash });

  // 1) sendBeacon（強い）
  try {
    const ok = navigator.sendBeacon(
      url,
      new Blob([body], { type: "text/plain;charset=UTF-8" })
    );
    if (ok) return true;
  } catch {}

  // 2) fetch keepalive（保険）
  await fetch(url, {
    method: "POST",
    body,
    // keepalive はページ遷移直前でも送れることがある（対応ブラウザなら）
    keepalive: true,
  });
  return true;
}

function cloudLoad() {
  return new Promise(async (resolve, reject) => {
    try {
      if (!getPassphrase()) return resolve(null);

      const keyHash = await getKeyHash();
      const cb = "__flow_cb_" + Date.now();

      let done = false;
      const finish = (err, obj) => {
        if (done) return;
        done = true;
        try { delete window[cb]; } catch {}
        try { script.remove(); } catch {}
        if (err) reject(err);
        else resolve(obj);
      };

      window[cb] = (obj) => finish(null, obj);

      const script = document.createElement("script");
      script.onerror = () => finish("cloudLoad failed");

      // ★URLを必ず壊れない形で構築する
      let src = withAction(GAS_EXEC_URL, "load");
      src = appendParam(src, "callback", cb);
      src = appendParam(src, "keyHash", keyHash);
      src = appendParam(src, "t", String(Date.now()));

      // （src を組み立てた直後）
window.__flow_lastCloudLoadSrc = src;              // ★必ず残る
console.log("[cloudLoad] src =", src);             // これは見えたらラッキー

script.src = src;
document.body.appendChild(script);

      // ★“ロードできたけどcallbackが呼ばれない”系も拾う（10秒で諦める）
      setTimeout(() => finish("cloudLoad timeout"), 10000);

    } catch (e) {
      reject(e);
    }
  });
}
function scheduleCloudSave(delayMs = 1500) {
  if (__isRestoring) return;

  localStorage.setItem("__flow_localDirtyAt", new Date().toISOString());

  clearTimeout(__syncTimer);
  __syncTimer = setTimeout(async () => {
    try {
      await cloudSave();
      localStorage.setItem("__flow_lastSaveAt", new Date().toISOString());
      localStorage.removeItem("__flow_localDirtyAt");
    } catch (e) {
      console.warn("auto save failed", e);
    }
  }, delayMs);
}

async function pullIfNewer() {
  if (!getPassphrase()) { console.log("[PULL] no passphrase"); return; }
  if (__isRestoring) { console.log("[PULL] __isRestoring true"); return; }

  try {
    const cloud = await cloudLoad();
    console.log("[PULL] cloud loaded:", !!cloud, cloud?.savedAt);

    if (!cloud) { console.log("[PULL] cloud is null -> return"); return; }

    const cloudAt = parseIso(cloud.savedAt);
    const localAt = parseIso(localStorage.getItem("__flow_lastPulledAt"));
    console.log("[PULL] times", {
      cloudAt,
      localAt,
      cloudSavedAt: cloud.savedAt,
      lastPulledAt: localStorage.getItem("__flow_lastPulledAt")
    });

    if (cloudAt && localAt && cloudAt <= localAt) {
      console.log("[PULL] blocked: cloudAt <= localAt");
      return;
    }

    const dirtyRaw = localStorage.getItem("__flow_localDirtyAt");
    const dirtyAt = parseIso(dirtyRaw);
    console.log("[PULL] dirty", { dirtyRaw, dirtyAt });

    if (dirtyAt) { console.log("[PULL] blocked: dirtyAt exists"); return; }

    __isRestoring = true;
    importState(cloud);
    localStorage.setItem("__flow_lastPulledAt", cloud.savedAt || new Date().toISOString());
    console.log("[PULL] imported, set __flow_lastPulledAt =", localStorage.getItem("__flow_lastPulledAt"));

    // ★pull後にUIへ反映（ここが無いと見た目だけ古いことがある）
    tasks = safeJsonParse("tasks", []);
    daily = safeJsonParse("daily", daily);
    viewMode = localStorage.getItem("viewMode") || "today";
    currentMood = Number(localStorage.getItem("mood") || 2);
    manuscript = loadManuscriptSafe();

    resetDailyIfNeeded();
    renderDaily();
    renderTasks();
    renderManuscript();
  } catch (e) {
    console.warn("auto pull failed", e);
  } finally {
    __isRestoring = false;
  }
}

function startAutoSync() {
  // 二重起動防止
  if (window.__flowAutoSyncStarted) return;
  window.__flowAutoSyncStarted = true;

  // 起動時に1回だけ同期（少し待ってから）
  setTimeout(() => {
    pullIfNewer().catch(() => {});
  }, 300);

  // ★定期同期はしない
}

// =====================
// Boot (DOM ready)
// =====================
document.addEventListener("DOMContentLoaded", () => {
  refreshPassBanner();

  // Mood buttons
  document.querySelectorAll("#moodButtons button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentMood = parseInt(btn.dataset.mood, 10);
      localStorage.setItem("mood", String(currentMood));
      renderTasks();
      scheduleCloudSave();
    });
  });

  // Add Daily
  document.getElementById("addDaily")?.addEventListener("click", () => {
    const input = document.getElementById("dailyInput");
    const title = input?.value.trim() || "";
    if (!title) return;

    daily.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title,
      done: false,
    });

    saveDaily();
    if (input) input.value = "";
    renderDaily();
    scheduleCloudSave();
  });

  // Add Task
  document.getElementById("addTask")?.addEventListener("click", () => {
    const titleEl = document.getElementById("taskInput");
    const deadlineEl = document.getElementById("deadlineInput");
    const energyEl = document.getElementById("energyInput");

    const title = titleEl?.value.trim() || "";
    const deadline = deadlineEl?.value || "";
    const energy = Number(energyEl?.value);

    if (!title) return;
    if (!Number.isFinite(energy) || energy < 0 || energy > 5) return;

    tasks.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title,
      deadline,
      energy,
      done: false,
      createdAt: new Date().toISOString(),
    });

    saveTasks();
    if (titleEl) titleEl.value = "";
    if (deadlineEl) deadlineEl.value = "";
    if (energyEl) energyEl.value = "";

    renderTasks();
    scheduleCloudSave();
  });

  // View mode
  document.getElementById("showToday")?.addEventListener("click", () => {
    viewMode = "today";
    localStorage.setItem("viewMode", "today");
    renderTasks();
    scheduleCloudSave();
  });
  document.getElementById("showAll")?.addEventListener("click", () => {
    viewMode = "all";
    localStorage.setItem("viewMode", "all");
    renderTasks();
    scheduleCloudSave();
  });

  // First render
  resetDailyIfNeeded();
  renderDaily();
  renderTasks();
  renderManuscript();

  // Sync
  startAutoSync();
});





