import { baseApi } from "@/store/api/baseApi";
import { toQueryString } from "@/lib/api/query-string";
import type { Paginated } from "@/types";
import type {
  CreateSavedViewInput,
  ListSavedViewsArgs,
  SavedView,
  ShareTarget,
  UpdateSavedViewInput,
} from "../types";

const NO_RETRY = { maxRetries: 0 }; // never auto-repeat a write

export const savedViewsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // ---------- reads ----------
    listSavedViews: build.query<Paginated<SavedView>, ListSavedViewsArgs>({
      query: (args) => `/api/saved-views${toQueryString({ ...args })}`,
      providesTags: (result) => [
        { type: "SavedViews", id: "LIST" },
        ...(result?.data ?? []).map((v) => ({ type: "SavedView" as const, id: v.id })),
      ],
    }),

    getSavedView: build.query<SavedView, string>({
      query: (id) => `/api/saved-views/${id}`,
      transformResponse: (res: { view: SavedView }) => res.view,
      providesTags: (_result, _error, id) => [{ type: "SavedView", id }],
    }),

    listViewShares: build.query<ShareTarget[], string>({
      query: (id) => `/api/saved-views/${id}/shares`,
      transformResponse: (res: { data: ShareTarget[] }) => res.data,
      providesTags: (_result, _error, id) => [{ type: "ViewShares", id }],
      keepUnusedDataFor: 0, // the share dialog must always start from the server's list
    }),

    listShareTargets: build.query<ShareTarget[], { datasetId: string; q?: string }>({
      query: (args) => `/api/saved-views/share-targets${toQueryString({ ...args })}`,
      transformResponse: (res: { data: ShareTarget[] }) => res.data,
      keepUnusedDataFor: 30,
    }),

    // ---------- writes ----------
    createSavedView: build.mutation<SavedView, CreateSavedViewInput>({
      query: (body) => ({ url: "/api/saved-views", method: "POST", body }),
      transformResponse: (res: { view: SavedView }) => res.view,
      invalidatesTags: [{ type: "SavedViews", id: "LIST" }],
      extraOptions: NO_RETRY,
    }),

    updateSavedView: build.mutation<SavedView, { id: string; changes: UpdateSavedViewInput }>({
      query: ({ id, changes }) => ({ url: `/api/saved-views/${id}`, method: "PATCH", body: changes }),
      transformResponse: (res: { view: SavedView }) => res.view,
      invalidatesTags: (_result, _error, { id }) => [
        { type: "SavedView", id },
        { type: "SavedViews", id: "LIST" },
      ],
      extraOptions: NO_RETRY,
    }),

    deleteSavedView: build.mutation<void, string>({
      query: (id) => ({ url: `/api/saved-views/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "SavedViews", id: "LIST" }],
      extraOptions: NO_RETRY,
    }),

    setViewShares: build.mutation<SavedView, { id: string; userIds: string[] }>({
      query: ({ id, userIds }) => ({ url: `/api/saved-views/${id}/shares`, method: "PUT", body: { userIds } }),
      transformResponse: (res: { view: SavedView }) => res.view,
      invalidatesTags: (_result, _error, { id }) => [
        { type: "ViewShares", id },
        { type: "SavedView", id },
        { type: "SavedViews", id: "LIST" },
      ],
      extraOptions: NO_RETRY,
    }),
  }),
});

export const {
  useListSavedViewsQuery,
  useGetSavedViewQuery,
  useListViewSharesQuery,
  useListShareTargetsQuery,
  useCreateSavedViewMutation,
  useUpdateSavedViewMutation,
  useDeleteSavedViewMutation,
  useSetViewSharesMutation,
} = savedViewsApi;
