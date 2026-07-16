// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Edit Provider Dialog
 * For editing existing API providers
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { IProvider } from "@/lib/api-key-manager";
import { getApiKeyCount } from "@/lib/api-key-manager";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { Loader2, Search, ChevronDown, ChevronUp } from "lucide-react";

interface EditProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: IProvider | null;
  onSave: (provider: IProvider) => void;
}

export function EditProviderDialog({
  open,
  onOpenChange,
  provider,
  onSave,
}: EditProviderDialogProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  // Model picker state
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [syncedModels, setSyncedModels] = useState<string[]>([]);
  const [syncingModels, setSyncingModels] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);

  const { syncProviderModels } = useAPIConfigStore();

  // Initialize form when provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl);
      setApiKey(provider.apiKey);
      // 加载已有模型
      setModel(provider.model?.join(', ') || '');
      setSelectedModels(new Set(provider.model || []));
      // 如果已经有 allSyncedModels，就展示它们
      if ((provider.allSyncedModels?.length ?? 0) > 0) {
        setSyncedModels(provider.allSyncedModels!);
      }
    }
  }, [provider]);

  // 过滤后的模型列表
  const filteredModels = useMemo(() => {
    let list = syncedModels;
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      list = list.filter(m => m.toLowerCase().includes(q));
    }
    if (!showAllModels && !modelSearch.trim()) {
      list = list.slice(0, 20);
    }
    return list;
  }, [syncedModels, modelSearch, showAllModels]);

  const handleSyncModels = async () => {
    if (!provider) return;
    setSyncingModels(true);
    try {
      const result = await syncProviderModels(provider.id);
      if (result.success) {
        // syncProviderModels 已经写入了 allSyncedModels，但我们需要重新读取
        setSyncingModels(false);
        // 从 store 重新读取 provider
        const updated = useAPIConfigStore.getState().providers.find(p => p.id === provider.id);
        if (updated?.allSyncedModels) {
          setSyncedModels(updated.allSyncedModels);
          // 合并已有选择
          const currentSet = new Set(provider.model || []);
          // 自动勾选推荐模型：评分 >= 60 的最多 8 个
          const scored = updated.allSyncedModels.map(m => {
            const meta = useAPIConfigStore.getState().modelTags[m];
            const type = useAPIConfigStore.getState().modelTypes[m];
            let score = 30;
            const tags = meta ?? [];
            const tagSet = new Set(tags);
            if (type === '图像' && tagSet.has('绘画')) score = 80;
            else if (type === '音视频' && tagSet.has('视频')) score = 70;
            else if (type === '文本') {
              if (tagSet.has('对话') && tagSet.has('工具') && tagSet.has('思考')) score = 100;
              else if (tagSet.has('对话') && tagSet.has('识图')) score = 80;
              else if (tags.length >= 3) score = 60;
              else score = 40;
            }
            return { model: m, score };
          });
          scored.sort((a, b) => b.score - a.score);
          const topN = new Set(scored.slice(0, 8).map(s => s.model));
          for (const m of topN) currentSet.add(m);

          setSelectedModels(currentSet);
          setModel(Array.from(currentSet).join(', '));
          setShowModelPicker(true);
        }
        toast.success(`已同步 ${result.count} 个模型`);
      } else {
        toast.error(result.error || '同步失败');
        setSyncingModels(false);
      }
    } catch (e) {
      toast.error('同步出错');
      setSyncingModels(false);
    }
  };

  const toggleModel = (m: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      setModel(Array.from(next).join(', '));
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set(syncedModels);
    setSelectedModels(all);
    setModel(Array.from(all).join(', '));
  };

  const deselectAll = () => {
    setSelectedModels(new Set());
    setModel('');
  };

  const handleSave = () => {
    if (!provider) return;

    if (!name.trim()) {
      toast.error("请输入名称");
      return;
    }

    // 解析模型列表（支持逗号或换行分隔）
    const models = model
      .split(/[,\n]/)
      .map(m => m.trim())
      .filter(m => m.length > 0);

    onSave({
      ...provider,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: models,
      allSyncedModels: syncedModels.length > 0 ? syncedModels : provider.allSyncedModels,
    });

    onOpenChange(false);
    toast.success("已保存更改");
  };

  const keyCount = getApiKeyCount(apiKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑供应商</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Platform (read-only) */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">平台</Label>
            <Input value={provider?.platform || ""} disabled className="bg-muted" />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="供应商名称"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* API Keys */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>API Keys</Label>
              <span className="text-xs text-muted-foreground">
                {keyCount} 个 Key
              </span>
            </div>
            <Textarea
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入 API Keys（每行一个，或用逗号分隔）"
              className="font-mono text-sm min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              💡 支持多个 Key 轮换使用，失败时自动切换到下一个
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <Label>模型</Label>
            <div className="flex items-center gap-2">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="输入模型名称，如 deepseek-v3"
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleSyncModels}
                disabled={syncingModels}
              >
                {syncingModels ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />同步中</>
                ) : syncedModels.length > 0 ? (
                  `重新同步 (${syncedModels.length})`
                ) : (
                  "同步模型"
                )}
              </Button>
            </div>

            {/* Model Picker */}
            {syncedModels.length > 0 && (
              <div className="border border-border rounded-lg mt-1">
                <button
                  type="button"
                  className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium hover:bg-muted/50 rounded-t-lg"
                  onClick={() => setShowModelPicker(!showModelPicker)}
                >
                  <span>
                    已选 {selectedModels.size} / 共 {syncedModels.length} 个
                  </span>
                  {showModelPicker ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {showModelPicker && (
                  <div className="border-t border-border">
                    {/* Search + Actions */}
                    <div className="flex items-center gap-1.5 px-3 py-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          placeholder="搜索模型..."
                          value={modelSearch}
                          onChange={e => setModelSearch(e.target.value)}
                          className="pl-7 h-7 text-xs"
                        />
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={selectAll}>全选</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={deselectAll}>清空</Button>
                    </div>

                    {/* Model List */}
                    <ScrollArea className="max-h-[200px]">
                      <div className="px-3 pb-2 space-y-0.5">
                        {filteredModels.map(m => (
                          <label
                            key={m}
                            className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-accent/50 text-xs"
                          >
                            <Checkbox
                              checked={selectedModels.has(m)}
                              onCheckedChange={() => toggleModel(m)}
                            />
                            <span className="font-mono truncate flex-1">{m}</span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Show All */}
                    {syncedModels.length > 20 && !modelSearch.trim() && (
                      <button
                        type="button"
                        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border"
                        onClick={() => setShowAllModels(!showAllModels)}
                      >
                        {showAllModels ? (
                          <><ChevronUp className="h-3 w-3" />仅显示前 20 个</>
                        ) : (
                          <><ChevronDown className="h-3 w-3" />显示全部 {syncedModels.length} 个</>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              多个模型用逗号分隔，第一个为默认模型
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
