// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";
import { generateUUID } from "@/lib/utils";

export const DEFAULT_FPS = 30;

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  createProject: (name?: string) => Project;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  ensureDefaultProject: () => void;
}

// Default project for desktop app
const DEFAULT_PROJECT: Project = {
  id: "default-project",
  name: "魔因漫创项目",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [DEFAULT_PROJECT],
      activeProjectId: DEFAULT_PROJECT.id,
      activeProject: DEFAULT_PROJECT,

      ensureDefaultProject: () => {
        const { projects, activeProjectId } = get();
        if (projects.length === 0) {
          set({
            projects: [DEFAULT_PROJECT],
            activeProjectId: DEFAULT_PROJECT.id,
            activeProject: DEFAULT_PROJECT,
          });
          return;
        }
        if (!activeProjectId) {
          set({
            activeProjectId: projects[0].id,
            activeProject: projects[0],
          });
        }
      },

      createProject: (name) => {
        const newProject: Project = {
          id: generateUUID(),
          name: name?.trim() || `新项目 ${new Date().toLocaleDateString('zh-CN')}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({
          projects: [newProject, ...state.projects],
          // 不在这里设置 activeProjectId —— 由 switchProject() 统一处理
          // 避免 switchProject 因 ID 已相同而跳过 rehydration
        }));
        return newProject;
      },

      renameProject: (id, name) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p
          ),
          activeProject:
            state.activeProject?.id === id
              ? { ...state.activeProject, name, updatedAt: Date.now() }
              : state.activeProject,
        }));
      },

      deleteProject: (id) => {
        set((state) => {
          const remaining = state.projects.filter((p) => p.id !== id);
          const nextActive =
            state.activeProjectId === id ? remaining[0] || null : state.activeProject;
          return {
            projects: remaining,
            activeProjectId: nextActive?.id || null,
            activeProject: nextActive,
          };
        });
        // Clean up per-project storage directory
        if (window.fileStorage?.removeDir) {
          window.fileStorage.removeDir(`_p/${id}`).catch((err: any) =>
            console.warn(`[ProjectStore] Failed to remove project dir _p/${id}:`, err)
          );
        }
      },

      setActiveProject: (id) => {
        set((state) => {
          const project = state.projects.find((p) => p.id === id) || null;
          return {
            activeProjectId: project?.id || null,
            activeProject: project,
          };
        });
      },
    }),
    {
      name: "moyin-project-store",
      version: 1,
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
      migrate: (persisted: any) => {
        if (persisted?.projects && persisted.projects.length > 0) {
          return persisted;
        }
        return {
          projects: [DEFAULT_PROJECT],
          activeProjectId: DEFAULT_PROJECT.id,
        };
      },
      onRehydrateStorage: () => async (state) => {
        if (!state) return;
        
        // 扫描磁盘 _p/ 目录恢复项目（在激活项目之前执行）
        if (window.fileStorage?.listDirs) {
          try {
            await discoverProjectsFromDisk();
          } catch (err) {
            console.warn('[ProjectStore] Disk discovery failed:', err);
          }
        }
        
        const project =
          state.projects.find((p) => p.id === state.activeProjectId) ||
          state.projects[0] ||
          null;
        state.activeProjectId = project?.id || null;
        state.activeProject = project;
      },
    }
  )
);

/**
 * 扫描磁盘上 _p/ 目录下的实际项目文件夹，
 * 将未在 projects 列表中注册的项目自动恢复。
 * 
 * 解决以下场景：
 * - 更改存储路径并迁移数据后，前端 store 未 reload，或 moyin-project-store.json
 *   中的 projects 列表不完整（旧版本、手动复制等）
 * - 导入数据后 moyin-project-store.json 缺失或不含新项目
 * - 换电脑后指向旧数据目录，projects 列表为空
 */
async function discoverProjectsFromDisk(): Promise<void> {
  if (!window.fileStorage?.listDirs) return;

  try {
    const diskProjectIds = await window.fileStorage.listDirs('_p');
    if (!diskProjectIds || diskProjectIds.length === 0) return;

    // 过滤：只保留 UUID 格式的项目ID（跳过 _migrated, default-project 等）
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = diskProjectIds.filter((id: string) => uuidPattern.test(id));
    if (validIds.length === 0) return;

    console.log('[ProjectStore] Disk projects found:', validIds.map((id: string) => id.substring(0, 8)));

    const { projects } = useProjectStore.getState();
    // 重建项目列表：先保留已有的有效项目，再加入磁盘上发现的新项目
    const existingValid = projects.filter((p) => uuidPattern.test(p.id));
    const knownIds = new Set(existingValid.map((p) => p.id));
    const missingIds = validIds.filter((id: string) => !knownIds.has(id));
    if (missingIds.length === 0 && existingValid.length === projects.length) return;

    console.log('[ProjectStore] Merging projects: existing=' + existingValid.length + ', fromDisk=' + missingIds.length);

    // 从 script 文件提取项目名称
    const recoveredProjects: Project[] = [];
    for (const pid of missingIds) {
      let name = '恢复的项目';
      const createdAt = Date.now();

      try {
        const scriptRaw = await window.fileStorage.getItem('_p/' + pid + '/script');
        if (scriptRaw) {
          const parsed = JSON.parse(scriptRaw);
          const pd = parsed?.state?.projectData;
          if (pd?.rawScript) {
            const preview = pd.rawScript.substring(0, 30).replace(/\n/g, ' ').trim();
            if (preview) name = preview;
          }
        }
      } catch { /* ignore */ }

      recoveredProjects.push({
        id: pid,
        name,
        createdAt,
        updatedAt: Date.now(),
      });
    }

    // 更新 store：有效项目 + 新恢复的项目
    useProjectStore.setState({
      projects: [...existingValid, ...recoveredProjects],
      // 如果有新项目且没有 active 项目，自动选中第一个
      ...(getActiveId() ? {} : {
        activeProjectId: (recoveredProjects[0] || existingValid[0])?.id || null,
        activeProject: recoveredProjects[0] || existingValid[0] || null,
      }),
    });

    console.log('[ProjectStore] Project list updated: ' + (existingValid.length + recoveredProjects.length) + ' projects');
  } catch (err) {
    console.error('[ProjectStore] discoverProjectsFromDisk error:', err);
  }
  
  function getActiveId(): string | null {
    return useProjectStore.getState().activeProjectId;
  }
}
