import { useCallback, useMemo, useRef, useState } from "react";
import {
  llmProfileDisplayName,
  rendererLlmRouting,
  type RendererLlmProfile,
  type RendererSettings,
  type UpsertLlmProfileInput,
} from "@shared/schemas/settings";
import { type AutocompleteProviderId } from "@shared/autocomplete";
import { ipcErrorMessage } from "../lib/errors";

export interface LlmSettingsController {
  aiKeySet: boolean;
  mistralKeySet: boolean;
  inceptionKeySet: boolean;
  roster: RendererLlmProfile[];
  mainId: string;
  fallbackIds: string[];
  storedCount: number;
  mainModelLabel: string;
  aiReady: boolean;
  upsertProfile: (input: UpsertLlmProfileInput) => Promise<boolean>;
  deleteProfile: (id: string) => Promise<boolean>;
  setRouting: (mainId: string, fallbackIds: string[]) => void;
  saveApiKey: (key: string | null) => Promise<boolean>;
  saveAutocompleteKey: (provider: AutocompleteProviderId, key: string | null) => Promise<boolean>;
  reset: () => void;
}

export function useLlmSettings(initial: RendererSettings, notify: (message: string) => void): LlmSettingsController {
  const [llm, setLlm] = useState(() => ({
    llmProfiles: initial.llmProfiles,
    llmMainProfileId: initial.llmMainProfileId,
    llmFallbackProfileIds: initial.llmFallbackProfileIds,
    geminiModel: initial.geminiModel,
  }));
  const [aiKeySet, setAiKeySet] = useState(initial.geminiApiKeySet);
  const [mistralKeySet, setMistralKeySet] = useState(initial.mistralApiKeySet);
  const [inceptionKeySet, setInceptionKeySet] = useState(initial.inceptionApiKeySet);

  const routingSeqRef = useRef(0);
  const routingQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const applyLlmSettings = useCallback((settings: RendererSettings): void => {
    setLlm({
      llmProfiles: settings.llmProfiles,
      llmMainProfileId: settings.llmMainProfileId,
      llmFallbackProfileIds: settings.llmFallbackProfileIds,
      geminiModel: settings.geminiModel,
    });
    setAiKeySet(settings.geminiApiKeySet);
  }, []);

  const llmRouting = useMemo(() => rendererLlmRouting(llm), [llm]);
  const mainModelLabel = llmProfileDisplayName(llmRouting.main);
  const aiReady = [llmRouting.main, ...llmRouting.fallbacks].some(
    (profile) => profile.provider !== "gemini" || profile.apiKeySet || aiKeySet,
  );

  const upsertProfile = useCallback(
    async (input: UpsertLlmProfileInput): Promise<boolean> => {
      try {
        applyLlmSettings(await window.api.upsertLlmProfile(input));
        notify("モデル設定を保存しました");
        return true;
      } catch (err) {
        notify(ipcErrorMessage(err));
        return false;
      }
    },
    [applyLlmSettings, notify],
  );

  const deleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        applyLlmSettings(await window.api.deleteLlmProfile(id));
        notify("モデルを削除しました");
        return true;
      } catch (err) {
        notify(ipcErrorMessage(err));
        return false;
      }
    },
    [applyLlmSettings, notify],
  );

  const setRouting = useCallback(
    (mainId: string, fallbackIds: string[]): void => {
      const seq = (routingSeqRef.current += 1);
      setLlm((prev) => ({ ...prev, llmMainProfileId: mainId, llmFallbackProfileIds: fallbackIds }));
      routingQueueRef.current = routingQueueRef.current.then(() =>
        window.api.setLlmRouting(mainId, fallbackIds).then(
          (settings) => {
            if (routingSeqRef.current === seq) applyLlmSettings(settings);
          },
          (err: unknown) => {
            if (routingSeqRef.current !== seq) return;
            notify(ipcErrorMessage(err));
            window.api.getSettings().then(applyLlmSettings, () => undefined);
          },
        ),
      );
    },
    [applyLlmSettings, notify],
  );

  const saveApiKey = useCallback(
    async (key: string | null): Promise<boolean> => {
      try {
        const persisted = await window.api.setSetting("geminiApiKey", key);
        if (!persisted) {
          notify("設定ストアが利用できないため保存できませんでした");
          return false;
        }
        setAiKeySet(key !== null);
        notify(key !== null ? "Gemini API キーを保存しました" : "Gemini API キーを削除しました");
        return true;
      } catch (err) {
        notify(ipcErrorMessage(err));
        return false;
      }
    },
    [notify],
  );

  const saveAutocompleteKey = useCallback(
    async (provider: AutocompleteProviderId, key: string | null): Promise<boolean> => {
      const settingKey = provider === "mistral" ? "mistralApiKey" : "inceptionApiKey";
      try {
        const persisted = await window.api.setSetting(settingKey, key);
        if (!persisted) {
          notify("設定ストアが利用できないため保存できませんでした");
          return false;
        }
        if (provider === "mistral") setMistralKeySet(key !== null);
        else setInceptionKeySet(key !== null);
        notify(key !== null ? "オートコンプリートの API キーを保存しました" : "API キーを削除しました");
        return true;
      } catch (err) {
        notify(ipcErrorMessage(err));
        return false;
      }
    },
    [notify],
  );

  const reset = useCallback((): void => {
    const seq = (routingSeqRef.current += 1);
    routingQueueRef.current = routingQueueRef.current.then(() =>
      window.api.resetLlmRouting().then(
        (settings) => {
          if (routingSeqRef.current === seq) applyLlmSettings(settings);
        },
        (err: unknown) => {
          if (routingSeqRef.current === seq) notify(ipcErrorMessage(err));
        },
      ),
    );
  }, [applyLlmSettings, notify]);

  return {
    aiKeySet,
    mistralKeySet,
    inceptionKeySet,
    roster: llmRouting.roster,
    mainId: llmRouting.main.id,
    fallbackIds: llmRouting.fallbacks.map((profile) => profile.id),
    storedCount: llm.llmProfiles.length,
    mainModelLabel,
    aiReady,
    upsertProfile,
    deleteProfile,
    setRouting,
    saveApiKey,
    saveAutocompleteKey,
    reset,
  };
}
