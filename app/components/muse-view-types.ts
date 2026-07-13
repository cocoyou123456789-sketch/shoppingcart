import type { AvatarOutfit, BodyMetrics } from "./Avatar3D";
import type { Product, WardrobeItem } from "../lib/muse-data";

export type MuseView = "home" | "shop" | "closet" | "studio" | "daily";

export type OutfitSelection = {
  topId?: string;
  bottomId?: string;
  dressId?: string;
  outerwearId?: string;
};

export type DailyPreferences = {
  weather: string;
  occasion: string;
  feeling: string;
  comfort: string;
};

export type ShopViewProps = {
  saved: string[];
  onToggleSaved: (productId: string) => void;
  onAdd: (product: Product) => void;
  onTry: (product: Product) => void;
};

export type ClosetViewProps = {
  wardrobe: WardrobeItem[];
  onAdd: (opener: HTMLButtonElement) => void;
  onWear: (item: WardrobeItem) => void;
  onDelete: (item: WardrobeItem) => Promise<void> | void;
  onClearData: () => void;
  clearingData: boolean;
  clearRetryPending: boolean;
};

export type StudioViewProps = {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  setMetrics: React.Dispatch<React.SetStateAction<BodyMetrics>>;
  outfit: OutfitSelection;
  setOutfit: React.Dispatch<React.SetStateAction<OutfitSelection>>;
  avatarOutfit: AvatarOutfit;
  onWear: (item: WardrobeItem) => void;
  initialOutfitStatus?: string;
  onInitialOutfitStatusAnnounced?: () => void;
  onSave: () => void;
  profileSaving: boolean;
};

export type DailyViewProps = {
  wardrobe: WardrobeItem[];
  metrics: BodyMetrics;
  preferences: DailyPreferences;
  onPreferencesChange: (field: keyof DailyPreferences, value: string) => void;
  onApply: (selection: OutfitSelection) => void;
};
