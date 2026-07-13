/* eslint-disable @next/next/no-img-element -- user-selected object URLs and private R2 images should not pass through a public optimizer */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AvatarOutfit, BodyMetrics } from "./Avatar3D";
import { DeferredAddGarmentDialog } from "./DeferredAddGarmentDialog";
import { DeferredAvatar } from "./DeferredAvatar";
import {
  CLIENT_IMAGE_TYPES,
  CLOSET_CATEGORIES,
  MAX_CLIENT_IMAGE_BYTES,
} from "../lib/garment-form-options";
import { rankOutfitSelections } from "../lib/outfit-ranking.mjs";
import {
  createSerialLatestQueue,
  createSerialTaskQueue,
} from "../lib/serial-latest-queue.mjs";
import { useDialogAccessibility } from "../lib/use-dialog-accessibility";
import {
  crossTabSnapshotAction,
  deviceGenerationAction,
  deviceSnapshotContentsMatch,
  guardKnownDeviceSnapshotWrite,
  hasUnsupportedDeviceSnapshotVersion,
  parseDeviceSnapshot,
  preservePersistedPhotos,
  readDeviceSnapshotEnvelope,
  resolveHydratedProfile,
  resolveSnapshotProfileChoice,
  restoreItemsInStoredOrder,
  serializeDeviceSnapshot,
} from "../lib/device-storage.mjs";
import {
  avatarOutfitFromSelection,
  createVirtualWardrobeItem,
  supportsAvatarTryOn,
  wearWardrobeItem,
} from "../lib/try-on-state.mjs";
import {
  clearMutationAction,
  clearMarkerHydrationAction,
  clearMarkerStorageKey,
  clearMarkerWriteAction,
  compareClearSignals,
  coordinationScope,
  createClearSignal,
  guardedSnapshotWrite,
  newestClearSignal,
  parseClearMarker,
  serializeCompletedClearMarker,
  serializeClearMarker,
  serializeFailedClearMarker,
  snapshotMatchesClearSignal,
} from "../lib/storage-coordination.mjs";
import {
  hasPendingWardrobeItems,
  removeWardrobeIdentity,
  replaceSyncedWardrobeItem,
} from "../lib/wardrobe-sync.mjs";
import { isClientWardrobeId, wardrobeCloudId } from "../lib/wardrobe-id.mjs";
import {
  BODY_PRESETS,
  PRODUCTS,
  SAMPLE_WARDROBE,
  type ClosetCategory,
  type Product,
  type ShopCategory,
  type WardrobeItem,
} from "../lib/muse-data";

type View = "home" | "shop" | "closet" | "studio" | "daily";
type OutfitSelection = {
  topId?: string;
  bottomId?: string;
  dressId?: string;
  outerwearId?: string;
};
type DailyPreferences = {
  weather: string;
  occasion: string;
  feeling: string;
  comfort: string;
};

const LOCAL_SNAPSHOT_KEY = "songsong-closet:device-state:v1";
const CLEAR_BOUNDARY_LOCK_NAME = "songsong-closet:clear-boundary:v2";

type LocalSnapshot = {
  version?: 1 | 2;
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  outfit?: OutfitSelection;
  mood?: number;
  cartProductIds?: string[];
  savedProductIds?: string[];
  cloudItemIds?: string[];
  cloudGeneration?: string;
  deletedWardrobeClientIds?: string[];
  dailyPreferences?: DailyPreferences;
  profilePending?: boolean;
  profileRevision?: number;
  clearSignal?: string;
  updatedAt?: string;
};

type DeviceSaveResult = "complete" | "metadata-only" | "unchanged" | "failed";
type GuardedDeviceSaveResult = DeviceSaveResult | "superseded" | "incompatible";
type DataMode = "连接中" | "云端已同步" | "部分已同步" | "等待选择" | "正在本机保存" | "本机已保存" | "仅本次有效";
type PendingCloudMutation = {
  promise: Promise<Response>;
  controller: AbortController;
};
type ProfileSaveJob = {
  metrics: BodyMetrics;
  editGeneration: number;
  requestEpoch: number;
};
type ProfileSaveQueue = {
  enqueue: (job: ProfileSaveJob) => Promise<void>;
  clear: () => void;
  readonly running: boolean;
  readonly pending: boolean;
};

const NAV_ITEMS: { id: View; label: string; short: string; icon: string }[] = [
  { id: "home", label: "今天", short: "今天", icon: "⌂" },
  { id: "shop", label: "松松逛", short: "逛逛", icon: "⌁" },
  { id: "closet", label: "我的衣橱", short: "衣橱", icon: "◇" },
  { id: "studio", label: "试穿间", short: "试穿", icon: "◎" },
  { id: "daily", label: "今日搭配", short: "搭配", icon: "✦" },
];

const DEFAULT_METRICS: BodyMetrics = {
  height: 165,
  weight: 58,
  shoulder: 40,
  chest: 90,
  waist: 74,
  hips: 96,
  torso: 50,
  legs: 82,
  skinTone: "#d7a883",
  bodyShape: "hourglass",
};

function clearedPersonalSnapshot(
  cloudGeneration: string,
): Omit<LocalSnapshot, "version" | "updatedAt"> {
  return {
    wardrobe: [],
    metrics: DEFAULT_METRICS,
    outfit: {},
    mood: 62,
    cartProductIds: [],
    savedProductIds: [],
    cloudItemIds: [],
    cloudGeneration,
    deletedWardrobeClientIds: [],
    dailyPreferences: DEFAULT_DAILY_PREFERENCES,
    profilePending: false,
    profileRevision: 0,
  };
}

const INITIAL_OUTFIT: OutfitSelection = {
  topId: "w-cream-tee",
  bottomId: "w-green-pants",
  outerwearId: "w-oat-coat",
};

const DAILY_OPTIONS = {
  weather: ["炎热", "温和", "偏凉", "下雨"],
  occasion: ["通勤", "上课", "约会", "运动", "宅家"],
  feeling: ["轻松", "利落", "温柔", "有点亮眼"],
  comfort: ["方便走动", "宽松", "不露肤", "保暖"],
} as const;

const DEFAULT_DAILY_PREFERENCES: DailyPreferences = {
  weather: "温和",
  occasion: "通勤",
  feeling: "轻松",
  comfort: "方便走动",
};

const SHOP_CATEGORIES: ("全部" | ShopCategory)[] = [
  "全部",
  "上装",
  "下装",
  "连衣裙",
  "外套",
  "鞋履",
  "美妆",
  "装饰",
];

const STUDIO_CATEGORIES: ("全部" | "上装" | "下装" | "连衣裙" | "外套")[] = [
  "全部",
  "上装",
  "下装",
  "连衣裙",
  "外套",
];

const MAX_WARDROBE_ITEMS = 200;
const CLOUD_MUTATION_TIMEOUT_MS = 9_000;
const CLOUD_UPLOAD_TIMEOUT_MS = 60_000;
const DATA_GENERATION_HEADER = "x-songsong-data-generation";
const CLEAR_REQUEST_HEADER = "x-songsong-clear-request";
const SKIN_TONES = [
  ["#f2d4bd", "浅暖色"],
  ["#dfb08d", "暖米色"],
  ["#c98e68", "蜜糖色"],
  ["#9d654a", "深暖色"],
  ["#684235", "深棕色"],
] as const;

function ProductVisual({ visual, color }: { visual: string; color: string }) {
  return (
    <div className={`product-visual product-visual--${visual}`} style={{ "--item-color": color } as React.CSSProperties}>
      <span className="visual-shape" aria-hidden="true" />
      <span className="visual-shadow" aria-hidden="true" />
    </div>
  );
}

function MiniGarment({ item }: { item: Pick<WardrobeItem, "category" | "color"> }) {
  const visual =
    item.category === "下装"
      ? "pants"
      : item.category === "连衣裙"
        ? "dress"
        : item.category === "外套"
          ? "coat"
          : item.category === "鞋履"
            ? "shoes"
            : item.category === "配饰"
              ? "bag"
              : "shirt";
  return <ProductVisual visual={visual} color={item.color} />;
}

function todayLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

function usesDeviceOnlyStorage() {
  return (
    window.location.hostname.endsWith(".github.io") ||
    document.documentElement.dataset.storageMode === "device"
  );
}

function localSnapshotKey(storageOwner?: string) {
  return storageOwner
    ? `${LOCAL_SNAPSHOT_KEY}:owner:${encodeURIComponent(storageOwner.trim().toLowerCase())}`
    : LOCAL_SNAPSHOT_KEY;
}

function productsForIds(ids: string[] = []) {
  return restoreItemsInStoredOrder(ids, PRODUCTS) as Product[];
}

function mergeWardrobe(...collections: WardrobeItem[][]) {
  const seen = new Set<string>();
  return collections.flat().filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeDailyPreferences(value: unknown): DailyPreferences | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DailyPreferences>;
  return {
    weather: DAILY_OPTIONS.weather.includes(candidate.weather as (typeof DAILY_OPTIONS.weather)[number])
      ? candidate.weather!
      : DEFAULT_DAILY_PREFERENCES.weather,
    occasion: DAILY_OPTIONS.occasion.includes(candidate.occasion as (typeof DAILY_OPTIONS.occasion)[number])
      ? candidate.occasion!
      : DEFAULT_DAILY_PREFERENCES.occasion,
    feeling: DAILY_OPTIONS.feeling.includes(candidate.feeling as (typeof DAILY_OPTIONS.feeling)[number])
      ? candidate.feeling!
      : DEFAULT_DAILY_PREFERENCES.feeling,
    comfort: DAILY_OPTIONS.comfort.includes(candidate.comfort as (typeof DAILY_OPTIONS.comfort)[number])
      ? candidate.comfort!
      : DEFAULT_DAILY_PREFERENCES.comfort,
  };
}

function readActiveClearSignal(storageKey: string) {
  return readActiveClearMarker(storageKey)?.signal ?? null;
}

function readActiveClearMarker(storageKey: string) {
  try {
    return parseClearMarker(
      window.localStorage.getItem(clearMarkerStorageKey(storageKey)),
    );
  } catch {
    return null;
  }
}

function parseLocalSnapshot(
  raw: string | null,
  activeClearSignal: string | null,
): LocalSnapshot | null {
  try {
    if (!raw) return null;
    const parsed = parseDeviceSnapshot(raw) as Partial<LocalSnapshot> | null;
    if (!parsed) return null;
    if (!snapshotMatchesClearSignal(parsed.clearSignal, activeClearSignal)) return null;
    if (!Array.isArray(parsed.wardrobe) || !parsed.metrics || typeof parsed.metrics !== "object") {
      return null;
    }
    const wardrobe = mergeWardrobe(
      parsed.wardrobe.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.category === "string" &&
          typeof item.color === "string",
      ).map((item) => ({
        ...item,
        clientId: item.clientId && isClientWardrobeId(item.clientId)
          ? item.clientId
          : undefined,
        imageUrl: item.imageUrl?.startsWith("blob:") ? undefined : item.imageUrl,
      })),
    );
    const mood = typeof parsed.mood === "number"
      ? Math.min(100, Math.max(0, parsed.mood))
      : undefined;
    return {
      version: parsed.version === 2 ? 2 : 1,
      wardrobe,
      metrics: { ...DEFAULT_METRICS, ...parsed.metrics },
      outfit: parsed.outfit && typeof parsed.outfit === "object" ? parsed.outfit : undefined,
      mood,
      cartProductIds: Array.isArray(parsed.cartProductIds)
        ? parsed.cartProductIds.filter((id): id is string => typeof id === "string")
        : undefined,
      savedProductIds: Array.isArray(parsed.savedProductIds)
        ? parsed.savedProductIds.filter((id): id is string => typeof id === "string")
        : undefined,
      cloudItemIds: Array.isArray(parsed.cloudItemIds)
        ? parsed.cloudItemIds.filter((id): id is string => typeof id === "string")
        : undefined,
      cloudGeneration: typeof parsed.cloudGeneration === "string"
        ? parsed.cloudGeneration
        : undefined,
      deletedWardrobeClientIds: Array.isArray(parsed.deletedWardrobeClientIds)
        ? parsed.deletedWardrobeClientIds.filter(
            (id): id is string => typeof id === "string" && isClientWardrobeId(id),
          )
        : undefined,
      dailyPreferences: normalizeDailyPreferences(parsed.dailyPreferences),
      profilePending: typeof parsed.profilePending === "boolean"
        ? parsed.profilePending
        : undefined,
      profileRevision:
        typeof parsed.profileRevision === "number" &&
        Number.isSafeInteger(parsed.profileRevision) &&
        parsed.profileRevision >= 0
          ? parsed.profileRevision
          : undefined,
      clearSignal: parsed.clearSignal,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function readLocalSnapshot(storageKey: string, activeClearSignal: string | null) {
  try {
    return parseLocalSnapshot(
      window.localStorage.getItem(storageKey),
      activeClearSignal,
    );
  } catch {
    return null;
  }
}

function writeLocalSnapshot(
  storageKey: string,
  {
    wardrobe,
    metrics,
    outfit,
    mood,
    cartProductIds,
    savedProductIds,
    cloudItemIds,
    cloudGeneration,
    deletedWardrobeClientIds,
    dailyPreferences,
    profilePending,
    profileRevision,
  }: Omit<LocalSnapshot, "version" | "updatedAt">,
  clearSignal: string | null,
  allowIncompatibleOverwrite = false,
  expectedRaw?: string | null,
): DeviceSaveResult | "superseded" | "incompatible" {
  const updatedAt = new Date().toISOString();
  const serialize = (snapshotWardrobe: WardrobeItem[]) =>
    serializeDeviceSnapshot(
      {
        wardrobe: snapshotWardrobe,
        metrics,
        outfit,
        mood,
        cartProductIds,
        savedProductIds,
        cloudItemIds,
        cloudGeneration,
        deletedWardrobeClientIds,
        dailyPreferences,
        profilePending,
        profileRevision,
      },
      clearSignal,
      updatedAt,
    );
  try {
    if (allowIncompatibleOverwrite) {
      if (
        expectedRaw !== undefined &&
        window.localStorage.getItem(storageKey) !== expectedRaw
      ) return "superseded";
      window.localStorage.setItem(storageKey, serialize(wardrobe));
      return "complete";
    }
    const guardedResult = guardKnownDeviceSnapshotWrite(
      () => window.localStorage.getItem(storageKey),
      () => {
        const nextRaw = serialize(wardrobe);
        const currentRaw = window.localStorage.getItem(storageKey);
        if (
          expectedRaw !== undefined &&
          currentRaw !== expectedRaw &&
          !deviceSnapshotContentsMatch(expectedRaw, currentRaw ?? "")
        ) return "superseded" as const;
        if (deviceSnapshotContentsMatch(currentRaw, nextRaw)) return "unchanged" as const;
        window.localStorage.setItem(storageKey, nextRaw);
        return "complete" as const;
      },
    );
    return guardedResult === "unavailable" ? "failed" : guardedResult;
  } catch {
    let previousRaw: string | null = null;
    try {
      previousRaw = window.localStorage.getItem(storageKey);
    } catch {
      // Storage can be write-limited and read-limited independently.
    }
    const safeFallback = preservePersistedPhotos(wardrobe, previousRaw);
    try {
      if (allowIncompatibleOverwrite) {
        if (
          expectedRaw !== undefined &&
          window.localStorage.getItem(storageKey) !== expectedRaw
        ) return "superseded";
        window.localStorage.setItem(storageKey, serialize(safeFallback));
        return "metadata-only";
      }
      const guardedResult = guardKnownDeviceSnapshotWrite(
        () => window.localStorage.getItem(storageKey),
        () => {
          const nextRaw = serialize(safeFallback);
          const currentRaw = window.localStorage.getItem(storageKey);
          if (
            expectedRaw !== undefined &&
            currentRaw !== expectedRaw &&
            !deviceSnapshotContentsMatch(expectedRaw, currentRaw ?? "")
          ) return "superseded" as const;
          if (deviceSnapshotContentsMatch(currentRaw, nextRaw)) return "unchanged" as const;
          window.localStorage.setItem(storageKey, nextRaw);
          return "metadata-only" as const;
        },
      );
      return guardedResult === "unavailable" ? "failed" : guardedResult;
    } catch {
      // Leave the previous snapshot untouched instead of deleting already-saved photos.
      return "failed";
    }
  }
}

function removeLocalSnapshot(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
    return window.localStorage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

function persistClearMarker(storageKey: string, marker: string) {
  try {
    const markerKey = clearMarkerStorageKey(storageKey);
    const nextMarker = parseClearMarker(marker);
    const currentMarker = parseClearMarker(window.localStorage.getItem(markerKey));
    if (clearMarkerWriteAction(currentMarker, nextMarker) !== "write") return false;
    window.localStorage.setItem(markerKey, marker);
    return window.localStorage.getItem(markerKey) === marker;
  } catch {
    return false;
  }
}

function isClearedLocalSnapshot(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return true;
    const parsed = parseDeviceSnapshot(raw) as Partial<LocalSnapshot> | null;
    if (!parsed) return false;
    const metrics = parsed.metrics as Partial<BodyMetrics> | undefined;
    const outfit = parsed.outfit ?? {};
    const dailyPreferences = normalizeDailyPreferences(parsed.dailyPreferences);
    return (
      Array.isArray(parsed.wardrobe) &&
      parsed.wardrobe.length === 0 &&
      Boolean(metrics) &&
      Object.entries(DEFAULT_METRICS).every(
        ([key, value]) => metrics?.[key as keyof BodyMetrics] === value,
      ) &&
      Object.values(outfit).every((value) => !value) &&
      parsed.mood === 62 &&
      Array.isArray(parsed.cartProductIds) &&
      parsed.cartProductIds.length === 0 &&
      Array.isArray(parsed.savedProductIds) &&
      parsed.savedProductIds.length === 0 &&
      Array.isArray(parsed.cloudItemIds) &&
      parsed.cloudItemIds.length === 0 &&
      Array.isArray(parsed.deletedWardrobeClientIds) &&
      parsed.deletedWardrobeClientIds.length === 0 &&
      Boolean(dailyPreferences) &&
      Object.entries(DEFAULT_DAILY_PREFERENCES).every(
        ([key, value]) => dailyPreferences?.[key as keyof DailyPreferences] === value,
      ) &&
      parsed.profilePending !== true
    );
  } catch {
    return false;
  }
}

async function photoToDeviceImage(file?: File) {
  if (!file) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const maxEdge = 900;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.76);
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
}

function wardrobeItemForm(item: WardrobeItem, photo?: File) {
  const form = new FormData();
  const fields: Array<keyof WardrobeItem> = [
    "id",
    "name",
    "category",
    "color",
    "colorName",
    "size",
    "sourceUrl",
    "season",
    "style",
    "chest",
    "waist",
    "hips",
    "length",
    "confidence",
  ];
  for (const field of fields) {
    const value = field === "id" ? (item.clientId ?? item.id) : item[field];
    if (value !== undefined && value !== null) form.append(field, String(value));
  }
  if (photo) form.append("photo", photo);
  return form;
}

async function devicePhotoFile(item: WardrobeItem) {
  if (!item.imageUrl?.startsWith("data:")) return undefined;
  try {
    const response = await fetch(item.imageUrl);
    const blob = await response.blob();
    if (!CLIENT_IMAGE_TYPES.has(blob.type.toLowerCase()) || blob.size > MAX_CLIENT_IMAGE_BYTES) {
      return undefined;
    }
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `wardrobe-${item.id}.${extension}`, { type: blob.type });
  } catch {
    return undefined;
  }
}

