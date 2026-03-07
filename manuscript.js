const manuscript = JSON.parse(localStorage.getItem("manuscript")) || {
  title: "原稿",
  deadline: "",
  total: 0,
  progress: 0,
  startPage: 3
};

// startPage が無い古いデータ対策
if (!Number.isFinite(Number(manuscript.startPage))) {
  manuscript.startPage = 3;
}
if (!Number.isFinite(Number(manuscript.total))) {
  manuscript.total = 0;
}

let checklist = JSON.parse(localStorage.getItem("checklist")) || [];

function saveChecklist() {
  localStorage.setItem("checklist", JSON.stringify(checklist));
}

function syncProgressToManuscript() {
  const doneCount = checklist.filter(item => item.done).length;

  const manuscript = JSON.parse(localStorage.getItem("manuscript")) || {
    title: "原稿",
    deadline: "",
    total: 0,
    progress: 0,
    startPage: 3
  };

  manuscript.progress = doneCount;
  localStorage.setItem("manuscript", JSON.stringify(manuscript));
}

function initChecklist() {
  const expectedCount = manuscript.total - manuscript.startPage + 1;

  if (
    checklist.length > 0 &&
    Number.isFinite(expectedCount) &&
    checklist.length === expectedCount
  ) {
    return;
  }

  checklist = [];

  for (let i = manuscript.startPage; i <= manuscript.total; i++) {
    checklist.push({
      page: i,
      draft: false,
      pen: false,
      tone: false,
      done: false,
      memo: ""
    });
  }

  saveChecklist();
}

function renderTiles() {
  const container = document.getElementById("pageTiles");
  if (!container) return;
  container.innerHTML = "";

  checklist.forEach(item => {
    const tile = document.createElement("span");
    tile.textContent = item.page;
    tile.style.cursor = "pointer";

    if (item.done) {
      tile.classList.add("tile-done");
    } else if (item.tone) {
      tile.classList.add("tile-tone");
    } else if (item.pen) {
      tile.classList.add("tile-pen");
    } else if (item.draft) {
      tile.classList.add("tile-draft");
    } else {
      tile.classList.add("tile-empty");
    }

    tile.addEventListener("click", () => {
      const target = document.getElementById(`page-${item.page}`);
      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });

    container.appendChild(tile);
  });
}

function renderChecklist() {
  const container = document.getElementById("checklistTable");
  if (!container) return;
  container.innerHTML = "";

  checklist.forEach((item, index) => {
    const row = document.createElement("div");
    row.id = `page-${item.page}`;

    row.innerHTML = `
      <strong>${item.page}p</strong>
      <label><input type="checkbox" data-index="${index}" data-key="draft" ${item.draft ? "checked" : ""}> 下書き</label>
      <label><input type="checkbox" data-index="${index}" data-key="pen" ${item.pen ? "checked" : ""}> ペン入れ</label>
      <label><input type="checkbox" data-index="${index}" data-key="tone" ${item.tone ? "checked" : ""}> トーン</label>
      <label><input type="checkbox" data-index="${index}" data-key="done" ${item.done ? "checked" : ""}> 完成</label>
      <input type="text" data-index="${index}" value="${item.memo}">
    `;

    container.appendChild(row);
  });

container.querySelectorAll('input[type="checkbox"]').forEach(input => {
  input.addEventListener("change", e => {
    const index = Number(e.target.dataset.index);
    const key = e.target.dataset.key;

    checklist[index][key] = e.target.checked;

    saveChecklist();
    syncProgressToManuscript();
    renderTiles();
  });
});

  container.querySelectorAll('input[type="text"]').forEach(input => {
    input.addEventListener("change", e => {
      const index = Number(e.target.dataset.index);
      checklist[index].memo = e.target.value;
      saveChecklist();
    });
  });
}

initChecklist();
renderTiles();
renderChecklist();

const backToTopBtn = document.getElementById("backToTop");

if (backToTopBtn) {
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}
