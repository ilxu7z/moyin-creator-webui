// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Project-Scoped Storage Adapters for Zustand
 * 
 * Routes store data to per-project files under _p/{projectId}/
 * and shared data to _shared/
 */

import type { StateStorage } from 'zustand/middleware';
import { fileStorage } from './indexed-db-storage';
import { useProjectStore } from '@/stores/project-store';
import { useAppSettingsStore } from '@/stores/app-settings-store';

// ==================== Helpers ====================

/**
 * Get current activeProjectId from project-store.
 * MUST be called synchronously (before any await) to avoid race conditions.
 */
function getActiveProjectId(): string | null {
  try {
    return useProjectStore.getState().activeProjectId;
  } catch {
    return null;
  }
}

/**
 * Safety check: does the data look like meaningful content (not empty/default)?
 * Returns false for empty shells like {"activeProjectId":null} or {"activeProjectId":""}
 * to prevent overwriting real data with empty state from race conditions.
 */
function isMeaningfulData(value: string): boolean {
  if (value.length < 100) {
    // Too small to contain real project data
    try {
      const parsed = JSON.parse(value);
      const state = parsed?.state ?? parsed;
      // Check if there's any meaningful content beyond an activeProjectId
      const keys = Object.keys(state);
      const hasContent = keys.some(k => {
        if (k === 'activeProjectId') return false;
        const v = state[k];
        if (v === null || v === undefined) return false;
        if (typeof v === 'string' && v.length === 0) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        if (typeof v === 'object' && Object.keys(v).length === 0) return false;
        return true;
      });
      if (!hasContent) return false;
    } catch { return false; }
  }
  return true;
}

/**
 * Size guard: refuse to write if new data is drastically smaller than existing.
 * This catches the most common data-loss pattern: switching to a project with
 * empty state overwriting kilobytes of real data with 44 bytes of null shell.
 */
async function safetyCheckBeforeWrite(key: string, newValue: string): Promise<void> {
  try {
    const hasExisting = await fileStorage.getItem(key);
    if (hasExisting && hasExisting.length > 200 && newValue.length < 100) {
      // Existing data has content, new data is too small — likely a race-condition write
      // Only block if the new data is clearly empty/default, not if it's a legitimate minimization
      if (!isMeaningfulData(newValue)) {
        console.error(
          `[ProjectStorage] ⚠️ REFUSED write to ${key}: ` +
          `existing=${hasExisting.length}B → new=${newValue.length}B (empty shell). ` +
          `This prevented a data loss event.`
        );
        throw new Error(
          `SAFETY_BLOCK: Refusing to overwrite ${hasExisting.length}B of data ` +
          `with ${newValue.length}B empty shell. Key: ${key}`
        );
      }
    }
  } catch (err: any) {
    // Re-throw our safety errors; ignore read errors (file doesn't exist yet)
    if (err?.message?.startsWith('SAFETY_BLOCK')) throw err;
  }
}

/**
 * Get resource sharing settings from app-settings-store.
 */
function getResourceSharing(): { shareCharacters: boolean; shareScenes: boolean; shareMedia: boolean } {
  try {
    return useAppSettingsStore.getState().resourceSharing;
  } catch {
    return { shareCharacters: true, shareScenes: true, shareMedia: true };
  }
}

/**
 * Get all project IDs from project-store.
 */
function getAllProjectIds(): string[] {
  try {
    return useProjectStore.getState().projects.map(p => p.id);
  } catch {
    return [];
  }
}

// ==================== Project-Scoped Storage ====================

/**
 * Creates a StateStorage that routes data to _p/{activeProjectId}/{storeName}.json
 * Used for stores that are entirely project-scoped (script, director, timeline).
 * 
 * On getItem: reads from _p/{pid}/{storeName}, falls back to legacy key if not migrated
 * On setItem: writes to _p/{pid}/{storeName}
 */
