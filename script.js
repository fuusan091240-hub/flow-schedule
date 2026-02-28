console.log("FLOW script.js loaded", new Date().toISOString());

const GAS_EXEC_URL = "https://script.google.com/macros/s/AKfycbyTiMB9GFIcOmvrPbikwzxuoKWfrFhlgeITKADoXiGEzK-N50YD2xN1D206PZy7WzOT/exec";

// === 合言葉管理 ===
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
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensurePassphrase() {
  if (getPassphrase()) return true;

  const pass = prompt("クラウド同期用の合言葉を入力（この端末に保存されます）:");
  if (!pass) return false;

  setPassphrase(pass);
  return true;
}

async function getKeyHash() {
  const pass = getPassphrase();
  if (!pass) throw new Error("合言葉が未設定です");
  return await sha256Hex(pass);
}

let tasks = JSON.parse(localStorage.getItem("tasks")) || [];
let currentMood = parseInt(localStorage.getItem("mood")) || 2;
let viewMode = "today";

function loadManuscriptSafe() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem("manuscript") || "{}"); } catch {}
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

function saveManuscript() {
  localStorage.setItem("manuscript", JSON.stringify(manuscript));
}
let manuscriptEditMode = false;

// ★ Daily
let daily = JSON.parse(localStorage.getItem("daily")) || [
  { id: "d1", title: "5分リセット", done: false },
  { id: "d2", title: "ちょい動き", done: false },
];
let dailyLastReset = localStorage.getItem("dailyLastReset") || "";

const taskList = document.getElementById("taskList");
const dailyList = document.getElementById("dailyList");

const capacityMap = {
  0: 2,  // 虚無
  1: 3,  // 低
  2: 5,  // 普通
  3: 3,  // イライラ
  4: 6,  // ハイ
  5: 5   // 無敵
};

function saveTasks() {
  localStorage.setItem("tasks", JSON.stringify(tasks));
}

