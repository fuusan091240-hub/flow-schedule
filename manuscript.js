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
  container.innerHTML = "";

  checklist.forEach(item => {
    const tile = document.createElement("span");
    tile.textContent = item.page;
    tile.style.display = "inline-block";
    tile.style.margin = "4px";
    tile.style.padding = "6px 10px";
    tile.style.border = "1px solid #ccc";
    tile.style.borderRadius = "6px";

    if (item.done) {
      tile.style.background = "#333";
      tile.style.color = "#fff";
    }

    container.appendChild(tile);
  });
}

function renderChecklist() {
  const container = document.getElementById("checklistTable");
  container.innerHTML = "";

  checklist.forEach((item, index) => {
    const row = document.createElement("div");
    row.style.marginBottom = "8px";

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