export function createProjectScopedStorage(storeName: string): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      // 等待 project-store 完成 rehydration，确保拿到正确的 activeProjectId
      // 否则启动时可能读到默认值 "default-project"，导致读错文件
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
      }

      const pid = getActiveProjectId();
      
      if (!pid) {
        console.warn(`[ProjectStorage] No activeProjectId, falling back to legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      const projectKey = `_p/${pid}/${storeName}`;
      
      // Try project-scoped path first
      const projectData = await fileStorage.getItem(projectKey);
      if (projectData) {
        console.log(`[ProjectStorage] Loaded ${storeName} for project ${pid.substring(0, 8)}`);
        return projectData;
      }

      // Fall back to legacy monolithic file (pre-migration)
      console.log(`[ProjectStorage] Project file not found for ${storeName}, trying legacy key: ${name}`);
      return fileStorage.getItem(name);
    },

    setItem: async (name: string, value: string): Promise<void> => {
      // Extract the intended project ID from the data being persisted.
      // This ensures data is always written to the correct per-project file,
      // even if getActiveProjectId() returns a different value due to race conditions
      // (e.g., during app startup when project-store hasn't rehydrated yet,
      //  or during project duplication when createProject changes the active ID).
      let dataProjectId: string | null = null;
      try {
        const parsed = JSON.parse(value);
        const state = parsed?.state ?? parsed;
        if (state && typeof state === 'object' && typeof state.activeProjectId === 'string') {
          dataProjectId = state.activeProjectId;
        }
      } catch {
        // If we can't parse the value, fall back to getActiveProjectId()
      }

      const pid = dataProjectId || getActiveProjectId();
      
      if (!pid) {
        // CRITICAL: Do NOT fall back to legacy monolithic file when pid is null/empty.
        // Writing empty-shell data to the legacy key permanently destroys the recovery
        // source for ALL projects. Instead, drop the write and log an error so the
        // race condition can be traced.
        //
        // Root cause of data loss E2: setActiveProject(null) in Dashboard triggered
        // persist writes with pid=null, which fell through to legacy, overwriting
        // all project data with 44 bytes of {"activeProjectId":null}.
        console.error(
          `[ProjectStorage] ⚠️ REFUSED write: no activeProjectId, would overwrite legacy key ` +
          `"${name}" with empty data. This is likely a race condition from ` +
          `setActiveProject(null). Store: ${storeName}, data: ${value.substring(0, 100)}`
        );
        return;
      }

      // Log a warning if there's a mismatch (indicates a race condition was avoided)
      const routerPid = getActiveProjectId();
      if (dataProjectId && routerPid && dataProjectId !== routerPid) {
        console.warn(
          `[ProjectStorage] Routing mismatch for ${storeName}: data.pid=${dataProjectId.substring(0, 8)}, ` +
          `router.pid=${routerPid.substring(0, 8)}. Using data.pid to prevent cross-project overwrite.`
        );
      }

      const projectKey = `_p/${pid}/${storeName}`;

      // Safety check: refuse to overwrite real data with an empty shell
      await safetyCheckBeforeWrite(projectKey, value);

      console.log(`[ProjectStorage] Saving ${storeName} for project ${pid.substring(0, 8)} (${Math.round(value.length / 1024)}KB)`);
      await fileStorage.setItem(projectKey, value);
    },

    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      if (!pid) {
        // Same safety principle as setItem: never touch legacy key with null pid
        console.warn(
          `[ProjectStorage] Skipping removeItem for "${name}": no activeProjectId. ` +
          `Legacy key was NOT touched to prevent data loss.`
        );
        return;
      }
      const projectKey = `_p/${pid}/${storeName}`;
      await fileStorage.removeItem(projectKey);
    },
  };
}

// ==================== Split Storage ====================

/**
 * Split/merge function types for flat-array stores.
 * splitFn: takes the persisted state object and splits it into project-specific and shared parts
 * mergeFn: merges project-specific and shared data back into a single state object
 */
export type SplitFn<T = any> = (state: T, projectId: string) => { projectData: T; sharedData: T };
export type MergeFn<T = any> = (projectData: T | null, sharedData: T | null) => T;

/**
 * Creates a StateStorage that splits flat-array data between:
 * - _p/{activeProjectId}/{storeName}.json (project-specific items)
 * - _shared/{storeName}.json (shared/global items)
 * 
 * Used for stores with flat arrays that have projectId fields (media, characters, scenes).
 * 
 * @param storeName - Base name for the storage files
 * @param splitFn - Function to split state into project and shared parts
 * @param mergeFn - Function to merge project and shared parts back together
 * @param sharingKey - Optional key in resourceSharing settings to check (e.g., 'shareCharacters')
 */
export function createSplitStorage<T = any>(
  storeName: string,
  splitFn: SplitFn<T>,
  mergeFn: MergeFn<T>,
  sharingKey?: 'shareCharacters' | 'shareScenes' | 'shareMedia',
): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      // 等待 project-store 完成 rehydration
      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
      }

      const pid = getActiveProjectId();
      
      if (!pid) {
        console.warn(`[SplitStorage] No activeProjectId, falling back to legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      const projectKey = `_p/${pid}/${storeName}`;
      const sharedKey = `_shared/${storeName}`;
      
      // Try to read current project's data
      const projectRaw = await fileStorage.getItem(projectKey);
      
      // If project file doesn't exist, try legacy file (pre-migration)
      if (!projectRaw) {
        console.log(`[SplitStorage] Project file not found for ${storeName}, trying legacy key: ${name}`);
        return fileStorage.getItem(name);
      }

      // Check if cross-project sharing is enabled
      let sharingEnabled = false;
      if (sharingKey) {
        const sharing = getResourceSharing();
        sharingEnabled = sharing[sharingKey];
      }

      try {
        const projectState = JSON.parse(projectRaw);
        const projectPayload = projectState?.state ?? projectState;

        if (sharingEnabled) {
          // Cross-project sharing ON: load ALL projects' data + shared
          const allPids = getAllProjectIds();
          const otherPayloads: T[] = [];
          
          for (const otherPid of allPids) {
            if (otherPid === pid) continue; // Current project already loaded
            const otherKey = `_p/${otherPid}/${storeName}`;
            try {
              const otherRaw = await fileStorage.getItem(otherKey);
              if (otherRaw) {
                const otherParsed = JSON.parse(otherRaw);
                otherPayloads.push(otherParsed?.state ?? otherParsed);
              }
            } catch {
              // Skip corrupted project files
            }
          }

          // Load shared data (items without projectId)
          let sharedPayload: T | null = null;
          try {
            const sharedRaw = await fileStorage.getItem(sharedKey);
            if (sharedRaw) {
              const sharedParsed = JSON.parse(sharedRaw);
              sharedPayload = sharedParsed?.state ?? sharedParsed;
            }
          } catch {}

          // Merge: shared → other projects → current project (last gets priority for currentFolderId etc.)
          let merged: T = mergeFn(null, sharedPayload);
          for (const pd of otherPayloads) {
            merged = mergeFn(pd, merged);
          }
          merged = mergeFn(projectPayload, merged);

          console.log(`[SplitStorage] Loaded ${storeName}: ${allPids.length} projects merged (sharing ON)`);
          return JSON.stringify({
            state: merged,
            version: projectState?.version ?? 0,
          });
        } else {
          // Cross-project sharing OFF: only current project's data
          console.log(`[SplitStorage] Loaded ${storeName}: project-only for ${pid.substring(0, 8)} (sharing OFF)`);
          return JSON.stringify({
            state: projectPayload,
            version: projectState?.version ?? 0,
          });
        }
      } catch (error) {
        console.error(`[SplitStorage] Failed to parse/merge ${storeName}:`, error);
        return projectRaw;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      const pid = getActiveProjectId();
      
      if (!pid) {
        // CRITICAL: Same as createProjectScopedStorage — never fall back to legacy
        // when pid is null/empty. Legacy keys are the recovery source for all projects.
        console.error(
          `[SplitStorage] ⚠️ REFUSED write: no activeProjectId, would overwrite legacy key ` +
          `"${name}". Store: ${storeName}. This prevents permanent data loss from race conditions.`
        );
        return;
      }

      try {
        const parsed = JSON.parse(value);
        const state = parsed.state ?? parsed;
        const version = parsed.version ?? 0;

        // Collect ALL unique projectIds from the state.
        // When sharing is ON, the store may contain items from other projects
        // that were modified (e.g. adding a variation to a character from another project).
        // We must write each project's data back to its own file.
        const allPids = new Set<string>([pid]);
        for (const val of Object.values(state as Record<string, unknown>)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item && typeof item === 'object' && 'projectId' in item &&
                  typeof (item as any).projectId === 'string') {
                allPids.add((item as any).projectId);
              }
            }
          }
        }

        // Write each project's data to its respective file
        for (const projectId of allPids) {
          const { projectData } = splitFn(state as T, projectId);
          const key = `_p/${projectId}/${storeName}`;
          const payload = JSON.stringify({ state: projectData, version });
          await fileStorage.setItem(key, payload);
        }

        // Write shared data (items without projectId)
        const { sharedData } = splitFn(state as T, pid);
        const sharedKey = `_shared/${storeName}`;
        const sharedPayload = JSON.stringify({ state: sharedData, version });
        await fileStorage.setItem(sharedKey, sharedPayload);
        
        console.log(`[SplitStorage] Saved ${storeName} to ${allPids.size} project(s) + shared`);
      } catch (error) {
        console.error(`[SplitStorage] Failed to split ${storeName}, saving to legacy:`, error);
        await fileStorage.setItem(name, value);
      }
    },

    removeItem: async (name: string): Promise<void> => {
      const pid = getActiveProjectId();
      if (!pid) {
        console.warn(
          `[SplitStorage] Skipping removeItem for "${name}": no activeProjectId. ` +
          `Legacy key was NOT touched to prevent data loss.`
        );
        return;
      }
      const projectKey = `_p/${pid}/${storeName}`;
      await fileStorage.removeItem(projectKey);
      // Note: shared data is NOT removed when a single project's data is removed
    },
  };
}