function saveDaily() {
  localStorage.setItem("daily", JSON.stringify(daily));
  localStorage.setItem("dailyLastReset", dailyLastReset);
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ★ Dailyは「日付が変わったら」未チェックに戻す
function resetDailyIfNeeded() {
  const t = todayKey();
  if (dailyLastReset !== t) {
    daily = daily.map(item => ({ ...item, done: false }));
    dailyLastReset = t;
    saveDaily();
    renderDaily();
    scheduleCloudSave();
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDaily() {
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
      renderTasks(); // 使用ポイント表示に連動させたいなら（任意）
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
  taskList.innerHTML = "";

  const capacity = capacityMap[currentMood];

  // 今日の使用ポイント（タスク完了分のみでOK）
  let used = tasks
    .filter(t => t.done)
    .reduce((sum, t) => sum + t.energy, 0);

  const display = document.getElementById("capacityDisplay");
  if (display) {
    const today = new Date();
const formatted = today.toLocaleDateString("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short"
});

display.textContent =
  `${formatted} ｜ 許容量：${capacity} / 使用：${used}`;
    display.style.color = (used > capacity) ? "red" : "black";
  }

 // 締切順：締切なしは下へ
const sorted = [...tasks].sort((a, b) => {
  const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
  const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
  return ad - bd;
});

// ★ フィルタは sort の外
let filteredTasks = sorted;

if (viewMode === "today") {
  filteredTasks = sorted.filter(t => !t.done);
}

// ★ ここで回す
filteredTasks.forEach((task) => {
    const canDo = task.energy <= capacity;

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
      <span class="task-meta">（締切: ${deadlineText} / 消耗度: ${task.energy}）</span>
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
      energyInput.value = String(task.energy);

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

  let daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
  daysLeft = Math.max(daysLeft, 1);

  const pagesPerDay = (remaining / daysLeft).toFixed(1);

  if (!manuscriptEditMode) {
    container.innerHTML = `
      <div class="manuscript-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 style="margin:0;">${manuscript.title}（${manuscript.deadline}締切）</h3>
          <button id="manuscriptEdit">✏</button>
        </div>

        <div>進捗：${manuscript.progress} / ${manuscript.total}</div>
        <div>残り：${remaining}</div>
        <div style="opacity:0.6;font-size:0.9em;">
          目安：あと${daysLeft}日 → 1日あたり ${pagesPerDay}p
        </div>

        <div style="margin-top:8px;">
          <button id="manuscriptMinus">−1</button>
          <button id="manuscriptPlus">+1</button>
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

  // --- 編集モード ---
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
        <button id="msSave">保存</button>
        <button id="msCancel">取消</button>
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

    // total変更で progress がはみ出ないように
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

// --- イベント類 ---

// タスク追加
const addTaskBtn = document.getElementById("addTask");
if (addTaskBtn) {
  addTaskBtn.addEventListener("click", () => {
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
}

// 今日やる / すべて（ボタンが無くても落ちない）
const showTodayBtn = document.getElementById("showToday");
if (showTodayBtn) {
  showTodayBtn.addEventListener("click", () => {
    viewMode = "today";
    localStorage.setItem("viewMode", "today");
    renderTasks();
    scheduleCloudSave();
  });
}

const showAllBtn = document.getElementById("showAll");
if (showAllBtn) {
  showAllBtn.addEventListener("click", () => {
    viewMode = "all";
    localStorage.setItem("viewMode", "all");
    renderTasks();
    scheduleCloudSave();
  });
}

// 気分変更
document.querySelectorAll("#mood-section button").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMood = parseInt(btn.dataset.mood, 10);
    localStorage.setItem("mood", String(currentMood));
    scheduleCloudSave();
    renderTasks();
  });
});

// Daily追加
const addDailyBtn = document.getElementById("addDaily");
if (addDailyBtn) {
  addDailyBtn.addEventListener("click", () => {
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
  });
}

// 初期化
resetDailyIfNeeded();
renderDaily();
renderTasks();
renderManuscript();

function exportState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),   // ←クラウド判定の軸
    data: {
      mood: Number(localStorage.getItem("mood") || 0),
      tasks: JSON.parse(localStorage.getItem("tasks") || "[]"),
      daily: JSON.parse(localStorage.getItem("daily") || "[]"),
      manuscript: JSON.parse(localStorage.getItem("manuscript") || "{}"),
      viewMode: localStorage.getItem("viewMode") || "today"
    }
  };
}
function importState(state) {
  const d = (state && state.data) || {};

  // 基本
  localStorage.setItem("mood", String(d.mood ?? 0));
  localStorage.setItem("tasks", JSON.stringify(d.tasks ?? []));
  localStorage.setItem("daily", JSON.stringify(d.daily ?? []));
  localStorage.setItem("viewMode", d.viewMode ?? "today");

  // manuscript：壊れやすいのでデフォルトを強制
  const m = d.manuscript || {};
  const safeManuscript = {
    title: typeof m.title === "string" ? m.title : "",
    deadline: typeof m.deadline === "string" ? m.deadline : "",
    total: Number.isFinite(Number(m.total)) ? Number(m.total) : 0,
    progress: Number.isFinite(Number(m.progress)) ? Number(m.progress) : 0,
  };

  // 進捗が総数を超えない/負にならない
  if (safeManuscript.progress < 0) safeManuscript.progress = 0;
  if (safeManuscript.total < 0) safeManuscript.total = 0;
  if (safeManuscript.progress > safeManuscript.total) safeManuscript.progress = safeManuscript.total;

  localStorage.setItem("manuscript", JSON.stringify(safeManuscript));
}

async function cloudSave() {
  const payload = exportState();

const keyHash = await getKeyHash();

await fetch(`${GAS_EXEC_URL}?action=save`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...payload,
    keyHash
  })
});

function cloudLoad() {
  return new Promise((resolve, reject) => {
    const cb = "__flow_cb_" + Date.now();

    window[cb] = (obj) => {
      delete window[cb];
      script.remove();
      resolve(obj);
    };

    const script = document.createElement("script");
    script.onerror = () => {
      delete window[cb];
      script.remove();
      reject("cloudLoad failed");
    };

    script.src = `${GAS_EXEC_URL}?action=load&callback=${cb}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

async function cloudRestore() {
  const state = await cloudLoad();
  importState(state);
  location.reload();
}

// ===== Auto Sync =====
let __syncTimer = null;
let __isRestoring = false;

// ローカル変更が入ったら「あとで保存」を予約（連打しても1回にまとめる）
function scheduleCloudSave(delayMs = 1500) {
  if (__isRestoring) return; // 復元中は保存しない（ループ防止）
  localStorage.setItem("__flow_localDirtyAt", new Date().toISOString());

  clearTimeout(__syncTimer);
  __syncTimer = setTimeout(async () => {
    try {
      await cloudSave();
      // no-cors なので成功判定しづらい→保存“したことにする”で十分
      localStorage.setItem("__flow_lastSaveAt", new Date().toISOString());
      localStorage.removeItem("__flow_localDirtyAt");
    } catch (e) {
      // 失敗しても落とさない（後でまた保存される）
      console.warn("auto save failed", e);
    }
  }, delayMs);
}

function parseIso(t) {
  const n = Date.parse(t || "");
  return Number.isFinite(n) ? n : 0;
}

// クラウドがローカルより新しければ自動復元
async function pullIfNewer() {
  try {
    const cloud = await cloudLoad();
    const cloudAt = parseIso(cloud && cloud.savedAt);
    const localAt = parseIso(localStorage.getItem("__flow_lastPulledAt"));

    // すでに取り込んだクラウドより新しくないなら何もしない
    if (cloudAt <= localAt) return;

    // ローカルに未保存変更があるときは上書きしない（事故防止）
    const dirtyAt = parseIso(localStorage.getItem("__flow_localDirtyAt"));
    if (dirtyAt) return;

    __isRestoring = true;
    importState(cloud);
    localStorage.setItem("__flow_lastPulledAt", cloud.savedAt || new Date().toISOString());
    location.reload();
  } catch (e) {
    console.warn("auto pull failed", e);
  } finally {
    __isRestoring = false;
  }
}

function startAutoSync() {
  // このタブ（この起動）では初回復元を1回だけにする
  if (sessionStorage.getItem("__flow_bootstrapped") !== "1") {
    sessionStorage.setItem("__flow_bootstrapped", "1");

    (async () => {
      try {
        __isRestoring = true;

        const cloud = await cloudLoad();
        const cloudAt = parseIso(cloud && cloud.savedAt);
        const localAt = parseIso(localStorage.getItem("__flow_lastPulledAt"));

        // ローカルが空っぽ（初回）か、クラウドの方が新しい時だけ取り込む
        const localTasks = JSON.parse(localStorage.getItem("tasks") || "[]");
        const isLocalEmpty = !Array.isArray(localTasks) || localTasks.length === 0;

        if (isLocalEmpty || cloudAt > localAt) {
          importState(cloud);
          localStorage.setItem("__flow_lastPulledAt", cloud.savedAt || new Date().toISOString());
          location.reload(); // ここは「必要なときだけ」実行される
        }
      } catch (e) {
        console.warn("initial restore failed", e);
      } finally {
        __isRestoring = false;
      }
    })();
  }

  // 以降は定期チェック（クラウドが新しい時だけ反映）
  setInterval(pullIfNewer, 10000);
}

// 初期化（最後に実行）
resetDailyIfNeeded();
renderDaily();
renderTasks();
renderManuscript();
startAutoSync();

// ===== 起動時処理 =====
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await ensurePassphrase();
  if (!ok) return;

  // 既存の自動同期があるなら呼ぶ
  if (typeof autoSync === "function") {
    await autoSync();
  }
});
