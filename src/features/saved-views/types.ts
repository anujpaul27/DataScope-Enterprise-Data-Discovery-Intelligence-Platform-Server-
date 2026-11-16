import type { FilterPayload } from "@/features/explorer/lib/filters";
import type { SortRule } from "@/store/slices/searchConfigSlice";
import type { Role } from "@/types";

export type ViewScope = "all" | "mine" | "shared";

/** The part of a view that describes the search itself. */
export interface SavedViewConfig {
  globalSearch: string | null;
  conditions: FilterPayload[];
  sort: SortRule[];
  /** [] = "the dataset's default columns" */
  visibleColumns: string[];
}

/** GET /api/saved-views and GET /api/saved-views/:id */
export interface SavedView extends SavedViewConfig {
  id: string;
  name: string;
  datasetId: string;
  datasetName: string;
  isShared: boolean;
  sharedWithCount: number;
  owner: { id: string; name: string };
  isOwner: boolean;
  /** Computed by the server: owner/admin AND not a viewer. */
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShareTarget {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface ListSavedViewsArgs {
  page: number;
  pageSize: number;
  scope?: ViewScope;
  datasetId?: string;
  q?: string;
}

export interface CreateSavedViewInput extends SavedViewConfig {
  datasetId: string;
  name: string;
}

export type UpdateSavedViewInput = Partial<SavedViewConfig> & { name?: string };
