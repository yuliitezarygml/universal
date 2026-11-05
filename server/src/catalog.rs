use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CraftAppMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub repo: &'static str,
    pub description: &'static str,
    pub color: &'static str,
}

pub const SUITE_APPS: &[CraftAppMeta] = &[
    CraftAppMeta {
        id: "photocraft",
        name: "PhotoCraft",
        repo: "storytold/photocraft",
        description: "Редактирование растровых изображений и фото",
        color: "#2f7bf5",
    },
    CraftAppMeta {
        id: "vectorcraft",
        name: "VectorCraft",
        repo: "storytold/vectorcraft",
        description: "Векторная графика и иллюстрации",
        color: "#e8573f",
    },
    CraftAppMeta {
        id: "wordcraft",
        name: "WordCraft",
        repo: "storytold/wordcraft",
        description: "Работа с текстом и документами",
        color: "#3f5fe0",
    },
    CraftAppMeta {
        id: "gridcraft",
        name: "GridCraft",
        repo: "storytold/gridcraft",
        description: "Электронные таблицы и анализ данных",
        color: "#1f9d55",
    },
    CraftAppMeta {
        id: "lightcraft",
        name: "LightCraft",
        repo: "storytold/lightcraft",
        description: "Проявка RAW и цветокоррекция",
        color: "#d97706",
    },
    CraftAppMeta {
        id: "filmcraft",
        name: "FilmCraft",
        repo: "storytold/filmcraft",
        description: "Нелинейный видеомонтаж",
        color: "#8b5cf6",
    },
    CraftAppMeta {
        id: "designcraft",
        name: "DesignCraft",
        repo: "storytold/designcraft",
        description: "Дизайн интерфейсов и прототипирование",
        color: "#ec4899",
    },
    CraftAppMeta {
        id: "pdfcraft",
        name: "PdfCraft",
        repo: "storytold/pdfcraft",
        description: "Чтение, разметка и экспорт PDF",
        color: "#ef4444",
    },
    CraftAppMeta {
        id: "effectcraft",
        name: "EffectCraft",
        repo: "storytold/effectcraft",
        description: "Моушн-дизайн и визуальные спецэффекты",
        color: "#06b6d4",
    },
    CraftAppMeta {
        id: "deckcraft",
        name: "DeckCraft",
        repo: "storytold/deckcraft",
        description: "Интерактивные презентации и слайды",
        color: "#f59e0b",
    },
    CraftAppMeta {
        id: "cadcraft",
        name: "CADCraft",
        repo: "storytold/cadcraft",
        description: "Параметрическое 2D/3D моделирование",
        color: "#3b82f6",
    },
    CraftAppMeta {
        id: "soundcraft",
        name: "SoundCraft",
        repo: "storytold/soundcraft",
        description: "Запись и сведение звука",
        color: "#10b981",
    },
    CraftAppMeta {
        id: "figcraft",
        name: "FigCraft",
        repo: "storytold/figcraft",
        description: "Скетчинг и цифровой рисунок",
        color: "#a855f7",
    },
    CraftAppMeta {
        id: "craft-anything",
        name: "Craft Anything",
        repo: "storytold/craft-anything",
        description: "Генеративные AI-инструменты творчества",
        color: "#6366f1",
    },
    CraftAppMeta {
        id: "texturecraft",
        name: "TextureCraft",
        repo: "storytold/texturecraft",
        description: "PBR-текстурирование и материалы",
        color: "#14b8a6",
    },
    CraftAppMeta {
        id: "materialcraft",
        name: "MaterialCraft",
        repo: "storytold/materialcraft",
        description: "Шейдеры и библиотека материалов",
        color: "#f97316",
    },
    CraftAppMeta {
        id: "solidcraft",
        name: "SolidCraft",
        repo: "tangency-labs/solidcraft",
        description: "Твердотельное инженерное моделирование (Community)",
        color: "#64748b",
    },
    CraftAppMeta {
        id: "craft-launcher",
        name: "ArtCraft Launcher",
        repo: "storytold/craft-launcher",
        description: "Сам лаунчер приложений (Self-update)",
        color: "#ff5722",
    },
];

#[allow(dead_code)]
pub fn find_app(id: &str) -> Option<&'static CraftAppMeta> {
    SUITE_APPS.iter().find(|a| a.id == id)
}