export function MuseApp({ storageOwner }: { storageOwner?: string } = {}) {
  const storageKey = useMemo(() => localSnapshotKey(storageOwner), [storageOwner]);
  const clearMarkerKey = useMemo(() => clearMarkerStorageKey(storageKey), [storageKey]);
  const clearScope = useMemo(() => coordinationScope(storageKey), [storageKey]);
  const [view, setView] = useState<View>("home");
  const [metrics, setMetrics] = useState<BodyMetrics>(DEFAULT_METRICS);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>(SAMPLE_WARDROBE);
  const [outfit, setOutfit] = useState<OutfitSelection>(INITIAL_OUTFIT);
  const [cart, setCart] = useState<Product[]>([]);
  const [savedProductIds, setSavedProductIds] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mood, setMood] = useState(62);
  const [dailyPreferences, setDailyPreferences] = useState<DailyPreferences>(DEFAULT_DAILY_PREFERENCES);
  const [dataMode, setDataMode] = useState<DataMode>("连接中");
  const [ready, setReady] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [externalUpdateAvailable, setExternalUpdateAvailable] = useState(false);
  const [wardrobeSyncAttempt, setWardrobeSyncAttempt] = useState(0);
  const hydrated = useRef(false);
  const storageWarningShown = useRef(false);
  const storageFailureShown = useRef(false);
  const incompatibleSnapshotWarningShown = useRef(false);
  const incompatibleSnapshot = useRef(false);
  const externalSnapshotRaw = useRef<string | null>(null);
  const lastKnownSnapshotRaw = useRef<string | null>(null);
  const localChangeGeneration = useRef(0);
  const persistedLocalChangeGeneration = useRef(0);
  const unlockedDeviceWritePending = useRef(false);
  const deviceCoordinationGeneration = useRef(0);
  const deviceWriteQueue = useRef<ReturnType<typeof createSerialTaskQueue> | null>(null);
  if (!deviceWriteQueue.current) deviceWriteQueue.current = createSerialTaskQueue();
  const clearBoundaryQueue = useRef<ReturnType<typeof createSerialTaskQueue> | null>(null);
  if (!clearBoundaryQueue.current) clearBoundaryQueue.current = createSerialTaskQueue();
  const runClearBoundaryTask = useCallback(
    <T,>(task: () => T) => clearBoundaryQueue.current!.enqueue(async () => {
      if (typeof navigator.locks?.request === "function") {
        return navigator.locks.request(
          CLEAR_BOUNDARY_LOCK_NAME,
          { mode: "exclusive" },
          task,
        );
      }
      return task();
    }),
    [],
  );
  const mainRef = useRef<HTMLElement>(null);
  const externalUpdateRef = useRef<HTMLElement>(null);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const previousView = useRef<View>(view);
  const cloudItemIds = useRef(new Set<string>());
  const cartProductIds = useRef(new Set<string>());
  const mutationEpoch = useRef(0);
  const pendingCloudMutations = useRef(new Set<PendingCloudMutation>());
  const clearChannel = useRef<BroadcastChannel | null>(null);
  const observedClearSignal = useRef<string | null>(null);
  const lastAppliedClearSignal = useRef<string | null>(null);
  const lastCompletedClearSignal = useRef<string | null>(null);
  const pendingWardrobeSyncIds = useRef(new Set<string>());
  const pendingWardrobeDeletionIds = useRef(new Set<string>());
  const wardrobeCloudReady = useRef(false);
  const profileCloudReady = useRef(false);
  const profilePending = useRef(false);
  const profileRevision = useRef(0);
  const profileEditGeneration = useRef(0);
  const profileSaveQueue = useRef<ProfileSaveQueue | null>(null);
  const cloudGeneration = useRef("initial");
  const deletedWardrobeClientIds = useRef(new Set<string>());
  const latestSnapshot = useRef<Omit<LocalSnapshot, "version" | "updatedAt">>({
    wardrobe,
    metrics,
    outfit,
    mood,
    cartProductIds: [],
    savedProductIds: [],
    cloudItemIds: [],
    cloudGeneration: "initial",
    deletedWardrobeClientIds: [],
    dailyPreferences,
    profilePending: false,
    profileRevision: 0,
  });
  latestSnapshot.current = {
    wardrobe,
    metrics,
    outfit,
    mood,
    cartProductIds: cart.map((product) => product.id),
    savedProductIds,
    cloudItemIds: [...cloudItemIds.current],
    cloudGeneration: cloudGeneration.current,
    deletedWardrobeClientIds: [...deletedWardrobeClientIds.current],
    dailyPreferences,
    profilePending: profilePending.current,
    profileRevision: profileRevision.current,
  };
  cartProductIds.current = new Set(cart.map((product) => product.id));

  function fetchCloudMutation(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs = CLOUD_MUTATION_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers);
    if (!headers.has(DATA_GENERATION_HEADER)) {
      headers.set(DATA_GENERATION_HEADER, cloudGeneration.current);
    }
    const promise = fetch(input, { ...init, headers, signal: controller.signal });
    const mutation = { promise, controller };
    pendingCloudMutations.current.add(mutation);
    void promise.then(
      () => {
        window.clearTimeout(timeout);
        pendingCloudMutations.current.delete(mutation);
      },
      () => {
        window.clearTimeout(timeout);
        pendingCloudMutations.current.delete(mutation);
      },
    );
    return promise;
  }

  function emptyPersonalSnapshot(): Omit<LocalSnapshot, "version" | "updatedAt"> {
    return clearedPersonalSnapshot(cloudGeneration.current);
  }

  const profileNeedsSync = useCallback(function profileNeedsSync() {
    return (
      profilePending.current ||
      !profileCloudReady.current ||
      incompatibleSnapshot.current
    );
  }, []);

  const writeCurrentLocalSnapshot = useCallback(function writeCurrentLocalSnapshot(
    snapshot = latestSnapshot.current,
  ): GuardedDeviceSaveResult {
    if (externalSnapshotRaw.current) return "superseded";
    if (incompatibleSnapshot.current) return "incompatible";
    try {
      const currentRaw = window.localStorage.getItem(storageKey);
      if (
        currentRaw !== lastKnownSnapshotRaw.current &&
        !deviceSnapshotContentsMatch(lastKnownSnapshotRaw.current, currentRaw ?? "")
      ) {
        const action = crossTabSnapshotAction({
          eventRaw: currentRaw,
          currentRaw,
          hasLocalWork: true,
        });
        if (action === "incompatible") {
          incompatibleSnapshot.current = true;
          lastKnownSnapshotRaw.current = currentRaw;
          setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
          if (!incompatibleSnapshotWarningShown.current) {
            incompatibleSnapshotWarningShown.current = true;
            setToast("另一标签页使用了更新版本；当前页面不会覆盖它保存的资料");
          }
          return "incompatible";
        }
        if (action === "prompt" || action === "apply") {
          externalSnapshotRaw.current = currentRaw;
          setExternalUpdateAvailable(true);
          setDataMode("等待选择");
          return "superseded";
        }
      } else if (currentRaw !== lastKnownSnapshotRaw.current) {
        lastKnownSnapshotRaw.current = currentRaw;
      }
    } catch {
      // The guarded write below still fails closed if storage cannot be read.
    }
    const activeSignal = readActiveClearSignal(storageKey);
    const result = guardedSnapshotWrite(
      observedClearSignal.current,
      activeSignal,
      () => writeLocalSnapshot(
        storageKey,
        snapshot,
        activeSignal,
        false,
        lastKnownSnapshotRaw.current,
      ),
    );
    if (result === "incompatible") incompatibleSnapshot.current = true;
    if (
      result === "superseded" &&
      readActiveClearSignal(storageKey) === observedClearSignal.current
    ) {
      try {
        const currentRaw = window.localStorage.getItem(storageKey);
        const action = crossTabSnapshotAction({
          eventRaw: currentRaw,
          currentRaw,
          hasLocalWork: true,
        });
        if (action === "incompatible") {
          incompatibleSnapshot.current = true;
          lastKnownSnapshotRaw.current = currentRaw;
          setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
        } else if (action === "prompt" || action === "apply") {
          externalSnapshotRaw.current = currentRaw;
          setExternalUpdateAvailable(true);
          setDataMode("等待选择");
        }
      } catch {
        // A later storage event or pageshow check can surface the conflict.
      }
    }
    if (
      result === "complete" ||
      result === "metadata-only" ||
      result === "unchanged"
    ) {
      try {
        lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
      } catch {
        // A successful write can still be followed by a read restriction.
      }
    }
    return result;
  }, [storageKey]);

  const scrubSnapshotAfterClear = useCallback(function scrubSnapshotAfterClear(
    previousSignal: string | null,
  ) {
    let marker = readActiveClearMarker(storageKey);
    if (!marker || marker.signal === previousSignal) return false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scrubSignal: string = marker.signal;
      const scrubGeneration = marker.completedGeneration ?? cloudGeneration.current;
      let currentRaw: string | null;
      try {
        currentRaw = window.localStorage.getItem(storageKey);
      } catch {
        return false;
      }
      if (!currentRaw) return true;
      const currentEnvelope = readDeviceSnapshotEnvelope(currentRaw);
      if (!currentEnvelope) return false;
      if (currentEnvelope.clearSignal === scrubSignal) return true;
      if (
        currentEnvelope.clearSignal &&
        compareClearSignals(currentEnvelope.clearSignal, scrubSignal) > 0
      ) return false;
      const saveResult = writeLocalSnapshot(
        storageKey,
        clearedPersonalSnapshot(scrubGeneration),
        scrubSignal,
        true,
        currentRaw,
      );
      if (saveResult === "failed") return false;
      marker = readActiveClearMarker(storageKey);
      if (marker?.signal === scrubSignal) {
        try {
          lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
        } catch {
          // The removal above is still the safest available fallback.
        }
        return true;
      }
      if (!marker) return true;
    }
    return false;
  }, [storageKey]);

  const requestDeviceSnapshotWrite = useCallback(function requestDeviceSnapshotWrite(): Promise<GuardedDeviceSaveResult> {
    return deviceWriteQueue.current!.enqueue(async () => {
      const saveAndConfirm = async (needsFallbackDelay: boolean) => {
        if (needsFallbackDelay) unlockedDeviceWritePending.current = true;
        const coordinationGenerationAtWrite = ++deviceCoordinationGeneration.current;
        const generationAtWrite = localChangeGeneration.current;
        const clearSignalAtWrite = observedClearSignal.current;
        const result = writeCurrentLocalSnapshot(latestSnapshot.current);
        if (
          result !== "complete" &&
          result !== "metadata-only" &&
          result !== "unchanged"
        ) return result;

        const writtenRaw = lastKnownSnapshotRaw.current;
        if (needsFallbackDelay) {
          // Some embedded browsers have no Web Locks. Keep a conservative
          // local-work marker and briefly wait so simultaneous writes surface
          // immediately; later external writes still require an explicit choice.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        }

        try {
          if (deviceCoordinationGeneration.current !== coordinationGenerationAtWrite) {
            return result;
          }
          if (
            observedClearSignal.current !== clearSignalAtWrite ||
            readActiveClearSignal(storageKey) !== clearSignalAtWrite
          ) {
            scrubSnapshotAfterClear(clearSignalAtWrite);
            return "superseded";
          }
          const currentRaw = window.localStorage.getItem(storageKey);
          if (
            currentRaw !== writtenRaw &&
            !deviceSnapshotContentsMatch(writtenRaw, currentRaw ?? "")
          ) {
            const action = crossTabSnapshotAction({
              eventRaw: currentRaw,
              currentRaw,
              hasLocalWork: true,
            });
            if (action === "incompatible") {
              incompatibleSnapshot.current = true;
              lastKnownSnapshotRaw.current = currentRaw;
              setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
              if (!incompatibleSnapshotWarningShown.current) {
                incompatibleSnapshotWarningShown.current = true;
                setToast("另一标签页使用了更新版本；当前页面不会覆盖它保存的资料");
              }
              return "incompatible";
            }
            if (action === "prompt" || action === "apply") {
              externalSnapshotRaw.current = currentRaw;
              setExternalUpdateAvailable(true);
              setDataMode("等待选择");
              return "superseded";
            }
          }
          lastKnownSnapshotRaw.current = currentRaw;
          if (!needsFallbackDelay) {
            unlockedDeviceWritePending.current = false;
            persistedLocalChangeGeneration.current = Math.max(
              persistedLocalChangeGeneration.current,
              generationAtWrite,
            );
          }
          return result;
        } catch {
          // Do not mark the generation persisted unless the committed value can
          // be verified after the write.
          return "failed";
        }
      };

      try {
        if ("locks" in navigator && navigator.locks) {
          return await navigator.locks.request(
            CLEAR_BOUNDARY_LOCK_NAME,
            { mode: "exclusive" },
            () => saveAndConfirm(false),
          );
        }
      } catch {
        // Fall through to delayed verification if locking is not usable here.
      }
      return saveAndConfirm(true);
    });
  }, [scrubSnapshotAfterClear, storageKey, writeCurrentLocalSnapshot]);

  const clearExternalSnapshotNotice = useCallback(function clearExternalSnapshotNotice() {
    const shouldRestoreFocus =
      document.activeElement instanceof HTMLElement &&
      Boolean(externalUpdateRef.current?.contains(document.activeElement));
    externalSnapshotRaw.current = null;
    setExternalUpdateAvailable(false);
    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  function restoreMainFocus() {
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }

  const applyExternalSnapshot = useCallback(function applyExternalSnapshot(raw: string) {
    const snapshot = parseLocalSnapshot(raw, readActiveClearSignal(storageKey));
    if (!snapshot) return false;
    deviceCoordinationGeneration.current += 1;
    const resolvedProfile = resolveSnapshotProfileChoice({
      choice: "incoming",
      current: {
        metrics: latestSnapshot.current.metrics,
        revision: profileRevision.current,
        pending: profilePending.current,
      },
      incoming: {
        metrics: snapshot.metrics,
        revision: snapshot.profileRevision ?? 0,
        pending: snapshot.profilePending === true,
      },
    }) as {
      metrics: BodyMetrics;
      revision: number;
      pending: boolean;
      source: "current" | "incoming";
    };
    const applyIncomingProfile = resolvedProfile.source === "incoming";
    clearExternalSnapshotNotice();
    lastKnownSnapshotRaw.current = raw;
    incompatibleSnapshot.current = false;
    profilePending.current = resolvedProfile.pending;
    profileRevision.current = resolvedProfile.revision;
    if (applyIncomingProfile) profileEditGeneration.current += 1;
    cloudGeneration.current = snapshot.cloudGeneration ?? cloudGeneration.current;
    cloudItemIds.current = new Set(snapshot.cloudItemIds ?? []);
    deletedWardrobeClientIds.current = new Set(
      snapshot.deletedWardrobeClientIds ?? [],
    );
    cartProductIds.current = new Set(snapshot.cartProductIds ?? []);
    flushSync(() => {
      setWardrobe(snapshot.wardrobe);
      if (applyIncomingProfile) setMetrics(resolvedProfile.metrics);
      setOutfit(snapshot.outfit ?? {});
      setMood(snapshot.mood ?? 62);
      setCart(productsForIds(snapshot.cartProductIds ?? []));
      setSavedProductIds(snapshot.savedProductIds ?? []);
      setDailyPreferences(
        snapshot.dailyPreferences ?? DEFAULT_DAILY_PREFERENCES,
      );
    });
    unlockedDeviceWritePending.current = false;
    persistedLocalChangeGeneration.current = localChangeGeneration.current;
    const hasPendingWardrobe =
      deletedWardrobeClientIds.current.size > 0 ||
      hasPendingWardrobeItems(snapshot.wardrobe, cloudItemIds.current);
    setDataMode(
      usesDeviceOnlyStorage()
        ? "本机已保存"
        : hasPendingWardrobe || profileNeedsSync()
          ? "部分已同步"
          : "云端已同步",
    );
    setToast(
      applyIncomingProfile
        ? "已同步另一标签页的最新修改"
        : "已同步另一标签页的其他修改，并保留本页更新的分身参数",
    );
    return true;
  }, [clearExternalSnapshotNotice, profileNeedsSync, storageKey]);

  function useExternalSnapshot() {
    let raw = externalSnapshotRaw.current;
    try {
      const currentRaw = window.localStorage.getItem(storageKey);
      if (currentRaw !== raw) {
        const action = crossTabSnapshotAction({
          eventRaw: currentRaw,
          currentRaw,
          hasLocalWork: true,
        });
        if (action === "incompatible") {
          clearExternalSnapshotNotice();
          incompatibleSnapshot.current = true;
          lastKnownSnapshotRaw.current = currentRaw;
          setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
          setToast("另一标签页已升级资料格式；当前页面不会覆盖它");
          restoreMainFocus();
          return;
        }
        if (action === "prompt" || action === "apply") {
          raw = currentRaw;
          externalSnapshotRaw.current = currentRaw;
        } else {
          clearExternalSnapshotNotice();
          setToast("另一标签页的更新已变化，请稍后再试");
          restoreMainFocus();
          return;
        }
      }
    } catch {
      // Fall back to the last event value; parsing still validates it below.
    }
    if (!raw || !applyExternalSnapshot(raw)) {
      clearExternalSnapshotNotice();
      setToast("另一标签页的更新已变化，请稍后再试");
      restoreMainFocus();
      return;
    }
    mutationEpoch.current += 1;
    profileSaveQueue.current?.clear();
    pendingCloudMutations.current.forEach((mutation) => mutation.controller.abort());
    pendingWardrobeSyncIds.current.clear();
    pendingWardrobeDeletionIds.current.clear();
    restoreMainFocus();
  }

  async function keepCurrentSnapshot() {
    const choiceEpoch = mutationEpoch.current;
    deviceCoordinationGeneration.current += 1;
    let acknowledgedRaw = externalSnapshotRaw.current;
    try {
      acknowledgedRaw = window.localStorage.getItem(storageKey);
    } catch {
      // Use the last authoritative event value if live storage is unavailable.
    }
    const incomingSnapshot = parseLocalSnapshot(
      acknowledgedRaw,
      readActiveClearSignal(storageKey),
    );
    if (incomingSnapshot) {
      const resolvedProfile = resolveSnapshotProfileChoice({
        choice: "current",
        current: {
          metrics: latestSnapshot.current.metrics,
          revision: profileRevision.current,
          pending: profilePending.current,
        },
        incoming: {
          metrics: incomingSnapshot.metrics,
          revision: incomingSnapshot.profileRevision ?? 0,
          pending: incomingSnapshot.profilePending === true,
        },
      });
      profileRevision.current = resolvedProfile.revision;
      profilePending.current = resolvedProfile.pending;
      latestSnapshot.current = {
        ...latestSnapshot.current,
        profilePending: profilePending.current,
        profileRevision: profileRevision.current,
      };
    }
    // The same live value is both merged above and acknowledged as the write
    // base. A newer value appearing after this line is rejected as superseded.
    lastKnownSnapshotRaw.current = acknowledgedRaw;
    clearExternalSnapshotNotice();
    const result = await requestDeviceSnapshotWrite();
    if (mutationEpoch.current !== choiceEpoch) {
      restoreMainFocus();
      return;
    }
    if (result === "superseded") {
      setDataMode("等待选择");
      setToast("保存前又收到一项更新，请再确认一次");
      window.requestAnimationFrame(() => {
        externalUpdateRef.current
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus({ preventScroll: true });
      });
      return;
    }
    if (result === "failed" || result === "incompatible") {
      setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
      setToast("本页内容仍在，但暂时无法覆盖另一标签页的更新");
      restoreMainFocus();
      return;
    }
    setDataMode(
      usesDeviceOnlyStorage()
        ? "本机已保存"
        : deletedWardrobeClientIds.current.size > 0 ||
            hasPendingWardrobeItems(latestSnapshot.current.wardrobe, cloudItemIds.current) ||
            profileNeedsSync()
          ? "部分已同步"
          : "云端已同步",
    );
    setToast("已保留本页内容，并同步给其他标签页");
    restoreMainFocus();
  }

  const adoptStaleCloudGeneration = useCallback(function adoptStaleCloudGeneration(response: Response) {
    if (response.status !== 409) return false;
    const generation = response.headers.get(DATA_GENERATION_HEADER)?.trim();
    if (!generation || generation === cloudGeneration.current) return false;
    cloudGeneration.current = generation;
    mutationEpoch.current += 1;
    deviceCoordinationGeneration.current += 1;
    profileEditGeneration.current += 1;
    profileSaveQueue.current?.clear();
    pendingCloudMutations.current.forEach((mutation) => mutation.controller.abort());
    pendingWardrobeSyncIds.current.clear();
    pendingWardrobeDeletionIds.current.clear();
    deletedWardrobeClientIds.current.clear();
    wardrobeCloudReady.current = false;
    profileCloudReady.current = false;
    profilePending.current = false;
    profileRevision.current = 0;
    incompatibleSnapshot.current = false;
    clearExternalSnapshotNotice();
    lastKnownSnapshotRaw.current = null;
    localChangeGeneration.current = 0;
    persistedLocalChangeGeneration.current = 0;
    unlockedDeviceWritePending.current = false;
    cloudItemIds.current.clear();
    cartProductIds.current.clear();
    latestSnapshot.current = emptyPersonalSnapshot();
    const localSignal = createClearSignal();
    const marker = serializeCompletedClearMarker(localSignal, generation);
    void runClearBoundaryTask(() => {
      const activeMarker = readActiveClearMarker(storageKey);
      if (activeMarker?.status === "pending" || activeMarker?.status === "failed") {
        return false;
      }
      if (
        activeMarker &&
        activeMarker.signal !== localSignal &&
        compareClearSignals(activeMarker.signal, localSignal) > 0
      ) return false;
      let ownerAccepted = false;
      for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
        const targetMarker = readActiveClearMarker(targetStorageKey);
        if (targetMarker?.status === "pending" || targetMarker?.status === "failed") {
          if (targetStorageKey === storageKey) return false;
          continue;
        }
        if (
          targetMarker &&
          targetMarker.signal !== localSignal &&
          compareClearSignals(targetMarker.signal, localSignal) > 0
        ) continue;
        removeLocalSnapshot(targetStorageKey);
        const saved = persistClearMarker(targetStorageKey, marker);
        if (targetStorageKey === storageKey) ownerAccepted = saved;
        if (saved) {
          clearChannel.current?.postMessage({
            type: "personal-data-cleared",
            scope: coordinationScope(targetStorageKey),
            marker,
          });
        }
      }
      if (ownerAccepted) {
        lastCompletedClearSignal.current = localSignal;
        observedClearSignal.current = localSignal;
        lastAppliedClearSignal.current = localSignal;
      }
      return ownerAccepted;
    }).finally(() => window.location.reload());
    return true;
  }, [clearExternalSnapshotNotice, runClearBoundaryTask, storageKey]);

  useEffect(() => {
    let disposed = false;
    const activeSignal = readActiveClearSignal(storageKey);
    observedClearSignal.current = activeSignal;
    lastAppliedClearSignal.current = activeSignal;

    const applyRemoteClear = (signal: string) => {
      if (!signal) return;
      const persistedSignal = readActiveClearSignal(storageKey);
      const knownSignal = newestClearSignal(
        persistedSignal,
        observedClearSignal.current,
        lastAppliedClearSignal.current,
        lastCompletedClearSignal.current,
      );
      if (knownSignal && knownSignal !== signal) {
        const ordering = compareClearSignals(signal, knownSignal);
        if (ordering <= 0) return;
      }
      if (lastAppliedClearSignal.current === signal) return;
      observedClearSignal.current = signal;
      lastAppliedClearSignal.current = signal;
      mutationEpoch.current += 1;
      deviceCoordinationGeneration.current += 1;
      profileEditGeneration.current += 1;
      profileSaveQueue.current?.clear();
      pendingCloudMutations.current.forEach((mutation) => mutation.controller.abort());
      pendingWardrobeSyncIds.current.clear();
      pendingWardrobeDeletionIds.current.clear();
      deletedWardrobeClientIds.current.clear();
      wardrobeCloudReady.current = false;
      profileCloudReady.current = false;
      profilePending.current = false;
      profileRevision.current = 0;
      incompatibleSnapshot.current = false;
      clearExternalSnapshotNotice();
      lastKnownSnapshotRaw.current = null;
      localChangeGeneration.current = 0;
      persistedLocalChangeGeneration.current = 0;
      unlockedDeviceWritePending.current = false;
      cloudItemIds.current.clear();
      cartProductIds.current.clear();
      const emptySnapshot = emptyPersonalSnapshot();
      latestSnapshot.current = emptySnapshot;
      const localRemoved = removeLocalSnapshot(storageKey);
      const markerSaved = readActiveClearSignal(storageKey) === signal;
      flushSync(() => {
        setCartOpen(false);
        setAddOpen(false);
        setCelebrationOpen(false);
        setWardrobe([]);
        setMetrics(DEFAULT_METRICS);
        setOutfit({});
        setMood(62);
        setCart([]);
        setSavedProductIds([]);
        setDailyPreferences(DEFAULT_DAILY_PREFERENCES);
        setClearingData(true);
        setReady(true);
      });
      hydrated.current = true;
      const saveResult = writeCurrentLocalSnapshot(emptySnapshot);
      const localCleared =
        markerSaved &&
        (localRemoved ||
          (
            saveResult !== "failed" &&
            saveResult !== "superseded" &&
            saveResult !== "incompatible"
          ) ||
          isClearedLocalSnapshot(storageKey));
      setDataMode(
        usesDeviceOnlyStorage()
          ? localCleared
            ? "本机已保存"
            : "仅本次有效"
          : "部分已同步",
      );
      setToast(
        localCleared
          ? "另一标签页正在清除个人资料；这里已清空并暂停编辑"
          : "页面资料已清空，但浏览器阻止清除本机副本",
      );
    };

    const completeRemoteClear = async (
      marker: NonNullable<ReturnType<typeof parseClearMarker>>,
      completedGeneration: string,
    ) => {
      if (!completedGeneration || lastCompletedClearSignal.current === marker.signal) return;
      const activeMarker = readActiveClearMarker(storageKey);
      const knownSignal = newestClearSignal(
        activeMarker?.signal,
        observedClearSignal.current,
        lastAppliedClearSignal.current,
        lastCompletedClearSignal.current,
      );
      if (
        knownSignal &&
        knownSignal !== marker.signal &&
        compareClearSignals(marker.signal, knownSignal) <= 0
      ) return;
      if (observedClearSignal.current !== marker.signal) {
        if (
          observedClearSignal.current &&
          compareClearSignals(marker.signal, observedClearSignal.current) <= 0
        ) return;
        observedClearSignal.current = marker.signal;
        lastAppliedClearSignal.current = marker.signal;
      }
      const completedMarker = serializeCompletedClearMarker(
        marker.signal,
        completedGeneration,
        marker.clearedAt,
      );
      const completedSnapshot = {
        ...emptyPersonalSnapshot(),
        cloudGeneration: completedGeneration,
      };
      const boundaryResult = await runClearBoundaryTask(() => {
        const currentMarker = readActiveClearMarker(storageKey);
        const liveSignal = newestClearSignal(
          currentMarker?.signal,
          observedClearSignal.current,
          lastAppliedClearSignal.current,
          lastCompletedClearSignal.current,
        );
        if (
          liveSignal &&
          liveSignal !== marker.signal &&
          compareClearSignals(marker.signal, liveSignal) <= 0
        ) return { accepted: false, saveResult: "superseded" as const };
        removeLocalSnapshot(storageKey);
        const saveResult = writeLocalSnapshot(
          storageKey,
          completedSnapshot,
          marker.signal,
          true,
        );
        const markerSaved = persistClearMarker(storageKey, completedMarker);
        return {
          accepted: markerSaved || !currentMarker,
          saveResult,
        };
      });
      const liveAfterBoundary = newestClearSignal(
        readActiveClearSignal(storageKey),
        observedClearSignal.current,
        lastAppliedClearSignal.current,
        lastCompletedClearSignal.current,
      );
      if (
        !boundaryResult.accepted ||
        (liveAfterBoundary &&
          liveAfterBoundary !== marker.signal &&
          compareClearSignals(marker.signal, liveAfterBoundary) <= 0)
      ) return;
      lastCompletedClearSignal.current = marker.signal;
      mutationEpoch.current += 1;
      deviceCoordinationGeneration.current += 1;
      profileEditGeneration.current += 1;
      profileSaveQueue.current?.clear();
      pendingCloudMutations.current.forEach((mutation) => mutation.controller.abort());
      pendingWardrobeSyncIds.current.clear();
      pendingWardrobeDeletionIds.current.clear();
      deletedWardrobeClientIds.current.clear();
      cloudGeneration.current = completedGeneration;
      wardrobeCloudReady.current = true;
      profileCloudReady.current = true;
      profilePending.current = false;
      profileRevision.current = 0;
      incompatibleSnapshot.current = false;
      clearExternalSnapshotNotice();
      lastKnownSnapshotRaw.current = null;
      localChangeGeneration.current = 0;
      persistedLocalChangeGeneration.current = 0;
      unlockedDeviceWritePending.current = false;
      cloudItemIds.current.clear();
      cartProductIds.current.clear();
      latestSnapshot.current = completedSnapshot;
      try {
        lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
      } catch {
        // The save result below already captures blocked device storage.
      }
      flushSync(() => {
        setCartOpen(false);
        setAddOpen(false);
        setCelebrationOpen(false);
        setWardrobe([]);
        setMetrics(DEFAULT_METRICS);
        setOutfit({});
        setMood(62);
        setCart([]);
        setSavedProductIds([]);
        setDailyPreferences(DEFAULT_DAILY_PREFERENCES);
        setReady(true);
      });
      hydrated.current = true;
      setClearingData(false);
      setDataMode(
        usesDeviceOnlyStorage()
          ? boundaryResult.saveResult === "failed" ||
              boundaryResult.saveResult === "incompatible"
            ? "仅本次有效"
            : "本机已保存"
          : boundaryResult.saveResult === "failed" ||
              boundaryResult.saveResult === "incompatible"
            ? "部分已同步"
            : "云端已同步",
      );
      setToast("另一标签页已完成清除，衣橱现在是空的");
      window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    };

    const releaseFailedRemoteClear = (
      marker: NonNullable<ReturnType<typeof parseClearMarker>>,
    ) => {
      const activeMarker = readActiveClearMarker(storageKey);
      const knownSignal = newestClearSignal(
        activeMarker?.signal,
        observedClearSignal.current,
        lastAppliedClearSignal.current,
        lastCompletedClearSignal.current,
      );
      if (
        knownSignal &&
        knownSignal !== marker.signal &&
        compareClearSignals(marker.signal, knownSignal) <= 0
      ) return;
      observedClearSignal.current = marker.signal;
      // A retry reuses the same request signal, so allow a later transition
      // from failed back to pending to run the remote-clear reset again.
      lastAppliedClearSignal.current = null;
      setClearingData(false);
      setDataMode(
        usesDeviceOnlyStorage()
          ? isClearedLocalSnapshot(storageKey)
            ? "本机已保存"
            : "仅本次有效"
          : "部分已同步",
      );
      setToast("本机资料已清空；云端还没有全部清除，请检查网络后重试");
      window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    };

    const markerAtSetup = readActiveClearMarker(storageKey);
    if (clearingData && markerAtSetup?.status === "complete" && markerAtSetup.completedGeneration) {
      void completeRemoteClear(markerAtSetup, markerAtSetup.completedGeneration);
    } else if (clearingData && markerAtSetup?.status === "failed") {
      releaseFailedRemoteClear(markerAtSetup);
    }

    const hasLocalWork = () =>
      !ready ||
      localChangeGeneration.current !== persistedLocalChangeGeneration.current ||
      unlockedDeviceWritePending.current ||
      addOpen ||
      clearingData ||
      pendingCloudMutations.current.size > 0 ||
      pendingWardrobeSyncIds.current.size > 0 ||
      pendingWardrobeDeletionIds.current.size > 0 ||
      Boolean(profileSaveQueue.current?.running || profileSaveQueue.current?.pending);

    const considerExternalSnapshot = (
      eventRaw: string | null,
      currentRaw: string | null,
    ) => {
      const activeClearSignal = readActiveClearSignal(storageKey);
      const currentEnvelope = readDeviceSnapshotEnvelope(currentRaw);
      if (
        activeClearSignal &&
        currentEnvelope &&
        currentEnvelope.clearSignal !== activeClearSignal
      ) {
        const futureSchema = hasUnsupportedDeviceSnapshotVersion(currentRaw);
        clearExternalSnapshotNotice();
        incompatibleSnapshot.current = futureSchema;
        lastKnownSnapshotRaw.current = currentRaw;
        setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
        setToast("检测到清除前的旧标签页资料，正在安全移除");
        void runClearBoundaryTask(() =>
          scrubSnapshotAfterClear(currentEnvelope.clearSignal ?? null)
        ).then((scrubbed) => {
          if (disposed) return;
          if (!scrubbed) {
            setToast(
              futureSchema
                ? "另一标签页使用了更新版本；当前页面不会覆盖它保存的资料"
                : "浏览器暂时无法移除清除前的本机副本，请关闭旧标签页后重试",
            );
            return;
          }
          incompatibleSnapshot.current = false;
          try {
            lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
          } catch {
            lastKnownSnapshotRaw.current = null;
          }
          setDataMode(usesDeviceOnlyStorage() ? "本机已保存" : "部分已同步");
          setToast("已移除清除前由旧标签页写回的本机资料");
        });
        return;
      }
      const action = crossTabSnapshotAction({
        eventRaw,
        currentRaw,
        hasLocalWork: hasLocalWork(),
      });
      if (action === "ignore") return;
      if (action === "incompatible") {
        clearExternalSnapshotNotice();
        incompatibleSnapshot.current = true;
        lastKnownSnapshotRaw.current = currentRaw;
        setDataMode(usesDeviceOnlyStorage() ? "仅本次有效" : "部分已同步");
        if (!incompatibleSnapshotWarningShown.current) {
          incompatibleSnapshotWarningShown.current = true;
          setToast("另一标签页使用了更新版本；当前页面不会覆盖它保存的资料");
        }
        return;
      }
      if (action === "prompt") {
        externalSnapshotRaw.current = eventRaw;
        setExternalUpdateAvailable(true);
        setDataMode("等待选择");
        return;
      }
      if (eventRaw && applyExternalSnapshot(eventRaw)) {
        lastKnownSnapshotRaw.current = eventRaw;
      }
    };

    const handlePageShow = () => {
      const marker = readActiveClearMarker(storageKey);
      if (marker?.status === "complete" && marker.completedGeneration) {
        const alreadyAbsorbed =
          lastCompletedClearSignal.current === marker.signal ||
          (!clearingData && cloudGeneration.current === marker.completedGeneration);
        if (alreadyAbsorbed) {
          lastCompletedClearSignal.current = marker.signal;
          observedClearSignal.current = marker.signal;
          lastAppliedClearSignal.current = marker.signal;
        } else {
          void completeRemoteClear(marker, marker.completedGeneration);
          return;
        }
      } else if (marker?.status === "failed") {
        releaseFailedRemoteClear(marker);
        return;
      }
      if (marker?.signal && marker.signal !== observedClearSignal.current) {
        applyRemoteClear(marker.signal);
        return;
      }
      try {
        const currentRaw = window.localStorage.getItem(storageKey);
        if (currentRaw !== lastKnownSnapshotRaw.current) {
          considerExternalSnapshot(currentRaw, currentRaw);
        }
      } catch {
        // Storage state will be retried on the next event or page restore.
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key === clearMarkerKey) {
        const marker = parseClearMarker(event.newValue);
        if (marker?.status === "complete" && marker.completedGeneration) {
          const alreadyAbsorbed =
            lastCompletedClearSignal.current === marker.signal ||
            (!clearingData && cloudGeneration.current === marker.completedGeneration);
          if (alreadyAbsorbed) {
            lastCompletedClearSignal.current = marker.signal;
            observedClearSignal.current = marker.signal;
            lastAppliedClearSignal.current = marker.signal;
          } else {
            void completeRemoteClear(marker, marker.completedGeneration);
          }
        } else if (marker?.status === "failed") {
          releaseFailedRemoteClear(marker);
        } else if (marker) {
          applyRemoteClear(marker.signal);
        }
        return;
      }
      if (event.key !== storageKey) return;
      try {
        considerExternalSnapshot(
          event.newValue,
          window.localStorage.getItem(storageKey),
        );
      } catch {
        // Ignore transient read restrictions; pageshow provides another chance.
      }
    };
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("songsong-closet:coordination:v1");
    clearChannel.current = channel;
    if (channel) {
      channel.onmessage = async (event: MessageEvent) => {
        const message = event.data as {
          type?: unknown;
          scope?: unknown;
          marker?: unknown;
          success?: unknown;
          cloudGeneration?: unknown;
        };
        if (
          message?.type === "personal-data-clear-finished" &&
          message.scope === clearScope &&
          typeof message.marker === "string"
        ) {
          const marker = parseClearMarker(message.marker);
          if (!marker) return;
          const activeSignal = readActiveClearSignal(storageKey);
          if (activeSignal && activeSignal !== marker.signal) return;
          if (message.success === true && typeof message.cloudGeneration === "string") {
            await completeRemoteClear(marker, message.cloudGeneration);
          } else if (
            message.success === false &&
            typeof message.cloudGeneration === "string" &&
            message.cloudGeneration !== cloudGeneration.current
          ) {
            cloudGeneration.current = message.cloudGeneration;
            wardrobeCloudReady.current = false;
            profileCloudReady.current = false;
            profilePending.current = false;
            profileRevision.current = 0;
            latestSnapshot.current = {
              ...emptyPersonalSnapshot(),
              cloudGeneration: message.cloudGeneration,
            };
            await requestDeviceSnapshotWrite();
            window.location.reload();
          } else {
            releaseFailedRemoteClear(marker);
          }
          return;
        }
        if (
          message?.type !== "personal-data-cleared" ||
          message.scope !== clearScope ||
          typeof message.marker !== "string"
        ) return;
        const marker = parseClearMarker(message.marker);
        if (marker?.status === "complete" && marker.completedGeneration) {
          await completeRemoteClear(marker, marker.completedGeneration);
        } else if (marker?.status === "failed") {
          releaseFailedRemoteClear(marker);
        } else if (marker) {
          applyRemoteClear(marker.signal);
        }
      };
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      disposed = true;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
      if (channel) channel.close();
      if (clearChannel.current === channel) clearChannel.current = null;
    };
  }, [addOpen, applyExternalSnapshot, clearExternalSnapshotNotice, clearMarkerKey, clearScope, clearingData, ready, requestDeviceSnapshotWrite, runClearBoundaryTask, scrubSnapshotAfterClear, storageKey, writeCurrentLocalSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const hydrationEpoch = mutationEpoch.current;
    wardrobeCloudReady.current = false;
    profileCloudReady.current = false;
    let snapshotEnvelope: ReturnType<typeof readDeviceSnapshotEnvelope> = null;
    try {
      const rawSnapshot = window.localStorage.getItem(storageKey);
      lastKnownSnapshotRaw.current = rawSnapshot;
      incompatibleSnapshot.current = hasUnsupportedDeviceSnapshotVersion(rawSnapshot);
      if (incompatibleSnapshot.current) {
        snapshotEnvelope = readDeviceSnapshotEnvelope(rawSnapshot);
      }
    } catch {
      incompatibleSnapshot.current = false;
    }
    let local = readLocalSnapshot(storageKey, observedClearSignal.current);
    profilePending.current = local?.profilePending === true;
    profileRevision.current = local?.profileRevision ?? 0;
    let storedCloudItemIds = new Set(local?.cloudItemIds ?? []);
    cloudGeneration.current =
      local?.cloudGeneration ?? snapshotEnvelope?.cloudGeneration ?? "initial";
    deletedWardrobeClientIds.current = new Set(local?.deletedWardrobeClientIds ?? []);
    cloudItemIds.current = new Set(storedCloudItemIds);
    const activeClearMarker = readActiveClearMarker(storageKey);
    const clearHydrationAction = clearMarkerHydrationAction(
      activeClearMarker,
      local ?? snapshotEnvelope,
      incompatibleSnapshot.current,
    );
    if (activeClearMarker?.status === "complete") {
      lastCompletedClearSignal.current = activeClearMarker.signal;
      if (
        activeClearMarker.completedGeneration &&
        clearHydrationAction === "reset-known"
      ) {
        local = null;
        profilePending.current = false;
        profileRevision.current = 0;
        profileEditGeneration.current += 1;
        incompatibleSnapshot.current = false;
        lastKnownSnapshotRaw.current = null;
        localChangeGeneration.current = 0;
        persistedLocalChangeGeneration.current = 0;
        unlockedDeviceWritePending.current = false;
        storedCloudItemIds = new Set();
        deletedWardrobeClientIds.current.clear();
        cloudItemIds.current.clear();
        cartProductIds.current.clear();
        cloudGeneration.current = activeClearMarker.completedGeneration;
        removeLocalSnapshot(storageKey);
      }
    }
    const hydrateClearBoundary = (pending: boolean) => {
      if (!activeClearMarker) return;
      observedClearSignal.current = activeClearMarker.signal;
      lastAppliedClearSignal.current = activeClearMarker.signal;
      profilePending.current = false;
      profileRevision.current = 0;
      profileEditGeneration.current += 1;
      incompatibleSnapshot.current = false;
      clearExternalSnapshotNotice();
      localChangeGeneration.current = 0;
      persistedLocalChangeGeneration.current = 0;
      unlockedDeviceWritePending.current = false;
      deletedWardrobeClientIds.current.clear();
      cloudItemIds.current.clear();
      cartProductIds.current.clear();
      latestSnapshot.current = emptyPersonalSnapshot();
      flushSync(() => {
        setCartOpen(false);
        setAddOpen(false);
        setCelebrationOpen(false);
        setWardrobe([]);
        setMetrics(DEFAULT_METRICS);
        setOutfit({});
        setMood(62);
        setCart([]);
        setSavedProductIds([]);
        setDailyPreferences(DEFAULT_DAILY_PREFERENCES);
        setDataMode(storageOwner ? "部分已同步" : "本机已保存");
        setClearingData(pending);
        setReady(true);
      });
      hydrated.current = true;
    };
    const announceClearRecovery = (message: string) => {
      queueMicrotask(() => {
        if (!cancelled) setToast(message);
      });
    };
    if (clearHydrationAction === "hold-failed") {
      hydrateClearBoundary(false);
      lastAppliedClearSignal.current = null;
      announceClearRecovery("本机资料已清空；云端还没有全部清除，请重试清除");
      return () => {
        cancelled = true;
      };
    }
    if (clearHydrationAction === "recover-pending" && activeClearMarker) {
      hydrateClearBoundary(true);
      announceClearRecovery("正在继续完成个人资料清除；完成前已暂停编辑");
      const recoverySignal = activeClearMarker.signal;
      const recoveryEpoch = mutationEpoch.current;
      const recoveryOwnsBoundary = () => {
        const currentMarker = readActiveClearMarker(storageKey);
        return (
          !cancelled &&
          mutationEpoch.current === recoveryEpoch &&
          observedClearSignal.current === recoverySignal &&
          currentMarker !== null &&
          currentMarker.signal === recoverySignal
        );
      };
      const recoveryStillActive = () => {
        const currentMarker = readActiveClearMarker(storageKey);
        return recoveryOwnsBoundary() && currentMarker?.status === "pending";
      };
      if (!storageOwner) {
        void (async () => {
          const completedMarker = serializeCompletedClearMarker(
            recoverySignal,
            cloudGeneration.current,
            activeClearMarker.clearedAt,
          );
          const accepted = await runClearBoundaryTask(() => {
            if (!recoveryStillActive()) return false;
            let ownerAccepted = false;
            for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
              const targetMarker = readActiveClearMarker(targetStorageKey);
              if (
                targetMarker &&
                targetMarker.signal !== recoverySignal &&
                compareClearSignals(targetMarker.signal, recoverySignal) > 0
              ) continue;
              writeLocalSnapshot(
                targetStorageKey,
                latestSnapshot.current,
                recoverySignal,
                true,
              );
              const saved = persistClearMarker(targetStorageKey, completedMarker);
              if (targetStorageKey === storageKey) ownerAccepted = saved;
            }
            return ownerAccepted;
          });
          if (!accepted || !recoveryOwnsBoundary()) return;
          lastCompletedClearSignal.current = recoverySignal;
          try {
            lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
          } catch {
            // Device-only mode can continue in memory when storage is blocked.
          }
          setClearingData(false);
          announceClearRecovery("个人资料清除已完成，衣橱现在是空的");
          window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
        })();
        return () => {
          cancelled = true;
        };
      }

      const recoveryControllers = new Set<AbortController>();
      let retryTimer: number | null = null;
      const waitBeforeRetry = () => new Promise<void>((resolve) => {
        retryTimer = window.setTimeout(resolve, 2_000);
      });
      void (async () => {
        let response: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!recoveryStillActive()) return;
          const attemptController = new AbortController();
          recoveryControllers.add(attemptController);
          const attemptTimeout = window.setTimeout(
            () => attemptController.abort(),
            CLOUD_MUTATION_TIMEOUT_MS,
          );
          try {
            response = await fetch("/api/personal-data", {
              method: "DELETE",
              headers: {
                [DATA_GENERATION_HEADER]: cloudGeneration.current,
                [CLEAR_REQUEST_HEADER]: activeClearMarker.signal,
              },
              signal: attemptController.signal,
            });
          } catch {
            if (!recoveryStillActive()) return;
            response = null;
          } finally {
            window.clearTimeout(attemptTimeout);
            recoveryControllers.delete(attemptController);
          }
          if (!recoveryStillActive()) return;
          if (response?.ok || response?.status === 409) break;
          if (attempt < 2) await waitBeforeRetry();
          if (!recoveryStillActive()) return;
        }
        if (!recoveryStillActive()) return;
        const recoveredGeneration = response?.headers
          .get(DATA_GENERATION_HEADER)?.trim();
        if ((response?.ok || response?.status === 409) && recoveredGeneration) {
          if (!recoveryStillActive()) return;
          const completedSnapshot = {
            ...emptyPersonalSnapshot(),
            cloudGeneration: recoveredGeneration,
          };
          const completedMarker = serializeCompletedClearMarker(
            recoverySignal,
            recoveredGeneration,
            activeClearMarker.clearedAt,
          );
          const accepted = await runClearBoundaryTask(() => {
            if (!recoveryStillActive()) return false;
            let ownerAccepted = false;
            for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
              const targetMarker = readActiveClearMarker(targetStorageKey);
              if (
                targetMarker &&
                targetMarker.signal !== recoverySignal &&
                compareClearSignals(targetMarker.signal, recoverySignal) > 0
              ) continue;
              writeLocalSnapshot(
                targetStorageKey,
                completedSnapshot,
                recoverySignal,
                true,
              );
              const saved = persistClearMarker(targetStorageKey, completedMarker);
              if (targetStorageKey === storageKey) ownerAccepted = saved;
            }
            return ownerAccepted;
          });
          if (!accepted || !recoveryOwnsBoundary()) return;
          cloudGeneration.current = recoveredGeneration;
          latestSnapshot.current = completedSnapshot;
          lastCompletedClearSignal.current = recoverySignal;
          window.location.reload();
          return;
        }
        if (!recoveryStillActive()) return;
        const failedMarker = serializeFailedClearMarker(
          recoverySignal,
          activeClearMarker.clearedAt,
        );
        const accepted = await runClearBoundaryTask(() => {
          if (!recoveryStillActive()) return false;
          let ownerAccepted = false;
          for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
            const targetMarker = readActiveClearMarker(targetStorageKey);
            if (
              targetMarker &&
              targetMarker.signal !== recoverySignal &&
              compareClearSignals(targetMarker.signal, recoverySignal) > 0
            ) continue;
            const saved = persistClearMarker(targetStorageKey, failedMarker);
            if (targetStorageKey === storageKey) ownerAccepted = saved;
          }
          return ownerAccepted;
        });
        if (!accepted || !recoveryOwnsBoundary()) return;
        setClearingData(false);
        setToast("本机资料已清空；云端清除仍未完成，请检查网络后重试");
        window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
      })();
      return () => {
        cancelled = true;
        recoveryControllers.forEach((controller) => controller.abort());
        recoveryControllers.clear();
        if (retryTimer !== null) window.clearTimeout(retryTimer);
      };
    }
    const hydrateDeviceState = () => {
      const deviceSnapshot = local;
      if (deviceSnapshot) setWardrobe(deviceSnapshot.wardrobe);
      if (deviceSnapshot?.metrics) setMetrics((current) => ({ ...current, ...deviceSnapshot.metrics }));
      if (deviceSnapshot?.outfit) setOutfit(deviceSnapshot.outfit);
      if (typeof deviceSnapshot?.mood === "number") setMood(deviceSnapshot.mood);
      if (deviceSnapshot?.dailyPreferences) setDailyPreferences(deviceSnapshot.dailyPreferences);
      if (deviceSnapshot?.cartProductIds) {
        setCart((current) => {
          const next = productsForIds([...deviceSnapshot.cartProductIds!, ...current.map((item) => item.id)]);
          cartProductIds.current = new Set(next.map((item) => item.id));
          return next;
        });
      }
      if (deviceSnapshot?.savedProductIds) {
        setSavedProductIds((current) => [...new Set([...deviceSnapshot.savedProductIds!, ...current])]);
      }
      setDataMode(incompatibleSnapshot.current ? "仅本次有效" : "本机已保存");
      if (incompatibleSnapshot.current && !incompatibleSnapshotWarningShown.current) {
        incompatibleSnapshotWarningShown.current = true;
        setToast("发现由新版松松逛保存的本机资料；当前版本不会覆盖它");
      }
      hydrated.current = true;
      setReady(true);
    };

    if (usesDeviceOnlyStorage()) {
      hydrateDeviceState();
      return () => {
        cancelled = true;
      };
    }

    const abortController = new AbortController();
    const requestTimeout = window.setTimeout(() => abortController.abort(), 6000);
    const wardrobeRequest = fetch("/api/wardrobe", { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Wardrobe unavailable");
        return response.json() as Promise<{ items?: WardrobeItem[]; generation?: string }>;
      });
    const profileRequest = fetch("/api/profile", { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Profile unavailable");
        return response.json() as Promise<{
          profile?: Partial<BodyMetrics> | null;
          revision?: number;
          generation?: string;
        }>;
      });

    void Promise.allSettled([wardrobeRequest, profileRequest]).then(async ([closetResult, profileResult]) => {
      window.clearTimeout(requestTimeout);
      if (cancelled || mutationEpoch.current !== hydrationEpoch) return;
      const receivedGenerations = new Set([
        closetResult.status === "fulfilled" ? closetResult.value.generation : undefined,
        profileResult.status === "fulfilled" ? profileResult.value.generation : undefined,
      ].filter((value): value is string => Boolean(value)));
      if (receivedGenerations.size > 1) {
        window.location.reload();
        return;
      }
      const serverGeneration = closetResult.status === "fulfilled"
        ? closetResult.value.generation
        : profileResult.status === "fulfilled"
          ? profileResult.value.generation
          : undefined;
      const generationAction = deviceGenerationAction(
        cloudGeneration.current,
        serverGeneration,
        incompatibleSnapshot.current,
      );
      if (generationAction === "reset-known" && serverGeneration) {
        const nextClearSignal = createClearSignal();
        const marker = serializeCompletedClearMarker(
          nextClearSignal,
          serverGeneration,
        );
        const boundary = await runClearBoundaryTask(() => {
          const activeMarker = readActiveClearMarker(storageKey);
          if (activeMarker?.status === "pending" || activeMarker?.status === "failed") {
            return { accepted: false, signal: activeMarker.signal };
          }
          if (
            activeMarker?.status === "complete" &&
            activeMarker.completedGeneration === serverGeneration
          ) {
            removeLocalSnapshot(storageKey);
            return { accepted: true, signal: activeMarker.signal };
          }
          let ownerAccepted = false;
          for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
            const targetMarker = readActiveClearMarker(targetStorageKey);
            if (targetMarker?.status === "pending" || targetMarker?.status === "failed") {
              if (targetStorageKey === storageKey) {
                return { accepted: false, signal: targetMarker.signal };
              }
              continue;
            }
            const saved = persistClearMarker(targetStorageKey, marker);
            if (targetStorageKey === storageKey) {
              ownerAccepted = saved || !targetMarker;
            }
            if (!saved) continue;
            removeLocalSnapshot(targetStorageKey);
            clearChannel.current?.postMessage({
              type: "personal-data-cleared",
              scope: coordinationScope(targetStorageKey),
              marker,
            });
          }
          return { accepted: ownerAccepted, signal: nextClearSignal };
        });
        if (
          !boundary.accepted ||
          cancelled ||
          mutationEpoch.current !== hydrationEpoch ||
          newestClearSignal(
            readActiveClearSignal(storageKey),
            observedClearSignal.current,
            lastAppliedClearSignal.current,
          ) !== boundary.signal
        ) {
          window.location.reload();
          return;
        }
        lastCompletedClearSignal.current = boundary.signal;
        local = null;
        profilePending.current = false;
        profileRevision.current = 0;
        profileEditGeneration.current += 1;
        deviceCoordinationGeneration.current += 1;
        incompatibleSnapshot.current = false;
        clearExternalSnapshotNotice();
        lastKnownSnapshotRaw.current = null;
        localChangeGeneration.current = 0;
        persistedLocalChangeGeneration.current = 0;
        unlockedDeviceWritePending.current = false;
        storedCloudItemIds = new Set();
        deletedWardrobeClientIds.current.clear();
        cloudGeneration.current = serverGeneration;
        observedClearSignal.current = boundary.signal;
        lastAppliedClearSignal.current = boundary.signal;
      } else if (serverGeneration) {
        cloudGeneration.current = serverGeneration;
      }
      const cloudWardrobeItems = closetResult.status === "fulfilled"
        ? (closetResult.value.items ?? []).filter(
            (item) => !item.clientId || !deletedWardrobeClientIds.current.has(item.clientId),
          )
        : [];
      if (closetResult.status === "fulfilled" && local && storageOwner) {
        const cloudById = new Map(
          cloudWardrobeItems.map((item) => [item.id, item]),
        );
        let reconciledWardrobe = local.wardrobe;
        let reconciledOutfit = local.outfit ?? {};
        for (const deletedClientId of deletedWardrobeClientIds.current) {
          const expectedCloudId = await wardrobeCloudId(storageOwner, deletedClientId);
          const removed = removeWardrobeIdentity(
            reconciledWardrobe,
            reconciledOutfit,
            deletedClientId,
            expectedCloudId ? [expectedCloudId] : [],
          );
          reconciledWardrobe = removed.wardrobe;
          reconciledOutfit = removed.outfit;
        }
        for (const item of reconciledWardrobe) {
          if (item.source !== "我的衣服" || storedCloudItemIds.has(item.id)) continue;
          const clientId = item.clientId ?? item.id;
          const expectedCloudId = await wardrobeCloudId(storageOwner, clientId);
          const cloudItem = expectedCloudId ? cloudById.get(expectedCloudId) : undefined;
          if (!cloudItem) continue;
          const reconciled = replaceSyncedWardrobeItem(
            reconciledWardrobe,
            reconciledOutfit,
            item.id,
            cloudItem,
          );
          reconciledWardrobe = reconciled.wardrobe;
          reconciledOutfit = reconciled.outfit;
          storedCloudItemIds.add(cloudItem.id);
        }
        local = { ...local, wardrobe: reconciledWardrobe, outfit: reconciledOutfit };
      }
      if (cancelled || mutationEpoch.current !== hydrationEpoch) return;
      const hydratedLocal = local;
      if (closetResult.status === "fulfilled") {
        wardrobeCloudReady.current = true;
        cloudItemIds.current = new Set(cloudWardrobeItems.map((item) => item.id));
        setWardrobe((current) =>
          mergeWardrobe(
            cloudWardrobeItems,
            hydratedLocal
              ? hydratedLocal.wardrobe.filter(
                  (item) =>
                    !storedCloudItemIds.has(item.id) &&
                    !deletedWardrobeClientIds.current.has(item.clientId ?? item.id),
                )
              : observedClearSignal.current
                ? []
                : current,
          ),
        );
      } else if (hydratedLocal) {
        setWardrobe(hydratedLocal.wardrobe);
      }
      if (profileResult.status === "fulfilled") {
        profileCloudReady.current = true;
        profileRevision.current =
          typeof profileResult.value.revision === "number" &&
          Number.isSafeInteger(profileResult.value.revision) &&
          profileResult.value.revision >= 0
            ? profileResult.value.revision
            : 0;
        const resolvedProfile = resolveHydratedProfile({
          defaults: DEFAULT_METRICS,
          local: hydratedLocal?.metrics,
          cloud: profileResult.value.profile,
          profilePending: hydratedLocal?.profilePending,
        }) as {
          metrics: BodyMetrics;
          profilePending: boolean;
        };
        profilePending.current = resolvedProfile.profilePending;
        setMetrics(resolvedProfile.metrics);
        if (
          resolvedProfile.profilePending &&
          hydratedLocal?.profilePending !== true
        ) {
          setToast("保留了尚未确认同步的本机分身参数；请在试穿间确认保存");
        }
      } else if (hydratedLocal?.metrics) {
        const resolvedProfile = resolveHydratedProfile({
          defaults: DEFAULT_METRICS,
          local: hydratedLocal.metrics,
          cloud: null,
          profilePending: hydratedLocal.profilePending,
        }) as {
          metrics: BodyMetrics;
          profilePending: boolean;
        };
        profilePending.current = resolvedProfile.profilePending;
        setMetrics(resolvedProfile.metrics);
        if (
          resolvedProfile.profilePending &&
          hydratedLocal.profilePending !== true
        ) {
          setToast("保留了尚未确认同步的本机分身参数；请在试穿间确认保存");
        }
      }
      if (hydratedLocal?.outfit) setOutfit(hydratedLocal.outfit);
      if (typeof hydratedLocal?.mood === "number") setMood(hydratedLocal.mood);
      if (hydratedLocal?.dailyPreferences) setDailyPreferences(hydratedLocal.dailyPreferences);
      if (hydratedLocal?.cartProductIds) {
        setCart((current) => {
          const next = productsForIds([...hydratedLocal.cartProductIds!, ...current.map((item) => item.id)]);
          cartProductIds.current = new Set(next.map((item) => item.id));
          return next;
        });
      }
      if (hydratedLocal?.savedProductIds) {
        setSavedProductIds((current) => [...new Set([...hydratedLocal.savedProductIds!, ...current])]);
      }
      const successCount = Number(closetResult.status === "fulfilled") + Number(profileResult.status === "fulfilled");
      const syncedWardrobeIds = closetResult.status === "fulfilled"
        ? new Set(cloudWardrobeItems.map((item) => item.id))
        : storedCloudItemIds;
      const hasPendingWardrobe = Boolean(
        hydratedLocal?.wardrobe.some(
          (item) =>
            item.source === "我的衣服" &&
            !deletedWardrobeClientIds.current.has(item.clientId ?? item.id) &&
            !syncedWardrobeIds.has(item.id),
        ),
      );
      const hasQueuedDeletion = deletedWardrobeClientIds.current.size > 0;
      setDataMode(
        successCount === 2 &&
          !hasPendingWardrobe &&
          !hasQueuedDeletion &&
          !profileNeedsSync() &&
          !incompatibleSnapshot.current
          ? "云端已同步"
          : successCount >= 1
            ? "部分已同步"
            : "本机已保存",
      );
      hydrated.current = true;
      setReady(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(requestTimeout);
      abortController.abort();
    };
  }, [clearExternalSnapshotNotice, clearMarkerKey, profileNeedsSync, runClearBoundaryTask, storageKey, storageOwner]);

  useEffect(() => {
    const retryPendingWardrobe = () => setWardrobeSyncAttempt((current) => current + 1);
    window.addEventListener("online", retryPendingWardrobe);
    return () => window.removeEventListener("online", retryPendingWardrobe);
  }, []);

  useEffect(() => {
    if (
      !ready ||
      clearingData ||
      !storageOwner ||
      usesDeviceOnlyStorage() ||
      !wardrobeCloudReady.current ||
      !navigator.onLine
    ) return;
    const queuedDeletion = [...deletedWardrobeClientIds.current].find(
      (clientId) => !pendingWardrobeDeletionIds.current.has(clientId),
    );
    if (queuedDeletion) {
      const requestEpoch = mutationEpoch.current;
      pendingWardrobeDeletionIds.current.add(queuedDeletion);
      void (async () => {
        try {
          const response = await fetchCloudMutation(
            `/api/wardrobe?clientId=${encodeURIComponent(queuedDeletion)}`,
            { method: "DELETE" },
          );
          if (mutationEpoch.current !== requestEpoch) return;
          if (!response.ok) {
            if (!adoptStaleCloudGeneration(response)) {
              setDataMode("部分已同步");
              window.setTimeout(
                () => setWardrobeSyncAttempt((current) => current + 1),
                5_000,
              );
            }
            return;
          }
          const cloudId = await wardrobeCloudId(storageOwner, queuedDeletion);
          deletedWardrobeClientIds.current.delete(queuedDeletion);
          if (cloudId) cloudItemIds.current.delete(cloudId);
          const removed = removeWardrobeIdentity(
            latestSnapshot.current.wardrobe,
            latestSnapshot.current.outfit ?? {},
            queuedDeletion,
            cloudId ? [cloudId] : [],
          );
          flushSync(() => {
            setWardrobe(removed.wardrobe);
            setOutfit(removed.outfit);
          });
          const stillPending =
            deletedWardrobeClientIds.current.size > 0 ||
            hasPendingWardrobeItems(removed.wardrobe, cloudItemIds.current);
          setDataMode(
            stillPending || profileNeedsSync()
              ? "部分已同步"
              : "云端已同步",
          );
          await requestDeviceSnapshotWrite();
          if (mutationEpoch.current !== requestEpoch) return;
          setWardrobeSyncAttempt((current) => current + 1);
        } catch {
          if (mutationEpoch.current === requestEpoch) {
            setDataMode("部分已同步");
            window.setTimeout(
              () => setWardrobeSyncAttempt((current) => current + 1),
              5_000,
            );
          }
        } finally {
          pendingWardrobeDeletionIds.current.delete(queuedDeletion);
        }
      })();
      return;
    }
    const pendingItem = wardrobe.find(
      (item) =>
        item.source === "我的衣服" &&
        !cloudItemIds.current.has(item.id) &&
        !pendingWardrobeSyncIds.current.has(item.id),
    );
    if (!pendingItem) return;

    const requestEpoch = mutationEpoch.current;
    pendingWardrobeSyncIds.current.add(pendingItem.id);
    void (async () => {
      try {
        const photo = await devicePhotoFile(pendingItem);
        if (pendingItem.imageUrl?.startsWith("data:") && !photo) return;
        if (mutationEpoch.current !== requestEpoch) return;
        const response = await fetchCloudMutation(
          "/api/wardrobe",
          { method: "POST", body: wardrobeItemForm(pendingItem, photo) },
          CLOUD_UPLOAD_TIMEOUT_MS,
        );
        if (mutationEpoch.current !== requestEpoch) return;
        if (!response.ok) {
          if (response.status === 410) {
            const clientId = pendingItem.clientId ?? pendingItem.id;
            const cloudId = await wardrobeCloudId(storageOwner, clientId);
            const removed = removeWardrobeIdentity(
              latestSnapshot.current.wardrobe,
              latestSnapshot.current.outfit ?? {},
              clientId,
              cloudId ? [cloudId] : [],
            );
            deletedWardrobeClientIds.current.delete(clientId);
            if (cloudId) cloudItemIds.current.delete(cloudId);
            flushSync(() => {
              setWardrobe(removed.wardrobe);
              setOutfit(removed.outfit);
            });
            const stillPending =
              deletedWardrobeClientIds.current.size > 0 ||
              hasPendingWardrobeItems(removed.wardrobe, cloudItemIds.current);
            setDataMode(
              stillPending || profileNeedsSync()
                ? "部分已同步"
                : "云端已同步",
            );
            await requestDeviceSnapshotWrite();
            if (mutationEpoch.current !== requestEpoch) return;
            setToast("这件衣物已在其他标签页移除");
            return;
          }
          if (!adoptStaleCloudGeneration(response)) {
            setDataMode("部分已同步");
            window.setTimeout(
              () => setWardrobeSyncAttempt((current) => current + 1),
              5_000,
            );
          }
          return;
        }
        const data = (await response.json()) as { item: WardrobeItem };
        if (mutationEpoch.current !== requestEpoch) return;
        const currentSnapshot = latestSnapshot.current;
        const reconciled = replaceSyncedWardrobeItem(
          currentSnapshot.wardrobe,
          currentSnapshot.outfit ?? {},
          pendingItem.id,
          data.item,
        );
        if (!reconciled.applied) {
          const cleanupClientId = data.item.clientId ?? pendingItem.clientId ?? pendingItem.id;
          await fetchCloudMutation(
            `/api/wardrobe?clientId=${encodeURIComponent(cleanupClientId)}`,
            { method: "DELETE" },
          );
          return;
        }
        cloudItemIds.current.add(data.item.id);
        flushSync(() => {
          setWardrobe(reconciled.wardrobe);
          setOutfit(reconciled.outfit);
        });
        const stillPending =
          deletedWardrobeClientIds.current.size > 0 ||
          hasPendingWardrobeItems(reconciled.wardrobe, cloudItemIds.current);
        setDataMode(
          stillPending || profileNeedsSync()
            ? "部分已同步"
            : "云端已同步",
        );
        await requestDeviceSnapshotWrite();
        if (mutationEpoch.current !== requestEpoch) return;
        setToast(stillPending ? "一件本机衣物已补同步到云端" : "本机衣物已全部补同步到云端");
      } catch {
        if (mutationEpoch.current === requestEpoch) {
          setDataMode("部分已同步");
          window.setTimeout(
            () => setWardrobeSyncAttempt((current) => current + 1),
            5_000,
          );
        }
      } finally {
        pendingWardrobeSyncIds.current.delete(pendingItem.id);
      }
    })();
  }, [adoptStaleCloudGeneration, clearingData, profileNeedsSync, ready, requestDeviceSnapshotWrite, storageOwner, wardrobe, wardrobeSyncAttempt]);

  useEffect(() => {
    if (!hydrated.current || dataMode === "连接中") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await requestDeviceSnapshotWrite();
        if (result === "superseded") return;
        if (result === "incompatible") {
          setDataMode((current) =>
            current === "云端已同步" || current === "部分已同步"
              ? "部分已同步"
              : "仅本次有效",
          );
          if (!incompatibleSnapshotWarningShown.current) {
            incompatibleSnapshotWarningShown.current = true;
            setToast("发现由新版松松逛保存的本机资料；当前版本不会覆盖它");
          }
          return;
        }
        if (result === "failed") {
          if (dataMode === "云端已同步" || dataMode === "部分已同步") {
            setDataMode("部分已同步");
          } else if (dataMode !== "仅本次有效") {
            setDataMode("仅本次有效");
          }
          if (!storageFailureShown.current) {
            storageFailureShown.current = true;
            setToast(
              dataMode === "云端已同步" || dataMode === "部分已同步"
                ? "云端衣橱仍安全，但本机搭配偏好这次没有保存"
                : "浏览器阻止了本机保存，本次内容仍会保留到页面关闭",
            );
          }
        } else if (result === "metadata-only" && !storageWarningShown.current) {
          storageWarningShown.current = true;
          setToast("衣橱资料已保存，但本机照片空间已满");
        }
        if (usesDeviceOnlyStorage() && result !== "failed") {
          setDataMode("本机已保存");
        }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [wardrobe, metrics, outfit, mood, cart, savedProductIds, dailyPreferences, dataMode, requestDeviceSnapshotWrite]);

  useEffect(() => {
    const flushDeviceState = () => {
      if (!hydrated.current) return;
      unlockedDeviceWritePending.current = true;
      deviceCoordinationGeneration.current += 1;
      const clearSignalAtFlush = observedClearSignal.current;
      if (readActiveClearSignal(storageKey) !== clearSignalAtFlush) {
        return;
      }
      writeCurrentLocalSnapshot(latestSnapshot.current);
      scrubSnapshotAfterClear(clearSignalAtFlush);
    };
    const handleVisibility = () => {
      if (document.hidden) flushDeviceState();
    };
    window.addEventListener("pagehide", flushDeviceState);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", flushDeviceState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [scrubSnapshotAfterClear, storageKey, writeCurrentLocalSnapshot]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!ready) return;
    if (previousView.current === view) return;
    previousView.current = view;
    const frame = window.requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, view]);

  const avatarOutfit = useMemo(
    () => avatarOutfitFromSelection(outfit, wardrobe) as AvatarOutfit,
    [outfit, wardrobe],
  );

  function navigate(next: View) {
    setView(next);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function markLocalChange() {
    localChangeGeneration.current += 1;
    setDataMode((current) =>
      current === "仅本次有效" || current === "等待选择"
        ? current
        : usesDeviceOnlyStorage()
          ? "正在本机保存"
          : "部分已同步",
    );
  }

  function updateMetrics(action: React.SetStateAction<BodyMetrics>) {
    const pendingCloudSave = !usesDeviceOnlyStorage();
    const currentMetrics = latestSnapshot.current.metrics;
    const nextMetrics = typeof action === "function"
      ? action(currentMetrics)
      : action;
    profilePending.current = pendingCloudSave;
    profileEditGeneration.current += 1;
    latestSnapshot.current = {
      ...latestSnapshot.current,
      metrics: nextMetrics,
      profilePending: pendingCloudSave,
    };
    setMetrics(nextMetrics);
    if (pendingCloudSave && profileSaveQueue.current?.running) {
      profileSaveQueue.current.enqueue({
        metrics: nextMetrics,
        editGeneration: profileEditGeneration.current,
        requestEpoch: mutationEpoch.current,
      });
    }
    markLocalChange();
  }

  function updateOutfit(action: React.SetStateAction<OutfitSelection>) {
    setOutfit(action);
    markLocalChange();
  }

  function addToCart(product: Product) {
    if (cartProductIds.current.has(product.id)) {
      setToast(`${product.name} 已经在虚拟购物袋里`);
      return;
    }
    cartProductIds.current.add(product.id);
    setCart((current) => [...current, product]);
    markLocalChange();
    setToast(`${product.name} 已放进虚拟购物袋`);
  }

  function removeFromCart(index: number) {
    setCart((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      cartProductIds.current = new Set(next.map((item) => item.id));
      return next;
    });
    markLocalChange();
  }

  function toggleSavedProduct(productId: string) {
    setSavedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
    markLocalChange();
  }

  function tryProduct(product: Product) {
    const item = createVirtualWardrobeItem(product) as WardrobeItem | null;
    if (!item) {
      setToast("这类商品可以放进虚拟购物袋，当前不提供虚假的试用效果");
      return;
    }
    if (!wardrobe.some((entry) => entry.id === item.id) && wardrobe.length >= MAX_WARDROBE_ITEMS) {
      setToast(`衣橱最多保存 ${MAX_WARDROBE_ITEMS} 件，请先移除一件再收入`);
      return;
    }
    setWardrobe((current) => (current.some((entry) => entry.id === item.id) ? current : [item, ...current]));
    markLocalChange();
    if (!supportsAvatarTryOn(product.category)) {
      setToast(`${product.name} 已收入衣橱；这类单品暂不参与 3D 上身`);
      return;
    }
    wearItem(item);
    navigate("studio");
    setToast("已经穿到分身上，慢慢看看");
  }

  function wearItem(item: WardrobeItem) {
    updateOutfit((current) => wearWardrobeItem(current, item));
  }

  async function deleteWardrobeItem(item: WardrobeItem) {
    if (!window.confirm(`确定从衣橱移除“${item.name}”吗？这不会影响真实购买记录。`)) return;
    const requestEpoch = mutationEpoch.current;
    let deletedFromCloud = false;
    let queuedCloudDeletion = false;
    const clientId = item.clientId && isClientWardrobeId(item.clientId)
      ? item.clientId
      : item.source === "我的衣服" && isClientWardrobeId(item.id)
        ? item.id
        : undefined;
    const expectedCloudId = clientId && storageOwner
      ? await wardrobeCloudId(storageOwner, clientId)
      : null;
    const shouldDeleteFromCloud = !usesDeviceOnlyStorage() && (
      Boolean(clientId) || cloudItemIds.current.has(item.id)
    );
    if (shouldDeleteFromCloud) {
      try {
        const query = clientId
          ? `clientId=${encodeURIComponent(clientId)}`
          : `id=${encodeURIComponent(item.id)}`;
        const response = await fetchCloudMutation(
          `/api/wardrobe?${query}`,
          { method: "DELETE" },
        );
        if (mutationEpoch.current !== requestEpoch) return;
        if (!response.ok) {
          if (adoptStaleCloudGeneration(response)) return;
          throw new Error("Delete failed");
        }
        deletedFromCloud = true;
        if (clientId) deletedWardrobeClientIds.current.delete(clientId);
        cloudItemIds.current.delete(item.id);
        if (expectedCloudId) cloudItemIds.current.delete(expectedCloudId);
      } catch {
        if (mutationEpoch.current !== requestEpoch) return;
        if (!clientId) {
          setToast("云端删除没有成功，这件衣服仍保留在衣橱中");
          return;
        }
        deletedWardrobeClientIds.current.add(clientId);
        queuedCloudDeletion = true;
      }
    }
    const removedIds = [item.id, expectedCloudId].filter((id): id is string => Boolean(id));
    const removed = clientId
      ? removeWardrobeIdentity(
          latestSnapshot.current.wardrobe,
          latestSnapshot.current.outfit ?? {},
          clientId,
          removedIds,
        )
      : {
          wardrobe: latestSnapshot.current.wardrobe.filter((entry) => entry.id !== item.id),
          outfit: {
            topId: latestSnapshot.current.outfit?.topId === item.id ? undefined : latestSnapshot.current.outfit?.topId,
            bottomId: latestSnapshot.current.outfit?.bottomId === item.id ? undefined : latestSnapshot.current.outfit?.bottomId,
            dressId: latestSnapshot.current.outfit?.dressId === item.id ? undefined : latestSnapshot.current.outfit?.dressId,
            outerwearId: latestSnapshot.current.outfit?.outerwearId === item.id ? undefined : latestSnapshot.current.outfit?.outerwearId,
          },
        };
    flushSync(() => {
      setWardrobe(removed.wardrobe);
      setOutfit(removed.outfit);
    });
    markLocalChange();
    if (deletedFromCloud) {
      const hasPendingWardrobe =
        deletedWardrobeClientIds.current.size > 0 ||
        hasPendingWardrobeItems(removed.wardrobe, cloudItemIds.current);
      if (!externalSnapshotRaw.current) {
        setDataMode(
          hasPendingWardrobe || profileNeedsSync()
            ? "部分已同步"
            : "云端已同步",
        );
      }
    }
    await requestDeviceSnapshotWrite();
    if (mutationEpoch.current !== requestEpoch) return;
    setToast(
      queuedCloudDeletion
        ? `${item.name} 已从本机移除；联网后会继续清理云端副本`
        : `${item.name} 已从衣橱移除`,
    );
  }

  function checkout() {
    const wearable = cart.map(createVirtualWardrobeItem).filter(Boolean) as WardrobeItem[];
    const newWearable = wearable.filter(
      (item) => !wardrobe.some((entry) => entry.id === item.id),
    );
    if (wardrobe.length + newWearable.length > MAX_WARDROBE_ITEMS) {
      setToast(`衣橱最多保存 ${MAX_WARDROBE_ITEMS} 件，请先移除一些衣物再完成`);
      return;
    }
    setWardrobe((current) => mergeWardrobe(wearable, current));
    setSavedProductIds((current) => [...new Set([...current, ...cart.map((item) => item.id)])]);
    markLocalChange();
    cartProductIds.current.clear();
    setCart([]);
    setCartOpen(false);
    setCelebrationOpen(true);
    setMood((current) => Math.min(100, current + 11));
  }

  function getProfileSaveQueue() {
    if (!profileSaveQueue.current) {
      profileSaveQueue.current = createSerialLatestQueue(executeProfileSave);
    }
    return profileSaveQueue.current;
  }

  function queueProfileSave(job: ProfileSaveJob) {
    const queue = getProfileSaveQueue();
    const wasRunning = queue.running;
    const completed = queue.enqueue(job);
    if (!wasRunning) {
      setProfileSaving(true);
      void completed.finally(() => setProfileSaving(false));
    }
    return completed;
  }

  async function executeProfileSave(job: ProfileSaveJob) {
    if (mutationEpoch.current !== job.requestEpoch) return false;
    profilePending.current = true;
    latestSnapshot.current = {
      ...latestSnapshot.current,
      profilePending: true,
      profileRevision: profileRevision.current,
    };
    try {
      const response = await fetchCloudMutation(
        "/api/profile",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...job.metrics,
            expectedRevision: profileRevision.current,
          }),
        },
      );
      if (mutationEpoch.current !== job.requestEpoch) return false;
      if (!response.ok) {
        if (adoptStaleCloudGeneration(response)) return false;
        if (response.status === 409) {
          const conflict = await response.json().catch(() => null) as {
            revision?: unknown;
          } | null;
          if (mutationEpoch.current !== job.requestEpoch) return false;
          if (
            typeof conflict?.revision === "number" &&
            Number.isSafeInteger(conflict.revision) &&
            conflict.revision >= 0
          ) {
            profileRevision.current = conflict.revision;
            profileCloudReady.current = true;
            profilePending.current = true;
            latestSnapshot.current = {
              ...latestSnapshot.current,
              profilePending: true,
              profileRevision: conflict.revision,
            };
            await requestDeviceSnapshotWrite();
            if (mutationEpoch.current !== job.requestEpoch) return false;
            setDataMode(externalSnapshotRaw.current ? "等待选择" : "部分已同步");
            setToast("另一标签页刚保存了分身；本页调整仍保留，再次确认即可覆盖");
            return false;
          }
        }
        throw new Error();
      }
      const saved = await response.json() as { revision?: unknown };
      if (mutationEpoch.current !== job.requestEpoch) return false;
      if (
        typeof saved.revision !== "number" ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision < 1
      ) throw new Error();
      profileRevision.current = saved.revision;
      profileCloudReady.current = true;
      const savedLatestProfile = profileEditGeneration.current === job.editGeneration;
      if (savedLatestProfile) {
        profilePending.current = false;
        latestSnapshot.current = {
          ...latestSnapshot.current,
          metrics: job.metrics,
          profilePending: false,
          profileRevision: saved.revision,
        };
      } else {
        latestSnapshot.current = {
          ...latestSnapshot.current,
          profileRevision: saved.revision,
        };
      }
      const deviceSaveResult = await requestDeviceSnapshotWrite();
      if (mutationEpoch.current !== job.requestEpoch) return false;
      const hasPendingWardrobe =
        deletedWardrobeClientIds.current.size > 0 ||
        hasPendingWardrobeItems(latestSnapshot.current.wardrobe, cloudItemIds.current);
      const deviceSaveIncomplete =
        deviceSaveResult === "failed" ||
        deviceSaveResult === "incompatible" ||
        deviceSaveResult === "superseded";
      const stillPending =
        hasPendingWardrobe || profilePending.current || deviceSaveIncomplete;
      setDataMode(
        deviceSaveResult === "superseded"
          ? "等待选择"
          : stillPending
            ? "部分已同步"
            : "云端已同步",
      );
      setToast(
        deviceSaveResult === "superseded"
          ? "云端分身已保存；请先选择如何处理另一标签页的修改"
          : deviceSaveResult === "incompatible"
          ? "云端分身已保存；当前版本不会覆盖由新版保存的本机资料"
          : deviceSaveResult === "failed"
            ? "云端分身已保存，但浏览器没有更新本机副本"
            : profilePending.current
              ? "已保存刚才的参数；最新调整正在排队保存"
              : hasPendingWardrobe
                ? "分身参数已保存；仍有衣橱变更等待同步"
                : "分身参数已安心保存",
      );
      return true;
    } catch {
      if (mutationEpoch.current !== job.requestEpoch) return false;
      profileCloudReady.current = false;
      profilePending.current = true;
      latestSnapshot.current = {
        ...latestSnapshot.current,
        profilePending: true,
        profileRevision: profileRevision.current,
      };
      const deviceSaveResult = await requestDeviceSnapshotWrite();
      if (mutationEpoch.current !== job.requestEpoch) return false;
      setDataMode(deviceSaveResult === "superseded" ? "等待选择" : "部分已同步");
      setToast(
        deviceSaveResult === "superseded"
          ? "本页分身参数仍保留；请先处理另一标签页的修改"
          : deviceSaveResult === "incompatible"
          ? "云端暂未保存；当前版本也不会覆盖由新版保存的本机资料"
          : deviceSaveResult === "failed"
            ? "暂时无法保存分身参数，请检查浏览器存储和网络"
            : "分身参数已保存在这台设备",
      );
      return false;
    }
  }

  async function saveMetrics() {
    const requestEpoch = mutationEpoch.current;
    if (usesDeviceOnlyStorage()) {
      profilePending.current = false;
      latestSnapshot.current = {
        ...latestSnapshot.current,
        metrics,
        profilePending: false,
        profileRevision: profileRevision.current,
      };
      const deviceSaveResult = await requestDeviceSnapshotWrite();
      if (mutationEpoch.current !== requestEpoch) return;
      if (deviceSaveResult === "superseded") {
        setDataMode("等待选择");
        setToast("分身参数仍保留在本页；请先处理另一标签页的修改");
      } else if (deviceSaveResult === "incompatible") {
        setDataMode("仅本次有效");
        setToast("当前分身仅在本页生效；这个版本不会覆盖由新版保存的本机资料");
      } else if (deviceSaveResult === "failed") {
        setDataMode("仅本次有效");
        setToast("浏览器阻止了本机保存，当前分身会保留到页面关闭");
      } else {
        setDataMode("本机已保存");
        setToast("分身参数已保存在这台设备");
      }
      return;
    }
    profilePending.current = true;
    latestSnapshot.current = {
      ...latestSnapshot.current,
      profilePending: true,
      profileRevision: profileRevision.current,
    };
    await requestDeviceSnapshotWrite();
    if (mutationEpoch.current !== requestEpoch) return;
    await queueProfileSave({
      metrics: latestSnapshot.current.metrics,
      editGeneration: profileEditGeneration.current,
      requestEpoch,
    });
  }

  async function addWardrobeItem(item: WardrobeItem, photo?: File): Promise<string | null> {
    if (wardrobe.length >= MAX_WARDROBE_ITEMS) {
      const message = `衣橱最多保存 ${MAX_WARDROBE_ITEMS} 件，请先移除一件再添加`;
      setToast(message);
      return message;
    }
    const requestEpoch = mutationEpoch.current;
    const addToDevice = async () => {
      const deviceImage = await photoToDeviceImage(photo);
      if (mutationEpoch.current !== requestEpoch) return false;
      const localItem = { ...item, imageUrl: deviceImage };
      setWardrobe((current) => [
        localItem,
        ...current.filter((entry) => entry.id !== localItem.id),
      ]);
      markLocalChange();
      return !photo || Boolean(deviceImage);
    };

    let photoSaved = true;
    if (usesDeviceOnlyStorage()) {
      photoSaved = await addToDevice();
    } else {
      try {
        const response = await fetchCloudMutation(
          "/api/wardrobe",
          { method: "POST", body: wardrobeItemForm(item, photo) },
          CLOUD_UPLOAD_TIMEOUT_MS,
        );
        if (mutationEpoch.current !== requestEpoch) return null;
        if (response.status === 409 && adoptStaleCloudGeneration(response)) return null;
        if (response.status === 409) {
          const message = `云端衣橱最多保存 ${MAX_WARDROBE_ITEMS} 件，请先移除一件`;
          setToast(message);
          return message;
        }
        if (response.status === 410) {
          const message = "这份衣物草稿已在其他标签页删除，请重新添加";
          setToast(message);
          return message;
        }
        if (!response.ok) {
          if (adoptStaleCloudGeneration(response)) return null;
          throw new Error();
        }
        const data = (await response.json()) as { item: WardrobeItem };
        if (mutationEpoch.current !== requestEpoch) return null;
        cloudItemIds.current.add(data.item.id);
        setWardrobe((current) => [
          data.item,
          ...current.filter(
            (entry) => entry.id !== data.item.id && entry.id !== data.item.clientId,
          ),
        ]);
        markLocalChange();
        const hasPendingWardrobe =
          deletedWardrobeClientIds.current.size > 0 ||
          hasPendingWardrobeItems(
            [
              data.item,
              ...wardrobe.filter(
                (entry) => entry.id !== data.item.id && entry.id !== data.item.clientId,
              ),
            ],
            cloudItemIds.current,
          );
        if (!externalSnapshotRaw.current) {
          setDataMode(
            hasPendingWardrobe || profileNeedsSync()
              ? "部分已同步"
              : "云端已同步",
          );
        }
      } catch {
        if (mutationEpoch.current !== requestEpoch) return null;
        photoSaved = await addToDevice();
      }
    }
    if (mutationEpoch.current !== requestEpoch) return null;
    setAddOpen(false);
    setToast(
      photoSaved
        ? "这件衣服已经住进你的衣橱"
        : "衣物资料已保存，但这张照片未能保存在本机",
    );
    return null;
  }

  async function clearPersonalData() {
    if (clearingData) return;
    const confirmed = window.confirm(
      "确定清除衣橱、身体参数、搭配、收藏和虚拟购物袋吗？登录版也会清除云端资料。这个操作不能撤销。",
    );
    if (!confirmed) return;

    const deviceOnly = usesDeviceOnlyStorage();
    const expectedCloudGeneration = cloudGeneration.current;
    const emptySnapshot = emptyPersonalSnapshot();
    const resumableClear = readActiveClearMarker(storageKey);
    const nextClearSignal = resumableClear?.status === "failed"
      ? resumableClear.signal
      : createClearSignal();
    const clearStartedAt = resumableClear?.status === "failed"
      ? resumableClear.clearedAt
      : new Date().toISOString();
    const marker = serializeClearMarker(nextClearSignal, clearStartedAt);
    let operationEpoch = -1;
    const operationOwnsBoundary = () => {
      const activeMarker = readActiveClearMarker(storageKey);
      return (
        mutationEpoch.current === operationEpoch &&
        observedClearSignal.current === nextClearSignal &&
        (!activeMarker || activeMarker.signal === nextClearSignal)
      );
    };
    const operationIsPending = () => {
      const activeMarker = readActiveClearMarker(storageKey);
      return (
        operationOwnsBoundary() &&
        (!activeMarker || activeMarker.status === "pending")
      );
    };
    const publishClearResult = async (
      success: boolean,
      completedSnapshot?: Omit<LocalSnapshot, "version" | "updatedAt">,
    ) => {
      if (!operationIsPending()) return false;
      const resultMarker = success
        ? serializeCompletedClearMarker(
            nextClearSignal,
            cloudGeneration.current,
            clearStartedAt,
          )
        : serializeFailedClearMarker(nextClearSignal, clearStartedAt);
      return runClearBoundaryTask(() => {
        if (!operationIsPending()) return false;
        let ownerBoundaryAccepted = false;
        for (const targetStorageKey of new Set([storageKey, LOCAL_SNAPSHOT_KEY])) {
          if (!operationOwnsBoundary()) return false;
          const activeMarker = readActiveClearMarker(targetStorageKey);
          if (
            activeMarker &&
            activeMarker.signal !== nextClearSignal &&
            compareClearSignals(activeMarker.signal, nextClearSignal) > 0
          ) continue;
          if (completedSnapshot) {
            writeLocalSnapshot(
              targetStorageKey,
              completedSnapshot,
              nextClearSignal,
              true,
            );
          }
          const markerSaved = persistClearMarker(targetStorageKey, resultMarker);
          if (targetStorageKey === storageKey) {
            ownerBoundaryAccepted = markerSaved || !activeMarker;
          }
          if (!markerSaved) continue;
          clearChannel.current?.postMessage({
            type: "personal-data-clear-finished",
            scope: coordinationScope(targetStorageKey),
            marker: resultMarker,
            success,
            cloudGeneration: cloudGeneration.current,
          });
        }
        if (success && ownerBoundaryAccepted) {
          lastCompletedClearSignal.current = nextClearSignal;
        }
        if (ownerBoundaryAccepted && completedSnapshot) {
          try {
            lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
          } catch {
            // The completion UI reports blocked local persistence separately.
          }
        }
        return ownerBoundaryAccepted;
      });
    };
    const initialBoundary = await runClearBoundaryTask(() => {
      const ownerMarker = readActiveClearMarker(storageKey);
      if (
        ownerMarker &&
        ownerMarker.signal !== nextClearSignal &&
        compareClearSignals(ownerMarker.signal, nextClearSignal) > 0
      ) {
        return { started: false } as const;
      }
      const publishPending = (targetStorageKey: string) => {
        const targetMarker = readActiveClearMarker(targetStorageKey);
        if (
          targetMarker &&
          targetMarker.signal !== nextClearSignal &&
          compareClearSignals(targetMarker.signal, nextClearSignal) > 0
        ) return false;
        const markerSaved = persistClearMarker(targetStorageKey, marker);
        if (markerSaved) {
          clearChannel.current?.postMessage({
            type: "personal-data-cleared",
            scope: coordinationScope(targetStorageKey),
            marker,
          });
        }
        return markerSaved;
      };
      const currentMarkerSaved = publishPending(storageKey);
      const legacyMarkerSaved = storageKey === LOCAL_SNAPSHOT_KEY
        ? currentMarkerSaved
        : publishPending(LOCAL_SNAPSHOT_KEY);
      const currentRemoved = removeLocalSnapshot(storageKey);
      const legacyRemoved = storageKey === LOCAL_SNAPSHOT_KEY
        ? currentRemoved
        : legacyMarkerSaved
          ? removeLocalSnapshot(LOCAL_SNAPSHOT_KEY)
          : false;
      const saveResult = writeLocalSnapshot(
        storageKey,
        emptySnapshot,
        nextClearSignal,
        true,
      );
      const legacySaveResult =
        storageKey !== LOCAL_SNAPSHOT_KEY && legacyMarkerSaved && !legacyRemoved
          ? writeLocalSnapshot(
              LOCAL_SNAPSHOT_KEY,
              emptySnapshot,
              nextClearSignal,
              true,
            )
          : null;
      const finalOwnerMarker = readActiveClearMarker(storageKey);
      const ownerBoundaryConfirmed =
        finalOwnerMarker !== null &&
        finalOwnerMarker.signal === nextClearSignal &&
        finalOwnerMarker.status === "pending";
      return {
        started:
          ownerBoundaryConfirmed ||
          (!currentMarkerSaved && finalOwnerMarker === null),
        currentMarkerSaved,
        legacyMarkerSaved,
        currentRemoved,
        legacyRemoved,
        saveResult,
        legacySaveResult,
      } as const;
    });
    if (!initialBoundary.started) {
      setToast("另一标签页已开始更新的清除操作，正在接收它的结果");
      window.location.reload();
      return;
    }
    const activeBoundary = readActiveClearMarker(storageKey);
    if (
      activeBoundary &&
      activeBoundary.signal !== nextClearSignal
    ) {
      observedClearSignal.current = activeBoundary.signal;
      setToast("另一标签页已开始更新的清除操作，正在接收它的结果");
      window.location.reload();
      return;
    }
    observedClearSignal.current = nextClearSignal;
    lastAppliedClearSignal.current = nextClearSignal;

    mutationEpoch.current += 1;
    operationEpoch = mutationEpoch.current;
    deviceCoordinationGeneration.current += 1;
    profileSaveQueue.current?.clear();
    const pendingMutations = [...pendingCloudMutations.current];
    pendingWardrobeSyncIds.current.clear();
    pendingWardrobeDeletionIds.current.clear();
    deletedWardrobeClientIds.current.clear();
    wardrobeCloudReady.current = false;
    profileCloudReady.current = false;
    profilePending.current = false;
    profileRevision.current = 0;
    profileEditGeneration.current += 1;
    incompatibleSnapshot.current = false;
    clearExternalSnapshotNotice();
    lastKnownSnapshotRaw.current = null;
    localChangeGeneration.current = 0;
    persistedLocalChangeGeneration.current = 0;
    unlockedDeviceWritePending.current = false;
    cloudItemIds.current.clear();
    cartProductIds.current.clear();
    latestSnapshot.current = emptySnapshot;
    flushSync(() => {
      setCartOpen(false);
      setAddOpen(false);
      setCelebrationOpen(false);
      setWardrobe([]);
      setMetrics(DEFAULT_METRICS);
      setOutfit({});
      setMood(62);
      setCart([]);
      setSavedProductIds([]);
      setDailyPreferences(DEFAULT_DAILY_PREFERENCES);
      setClearingData(true);
    });

    try {
      lastKnownSnapshotRaw.current = window.localStorage.getItem(storageKey);
    } catch {
      // The clear result below still reports whether the local copy was removed.
    }
    const currentCleared =
      initialBoundary.currentMarkerSaved &&
      (initialBoundary.currentRemoved ||
        initialBoundary.saveResult !== "failed" ||
        isClearedLocalSnapshot(storageKey));
    const legacyCleared = storageKey === LOCAL_SNAPSHOT_KEY
      ? currentCleared
      : initialBoundary.legacyMarkerSaved &&
        (initialBoundary.legacyRemoved ||
          (initialBoundary.legacySaveResult !== null &&
            initialBoundary.legacySaveResult !== "failed") ||
          isClearedLocalSnapshot(LOCAL_SNAPSHOT_KEY));
    const localCleared = currentCleared && legacyCleared;
    let enteredClearUi = true;

    try {
      if (!deviceOnly) {
        pendingMutations.forEach((mutation) => mutation.controller.abort());
        await Promise.allSettled(
          pendingMutations.map((mutation) => mutation.promise),
        );
        if (!operationIsPending()) return;

        let deletionResponse: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!operationIsPending()) return;
          try {
            deletionResponse = await fetchCloudMutation(
              "/api/personal-data",
              {
                method: "DELETE",
                headers: {
                  [DATA_GENERATION_HEADER]: expectedCloudGeneration,
                  [CLEAR_REQUEST_HEADER]: nextClearSignal,
                },
              },
            );
          } catch {
            if (!operationIsPending()) return;
            if (attempt < 2 && navigator.onLine) continue;
            throw new Error("cloud deletion unavailable");
          }
          if (!operationIsPending()) return;
          if (deletionResponse.ok) break;
          if (deletionResponse.status === 503 && attempt < 2) continue;
          break;
        }
        if (!deletionResponse) throw new Error("cloud deletion unavailable");
        const authoritativeGeneration = deletionResponse.headers
          .get(DATA_GENERATION_HEADER)?.trim() ?? null;
        const clearAction = clearMutationAction(
          deletionResponse.status,
          expectedCloudGeneration,
          authoritativeGeneration,
        );
        if (clearAction === "stale" && authoritativeGeneration) {
          if (!operationIsPending()) return;
          cloudGeneration.current = authoritativeGeneration;
          const refreshedSnapshot = { ...emptySnapshot, cloudGeneration: authoritativeGeneration };
          latestSnapshot.current = refreshedSnapshot;
          if (!await publishClearResult(true, refreshedSnapshot)) return;
          window.location.reload();
          return;
        }
        if (!deletionResponse.ok) {
          throw new Error("cloud deletion failed");
        }
        const confirmedGeneration = deletionResponse.headers.get(DATA_GENERATION_HEADER)?.trim();
        if (!confirmedGeneration) throw new Error("cloud generation missing");
        if (!operationIsPending()) return;
        cloudGeneration.current = confirmedGeneration;
        wardrobeCloudReady.current = true;
        profileCloudReady.current = true;
        const completedSnapshot = {
          ...emptySnapshot,
          cloudGeneration: confirmedGeneration,
        };
        latestSnapshot.current = completedSnapshot;
        if (!await publishClearResult(true, completedSnapshot)) return;
      } else {
        if (!await publishClearResult(true)) return;
      }

      setDataMode(
        deviceOnly
          ? localCleared
            ? "本机已保存"
            : "仅本次有效"
          : localCleared
            ? "云端已同步"
            : "部分已同步",
      );
      setToast(
        localCleared
          ? "个人资料已清除，衣橱现在是空的"
          : deviceOnly
            ? "页面中的资料已清空；浏览器阻止清除本机副本，请在网站数据设置中删除"
            : "云端资料已清除；浏览器阻止清除本机副本，请在网站数据设置中删除",
      );
    } catch {
      if (!operationIsPending() || !await publishClearResult(false)) return;
      setDataMode(deviceOnly ? (localCleared ? "本机已保存" : "仅本次有效") : "部分已同步");
      setToast(
        localCleared
          ? "本机资料已清除；云端还没有全部清除，请检查网络后重试"
          : "页面资料已清空，但本机副本和云端还没有全部清除，请检查设置与网络",
      );
    } finally {
      if (operationOwnsBoundary()) {
        flushSync(() => setClearingData(false));
        window.requestAnimationFrame(() => {
          const heading = mainRef.current?.querySelector<HTMLElement>("h1");
          if (!heading) return;
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        });
      } else if (enteredClearUi) {
        enteredClearUi = false;
        window.location.reload();
      }
    }
  }

  const backgroundInert = clearingData || cartOpen || addOpen || celebrationOpen;

  return (
    <>
      <div
        className="site-shell"
        aria-busy={clearingData}
        inert={backgroundInert ? true : undefined}
      >
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar">
        <button type="button" className="brand" disabled={!ready} onClick={() => navigate("home")} aria-label="回到松松逛首页">
          <span className="brand-mark" aria-hidden="true">松</span>
          <span><strong>松松逛</strong><small>MELLOW CLOSET</small></span>
        </button>
        <nav className="desktop-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={!ready}
              className={view === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span aria-hidden="true" className={`sync-state sync-state--${dataMode === "云端已同步" || dataMode === "本机已保存" ? "saved" : "demo"}`}>
            <span aria-hidden="true">●</span> {dataMode}
          </span>
          <button type="button" className="bag-button" disabled={!ready} onClick={(event) => { dialogOpenerRef.current = event.currentTarget; setCartOpen(true); }} aria-label={`打开虚拟购物袋，共 ${cart.length} 件`}>
            <span aria-hidden="true">▢</span>
            <span>虚拟购物袋</span>
            <b>{cart.length}</b>
          </button>
        </div>
      </header>

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {externalUpdateAvailable
          ? "检测到另一标签页的新修改；自动保存已暂停。请在页面顶部选择载入另一页或保留本页。"
          : `保存状态：${dataMode}`}
      </span>

      {externalUpdateAvailable && (
        <section ref={externalUpdateRef} className="external-update" role="region" aria-labelledby="external-update-title">
          <div>
            <strong id="external-update-title">另一标签页有新修改</strong>
            <p>为避免覆盖，本页已暂停自动保存。你可以载入最新内容，或明确保留本页内容。</p>
          </div>
          <div className="external-update__actions">
            <button type="button" className="button button--soft" disabled={!ready} onClick={useExternalSnapshot}>载入另一页</button>
            <button type="button" className="button button--dark" disabled={!ready} onClick={() => void keepCurrentSnapshot()}>保留本页</button>
          </div>
        </section>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {ready ? "衣橱已准备好，现在可以编辑" : "正在取回你的衣橱"}
      </span>

      {!ready && (
        <div className="hydration-status">
          <span aria-hidden="true" /> 正在取回你的衣橱，完成前暂时不能编辑
        </div>
      )}
      <main id="main-content" ref={mainRef} tabIndex={-1} aria-busy={!ready} inert={ready ? undefined : true}>
        {view === "home" && (
          <HomeView
            metrics={metrics}
            avatarOutfit={avatarOutfit}
            wardrobe={wardrobe}
            mood={mood}
            setMood={(value) => {
              setMood(value);
              markLocalChange();
            }}
            onNavigate={navigate}
            onWear={(item) => {
              wearItem(item);
              navigate("studio");
            }}
          />
        )}
        {view === "shop" && (
          <ShopView
            saved={savedProductIds}
            onToggleSaved={toggleSavedProduct}
            onAdd={addToCart}
            onTry={tryProduct}
          />
        )}
        {view === "closet" && (
          <ClosetView
            wardrobe={wardrobe}
            onAdd={(opener) => { dialogOpenerRef.current = opener; setAddOpen(true); }}
            onDelete={deleteWardrobeItem}
            onClearData={clearPersonalData}
            clearingData={clearingData}
            onWear={(item) => {
              wearItem(item);
              navigate("studio");
            }}
          />
        )}
        {view === "studio" && (
          <StudioView
            wardrobe={wardrobe}
            metrics={metrics}
            setMetrics={updateMetrics}
            outfit={outfit}
            setOutfit={updateOutfit}
            avatarOutfit={avatarOutfit}
            onWear={wearItem}
            onSave={saveMetrics}
            profileSaving={profileSaving}
          />
        )}
        {view === "daily" && (
          <DailyView
            wardrobe={wardrobe}
            metrics={metrics}
            preferences={dailyPreferences}
            onPreferencesChange={(field, value) => {
              setDailyPreferences((current) => ({ ...current, [field]: value }));
              markLocalChange();
            }}
            onApply={(selection) => {
              updateOutfit(selection);
              navigate("studio");
              setToast("这套已经穿到分身上");
            }}
          />
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            disabled={!ready}
            className={view === item.id ? "is-active" : ""}
            onClick={() => navigate(item.id)}
            aria-current={view === item.id ? "page" : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.short}
          </button>
        ))}
      </nav>
      </div>

      {cartOpen && (
        <CartDrawer
          cart={cart}
          onClose={() => setCartOpen(false)}
          onRemove={removeFromCart}
          onCheckout={checkout}
          returnFocusRef={dialogOpenerRef}
        />
      )}
      {addOpen && <DeferredAddGarmentDialog onClose={() => setAddOpen(false)} onAdd={addWardrobeItem} returnFocusRef={dialogOpenerRef} />}
      {celebrationOpen && (
        <CelebrationDialog
          onClose={() => setCelebrationOpen(false)}
          returnFocusRef={dialogOpenerRef}
          onCloset={() => {
            setCelebrationOpen(false);
            navigate("closet");
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {clearingData && (
        <div className="data-clearing-status" role="status" aria-live="assertive">
          <p><span aria-hidden="true" /> 正在安全清除个人资料，请稍候</p>
        </div>
      )}
    </>
  );
}

function HomeView({
  metrics,
  avatarOutfit,
  wardrobe,
  mood,
  setMood,
  onNavigate,
  onWear,
}: {
  metrics: BodyMetrics;
  avatarOutfit: AvatarOutfit;
  wardrobe: WardrobeItem[];
  mood: number;
  setMood: (value: number) => void;
  onNavigate: (view: View) => void;
  onWear: (item: WardrobeItem) => void;
}) {
  const previewableWardrobe = wardrobe.filter((item) => supportsAvatarTryOn(item.category));
  const hasCurrentLook = Object.values(avatarOutfit).some(Boolean);
  const canBuildOutfit = previewableWardrobe.some((item) => item.category === "连衣裙") || (
    previewableWardrobe.some((item) => item.category === "上装") &&
    previewableWardrobe.some((item) => item.category === "下装")
  );
  return (
    <div className="page page--home">
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow"><span aria-hidden="true">✦</span> 今天不需要做正确选择</p>
          <h1>想买就先在这里拥有，<br /><em>不用真的花钱。</em></h1>
          <p className="hero-lead">
            像逛喜欢的商店一样慢慢挑，也可以把自己的衣服穿到数字分身上。这里没有付款、银行卡和真实订单。
          </p>
          <div className="hero-actions">
            <button type="button" className="button button--primary" onClick={() => onNavigate("shop")}>开始慢慢逛 <span aria-hidden="true">→</span></button>
            <button type="button" className="button button--soft" onClick={() => onNavigate(canBuildOutfit ? "daily" : "closet")}>✦ {canBuildOutfit ? "生成今日搭配" : "先整理衣橱"}</button>
          </div>
          <div className="reassurance-row">
            <span><i aria-hidden="true">✓</i> 永远 0 元</span>
            <span><i aria-hidden="true">✓</i> 不收集银行卡</span>
            <span><i aria-hidden="true">✓</i> 身体友好</span>
          </div>
        </div>
        <div className="hero-avatar-card">
          <div className="hero-card-top">
            <div><span>今日试穿</span><strong>{todayLabel()}</strong></div>
            <button type="button" onClick={() => onNavigate("studio")}>进入试穿间 ↗</button>
          </div>
          <DeferredAvatar metrics={metrics} outfit={avatarOutfit} compact />
          <div className="hero-look-note">
            <span className="look-swatches" aria-hidden="true"><i style={{ background: avatarOutfit.top?.color }} /><i style={{ background: avatarOutfit.bottom?.color }} /><i style={{ background: avatarOutfit.outerwear?.color }} /></span>
            <div><strong>{hasCurrentLook ? "舒服但不无聊的一套" : "分身正在等第一套衣服"}</strong><small>{hasCurrentLook ? "适合散步、上课和不赶时间的下午" : "从衣橱穿上一件，或先去轻松逛逛"}</small></div>
          </div>
        </div>
      </section>

      <section className="mood-strip" aria-labelledby="mood-heading">
        <div className="mood-copy"><span className="breathing-orb" aria-hidden="true" /><div><p className="section-kicker">一小口呼吸</p><h2 id="mood-heading">现在的心情，有松一点吗？</h2></div></div>
        <div className="mood-control">
          <span>有点绷</span>
          <input aria-label="当前放松程度" aria-valuetext={`放松程度 ${mood}%`} type="range" min="0" max="100" value={mood} onChange={(event) => setMood(Number(event.target.value))} style={{ "--mood-value": `${mood}%` } as React.CSSProperties} />
          <span>松下来了</span>
          <b>{mood}%</b>
        </div>
      </section>

      <section className="home-grid">
        <article className="feature-card feature-card--outfit">
          <div className="card-heading"><div><p className="section-kicker">今日搭配</p><h2>{canBuildOutfit ? "衣橱已经替你想好了" : "再添一件，就能开始搭配"}</h2></div><button type="button" className="text-button" onClick={() => onNavigate(canBuildOutfit ? "daily" : "closet")}>{canBuildOutfit ? "看看搭配建议 →" : "打开衣橱 →"}</button></div>
          <div className="outfit-preview-row">
            {previewableWardrobe.slice(0, 3).map((item) => (
              <button type="button" key={item.id} className="mini-item" onClick={() => onWear(item)}>
                <MiniGarment item={item} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </article>
        <article className="feature-card feature-card--closet">
          <div className="closet-count"><strong>{wardrobe.length}</strong><span>件衣服正在等你重新喜欢它们</span></div>
          <div className="closet-stack" aria-hidden="true">
            {wardrobe.slice(0, 4).map((item, index) => <i key={item.id} style={{ background: item.color, transform: `rotate(${(index - 1.5) * 5}deg)` }} />)}
          </div>
          <button type="button" className="text-button" onClick={() => onNavigate("closet")}>打开我的衣橱 →</button>
        </article>
      </section>

      <section className="how-section">
        <div className="section-title"><div><p className="section-kicker">你的两个空间</p><h2>逛一会儿，也照顾好真实的自己</h2></div><p>不用先把一切准备完，从任何一步开始都可以。</p></div>
        <div className="path-grid">
          <button type="button" className="path-card path-card--shop" onClick={() => onNavigate("shop")}>
            <span className="path-number">01</span><div><small>VIRTUAL SHOPPING</small><h3>松松逛</h3><p>服装、美妆和装饰都能放进袋子。结账只是一个快乐的结束动作，不会扣款。</p></div><span className="path-arrow">↗</span>
          </button>
          <button type="button" className="path-card path-card--closet" onClick={() => onNavigate("studio")}>
            <span className="path-number">02</span><div><small>DIGITAL WARDROBE</small><h3>我的数字衣橱</h3><p>调整接近你的身形，录入自己的衣服，试出明天真正可以穿的一套。</p></div><span className="path-arrow">↗</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ShopView({
  saved,
  onToggleSaved,
  onAdd,
  onTry,
}: {
  saved: string[];
  onToggleSaved: (productId: string) => void;
  onAdd: (product: Product) => void;
  onTry: (product: Product) => void;
}) {
  const [category, setCategory] = useState<(typeof SHOP_CATEGORIES)[number]>("全部");
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const savedFilterRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = PRODUCTS.filter(
    (product) =>
      (category === "全部" || product.category === category) &&
      (!normalizedQuery ||
        product.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        product.colorName.toLocaleLowerCase("zh-CN").includes(normalizedQuery)) &&
      (!savedOnly || saved.includes(product.id)),
  );
  const [resultAnnouncement, setResultAnnouncement] = useState("");

  function toggleSavedAndRestoreFocus(
    productId: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const button = event.currentTarget;
    const grid = button.closest<HTMLElement>(".product-grid");
    const buttonsBefore = grid
      ? Array.from(grid.querySelectorAll<HTMLButtonElement>(".save-button"))
      : [];
    const focusIndex = Math.max(0, buttonsBefore.indexOf(button));
    const willDisappear = savedOnly && saved.includes(productId);
    onToggleSaved(productId);
    if (!willDisappear) return;
    window.requestAnimationFrame(() => {
      const buttonsAfter = grid?.isConnected
        ? Array.from(grid.querySelectorAll<HTMLButtonElement>(".save-button"))
        : [];
      const target = buttonsAfter[Math.min(focusIndex, buttonsAfter.length - 1)];
      (target ?? savedFilterRef.current)?.focus();
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const scope = savedOnly ? "收藏中" : category === "全部" ? "全部分类中" : `${category}分类中`;
      const search = normalizedQuery ? `搜索“${query.trim()}”时，` : "";
      setResultAnnouncement(`${search}${scope}找到 ${visible.length} 件虚拟商品`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [category, normalizedQuery, query, savedOnly, visible.length]);

  return (
    <div className="page page--shop">
      <section className="page-hero page-hero--shop">
        <div><p className="eyebrow">VIRTUAL SHOPPING · 0 元体验</p><h1>慢慢逛，喜欢就收下。</h1><p>所有商品都是虚拟的。没有库存提醒，没有倒计时，也没有任何真实支付。</p></div>
        <div className="imagination-balance"><span>今日想象力余额</span><strong>∞</strong><small>怎么逛都不会变少</small></div>
      </section>
      <section className="shop-toolbar">
        <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索虚拟商品" placeholder="搜一件让你开心的东西" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="chip-row" role="group" aria-label="商品筛选">
          {SHOP_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          <button ref={savedFilterRef} type="button" aria-pressed={savedOnly} className={savedOnly ? "is-active" : ""} onClick={() => setSavedOnly((current) => !current)}>♡ 收藏 {saved.length}</button>
        </div>
      </section>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {resultAnnouncement}
      </p>
      <section className="product-grid">
        {visible.map((product) => {
          const wardrobeCandidate = createVirtualWardrobeItem(product);
          return <article className="product-card" key={product.id}>
            <div className="product-image-wrap">
              <span className="virtual-pill">虚拟商品</span>
              <button type="button" className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`} onClick={(event) => toggleSavedAndRestoreFocus(product.id, event)} aria-label={saved.includes(product.id) ? `取消收藏${product.name}` : `收藏${product.name}`} aria-pressed={saved.includes(product.id)}>♡</button>
              <ProductVisual visual={product.visual} color={product.color} />
            </div>
            <div className="product-info">
              <p className="product-meta"><span>{product.category}</span><i style={{ background: product.color }} /> {product.colorName}</p>
              <h2>{product.name}</h2><p>{product.subtitle}</p>
              <div className="product-bottom"><strong><small>虚拟价</small> {product.points} 松松币</strong><span>不会扣款</span></div>
              <div className={`product-actions ${wardrobeCandidate ? "" : "product-actions--single"}`}>
                {wardrobeCandidate && (
                  <button type="button" className="button button--soft" onClick={() => onTry(product)}>
                    {supportsAvatarTryOn(product.category) ? "试穿看看" : "收入衣橱"}
                  </button>
                )}
                <button type="button" className="button button--dark" onClick={() => onAdd(product)}>放进袋子</button>
              </div>
            </div>
          </article>;
        })}
      </section>
      {!visible.length && <div className="empty-state"><span>⌁</span><h2>{savedOnly ? "还没有收藏的虚拟商品" : "这里暂时是空的"}</h2><p>{savedOnly ? "遇到喜欢的就点一下爱心，之后还会在这里。" : "换个关键词，或者回到“全部”慢慢看看。"}</p></div>}
      <div className="no-pressure-note"><span aria-hidden="true">☁</span><div><strong>这里不制造“错过焦虑”</strong><p>没有限时、库存紧张和消费排名。你可以收藏、离开，任何时候再回来。</p></div></div>
    </div>
  );
}

function ClosetView({ wardrobe, onAdd, onWear, onDelete, onClearData, clearingData }: { wardrobe: WardrobeItem[]; onAdd: (opener: HTMLButtonElement) => void; onWear: (item: WardrobeItem) => void; onDelete: (item: WardrobeItem) => Promise<void> | void; onClearData: () => void; clearingData: boolean }) {
  const [category, setCategory] = useState<(typeof CLOSET_CATEGORIES)[number]>("全部");
  const visible = wardrobe.filter((item) => category === "全部" || item.category === category);
  const previewableCount = wardrobe.filter((item) => supportsAvatarTryOn(item.category)).length;
  const completeness = wardrobe.length
    ? Math.round(wardrobe.reduce((sum, item) => sum + [item.size, item.color, item.season, item.style, item.chest ?? item.waist ?? item.length].filter(Boolean).length / 5, 0) / wardrobe.length * 100)
    : 0;

  async function deleteAndRestoreFocus(
    item: WardrobeItem,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const button = event.currentTarget;
    const grid = button.closest<HTMLElement>(".wardrobe-grid");
    const buttonsBefore = grid
      ? Array.from(grid.querySelectorAll<HTMLButtonElement>("button:not([disabled])"))
      : [];
    const focusIndex = Math.max(0, buttonsBefore.indexOf(button));
    await onDelete(item);
    window.requestAnimationFrame(() => {
      if (button.isConnected || !grid?.isConnected) return;
      const buttonsAfter = Array.from(
        grid.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      buttonsAfter[Math.min(focusIndex, buttonsAfter.length - 1)]?.focus();
    });
  }

  return (
    <div className="page page--closet">
      <section className="page-title-row">
        <div><p className="eyebrow">MY DIGITAL WARDROBE</p><h1>我的衣橱</h1><p>{wardrobe.length} 件衣服，每一件都可以重新被搭配。</p></div>
        <button type="button" className="button button--primary" onClick={(event) => onAdd(event.currentTarget)}>＋ 添加一件衣服</button>
      </section>
      <section className="closet-summary">
        <div><span>可参与 3D 试穿</span><strong>{previewableCount}<small> 件</small></strong><p>支持上装、下装、连衣裙和外套</p></div>
        <div className="closet-summary-art" aria-hidden="true"><i /><i /><i /><i /></div>
        <div><span>资料完整度</span><strong>{completeness}<small>%</small></strong><p>补充尺寸会让参考更可靠</p></div>
      </section>
      <div className="closet-toolbar">
        <div className="chip-row" role="group" aria-label="衣橱分类">{CLOSET_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <span className="privacy-note">⌁ 身体与衣物资料默认保持私密</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {category === "全部" ? `衣橱共有 ${visible.length} 件` : `${category}分类共有 ${visible.length} 件`}
      </p>
      <section className="privacy-controls" aria-labelledby="privacy-controls-title" aria-busy={clearingData}>
        <div><span aria-hidden="true">⌁</span><div><h2 id="privacy-controls-title">你的资料由你决定</h2><p>可随时清除衣橱、身体参数、搭配、收藏和虚拟购物袋；登录版会同时清除云端副本。</p></div></div>
        <button type="button" className="button button--soft" disabled={clearingData} onClick={onClearData}>{clearingData ? "正在清除…" : "清除我的全部资料"}</button>
      </section>
      <section className="wardrobe-grid">
        <button type="button" className="add-card" onClick={(event) => onAdd(event.currentTarget)}><span>＋</span><strong>添加一件衣服</strong><small>拍照、链接或手动录入</small></button>
        {visible.map((item) => (
          <article className="wardrobe-card" key={item.id}>
            <div className="wardrobe-visual"><span className={`source-pill ${item.source === "虚拟商品" ? "source-pill--virtual" : item.source === "示例衣物" ? "source-pill--sample" : ""}`}>{item.source}</span>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <MiniGarment item={item} />}</div>
            <div className="wardrobe-info"><div><span>{item.category} · {item.size}</span><i style={{ background: item.color }} /></div><h2>{item.name}</h2><p>{item.season} · {item.style}</p><div className="confidence-line"><span>资料可信度</span><b className={`confidence confidence--${item.confidence === "高" ? "high" : item.confidence === "中" ? "mid" : "low"}`}>{item.confidence}</b></div><div className="wardrobe-actions"><button type="button" className="button button--dark" onClick={() => onWear(item)} disabled={!supportsAvatarTryOn(item.category)}>{supportsAvatarTryOn(item.category) ? "穿上看看" : "暂不支持 3D"}</button><button type="button" className="remove-garment" onClick={(event) => void deleteAndRestoreFocus(item, event)} aria-label={`从衣橱移除${item.name}`}>移除</button></div></div>
          </article>
        ))}
      </section>
      {!visible.length && category !== "全部" && (
        <div className="empty-state"><span aria-hidden="true">◇</span><h2>这个分类还没有衣物</h2><p>可以换一个分类，或添加一件自己的衣服。</p></div>
      )}
    </div>
  );
}

function StudioView({
  wardrobe,
  metrics,
  setMetrics,
  outfit,
  setOutfit,
  avatarOutfit,
  onWear,
  onSave,
  profileSaving,
}: {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  setMetrics: React.Dispatch<React.SetStateAction<BodyMetrics>>;
  outfit: OutfitSelection;
  setOutfit: React.Dispatch<React.SetStateAction<OutfitSelection>>;
  avatarOutfit: AvatarOutfit;
  onWear: (item: WardrobeItem) => void;
  onSave: () => void;
  profileSaving: boolean;
}) {
  const [closetCategory, setClosetCategory] = useState<(typeof STUDIO_CATEGORIES)[number]>("全部");
  const previewableWardrobe = wardrobe.filter((item) => supportsAvatarTryOn(item.category));
  const visible = previewableWardrobe.filter((item) => closetCategory === "全部" || item.category === closetCategory);
  const selected = wardrobe.filter((item) =>
    (item.category === "上装" && item.id === outfit.topId) ||
    (item.category === "下装" && item.id === outfit.bottomId) ||
    (item.category === "连衣裙" && item.id === outfit.dressId) ||
    (item.category === "外套" && item.id === outfit.outerwearId),
  );
  const selectedIds = selected.map((item) => item.id);
  const fitItem = selected.find((item) => item.category === "上装" || item.category === "连衣裙");
  const ease = fitItem?.chest ? fitItem.chest - metrics.chest : null;
  const fitLabel = ease === null ? "信息不足" : ease < 3 ? "可能偏贴身" : ease < 12 ? "常规松量" : "可能偏宽松";

  function choosePreset(shape: BodyMetrics["bodyShape"]) {
    const preset = BODY_PRESETS[shape];
    setMetrics((current) => ({ ...current, ...preset, bodyShape: shape }));
  }

  function removeFromOutfit(item: WardrobeItem) {
    setOutfit((current) => ({
      ...current,
      ...(item.category === "上装"
        ? { topId: undefined }
        : item.category === "下装"
          ? { bottomId: undefined }
          : item.category === "连衣裙"
            ? { dressId: undefined }
            : item.category === "外套"
              ? { outerwearId: undefined }
              : {}),
    }));
  }

  return (
    <div className="page page--studio">
      <section className="studio-heading"><div><p className="eyebrow">3D FITTING STUDIO</p><h1>让分身更像你</h1><p>没有标准身材，调到看起来像你就好。</p></div><div className="studio-disclaimer"><span aria-hidden="true">i</span><p><strong>视觉参考，不是合身保证</strong>面料垂坠、弹性和真实松量可能不同。</p></div></section>
      <section className="studio-grid">
        <aside className="studio-panel studio-closet-panel" aria-labelledby="studio-closet-title">
          <div className="panel-title"><div><p id="studio-closet-title">可试穿衣物</p><strong>{visible.length} 件</strong></div><span>{closetCategory === "全部" ? "点击穿上" : `${closetCategory}分类`}</span></div>
          <div className="mini-chip-row" role="group" aria-label="试穿衣物分类">{STUDIO_CATEGORIES.map((item) => <button type="button" key={item} aria-pressed={closetCategory === item} className={closetCategory === item ? "is-active" : ""} onClick={() => setClosetCategory(item)}>{item}</button>)}</div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {closetCategory === "全部" ? `共有 ${visible.length} 件可试穿衣物` : `${closetCategory}分类共有 ${visible.length} 件可试穿衣物`}
          </p>
          <div className="studio-item-list">{visible.length ? visible.map((item) => {
            const isWearing = selectedIds.includes(item.id);
            return <button type="button" key={item.id} aria-pressed={isWearing} aria-label={`${isWearing ? "脱下" : "穿上"}${item.name}，${item.category}，${item.size} 码`} className={isWearing ? "is-wearing" : ""} onClick={() => isWearing ? removeFromOutfit(item) : onWear(item)}><div className="studio-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <MiniGarment item={item} />}</div><span><strong>{item.name}</strong><small>{item.category} · {item.size}</small></span><i aria-hidden="true">{isWearing ? "✓" : "+"}</i></button>;
          }) : <div className="studio-list-empty"><span aria-hidden="true">◇</span><strong>这里还没有可试穿衣物</strong><p>上装、下装、连衣裙和外套会出现在这里。</p></div>}</div>
        </aside>
        <div className="studio-avatar-wrap">
          <div className="studio-status"><span><i className="status-dot" /> 三维身形示意</span><b>{metrics.height} cm · {metrics.weight} kg</b></div>
          <DeferredAvatar metrics={metrics} outfit={avatarOutfit} priority />
          <div className="wearing-dock"><div><span>当前穿搭</span><div className="wearing-chips">{selected.length ? selected.map((item) => <button type="button" key={item.id} aria-label={`脱下${item.name}`} onClick={() => removeFromOutfit(item)}><i aria-hidden="true" style={{ background: item.color }} />{item.name}<b aria-hidden="true">×</b></button>) : <span>还没有穿上衣服</span>}</div></div><button type="button" className="reset-button" aria-label="清空当前试穿" disabled={!selected.length} onClick={() => setOutfit({})}>清空试穿</button></div>
        </div>
        <aside className="studio-panel body-panel" aria-labelledby="studio-body-title">
          <div className="panel-title"><div><p id="studio-body-title">我的分身</p><strong>手动微调</strong></div><span>实时更新</span></div>
          <div className="preset-group"><span id="body-shape-label">身形起点</span><div className="preset-grid" role="group" aria-labelledby="body-shape-label">{([ ["straight", "直筒"], ["pear", "梨形"], ["hourglass", "沙漏"], ["inverted", "倒三角"], ["apple", "苹果形"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={metrics.bodyShape === value} className={metrics.bodyShape === value ? "is-active" : ""} onClick={() => choosePreset(value)}>{label}</button>)}</div></div>
          <div className="metric-pair"><MetricInput label="身高" value={metrics.height} min={145} max={195} unit="cm" onChange={(height) => setMetrics((current) => ({ ...current, height }))} /><MetricInput label="体重" value={metrics.weight} min={38} max={120} unit="kg" onChange={(weight) => setMetrics((current) => ({ ...current, weight }))} /></div>
          <div className="slider-list">
            <BodySlider label="肩线" value={metrics.shoulder} min={32} max={52} left="窄" right="宽" onChange={(shoulder) => setMetrics((current) => ({ ...current, shoulder }))} />
            <BodySlider label="胸围" value={metrics.chest} min={72} max={126} left="小" right="大" onChange={(chest) => setMetrics((current) => ({ ...current, chest }))} />
            <BodySlider label="腰围" value={metrics.waist} min={56} max={118} left="小" right="大" onChange={(waist) => setMetrics((current) => ({ ...current, waist }))} />
            <BodySlider label="臀围" value={metrics.hips} min={76} max={132} left="小" right="大" onChange={(hips) => setMetrics((current) => ({ ...current, hips }))} />
            <BodySlider label="上身比例" value={metrics.torso} min={42} max={58} left="短" right="长" onChange={(torso) => setMetrics((current) => ({ ...current, torso }))} />
            <BodySlider label="腿长比例" value={metrics.legs} min={72} max={94} left="短" right="长" onChange={(legs) => setMetrics((current) => ({ ...current, legs }))} />
          </div>
          <div className="skin-row"><span id="skin-tone-label">肤色示意</span><div role="group" aria-labelledby="skin-tone-label">{SKIN_TONES.map(([tone, label]) => <button type="button" key={tone} aria-label={label} aria-pressed={metrics.skinTone === tone} className={metrics.skinTone === tone ? "is-active" : ""} style={{ background: tone }} onClick={() => setMetrics((current) => ({ ...current, skinTone: tone }))} />)}</div></div>
          <button type="button" className="button button--primary button--full" disabled={profileSaving} onClick={onSave}>{profileSaving ? "正在安心保存…" : "这就是现在的我"}</button>
          <div className="fit-readout"><div><span>当前上身松量</span><b>{fitLabel}</b></div><p>{ease === null ? "补充衣物胸围后，可以得到更可靠的参考。" : `根据已填数据，衣物与身体胸围相差约 ${ease} cm。`}</p><small>尺码建议不代表实际舒适度。</small></div>
        </aside>
      </section>
    </div>
  );
}

function MetricInput({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  const inputValue = draft.source === value ? draft.text : String(value);
  const commit = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) {
      setDraft({ source: value, text: String(value) });
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setDraft({ source: next, text: String(next) });
    onChange(next);
  };
  return <label className="metric-input"><span>{label}</span><span><input type="number" value={inputValue} min={min} max={max} onChange={(event) => setDraft({ source: value, text: event.target.value })} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} /><b>{unit}</b></span></label>;
}

function BodySlider({ label, value, min, max, left, right, onChange }: { label: string; value: number; min: number; max: number; left: string; right: string; onChange: (value: number) => void }) {
  return <label className="body-slider"><span><b>{label}</b><i>{value} cm</i></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><small><i>{left}</i><i>{right}</i></small></label>;
}

function DailyView({
  wardrobe,
  metrics,
  preferences,
  onPreferencesChange,
  onApply,
}: {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  preferences: DailyPreferences;
  onPreferencesChange: (field: keyof DailyPreferences, value: string) => void;
  onApply: (selection: OutfitSelection) => void;
}) {
  const { weather, occasion, feeling, comfort } = preferences;
  const [seed, setSeed] = useState(0);
  const occasionStyles: Record<string, string[]> = {
    通勤: ["利落", "轻松"],
    上课: ["轻松", "利落"],
    约会: ["温柔", "有点亮眼"],
    运动: ["轻松"],
    宅家: ["轻松", "温柔"],
  };
  const weatherSeasons: Record<string, string[]> = {
    炎热: ["春夏", "四季"],
    温和: ["春秋", "四季", "春夏"],
    偏凉: ["春秋", "四季"],
    下雨: ["四季", "春秋"],
  };
  const scoreItem = (item: WardrobeItem) => {
    let score = 0;
    if (item.style === feeling) score += 8;
    if (occasionStyles[occasion]?.includes(item.style)) score += 5;
    if (weatherSeasons[weather]?.includes(item.season)) score += 4;
    if (item.season === "四季") score += 1;
    if (comfort === "方便走动" && (item.style === "轻松" || item.category === "下装")) score += 4;
    if (comfort === "宽松" && (item.style === "轻松" || (item.chest ?? 0) - metrics.chest >= 10)) score += 4;
    if (comfort === "不露肤" && ["下装", "外套"].includes(item.category)) score += 3;
    if (comfort === "保暖" && (item.category === "外套" || item.season === "春秋")) score += 5;
    if ((weather === "偏凉" || weather === "下雨") && item.category === "外套") score += 6;
    return score;
  };
  const ranked = (category: ClosetCategory) => wardrobe
    .filter((item) => item.category === category)
    .sort((left, right) => scoreItem(right) - scoreItem(left) || left.id.localeCompare(right.id));
  const tops = ranked("上装");
  const bottoms = ranked("下装");
  const dresses = ranked("连衣裙");
  const outers = ranked("外套");
  const needsOuterwear = weather === "偏凉" || weather === "下雨" || comfort === "保暖";
  const scoredLooks = rankOutfitSelections({
    tops,
    bottoms,
    dresses,
    outers,
    needsOuterwear,
    scoreItem,
  });
  const bestLook = scoredLooks[0];
  const alternatives = scoredLooks.slice(1);
  const alternativeOffset = alternatives.length ? seed % alternatives.length : 0;
  const suggestions = [
    bestLook,
    alternatives[alternativeOffset],
    alternatives.length > 1 ? alternatives[(alternativeOffset + 1) % alternatives.length] : undefined,
  ].filter((look): look is NonNullable<typeof look> => Boolean(look));
  const names = [`${feeling}感${occasion}`, `${comfort}的一套`, "今天的衣橱惊喜"];

  return (
    <div className="page page--daily">
      <section className="daily-hero"><div><p className="eyebrow">TODAY&apos;S OUTFIT</p><h1>今天穿什么，交给衣橱。</h1><p>使用衣橱里的衣服生成最多三套建议；内置示例衣物会清楚标出，不会冒充你的衣服。</p></div><div className="daily-date"><span>{todayLabel()}</span><strong>{weather} · 22°C</strong><small>天气为体验示例，可手动选择</small></div></section>
      <section className="preference-panel">
        <ChoiceGroup label="天气" options={[...DAILY_OPTIONS.weather]} value={weather} onChange={(value) => onPreferencesChange("weather", value)} />
        <ChoiceGroup label="场景" options={[...DAILY_OPTIONS.occasion]} value={occasion} onChange={(value) => onPreferencesChange("occasion", value)} />
        <ChoiceGroup label="今天的感觉" options={[...DAILY_OPTIONS.feeling]} value={feeling} onChange={(value) => onPreferencesChange("feeling", value)} />
        <ChoiceGroup label="舒适偏好" options={[...DAILY_OPTIONS.comfort]} value={comfort} onChange={(value) => onPreferencesChange("comfort", value)} />
        <button type="button" className="button button--primary" onClick={() => setSeed((current) => current + 1)}>✦ 换一组看看</button>
      </section>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        已按{weather}、{occasion}、{feeling}和{comfort}更新第 {seed + 1} 组搭配，共 {suggestions.length} 套
      </p>
      <div className="suggestion-heading"><div><span>从 {wardrobe.length} 件衣服中组合</span><h2>为现在的你准备了 {suggestions.length} 套</h2></div><p>身高 {metrics.height} cm · 偏好「{comfort}」</p></div>
      {suggestions.length ? <section className="suggestion-grid">
        {suggestions.map(({ selection, key }, index) => {
          const items = wardrobe.filter((item) => [selection.topId, selection.bottomId, selection.dressId, selection.outerwearId].includes(item.id));
          return <article className={`suggestion-card suggestion-card--${index + 1}`} key={key}><div className="suggestion-number" aria-hidden="true">0{index + 1}</div><div className="suggestion-visual">{items.map((item) => <div key={item.id} className="suggestion-piece"><MiniGarment item={item} /></div>)}</div><div className="suggestion-copy"><span className="suggestion-tag">{index === 0 ? "最符合今天" : index === 1 ? "换一种心情" : "衣橱惊喜"}</span><h2>{names[index]}</h2><p>{occasion}需要一点{feeling}感；{items.map((item) => item.colorName).join("、")}放在一起不会太用力，也符合“{comfort}”的偏好。</p><div className="suggestion-items">{items.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.name}</span>)}</div><div className="suggestion-actions"><button type="button" className="button button--dark" onClick={() => onApply(selection)}>穿上看看</button><button type="button" className="button button--soft" onClick={() => setSeed((current) => current + index + 1)}>{index === 0 ? "换一组" : "换一件"}</button></div></div></article>;
        })}
      </section> : <div className="empty-state"><span>◇</span><h2>还缺少可以组合的衣服</h2><p>先在衣橱加入上装与下装，或一件连衣裙，再回来生成搭配。</p></div>}
      <p className="daily-footnote">推荐来自你的现有衣橱与已选偏好，不评价身材，也不会建议为了搭配而购买新衣服。</p>
    </div>
  );
}

function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="choice-group"><legend>{label}</legend><div>{options.map((option) => <button type="button" key={option} className={value === option ? "is-active" : ""} onClick={() => onChange(option)} aria-pressed={value === option}>{option}</button>)}</div></fieldset>;
}

function CartDrawer({ cart, onClose, onRemove, onCheckout, returnFocusRef }: { cart: Product[]; onClose: () => void; onRemove: (index: number) => void; onCheckout: () => void; returnFocusRef: React.RefObject<HTMLElement | null> }) {
  const total = cart.reduce((sum, item) => sum + item.points, 0);
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose, returnFocusRef);
  const cartListRef = useRef<HTMLDivElement>(null);
  const [removalStatus, setRemovalStatus] = useState("");

  function removeAndRestoreFocus(
    index: number,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const button = event.currentTarget;
    const removedItem = cart[index];
    onRemove(index);
    if (removedItem) {
      setRemovalStatus(`${removedItem.name}已从购物袋移除，还剩 ${cart.length - 1} 件。`);
    }
    window.requestAnimationFrame(() => {
      if (button.isConnected) return;
      const remainingButtons = Array.from(
        cartListRef.current?.querySelectorAll<HTMLButtonElement>("article > button") ?? [],
      );
      const target = remainingButtons[Math.min(index, remainingButtons.length - 1)]
        ?? dialogRef.current?.querySelector<HTMLElement>("#cart-title");
      target?.focus();
    });
  }

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} tabIndex={-1} className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="drawer-header">
          <div><p>VIRTUAL BAG</p><h2 id="cart-title" tabIndex={-1}>虚拟购物袋 <span>{cart.length}</span></h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭购物袋">×</button>
        </div>
        <div className="payment-reassurance"><span aria-hidden="true">♡</span><p id="cart-payment-note"><strong>放心，这里不会扣款</strong>不需要银行卡、地址，也不会产生真实订单。</p></div>
        <div ref={cartListRef} className="cart-list">
          {cart.length ? cart.map((item, index) => (
            <article key={`${item.id}-${index}`}>
              <div className="cart-thumb"><ProductVisual visual={item.visual} color={item.color} /></div>
              <div><span>{item.category} · 虚拟商品</span><h3>{item.name}</h3><p>{item.points} 松松币</p></div>
              <button type="button" onClick={(event) => removeAndRestoreFocus(index, event)} aria-label={`移除${item.name}`}>×</button>
            </article>
          )) : (
            <div className="cart-empty"><span aria-hidden="true">▢</span><h3>袋子还是轻轻的</h3><p>看到喜欢的再放进来，不急。</p></div>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{removalStatus}</p>
        <div className="drawer-footer"><div><span>虚拟合计</span><strong>{total} 松松币</strong></div><button type="button" className="button button--primary button--full" disabled={!cart.length} onClick={onCheckout} aria-describedby="cart-payment-note cart-checkout-note">完成这次虚拟购物</button><small id="cart-checkout-note">点击只会完成体验，不会提交付款或真实订单。</small></div>
      </aside>
    </div>
  );
}

function CelebrationDialog({
  onClose,
  onCloset,
  returnFocusRef,
}: {
  onClose: () => void;
  onCloset: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(onClose, returnFocusRef);
  return (
    <div
      className="modal-layer modal-layer--center celebration-layer"
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="celebration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebration-title"
      >
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <span className="celebration-icon" aria-hidden="true">
          ♡
        </span>
        <p>VIRTUAL CHECKOUT COMPLETE</p>
        <h2 id="celebration-title">
          喜欢的东西已经收下，
          <br />
          这次不用花一分钱。
        </h2>
        <p className="celebration-copy">
          服装类虚拟商品会放进衣橱；美妆与装饰会留在虚拟收藏。上装、下装、连衣裙和外套还可以继续让分身试穿。这里没有付款，也没有真实订单。
        </p>
        <div>
          <button
            type="button"
            className="button button--primary"
            onClick={onCloset}
          >
            去衣橱看看
          </button>
          <button
            type="button"
            className="button button--soft"
            onClick={onClose}
          >
            继续慢慢逛
          </button>
        </div>
      </div>
    </div>
  );
}
