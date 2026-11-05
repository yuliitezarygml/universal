"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  Server,
  Database,
  Cloud,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  FileBox,
  Key,
  LogOut,
  Folder,
  ArrowUpRight,
  HardDrive
} from "lucide-react";

interface AppAsset {
  name: string;
  size: number;
  sha256: string;
  download_url: string;
  is_cached: boolean;
  local_download_url: string | null;
}

interface AppSyncStatus {
  id: string;
  name: string;
  repo: string;
  description: string;
  color: string;
  latest_tag: string | null;
  published_at: string | null;
  total_assets: number;
  cached_assets: number;
  assets: AppAsset[];
}

interface StoredFile {
  name: string;
  folder: string;
  category: string;
  size: number;
  sha256: string;
  modified: string;
  download_url: string;
}

interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  status: {
    type: "Pending" | "Downloading" | "Finished" | "Failed";
    data?: any;
  };
  created_at: string;
}

interface S3Status {
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  public_url?: string;
  message?: string;
}

export default function AdminPage() {
  const [authToken, setAuthToken] = useState<string>("");
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState(false);

  const [activeTab, setActiveTab] = useState<"suite" | "storage" | "remote" | "minio">("suite");
  const [backendUrl, setBackendUrl] = useState("http://localhost:8080");
  const [minioConsoleUrl, setMinioConsoleUrl] = useState("http://localhost:9001");

  const [s3Status, setS3Status] = useState<S3Status | null>(null);
  const [apps, setApps] = useState<AppSyncStatus[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("all");

  const [remoteUrl, setRemoteUrl] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ filename: string; percent: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    const saved = localStorage.getItem("artcraft_admin_token");
    if (saved) {
      setAuthToken(saved);
    }
    setIsAuthChecking(false);
  }, []);

  const authHeaders = () => ({
    Authorization: `Bearer ${authToken}`,
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(false);
    try {
      const res = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthToken(passwordInput);
        localStorage.setItem("artcraft_admin_token", passwordInput);
      } else {
        setLoginError(true);
      }
    } catch (err) {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("artcraft_admin_token");
    setAuthToken("");
  };

  // Fetch data
  const fetchData = async () => {
    if (!authToken) return;
    try {
      // 1. S3 Status
      const s3Res = await fetch(`${backendUrl}/api/s3/status`, { headers: authHeaders() });
      if (s3Res.ok) {
        setS3Status(await s3Res.json());
      }

      // 2. Apps sync status
      const appsRes = await fetch(`${backendUrl}/api/apps`, { headers: authHeaders() });
      if (appsRes.ok) {
        setApps(await appsRes.json());
      }

      // 3. Stored files
      const filesRes = await fetch(`${backendUrl}/api/files`, { headers: authHeaders() });
      if (filesRes.ok) {
        setFiles(await filesRes.json());
      }

      // 4. Tasks
      const tasksRes = await fetch(`${backendUrl}/api/tasks`, { headers: authHeaders() });
      if (tasksRes.ok) {
        setTasks(await tasksRes.json());
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  };

  useEffect(() => {
    if (authToken) {
      fetchData();
      const interval = setInterval(fetchData, 2500);
      return () => clearInterval(interval);
    }
  }, [authToken]);

  const syncApp = async (appId: string, platform: string | null = null) => {
    showToast(`Запуск синхронизации для ${appId}...`);
    try {
      const res = await fetch(`${backendUrl}/api/apps/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ app_id: appId, platform }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Поставлено в очередь загрузок: ${data.queued_tasks} файлов`);
        fetchData();
      } else {
        alert("Ошибка: " + data.error);
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const syncAllApps = async () => {
    if (!confirm("Скачать последние релизы ВСЕХ 17 приложений в MinIO S3?")) return;
    showToast("Запуск глобальной синхронизации в MinIO...");
    try {
      const res = await fetch(`${backendUrl}/api/apps/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`В очередь загрузок добавлено: ${data.queued_tasks} пакетов`);
        fetchData();
        setActiveTab("remote");
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const deleteFile = async (name: string) => {
    if (!confirm(`Удалить файл "${name}" из S3 хранилища?`)) return;
    try {
      const res = await fetch(`${backendUrl}/api/files/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        showToast("Файл удален");
        fetchData();
      } else {
        alert("Ошибка удаления файла");
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const startRemoteDownload = async () => {
    if (!remoteUrl.trim()) {
      alert("Введите URL файла");
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ url: remoteUrl.trim() }),
      });
      if (res.ok) {
        setRemoteUrl("");
        showToast("Команда принята, скачивание началось в фоне");
        fetchData();
      } else {
        const text = await res.text();
        alert("Ошибка: " + text);
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress({ filename: file.name, percent: 0 });
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${backendUrl}/api/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setUploadProgress({ filename: file.name, percent: pct });
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        showToast(`Файл "${file.name}" загружен в MinIO S3!`);
        setTimeout(() => setUploadProgress(null), 1200);
        fetchData();
      } else {
        alert("Ошибка загрузки: " + xhr.responseText);
        setUploadProgress(null);
      }
    };

    xhr.onerror = () => {
      alert("Сетевая ошибка при загрузке");
      setUploadProgress(null);
    };

    xhr.send(formData);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Скопировано в буфер обмена!");
  };

  if (isAuthChecking) return null;

  if (!authToken) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#13151b] border border-[#232630] rounded-xl p-8 shadow-2xl text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[#ff5722]/15 text-[#ff5722] mb-4">
            <Key className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold mb-2">ArtCraft S3 Hub</h2>
          <p className="text-sm text-[#8b92a5] mb-6">
            Введите пароль администратора для управления зеркалом и MinIO S3
          </p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Пароль администратора (admin123)"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0a0b0e] border border-[#232630] rounded-lg text-sm text-[#ededed] focus:outline-none focus:border-[#ff5722]"
            />
            {loginError && (
              <p className="text-xs text-[#ef4444]">Неверный пароль. Проверьте данные.</p>
            )}
            <button
              type="submit"
              className="w-full py-2.5 bg-[#ff5722] hover:bg-[#ff7043] font-semibold text-white rounded-lg text-sm transition"
            >
              Войти в панель
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totalStorageBytes = files.reduce((acc, f) => acc + f.size, 0);
  const activeTasksCount = tasks.filter(
    (t) => t.status.type === "Downloading" || t.status.type === "Pending"
  ).length;

  const foldersSet = Array.from(new Set(files.map((f) => f.folder).filter(Boolean))).sort();
  const filteredFiles =
    selectedFolder === "all" ? files : files.filter((f) => f.folder === selectedFolder);

  return (
    <div className="flex-1 flex flex-col">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#161820] border border-[#2a2e3d] text-white px-4 py-3 rounded-lg shadow-xl text-sm flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-[#12141a] border-b border-[#232630] px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="bg-[#ff5722] text-white font-extrabold text-xs px-2.5 py-1 rounded tracking-wide">
            ARTCRAFT
          </span>
          <div>
            <div className="font-semibold text-sm leading-tight flex items-center gap-2">
              <span>S3 Distribution & Mirror Hub</span>
              <span className="text-[10px] bg-[#1d2029] text-[#8b92a5] px-1.5 py-0.5 rounded border border-[#262a36]">
                Next.js + MinIO
              </span>
            </div>
            <div className="text-xs text-[#8b92a5]">
              {backendUrl} • {s3Status?.bucket || "artcraft-packages"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* S3 Status Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/25">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
            <span>{s3Status?.enabled ? "MinIO S3 Connected" : "Local Disk Storage"}</span>
          </div>

          {/* MinIO Console Link */}
          <a
            href={minioConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1d2029] hover:bg-[#252936] text-[#ededed] border border-[#262a36] transition"
          >
            <Cloud className="w-3.5 h-3.5 text-[#ff5722]" />
            <span>MinIO Console</span>
            <ArrowUpRight className="w-3 h-3 text-[#8b92a5]" />
          </a>

          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1d2029] hover:bg-[#252936] text-[#8b92a5] hover:text-white border border-[#262a36] transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Выйти</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto p-6 flex-1 flex flex-col gap-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Хранилище MinIO S3</span>
              <Database className="w-4 h-4 text-[#ff5722]" />
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {s3Status?.bucket || "artcraft-packages"}
            </div>
            <div className="text-xs text-[#8b92a5] mt-1 truncate">
              {s3Status?.endpoint || "http://minio:9000"}
            </div>
          </div>

          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Всего файлов в S3</span>
              <FileBox className="w-4 h-4 text-[#3b82f6]" />
            </div>
            <div className="text-2xl font-bold font-mono text-white">{files.length}</div>
            <div className="text-xs text-[#8b92a5] mt-1">пакетов инсталляторов</div>
          </div>

          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Занято места в S3</span>
              <HardDrive className="w-4 h-4 text-[#10b981]" />
            </div>
            <div className="text-2xl font-bold font-mono text-white">
              {formatBytes(totalStorageBytes)}
            </div>
            <div className="text-xs text-[#8b92a5] mt-1">чистый объем дистрибутивов</div>
          </div>

          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Активных закачек</span>
              <Download className="w-4 h-4 text-[#f59e0b]" />
            </div>
            <div className="text-2xl font-bold font-mono text-[#f59e0b]">{activeTasksCount}</div>
            <div className="text-xs text-[#8b92a5] mt-1">фоновые потоки загрузки</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#232630] gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab("suite")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === "suite"
                ? "border-[#ff5722] text-white"
                : "border-transparent text-[#8b92a5] hover:text-white"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Каталог приложений (Suite Sync)</span>
          </button>
          <button
            onClick={() => setActiveTab("storage")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === "storage"
                ? "border-[#ff5722] text-white"
                : "border-transparent text-[#8b92a5] hover:text-white"
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>MinIO S3 Хранилище ({files.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("remote")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === "remote"
                ? "border-[#ff5722] text-white"
                : "border-transparent text-[#8b92a5] hover:text-white"
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Скачать по URL ({tasks.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("minio")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === "minio"
                ? "border-[#ff5722] text-white"
                : "border-transparent text-[#8b92a5] hover:text-white"
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>MinIO & API Настройки</span>
          </button>
        </div>

        {/* TAB 1: SUITE SYNC */}
        {activeTab === "suite" && (
          <div className="space-y-6">
            <div className="bg-[#12141a] border border-[#232630] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-base text-white">
                  Синхронизация Craft App Suite с MinIO S3
                </h3>
                <p className="text-xs text-[#8b92a5] mt-1">
                  Сервер скачивает официальные релизы с GitHub, проверяет SHA-256 хэши и загружает
                  их в бакет MinIO <code className="text-[#ff5722]">artcraft-packages</code>.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={syncAllApps}
                  className="px-4 py-2 bg-[#ff5722] hover:bg-[#ff7043] text-white font-medium text-xs rounded-lg transition flex items-center gap-1.5 shadow"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Синхронизировать ВСЕ 17 приложений</span>
                </button>
                <button
                  onClick={fetchData}
                  className="px-3 py-2 bg-[#1d2029] hover:bg-[#252936] text-[#ededed] border border-[#262a36] font-medium text-xs rounded-lg transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Обновить</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {apps.map((app) => {
                const isFull = app.total_assets > 0 && app.cached_assets === app.total_assets;
                return (
                  <div
                    key={app.id}
                    className="bg-[#12141a] border border-[#232630] hover:border-[#353948] rounded-xl p-5 flex flex-col justify-between transition relative overflow-hidden"
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{ backgroundColor: app.color }}
                    />
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: app.color }}
                          />
                          <h4 className="font-bold text-sm text-white">{app.name}</h4>
                        </div>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#1b1e26] border border-[#262a36] text-[#a5b4fc]">
                          {app.latest_tag || "не опубликован"}
                        </span>
                      </div>
                      <p className="text-xs text-[#8b92a5] mb-4 line-clamp-2">{app.description}</p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs bg-[#0b0c0f] px-3 py-2 rounded-lg border border-[#1e212b]">
                        <span className="text-[#8b92a5]">Статус в S3:</span>
                        {isFull ? (
                          <span className="text-[#10b981] font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Все {app.cached_assets} пакетов в S3
                          </span>
                        ) : (
                          <span className="text-[#f59e0b] font-medium">
                            {app.cached_assets} / {app.total_assets} пакетов
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        <button
                          onClick={() => syncApp(app.id, null)}
                          className="col-span-1 py-1.5 bg-[#ff5722]/15 hover:bg-[#ff5722] text-[#ff5722] hover:text-white border border-[#ff5722]/30 rounded text-[11px] font-medium transition"
                          title="Скачать все платформы"
                        >
                          ⚡ Всё
                        </button>
                        <button
                          onClick={() => syncApp(app.id, "macos")}
                          className="col-span-1 py-1.5 bg-[#1b1e26] hover:bg-[#252936] text-[#ededed] border border-[#262a36] rounded text-[11px] font-medium transition"
                          title="Скачать .dmg для macOS"
                        >
                          🍎 Mac
                        </button>
                        <button
                          onClick={() => syncApp(app.id, "windows")}
                          className="col-span-1 py-1.5 bg-[#1b1e26] hover:bg-[#252936] text-[#ededed] border border-[#262a36] rounded text-[11px] font-medium transition"
                          title="Скачать .msi для Windows"
                        >
                          🪟 Win
                        </button>
                        <button
                          onClick={() => syncApp(app.id, "linux")}
                          className="col-span-1 py-1.5 bg-[#1b1e26] hover:bg-[#252936] text-[#ededed] border border-[#262a36] rounded text-[11px] font-medium transition"
                          title="Скачать .AppImage/.deb для Linux"
                        >
                          🐧 Linux
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: STORAGE & S3 EXPLORER */}
        {activeTab === "storage" && (
          <div className="space-y-6">
            {/* Upload Zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#12141a] border-2 border-dashed border-[#262a36] hover:border-[#ff5722] rounded-xl p-8 text-center cursor-pointer transition"
            >
              <Upload className="w-8 h-8 text-[#8b92a5] mx-auto mb-2" />
              <div className="font-semibold text-sm text-white mb-1">
                Перетащите инсталлятор сюда или нажмите для выбора
              </div>
              <div className="text-xs text-[#8b92a5]">
                Автоматически загрузится в MinIO S3 и распределится по папкам (apps/ или uploads/)
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileUpload}
              />
              {uploadProgress && (
                <div className="mt-4 max-w-sm mx-auto text-left">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate">{uploadProgress.filename}</span>
                    <span>{uploadProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-[#0a0b0e] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#ff5722] h-full transition-all duration-150"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Files List Card */}
            <div className="bg-[#12141a] border border-[#232630] rounded-xl p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-semibold text-base text-white">Пакеты в MinIO S3</h3>
                  <p className="text-xs text-[#8b92a5]">
                    Все проверенные дистрибутивы, готовые к локальной раздаче
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#8b92a5]">Папка:</span>
                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    className="bg-[#0b0c0f] border border-[#232630] text-xs text-[#ededed] px-3 py-1.5 rounded-lg focus:outline-none"
                  >
                    <option value="all">Все папки ({files.length})</option>
                    {foldersSet.map((f) => (
                      <option key={f} value={f}>
                        📁 {f}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={fetchData}
                    className="p-1.5 bg-[#1b1e26] hover:bg-[#252936] text-[#ededed] border border-[#262a36] rounded-lg transition"
                    title="Обновить список"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#232630] text-[#8b92a5] font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Имя файла</th>
                      <th className="py-3 px-4">Папка / Категория</th>
                      <th className="py-3 px-4">Размер</th>
                      <th className="py-3 px-4">SHA-256 Checksum</th>
                      <th className="py-3 px-4">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e212b]">
                    {filteredFiles.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#8b92a5]">
                          Файлы не найдены
                        </td>
                      </tr>
                    ) : (
                      filteredFiles.map((f) => (
                        <tr key={f.name} className="hover:bg-[#161820] transition">
                          <td className="py-3.5 px-4 font-semibold text-white max-w-xs truncate">
                            {f.name}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#ff5722]/10 text-[#ff5722] border border-[#ff5722]/20">
                              <Folder className="w-3 h-3" />
                              <span>{f.folder}</span>
                            </span>
                            <div className="text-[10px] text-[#8b92a5] mt-0.5">{f.category}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono">{formatBytes(f.size)}</td>
                          <td className="py-3.5 px-4 font-mono">
                            <button
                              onClick={() => copyToClipboard(f.sha256)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#0b0c0f] border border-[#232630] text-[#8b92a5] hover:text-white transition"
                              title="Нажмите для копирования SHA-256"
                            >
                              <span>
                                {f.sha256.substring(0, 10)}…{f.sha256.substring(56)}
                              </span>
                              <Copy className="w-3 h-3" />
                            </button>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <a
                                href={f.download_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 bg-[#1d2029] hover:bg-[#252936] text-[#ededed] border border-[#262a36] rounded font-medium transition inline-flex items-center gap-1"
                              >
                                <span>Скачать</span>
                                <ExternalLink className="w-3 h-3 text-[#8b92a5]" />
                              </a>
                              <button
                                onClick={() => deleteFile(f.name)}
                                className="p-1 bg-[#ef4444]/15 hover:bg-[#ef4444] text-[#ef4444] hover:text-white border border-[#ef4444]/30 rounded transition"
                                title="Удалить из S3"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: REMOTE DOWNLOAD / TASKS */}
        {activeTab === "remote" && (
          <div className="space-y-6">
            <div className="bg-[#12141a] border border-[#232630] rounded-xl p-6">
              <h3 className="font-semibold text-base text-white mb-2">
                Дать команду серверу скачать файл по URL
              </h3>
              <p className="text-xs text-[#8b92a5] mb-4">
                Сервер в фоне скачает файл по ссылке, проверит целостность и добавит в MinIO S3
              </p>
              <div className="flex gap-3">
                <input
                  type="url"
                  placeholder="https://github.com/storytold/photocraft/releases/download/v0.20.1/photocraft-0.20.1-macos-universal.dmg"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  className="flex-1 px-4 py-2 bg-[#0b0c0f] border border-[#232630] rounded-lg text-xs text-white focus:outline-none focus:border-[#ff5722]"
                />
                <button
                  onClick={startRemoteDownload}
                  className="px-5 py-2 bg-[#ff5722] hover:bg-[#ff7043] font-medium text-xs text-white rounded-lg transition flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Скачать в MinIO</span>
                </button>
              </div>
            </div>

            {/* Tasks list */}
            <div className="bg-[#12141a] border border-[#232630] rounded-xl p-6">
              <h3 className="font-semibold text-base text-white mb-4">
                Фоновые загрузки ({tasks.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#232630] text-[#8b92a5] uppercase text-[11px]">
                      <th className="py-2.5 px-3">Файл</th>
                      <th className="py-2.5 px-3">Статус</th>
                      <th className="py-2.5 px-3">Прогресс</th>
                      <th className="py-2.5 px-3">Время</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e212b]">
                    {tasks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[#8b92a5]">
                          Нет активных или недавних задач
                        </td>
                      </tr>
                    ) : (
                      tasks.map((t) => {
                        let statusBadge: React.ReactNode = null;
                        let progressContent: React.ReactNode = "-";

                        if (t.status.type === "Downloading") {
                          const pct = t.status.data?.percent?.toFixed(1) || "0";
                          statusBadge = (
                            <span className="text-[#f59e0b] font-medium">Скачивание ({pct}%)</span>
                          );
                          progressContent = (
                            <div className="w-44">
                              <div className="flex justify-between text-[11px] mb-1">
                                <span>{formatBytes(t.status.data?.downloaded || 0)}</span>
                                <span>
                                  {t.status.data?.total ? formatBytes(t.status.data.total) : "?"}
                                </span>
                              </div>
                              <div className="w-full bg-[#0b0c0f] h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="bg-[#f59e0b] h-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        } else if (t.status.type === "Finished") {
                          statusBadge = (
                            <span className="text-[#10b981] font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Завершено
                            </span>
                          );
                          progressContent = formatBytes(t.status.data?.size || 0);
                        } else if (t.status.type === "Failed") {
                          statusBadge = (
                            <span className="text-[#ef4444] font-medium flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Ошибка
                            </span>
                          );
                          progressContent = (
                            <span className="text-[#ef4444] text-[11px]">
                              {t.status.data?.error}
                            </span>
                          );
                        } else {
                          statusBadge = <span className="text-[#8b92a5]">В очереди...</span>;
                        }

                        return (
                          <tr key={t.id} className="hover:bg-[#161820] transition">
                            <td className="py-3 px-3 font-semibold text-white max-w-xs truncate">
                              {t.filename}
                            </td>
                            <td className="py-3 px-3">{statusBadge}</td>
                            <td className="py-3 px-3">{progressContent}</td>
                            <td className="py-3 px-3 text-[#8b92a5] font-mono">{t.created_at}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MINIO & API SETTINGS */}
        {activeTab === "minio" && (
          <div className="space-y-6">
            <div className="bg-[#12141a] border border-[#232630] rounded-xl p-6">
              <h3 className="font-semibold text-base text-white mb-2">
                MinIO Community S3 Конфигурация
              </h3>
              <p className="text-xs text-[#8b92a5] mb-6">
                Параметры подключения объектного хранилища S3 и консоли управления
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-[#0b0c0f] p-4 rounded-lg border border-[#232630]">
                  <div className="text-[#8b92a5] mb-1 font-sans font-semibold">S3 API Endpoint</div>
                  <div className="text-white">{s3Status?.endpoint || "http://localhost:9000"}</div>
                </div>

                <div className="bg-[#0b0c0f] p-4 rounded-lg border border-[#232630]">
                  <div className="text-[#8b92a5] mb-1 font-sans font-semibold">S3 Bucket Name</div>
                  <div className="text-[#ff5722]">{s3Status?.bucket || "artcraft-packages"}</div>
                </div>

                <div className="bg-[#0b0c0f] p-4 rounded-lg border border-[#232630]">
                  <div className="text-[#8b92a5] mb-1 font-sans font-semibold">
                    MinIO Web Console
                  </div>
                  <div className="text-[#3b82f6]">
                    <a href={minioConsoleUrl} target="_blank" rel="noreferrer" className="underline">
                      {minioConsoleUrl}
                    </a>{" "}
                    (login: minioadmin / minioadmin123)
                  </div>
                </div>

                <div className="bg-[#0b0c0f] p-4 rounded-lg border border-[#232630]">
                  <div className="text-[#8b92a5] mb-1 font-sans font-semibold">
                    Launcher Feed URL
                  </div>
                  <div className="text-[#10b981] truncate">
                    {backendUrl}/v1/craft_apps/release_info
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-[#0b0c0f] border border-[#232630] rounded-lg">
                <h4 className="text-xs font-bold text-white mb-2">
                  Как подключить ArtCraft Launcher к вашему зеркалу MinIO:
                </h4>
                <p className="text-xs text-[#8b92a5] mb-3">
                  Запустите лаунчер с переменной окружения вашего сервера:
                </p>
                <pre className="bg-[#161820] p-3 rounded text-[11px] font-mono text-[#a5b4fc] overflow-x-auto">
                  ARTCRAFT_LAUNCHER_DOWNLOAD_BASE={backendUrl}/downloads/ cargo run
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
