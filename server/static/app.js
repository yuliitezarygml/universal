let authToken = localStorage.getItem("artcraft_admin_token") || "";

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 3000);
}

function checkAuth() {
  if (!authToken) {
    document.getElementById("authModal").style.display = "flex";
  } else {
    document.getElementById("authModal").style.display = "none";
    loadDashboard();
  }
}

async function submitLogin() {
  const pwd = document.getElementById("adminPasswordInput").value;
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pwd })
  });
  if (res.ok) {
    authToken = pwd;
    localStorage.setItem("artcraft_admin_token", authToken);
    document.getElementById("authModal").style.display = "none";
    loadDashboard();
  } else {
    document.getElementById("loginError").style.display = "block";
  }
}

function logout() {
  localStorage.removeItem("artcraft_admin_token");
  authToken = "";
  location.reload();
}

function authHeaders() {
  return { "Authorization": "Bearer " + authToken };
}

function switchTab(tab, event) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tabSuite").style.display = tab === 'suite' ? 'block' : 'none';
  document.getElementById("tabStorage").style.display = tab === 'storage' ? 'block' : 'none';
  document.getElementById("tabRemote").style.display = tab === 'remote' ? 'block' : 'none';
  document.getElementById("tabFeed").style.display = tab === 'feed' ? 'block' : 'none';
  if (event && event.target) {
    event.target.classList.add("active");
  }

  if (tab === 'feed') loadFeedPreview();
  if (tab === 'suite') loadApps();
  if (tab === 'storage') loadFiles();
}

