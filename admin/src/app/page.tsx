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
  HardDrive,
  Plus,
  Edit,
  Image as ImageIcon,
  Package,
  X,
  Sparkles,
  Tag,
  Globe
} from "lucide-react";

interface CustomAppAsset {
  id: string;
  app_id: string;
  filename: string;
  platform_os: string;
  platform_arch: string;
  package_type: string;
  size_bytes: number;
  sha256: string;
  download_url: string;
  s3_key?: string;
  created_at: string;
}

interface CustomApp {
  id: string;
  name: string;
  tagline: string;
  repo: string;
  color: string;
  version: string;
  notes: string;
  mac_team?: string;
  created_at: string;
  updated_at: string;
  assets: CustomAppAsset[];
  screenshots: string[];
}

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

interface DbStatus {
  connected: boolean;
  engine?: string;
  registered_files_count?: number;
  message?: string;
}

export default function AdminPage() {
  const [authToken, setAuthToken] = useState<string>("");
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState(false);

  const [activeTab, setActiveTab] = useState<"suite" | "custom" | "storage" | "remote" | "minio">("suite");
  const [backendUrl, setBackendUrl] = useState(() => {
    if (typeof window !== "undefined") {
      return process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
    }
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  });
  const [minioConsoleUrl, setMinioConsoleUrl] = useState(() => {
    if (typeof window !== "undefined") {
      return process.env.NEXT_PUBLIC_MINIO_CONSOLE_URL || `${window.location.protocol}//${window.location.hostname}:9001`;
    }
    return process.env.NEXT_PUBLIC_MINIO_CONSOLE_URL || "http://localhost:9001";
  });

  const [s3Status, setS3Status] = useState<S3Status | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [apps, setApps] = useState<AppSyncStatus[]>([]);
  const [customApps, setCustomApps] = useState<CustomApp[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("all");

  // Custom App modal form states
  const [isAppModalOpen, setIsAppModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<CustomApp | null>(null);
  const [appIdInput, setAppIdInput] = useState("");
  const [appNameInput, setAppNameInput] = useState("");
  const [appTaglineInput, setAppTaglineInput] = useState("");
  const [appRepoInput, setAppRepoInput] = useState("");
  const [appColorInput, setAppColorInput] = useState("#6366f1");
  const [appVersionInput, setAppVersionInput] = useState("1.0.0");
  const [appNotesInput, setAppNotesInput] = useState("");
  const [appMacTeamInput, setAppMacTeamInput] = useState("");

  // Asset upload modal states
  const [assetModalApp, setAssetModalApp] = useState<CustomApp | null>(null);
  const [assetOs, setAssetOs] = useState("macos");
  const [assetArch, setAssetArch] = useState("universal");
  const [assetPkg, setAssetPkg] = useState("dmg");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);

  // Screenshot upload modal states
  const [screenshotModalApp, setScreenshotModalApp] = useState<CustomApp | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotName, setScreenshotName] = useState("demo");
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);

  const [remoteUrl, setRemoteUrl] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ filename: string; percent: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");

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

      // 5. PostgreSQL DB status
      const dbRes = await fetch(`${backendUrl}/api/db/status`, { headers: authHeaders() });
      if (dbRes.ok) {
        setDbStatus(await dbRes.json());
      }

      // 6. Custom Apps
      const customAppsRes = await fetch(`${backendUrl}/api/custom-apps`, { headers: authHeaders() });
      if (customAppsRes.ok) {
        setCustomApps(await customAppsRes.json());
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  };

  // WebSocket connection effect
  useEffect(() => {
    if (!authToken) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsStatus("disconnected");
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const connectWs = () => {
      if (isCancelled) return;
      setWsStatus("connecting");

      try {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = backendUrl.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProtocol}//${host}/ws?token=${encodeURIComponent(authToken)}`;

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCancelled) return;
          setWsStatus("connected");
          // Heartbeat ping every 25s
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, 25000);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "init") {
              if (msg.data.tasks) setTasks(msg.data.tasks);
              if (msg.data.s3_enabled !== undefined) {
                setS3Status({
                  enabled: msg.data.s3_enabled,
                  bucket: msg.data.s3_bucket,
                });
              }
              if (msg.data.db_enabled !== undefined) {
                setDbStatus({
                  connected: msg.data.db_enabled,
                  engine: "PostgreSQL 16",
                });
              }
            } else if (msg.type === "task_updated") {
              const updatedTask: DownloadTask = msg.data;
              setTasks((prev) => {
                const idx = prev.findIndex((t) => t.id === updatedTask.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = updatedTask;
                  return next;
                } else {
                  return [updatedTask, ...prev];
                }
              });
              if (updatedTask.status.type === "Finished") {
                fetchData();
              }
            } else if (msg.type === "file_added") {
              showToast(`Новый файл в S3: ${msg.data.filename}`);
              fetchData();
            } else if (msg.type === "file_deleted") {
              setFiles((prev) => prev.filter((f) => f.name !== msg.data.filename));
              showToast(`Файл удален: ${msg.data.filename}`);
              fetchData();
            } else if (msg.type === "sync_queued") {
              showToast(`Поставлено в очередь загрузок: ${msg.data.queued_count} файлов`);
              fetchData();
            } else if (msg.type === "custom_app_updated") {
              showToast(`Приложение обновлено: ${msg.data.name}`);
              fetchData();
            } else if (msg.type === "custom_app_deleted") {
              showToast(`Приложение удалено`);
              fetchData();
            }
          } catch (e) {
            console.error("WS parse error", e);
          }
        };

        ws.onclose = () => {
          if (isCancelled) return;
          setWsStatus("disconnected");
          if (pingInterval) clearInterval(pingInterval);
          reconnectTimer = setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        setWsStatus("disconnected");
        reconnectTimer = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      isCancelled = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [authToken, backendUrl]);

  // Periodic slow refresh as fallback (every 10s)
  useEffect(() => {
    if (authToken) {
      fetchData();
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
    }
  }, [authToken]);

  const sendWs = (payload: any): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const syncApp = async (appId: string, platform: string | null = null) => {
    showToast(`Запуск синхронизации для ${appId}...`);
    if (sendWs({ action: "sync_app", app_id: appId, platform })) {
      return;
    }
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
    if (sendWs({ action: "sync_all" })) {
      setActiveTab("remote");
      return;
    }
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
    if (sendWs({ action: "delete_file", filename: name })) {
      return;
    }
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
    showToast("Запуск скачивания по URL...");
    if (sendWs({ action: "remote_download", url: remoteUrl.trim() })) {
      setRemoteUrl("");
      setActiveTab("remote");
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

  const openCreateAppModal = () => {
    setEditingApp(null);
    setAppIdInput("");
    setAppNameInput("");
    setAppTaglineInput("");
    setAppRepoInput("");
    setAppColorInput("#6366f1");
    setAppVersionInput("1.0.0");
    setAppNotesInput("");
    setAppMacTeamInput("");
    setIsAppModalOpen(true);
  };

  const openEditAppModal = (app: CustomApp) => {
    setEditingApp(app);
    setAppIdInput(app.id);
    setAppNameInput(app.name);
    setAppTaglineInput(app.tagline);
    setAppRepoInput(app.repo);
    setAppColorInput(app.color || "#6366f1");
    setAppVersionInput(app.version || "1.0.0");
    setAppNotesInput(app.notes || "");
    setAppMacTeamInput(app.mac_team || "");
    setIsAppModalOpen(true);
  };

  const handleSaveApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appIdInput.trim() || !appNameInput.trim()) {
      alert("Заполните ID и название приложения");
      return;
    }

    const payload = {
      id: appIdInput.trim().toLowerCase(),
      name: appNameInput.trim(),
      tagline: appTaglineInput.trim(),
      repo: appRepoInput.trim() || `custom/${appIdInput.trim().toLowerCase()}`,
      color: appColorInput,
      version: appVersionInput.trim() || "1.0.0",
      notes: appNotesInput.trim(),
      mac_team: appMacTeamInput.trim() || undefined,
    };

    try {
      const url = editingApp
        ? `${backendUrl}/api/custom-apps/${encodeURIComponent(editingApp.id)}`
        : `${backendUrl}/api/custom-apps`;
      const method = editingApp ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showToast(editingApp ? "Приложение обновлено" : "Приложение создано!");
        setIsAppModalOpen(false);
        fetchData();
      } else {
        const err = await res.json();
        alert("Ошибка: " + (err.error || "Не удалось сохранить"));
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const handleDeleteCustomApp = async (id: string, name: string) => {
    if (!confirm(`Удалить приложение "${name}" и все его пакеты?`)) return;
    if (sendWs({ action: "delete_custom_app", id })) {
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/custom-apps/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        showToast("Приложение удалено");
        fetchData();
      } else {
        alert("Ошибка удаления приложения");
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const handleUploadAssetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetModalApp || !assetFile) {
      alert("Выберите файл пакета");
      return;
    }

    setIsUploadingAsset(true);
    const formData = new FormData();
    formData.append("file", assetFile);
    formData.append("platform_os", assetOs);
    formData.append("platform_arch", assetArch);
    formData.append("package_type", assetPkg);

    try {
      const res = await fetch(`${backendUrl}/api/custom-apps/${assetModalApp.id}/upload-asset`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });

      if (res.ok) {
        showToast(`Пакет "${assetFile.name}" прикреплен к ${assetModalApp.name}!`);
        setAssetModalApp(null);
        setAssetFile(null);
        fetchData();
      } else {
        const err = await res.json();
        alert("Ошибка загрузки пакета: " + (err.error || "Ошибка"));
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const handleDeleteAsset = async (appId: string, assetId: string, filename: string) => {
    if (!confirm(`Удалить пакет "${filename}"?`)) return;
    try {
      const res = await fetch(`${backendUrl}/api/custom-apps/${encodeURIComponent(appId)}/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        showToast("Пакет удален");
        fetchData();
      } else {
        alert("Ошибка удаления пакета");
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    }
  };

  const handleUploadScreenshotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screenshotModalApp || !screenshotFile) {
      alert("Выберите изображение скриншота (.jpg)");
      return;
    }

    setIsUploadingScreenshot(true);
    const formData = new FormData();
    formData.append("file", screenshotFile);
    formData.append("shot_name", screenshotName.trim() || "demo");

    try {
      const res = await fetch(`${backendUrl}/api/custom-apps/${screenshotModalApp.id}/upload-screenshot`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });

      if (res.ok) {
        showToast(`Скриншот загружен для ${screenshotModalApp.name}!`);
        setScreenshotModalApp(null);
        setScreenshotFile(null);
        fetchData();
      } else {
        const err = await res.json();
        alert("Ошибка загрузки скриншота: " + (err.error || "Ошибка"));
      }
    } catch (err) {
      alert("Ошибка сети: " + err);
    } finally {
      setIsUploadingScreenshot(false);
    }
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
          {/* WebSocket Live Status */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition ${
              wsStatus === "connected"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : wsStatus === "connecting"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}
          >
            {wsStatus === "connected" && (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>WebSocket Live</span>
              </>
            )}
            {wsStatus === "connecting" && (
              <>
                <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                <span>WS Подключение...</span>
              </>
            )}
            {wsStatus === "disconnected" && (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>WS Офлайн</span>
              </>
            )}
          </div>

          {/* PostgreSQL Status Pill */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition ${
              dbStatus?.connected
                ? "bg-sky-500/10 text-sky-400 border-sky-500/25"
                : "bg-slate-500/10 text-slate-400 border-slate-500/25"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>{dbStatus?.connected ? "PostgreSQL 16" : "Postgres Offline"}</span>
          </div>

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Хранилище S3</span>
              <Cloud className="w-4 h-4 text-[#ff5722]" />
            </div>
            <div className="text-xl font-bold font-mono text-white truncate">
              {s3Status?.bucket || "artcraft-packages"}
            </div>
            <div className="text-xs text-[#8b92a5] mt-1 truncate">
              MinIO Community
            </div>
          </div>

          <div className="bg-[#12141a] border border-[#232630] rounded-xl p-5">
            <div className="text-xs font-semibold text-[#8b92a5] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>База данных</span>
              <Database className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {dbStatus?.connected ? "PostgreSQL 16" : "Память"}
            </div>
            <div className="text-xs text-[#8b92a5] mt-1 truncate">
              {dbStatus?.connected ? `Записей в БД: ${dbStatus.registered_files_count ?? 0}` : "artcraft"}
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
            <span>Каталог Suite Sync</span>
          </button>
          <button
            onClick={() => setActiveTab("custom")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === "custom"
                ? "border-[#ff5722] text-white"
                : "border-transparent text-[#8b92a5] hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Мои программы ({customApps.length})</span>
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

        {/* TAB: CUSTOM APPS */}
        {activeTab === "custom" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#12141a] border border-[#232630] rounded-xl p-5">
              <div>
                <h3 className="font-semibold text-base text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <span>Кастомные программы (Custom Apps)</span>
                </h3>
                <p className="text-xs text-[#8b92a5] mt-1">
                  Добавляйте свои приложения. Они автоматически транслируются в лаунчер и раздаются из MinIO S3.
                </p>
              </div>

              <button
                onClick={openCreateAppModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#ff5722] hover:bg-[#f4511e] text-white rounded-lg text-xs font-semibold shadow-lg shadow-[#ff5722]/20 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить программу</span>
              </button>
            </div>

            {customApps.length === 0 ? (
              <div className="bg-[#12141a] border border-[#232630] rounded-xl p-12 text-center">
                <Package className="w-12 h-12 text-[#8b92a5] mx-auto mb-3 opacity-60" />
                <h4 className="text-sm font-semibold text-white mb-1">
                  У вас пока нет своих программ
                </h4>
                <p className="text-xs text-[#8b92a5] max-w-md mx-auto mb-5">
                  Создайте свою первую программу: укажите название, версию, цвет, загрузите установочный файл (.dmg / .msi / .AppImage) и скриншоты.
                </p>
                <button
                  onClick={openCreateAppModal}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff5722] hover:bg-[#f4511e] text-white rounded-lg text-xs font-semibold transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить программу</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {customApps.map((app) => (
                  <div
                    key={app.id}
                    className="bg-[#12141a] border border-[#232630] rounded-xl p-6 flex flex-col justify-between hover:border-[#353949] transition shadow-md"
                    style={{ borderTopColor: app.color, borderTopWidth: "3px" }}
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: app.color }}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-base text-white">{app.name}</h4>
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#1b1e26] border border-[#262a36] text-[#a5b4fc]">
                                v{app.version}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#8b92a5] font-mono mt-0.5">
                              ID: {app.id} • {app.repo}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openEditAppModal(app)}
                            className="p-1.5 rounded-lg bg-[#1b1e26] hover:bg-[#252936] text-[#8b92a5] hover:text-white border border-[#262a36] transition"
                            title="Редактировать приложение"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteCustomApp(app.id, app.name)}
                            className="p-1.5 rounded-lg bg-[#1b1e26] hover:bg-rose-500/20 text-[#8b92a5] hover:text-rose-400 border border-[#262a36] hover:border-rose-500/30 transition"
                            title="Удалить приложение"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Tagline */}
                      <p className="text-xs text-[#d1d5db] mb-4 bg-[#0b0c0f] p-3 rounded-lg border border-[#1e212b]">
                        {app.tagline || "Нет описания"}
                      </p>

                      {/* Release notes if present */}
                      {app.notes && (
                        <div className="text-[11px] text-[#8b92a5] mb-4 bg-[#0b0c0f]/60 p-2.5 rounded border border-[#1e212b] line-clamp-2">
                          <span className="text-white font-medium">Заметки: </span> {app.notes}
                        </div>
                      )}

                      {/* Assets Section */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-sky-400" />
                            <span>Установочные пакеты ({app.assets.length})</span>
                          </div>
                          <button
                            onClick={() => {
                              setAssetModalApp(app);
                              setAssetFile(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b1e26] hover:bg-[#252936] text-white border border-[#262a36] text-[11px] font-medium transition"
                          >
                            <Plus className="w-3 h-3 text-[#10b981]" />
                            <span>Загрузить пакет</span>
                          </button>
                        </div>

                        {app.assets.length === 0 ? (
                          <div className="text-center py-4 bg-[#0b0c0f] rounded-lg border border-[#1e212b] text-[11px] text-[#8b92a5]">
                            Нет прикрепленных пакетов. Нажмите «Загрузить пакет».
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {app.assets.map((asset) => (
                              <div
                                key={asset.id}
                                className="flex items-center justify-between bg-[#0b0c0f] px-3 py-2 rounded-lg border border-[#1e212b] text-xs"
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="font-mono text-white text-[11px] truncate flex items-center gap-2">
                                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/15 text-indigo-300 font-sans uppercase">
                                      {asset.platform_os} • {asset.package_type}
                                    </span>
                                    <span className="truncate">{asset.filename}</span>
                                  </div>
                                  <div className="text-[10px] text-[#8b92a5] flex items-center gap-2 mt-0.5">
                                    <span>{formatBytes(asset.size_bytes)}</span>
                                    <span>•</span>
                                    <span className="font-mono truncate max-w-[140px]" title={asset.sha256}>
                                      {asset.sha256 ? `${asset.sha256.substring(0, 12)}...` : "хэш не указан"}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <a
                                    href={asset.download_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 rounded bg-[#1b1e26] hover:bg-[#252936] text-[#ededed] border border-[#262a36] transition"
                                    title="Скачать"
                                  >
                                    <Download className="w-3 h-3 text-[#10b981]" />
                                  </a>
                                  <button
                                    onClick={() => copyToClipboard(asset.sha256)}
                                    className="p-1 rounded bg-[#1b1e26] hover:bg-[#252936] text-[#8b92a5] hover:text-white border border-[#262a36] transition"
                                    title="Скопировать SHA-256"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAsset(app.id, asset.id, asset.filename)}
                                    className="p-1 rounded bg-[#1b1e26] hover:bg-rose-500/20 text-[#8b92a5] hover:text-rose-400 border border-[#262a36] transition"
                                    title="Удалить пакет"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Screenshots Section */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                            <span>Скриншоты ({app.screenshots.length})</span>
                          </div>
                          <button
                            onClick={() => {
                              setScreenshotModalApp(app);
                              setScreenshotFile(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b1e26] hover:bg-[#252936] text-white border border-[#262a36] text-[11px] font-medium transition"
                          >
                            <Plus className="w-3 h-3 text-amber-400" />
                            <span>Загрузить скриншот</span>
                          </button>
                        </div>

                        {app.screenshots.length === 0 ? (
                          <div className="text-center py-3 bg-[#0b0c0f] rounded-lg border border-[#1e212b] text-[11px] text-[#8b92a5]">
                            Нет скриншотов. Нажмите «Загрузить скриншот» (.jpg).
                          </div>
                        ) : (
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {app.screenshots.map((shot) => {
                              const shotKey = shot.replace(/\.jpg$/, "");
                              const imgUrl = `${backendUrl}/screenshots/${app.id}/${shotKey}.jpg`;
                              return (
                                <div
                                  key={shot}
                                  className="relative group rounded-lg overflow-hidden border border-[#262a36] bg-[#0b0c0f] flex-shrink-0 w-32 h-20"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={imgUrl}
                                    alt={shot}
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1 text-[10px] text-white">
                                    <span>{shotKey}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

        {/* MODAL 1: CREATE / EDIT APP */}
        {isAppModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-[#12141a] border border-[#2a2e3d] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-[#232630] pb-3">
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>{editingApp ? "Редактировать приложение" : "Добавить новую программу"}</span>
                </h3>
                <button
                  onClick={() => setIsAppModalOpen(false)}
                  className="p-1 rounded-lg text-[#8b92a5] hover:text-white hover:bg-[#1e212b] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveApp} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">ID приложения (slug)</label>
                    <input
                      type="text"
                      disabled={!!editingApp}
                      value={appIdInput}
                      onChange={(e) => setAppIdInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      placeholder="например: retrocraft"
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none disabled:opacity-50"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Название программы</label>
                    <input
                      type="text"
                      value={appNameInput}
                      onChange={(e) => setAppNameInput(e.target.value)}
                      placeholder="например: RetroCraft"
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Краткое описание (Tagline)</label>
                  <input
                    type="text"
                    value={appTaglineInput}
                    onChange={(e) => setAppTaglineInput(e.target.value)}
                    placeholder="например: Редактор пиксельной графики и тайлов"
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Разработчик / Репозиторий</label>
                    <input
                      type="text"
                      value={appRepoInput}
                      onChange={(e) => setAppRepoInput(e.target.value)}
                      placeholder="например: myteam/retrocraft"
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Текущая версия</label>
                    <input
                      type="text"
                      value={appVersionInput}
                      onChange={(e) => setAppVersionInput(e.target.value)}
                      placeholder="1.0.0"
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Цвет акцента / Бренда</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={appColorInput}
                        onChange={(e) => setAppColorInput(e.target.value)}
                        className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer p-0"
                      />
                      <input
                        type="text"
                        value={appColorInput}
                        onChange={(e) => setAppColorInput(e.target.value)}
                        className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Apple Team ID (macOS, опционально)</label>
                    <input
                      type="text"
                      value={appMacTeamInput}
                      onChange={(e) => setAppMacTeamInput(e.target.value)}
                      placeholder="например: ARTCRAFT или 10-значный ID"
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Заметки о релизе (Release Notes)</label>
                  <textarea
                    rows={3}
                    value={appNotesInput}
                    onChange={(e) => setAppNotesInput(e.target.value)}
                    placeholder="Что нового в этой версии (поддерживает Markdown)..."
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#232630]">
                  <button
                    type="button"
                    onClick={() => setIsAppModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-[#1b1e26] hover:bg-[#252936] text-[#8b92a5] hover:text-white transition font-medium"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-[#ff5722] hover:bg-[#f4511e] text-white font-semibold shadow-lg shadow-[#ff5722]/20 transition"
                  >
                    {editingApp ? "Сохранить изменения" : "Создать приложение"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: UPLOAD PACKAGE ASSET */}
        {assetModalApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-[#12141a] border border-[#2a2e3d] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-[#232630] pb-3">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <Package className="w-4 h-4 text-sky-400" />
                    <span>Загрузить пакет в MinIO S3</span>
                  </h3>
                  <div className="text-xs text-[#8b92a5] mt-0.5">
                    Для приложения: <span className="text-white font-semibold">{assetModalApp.name}</span>
                  </div>
                </div>
                <button
                  onClick={() => setAssetModalApp(null)}
                  className="p-1 rounded-lg text-[#8b92a5] hover:text-white hover:bg-[#1e212b] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUploadAssetSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Файл дистрибутива (.dmg, .msi, .AppImage, .zip)</label>
                  <input
                    type="file"
                    onChange={(e) => setAssetFile(e.target.files?.[0] || null)}
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#ff5722] file:text-white hover:file:bg-[#f4511e] cursor-pointer"
                    required
                  />
                  {assetFile && (
                    <div className="mt-1 text-[11px] text-[#10b981]">
                      Выбран: {assetFile.name} ({formatBytes(assetFile.size)})
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Операционная система</label>
                    <select
                      value={assetOs}
                      onChange={(e) => setAssetOs(e.target.value)}
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none"
                    >
                      <option value="macos">🍎 macOS</option>
                      <option value="windows">🪟 Windows</option>
                      <option value="linux">🐧 Linux</option>
                      <option value="web">🌐 Web</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#8b92a5] font-medium mb-1">Архитектура процессора</label>
                    <select
                      value={assetArch}
                      onChange={(e) => setAssetArch(e.target.value)}
                      className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none"
                    >
                      <option value="universal">Universal (All)</option>
                      <option value="arm64">Apple Silicon / ARM64</option>
                      <option value="x64">Intel / AMD x64</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Тип установочного пакета</label>
                  <select
                    value={assetPkg}
                    onChange={(e) => setAssetPkg(e.target.value)}
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white focus:border-[#ff5722] focus:outline-none"
                  >
                    <option value="dmg">Apple Disk Image (.dmg)</option>
                    <option value="msi">Windows Installer (.msi)</option>
                    <option value="app_image">Linux AppImage (.AppImage)</option>
                    <option value="deb">Debian / Ubuntu Package (.deb)</option>
                    <option value="portable_zip">Portable ZIP (.zip)</option>
                    <option value="zip">Archive ZIP (.zip)</option>
                    <option value="tar_gz">Tarball (.tar.gz)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#232630]">
                  <button
                    type="button"
                    onClick={() => setAssetModalApp(null)}
                    disabled={isUploadingAsset}
                    className="px-4 py-2 rounded-lg bg-[#1b1e26] hover:bg-[#252936] text-[#8b92a5] hover:text-white transition font-medium disabled:opacity-50"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isUploadingAsset || !assetFile}
                    className="px-5 py-2 rounded-lg bg-[#ff5722] hover:bg-[#f4511e] text-white font-semibold shadow-lg shadow-[#ff5722]/20 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUploadingAsset ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Загрузка в S3...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Загрузить пакет</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 3: UPLOAD SCREENSHOT */}
        {screenshotModalApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-[#12141a] border border-[#2a2e3d] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-[#232630] pb-3">
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    <span>Загрузить скриншот программы</span>
                  </h3>
                  <div className="text-xs text-[#8b92a5] mt-0.5">
                    Для: <span className="text-white font-semibold">{screenshotModalApp.name}</span>
                  </div>
                </div>
                <button
                  onClick={() => setScreenshotModalApp(null)}
                  className="p-1 rounded-lg text-[#8b92a5] hover:text-white hover:bg-[#1e212b] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUploadScreenshotSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Изображение скриншота (JPEG / PNG)</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setScreenshotFile(e.target.files?.[0] || null)}
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#ff5722] file:text-white hover:file:bg-[#f4511e] cursor-pointer"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[#8b92a5] font-medium mb-1">Имя ключа скриншота</label>
                  <input
                    type="text"
                    value={screenshotName}
                    onChange={(e) => setScreenshotName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                    placeholder="demo"
                    className="w-full bg-[#0b0c0f] border border-[#262a36] rounded-lg px-3 py-2 text-white font-mono focus:border-[#ff5722] focus:outline-none"
                    required
                  />
                  <div className="text-[10px] text-[#8b92a5] mt-1">
                    Основной скриншот для карточки лаунчера должен иметь ключ: <code className="text-[#a5b4fc]">demo</code>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#232630]">
                  <button
                    type="button"
                    onClick={() => setScreenshotModalApp(null)}
                    disabled={isUploadingScreenshot}
                    className="px-4 py-2 rounded-lg bg-[#1b1e26] hover:bg-[#252936] text-[#8b92a5] hover:text-white transition font-medium disabled:opacity-50"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isUploadingScreenshot || !screenshotFile}
                    className="px-5 py-2 rounded-lg bg-[#ff5722] hover:bg-[#f4511e] text-white font-semibold shadow-lg shadow-[#ff5722]/20 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUploadingScreenshot ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Загрузка...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Загрузить в S3</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