async function loadDashboard() {
  loadStatus();
  loadApps();
  loadFiles();
  loadTasks();
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status", { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    document.getElementById("serverSubtitle").innerText = data.base_url + " • " + data.storage_dir;
    document.getElementById("feedUrlDisplay").value = data.base_url + "/v1/craft_apps/release_info";
    document.getElementById("statPort").innerText = data.port;
  } catch (e) {
    console.error(e);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function loadApps() {
  try {
    const res = await fetch("/api/apps", { headers: authHeaders() });
    const apps = await res.json();
    const grid = document.getElementById("appsGrid");

    if (!apps || apps.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">Нет данных о приложениях</div>';
      return;
    }

    grid.innerHTML = apps.map(app => {
      const tag = app.latest_tag || 'Не опубликован';
      const isFull = app.total_assets > 0 && app.cached_assets === app.total_assets;
      const statusBadge = isFull 
        ? `<span class="badge-cached">✓ Все ${app.cached_assets} пакетов в кэше</span>`
        : `<span class="badge-pending">${app.cached_assets} / ${app.total_assets} пакетов скачано</span>`;

      return `
        <div class="app-card" style="border-top: 3px solid ${app.color};">
          <div class="app-card-top">
            <div class="app-title-group">
              <span class="app-color-badge" style="background: ${app.color};"></span>
              <div>
                <div class="app-name">${escapeHtml(app.name)}</div>
                <div class="app-repo">${escapeHtml(app.repo)}</div>
              </div>
            </div>
            <span class="app-tag-badge">${escapeHtml(tag)}</span>
          </div>
          <div class="app-desc">${escapeHtml(app.description)}</div>
          
          <div class="app-cache-info">
            <span>Локальный статус:</span>
            ${statusBadge}
          </div>

          <div class="app-actions">
            <button class="btn-app-action btn-app-sync-all" onclick="syncApp('${app.id}', null)">
              ⚡ Скачать всё
            </button>
            <button class="btn-app-action" onclick="syncApp('${app.id}', 'macos')" title="Скачать .dmg для macOS">
              🍎 macOS
            </button>
            <button class="btn-app-action" onclick="syncApp('${app.id}', 'windows')" title="Скачать .msi для Windows">
              🪟 Windows
            </button>
            <button class="btn-app-action" onclick="syncApp('${app.id}', 'linux')" title="Скачать .AppImage/.deb для Linux">
              🐧 Linux
            </button>
          </div>
        </div>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
  }
}

async function syncApp(appId, platform) {
  showToast(`Запуск синхронизации для ${appId}...`);
  try {
    const res = await fetch("/api/apps/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ app_id: appId, platform: platform })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Поставлено в очередь закачек: ${data.queued_tasks} файлов`);
      loadTasks();
    } else {
      alert("Ошибка: " + data.error);
    }
  } catch (e) {
    alert("Ошибка сети: " + e);
  }
}

async function syncAllApps() {
  if (!confirm("Скачать последние релизы ВСЕХ 17 приложений на сервер? (Это займет время в фоне)")) return;
  showToast("Запуск глобальной синхронизации всех приложений...");
  try {
    const res = await fetch("/api/apps/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ all: true })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`В очередь загрузок добавлено: ${data.queued_tasks} пакетов`);
      loadTasks();
      switchTab('remote');
    }
  } catch (e) {
    alert("Ошибка: " + e);
  }
}

let allStorageFiles = [];

async function loadFiles() {
  try {
    const res = await fetch("/api/files", { headers: authHeaders() });
    allStorageFiles = await res.json();

    let totalBytes = 0;
    const foldersSet = new Set();
    allStorageFiles.forEach(f => {
      totalBytes += f.size;
      if (f.folder) foldersSet.add(f.folder);
    });

    document.getElementById("statFiles").innerText = allStorageFiles.length;
    document.getElementById("statSize").innerText = formatBytes(totalBytes);

    // Update folder dropdown options
    const select = document.getElementById("folderFilter");
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Все папки (Все файлы)</option>';
    Array.from(foldersSet).sort().forEach(folder => {
      const opt = document.createElement("option");
      opt.value = folder;
      opt.innerText = `📁 ${folder}`;
      select.appendChild(opt);
    });
    if (Array.from(foldersSet).includes(currentVal)) {
      select.value = currentVal;
    }

    renderFilteredFiles();
  } catch (e) {
    console.error(e);
  }
}

function renderFilteredFiles() {
  const tbody = document.getElementById("filesTableBody");
  const selectedFolder = document.getElementById("folderFilter").value;

  const filtered = selectedFolder === "all" 
    ? allStorageFiles 
    : allStorageFiles.filter(f => f.folder === selectedFolder);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">В этой папке пока нет файлов.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(f => `
    <tr>
      <td class="file-name">${escapeHtml(f.name)}</td>
      <td>
        <span class="hash-badge" style="color: var(--accent); background: rgba(255, 87, 34, 0.08); border-color: rgba(255, 87, 34, 0.2);">
          📁 ${escapeHtml(f.folder)}
        </span>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">${escapeHtml(f.category)}</div>
      </td>
      <td>${formatBytes(f.size)}</td>
      <td>
        <span class="hash-badge" onclick="copyText('${f.sha256}')" title="Нажмите, чтобы скопировать">
          ${f.sha256.substring(0, 12)}…${f.sha256.substring(56)} 📋
        </span>
      </td>
      <td style="color: var(--text-muted); font-size: 12px;">${f.modified.substring(0, 10)}</td>
      <td>
        <a href="${f.download_url}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px; text-decoration: none;" download>Скачать ↗</a>
        <button class="btn btn-danger" onclick="deleteFile('${escapeHtml(f.name)}')">Удалить</button>
      </td>
    </tr>
  `).join("");
}

async function deleteFile(name) {
  if (!confirm(`Удалить файл "${name}" с сервера?`)) return;
  const res = await fetch(`/api/files/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (res.ok) {
    showToast("Файл удален");
    loadFiles();
    loadApps();
  } else {
    alert("Ошибка удаления файла");
  }
}

async function loadTasks() {
  try {
    const res = await fetch("/api/tasks", { headers: authHeaders() });
    const tasks = await res.json();
    const tbody = document.getElementById("tasksTableBody");

    const activeCount = tasks.filter(t => t.status.type === 'Downloading' || t.status.type === 'Pending').length;
    document.getElementById("statTasks").innerText = activeCount;

    if (tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Нет недавних задач</td></tr>';
      return;
    }

    tbody.innerHTML = tasks.map(t => {
      let statusHtml = '';
      let progressHtml = '-';

      if (t.status.type === 'Pending') {
        statusHtml = '<span style="color: var(--text-muted);">Ожидание...</span>';
      } else if (t.status.type === 'Downloading') {
        const pct = t.status.data.percent.toFixed(1);
        statusHtml = `<span style="color: var(--accent);">Скачивание (${pct}%)</span>`;
        progressHtml = `
          <div>${formatBytes(t.status.data.downloaded)} / ${t.status.data.total ? formatBytes(t.status.data.total) : '?'}</div>
          <div class="progress-bar-wrap"><div class="progress-bar" style="width: ${pct}%"></div></div>
        `;
      } else if (t.status.type === 'Finished') {
        statusHtml = '<span style="color: var(--success);">Готово ✓</span>';
        progressHtml = formatBytes(t.status.data.size);
      } else if (t.status.type === 'Failed') {
        statusHtml = `<span style="color: var(--danger);" title="${escapeHtml(t.status.data.error)}">Ошибка ✕</span>`;
        progressHtml = `<span style="color: var(--danger); font-size: 11px;">${escapeHtml(t.status.data.error)}</span>`;
      }

      return `
        <tr>
          <td class="file-name">${escapeHtml(t.filename)}</td>
          <td>${statusHtml}</td>
          <td style="min-width: 180px;">${progressHtml}</td>
          <td style="color: var(--text-muted); font-size: 12px;">${t.created_at}</td>
        </tr>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
  }
}

async function startRemoteDownload() {
  const url = document.getElementById("remoteUrl").value.trim();
  if (!url) {
    alert("Введите URL файла");
    return;
  }

  const res = await fetch("/api/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ url })
  });

  if (res.ok) {
    document.getElementById("remoteUrl").value = "";
    showToast("Команда принята, скачивание началось в фоне");
    loadTasks();
  } else {
    const err = await res.text();
    alert("Ошибка: " + err);
  }
}

// Drag and Drop Upload
const dropZone = document.getElementById("dropZone");
['dragenter', 'dragover'].forEach(name => {
  dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});
['dragleave', 'drop'].forEach(name => {
  dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });
});
dropZone.addEventListener('drop', (e) => {
  handleFileUpload(e.dataTransfer.files);
});

function handleFileUpload(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  const formData = new FormData();
  formData.append("file", file);

  const progressBox = document.getElementById("uploadProgressBox");
  const progressBar = document.getElementById("uploadProgressBar");
  const fileNameLabel = document.getElementById("uploadFileName");
  const percentLabel = document.getElementById("uploadPercent");

  progressBox.style.display = "block";
  fileNameLabel.innerText = file.name;
  progressBar.style.width = "0%";
  percentLabel.innerText = "0%";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  xhr.setRequestHeader("Authorization", "Bearer " + authToken);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = pct + "%";
      percentLabel.innerText = pct + "%";
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      showToast(`Файл "${file.name}" успешно загружен!`);
      setTimeout(() => { progressBox.style.display = "none"; }, 1500);
      loadFiles();
      loadApps();
    } else {
      alert("Ошибка загрузки: " + xhr.responseText);
      progressBox.style.display = "none";
    }
  };

  xhr.onerror = () => {
    alert("Сетевая ошибка при загрузке");
    progressBox.style.display = "none";
  };

  xhr.send(formData);
}

async function loadFeedPreview() {
  try {
    const res = await fetch("/v1/craft_apps/release_info");
    const json = await res.json();
    document.getElementById("feedPreview").innerText = JSON.stringify(json, null, 2);
  } catch (e) {
    document.getElementById("feedPreview").innerText = "Ошибка загрузки фида: " + e;
  }
}

function copyFeedUrl() {
  copyText(document.getElementById("feedUrlDisplay").value);
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  showToast("Скопировано в буфер обмена!");
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

// Auto poll tasks every 2 seconds
setInterval(loadTasks, 2000);

// Initial check
checkAuth();
