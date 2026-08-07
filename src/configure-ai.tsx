import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  Icon,
  List,
  popToRoot,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState, type ReactElement } from "react";

import {
  AiModelCatalog,
  normalizeSelectedModelId,
  type AiModel,
  type ExternalAiProvider,
} from "./services/ai-model-catalog";
import { humanizeAiModelId } from "./services/ai-model-display-name";
import { createAiClient } from "./services/ai-client-factory";
import { AI_PROVIDER_DISPLAY_NAMES, type AiPreferenceValues, type AiProvider } from "./services/ai-provider";
import {
  isRemoteHttpBaseUrl,
  parseCustomHeaders,
  validateCustomBaseUrl,
  withBearerAuthorization,
} from "./services/custom-ai-configuration";
import { aiSettingsRepository } from "./services/raycast-ai-settings-repository";
import { availableRaycastAiModels, DEFAULT_RAYCAST_AI_MODEL, type RaycastAiModel } from "./services/raycast-ai-client";
import { aiThinkingLevels, supportsAiThinking, type AiThinkingLevel } from "./services/ai-thinking";

const EMPTY_SETTINGS: AiPreferenceValues = { aiProvider: "raycast" };
const modelCatalog = new AiModelCatalog();
const OPENAI_MODEL_GROUPS = ["GPT-5", "GPT-4.1", "Reasoning", "GPT-4o", "Other Models"] as const;

export default function ConfigureAiCommand() {
  const { push } = useNavigation();
  const requestController = useRef<AbortController | undefined>(undefined);
  const [settings, setSettings] = useState<AiPreferenceValues>(EMPTY_SETTINGS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | undefined>();
  const { error, isLoading, revalidate } = usePromise(() => aiSettingsRepository.get(), [], {
    onData: setSettings,
    async onError(error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Load AI Settings",
        message: errorMessage(error),
      });
    },
  });
  const apiKeyUrl = providerApiKeyUrl(settings.aiProvider);

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    []
  );

  async function submit(): Promise<void> {
    if (isSubmitting) {
      return;
    }
    setConnectionError(undefined);
    if (settings.aiProvider === "raycast") {
      push(<RaycastModelList settings={settings} onSelected={setSettings} />);
      return;
    }
    if (settings.aiProvider === "custom") {
      await saveCustomSettings();
      return;
    }

    const provider = settings.aiProvider;
    const apiKey = selectedApiKey(settings)?.trim();
    if (!apiKey) {
      setConnectionError(`${AI_PROVIDER_DISPLAY_NAMES[provider]} API key is required`);
      return;
    }

    setIsSubmitting(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const models = await modelCatalog.list(provider, apiKey, controller.signal);
      push(<ModelList models={models} provider={provider} settings={settings} onSelected={setSettings} />);
    } catch (error: unknown) {
      setConnectionError(errorMessage(error));
    } finally {
      if (requestController.current === controller) {
        requestController.current = undefined;
      }
      setIsSubmitting(false);
    }
  }

  async function saveCustomSettings(): Promise<void> {
    const displayName = customDisplayName(settings);
    try {
      const baseUrl = validateCustomBaseUrl(settings.customBaseUrl ?? "", displayName);
      if (!(settings.customModel ?? "").trim()) {
        throw new Error(`${displayName} Model ID is required`);
      }
      withBearerAuthorization(
        parseCustomHeaders(settings.customHeadersJson, displayName),
        settings.customApiKey,
        displayName
      );
      setIsSubmitting(true);
      const saved = await aiSettingsRepository.save({ ...settings, customBaseUrl: baseUrl });
      setSettings(saved);
      await showToast({ style: Toast.Style.Success, title: `${displayName} Selected` });
      await closeMainWindow();
    } catch (error: unknown) {
      setConnectionError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function browseCustomModels(): Promise<void> {
    if (isSubmitting) {
      return;
    }
    setConnectionError(undefined);
    const displayName = customDisplayName(settings);
    let baseUrl: string;
    let headers: Record<string, string>;
    try {
      baseUrl = validateCustomBaseUrl(settings.customBaseUrl ?? "", displayName);
      headers = withBearerAuthorization(
        parseCustomHeaders(settings.customHeadersJson, displayName),
        settings.customApiKey,
        displayName
      );
    } catch (error: unknown) {
      setConnectionError(errorMessage(error));
      return;
    }

    setIsSubmitting(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const models = await modelCatalog.listCustom(baseUrl, headers, displayName, controller.signal);
      push(<CustomModelList models={models} settings={settings} onSelected={setSettings} />);
    } catch (error: unknown) {
      await showToast({ style: Toast.Style.Failure, title: "Could Not Load Models", message: errorMessage(error) });
    } finally {
      if (requestController.current === controller) {
        requestController.current = undefined;
      }
      setIsSubmitting(false);
    }
  }

  async function testProvider(): Promise<void> {
    if (isSubmitting) {
      return;
    }
    setConnectionError(undefined);
    const displayName = selectedProviderDisplayName(settings);
    setIsSubmitting(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const client = createAiClient(settings, { timeoutMs: 15_000 });
      await client.ask("Reply with exactly OK.", controller.signal);
      await showToast({
        style: Toast.Style.Success,
        title: `${displayName} Connection Successful`,
        message: "Authentication and chat completion succeeded.",
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      setConnectionError(message);
      await showToast({ style: Toast.Style.Failure, title: `${displayName} Connection Failed`, message });
    } finally {
      if (requestController.current === controller) {
        requestController.current = undefined;
      }
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isLoading || isSubmitting}
      navigationTitle="Configure AI Provider"
      searchBarAccessory={
        !error && apiKeyUrl ? (
          <Form.LinkAccessory
            target={apiKeyUrl}
            text={`Get ${AI_PROVIDER_DISPLAY_NAMES[settings.aiProvider]} API Key`}
          />
        ) : undefined
      }
      actions={
        <ActionPanel>
          {error ? (
            <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
          ) : (
            <Action.SubmitForm
              title={submitButtonTitle(settings.aiProvider)}
              icon={submitButtonIcon(settings.aiProvider)}
              onSubmit={submit}
            />
          )}
          {!error ? <Action title="Test Provider" icon={Icon.CheckCircle} onAction={testProvider} /> : null}
          {!error && settings.aiProvider === "custom" ? (
            <Action title="Browse Models" icon={Icon.List} onAction={browseCustomModels} />
          ) : null}
          {!error && apiKeyUrl ? (
            <Action.OpenInBrowser
              title={`Get ${AI_PROVIDER_DISPLAY_NAMES[settings.aiProvider]} API Key`}
              url={apiKeyUrl}
            />
          ) : null}
        </ActionPanel>
      }
    >
      {error ? (
        <Form.Description title="AI Settings" text={errorMessage(error)} />
      ) : (
        <>
          <Form.Dropdown
            id="aiProvider"
            title="AI Provider"
            value={settings.aiProvider}
            onChange={(value) => {
              if (isAiProvider(value)) {
                requestController.current?.abort();
                setConnectionError(undefined);
                setSettings((current) => ({ ...current, aiProvider: value }));
              }
            }}
          >
            <Form.Dropdown.Item title="Raycast AI" value="raycast" icon={Icon.Stars} />
            <Form.Dropdown.Item title="OpenAI API" value="openai" icon={Icon.Globe} />
            <Form.Dropdown.Item title="Google Gemini API" value="gemini" icon={Icon.Globe} />
            <Form.Dropdown.Item title="Anthropic Claude API" value="anthropic" icon={Icon.Globe} />
            <Form.Dropdown.Item title="Custom AI" value="custom" icon={Icon.Globe} />
          </Form.Dropdown>
          {settings.aiProvider === "raycast" ? (
            <>
              <Form.Description
                title="Raycast AI"
                text="Uses the AI access included with your Raycast account. No API key is required."
              />
              <Form.Description title="Current Model" text={settings.raycastModelName ?? "GPT-5 Mini (default)"} />
            </>
          ) : settings.aiProvider === "custom" ? (
            <CustomProviderFields
              connectionError={connectionError}
              settings={settings}
              onChange={(next) => {
                setConnectionError(undefined);
                setSettings(next);
              }}
            />
          ) : (
            <ExternalProviderFields
              connectionError={connectionError}
              provider={settings.aiProvider}
              settings={settings}
              onChange={(next) => {
                setConnectionError(undefined);
                setSettings(next);
              }}
            />
          )}
          {apiKeyUrl ? (
            <Form.Description
              title="Need an API Key?"
              text={`Use “Get ${AI_PROVIDER_DISPLAY_NAMES[settings.aiProvider]} API Key” in the top right to open the provider's key page.`}
            />
          ) : null}
          <Form.Description
            title="Storage"
            text={
              settings.aiProvider === "custom"
                ? "API key and additional headers are stored in macOS Keychain. Provider name, Base URL, and model ID are stored in Raycast extension storage. Settings for other providers remain saved when you switch."
                : "API keys are stored in macOS Keychain. Settings for other providers remain saved when you switch."
            }
          />
        </>
      )}
    </Form>
  );
}

function submitButtonTitle(provider: AiProvider): string {
  if (provider === "raycast") {
    return "Choose Model";
  }
  if (provider === "custom") {
    return "Save Custom Provider";
  }
  return "Choose Model";
}

function submitButtonIcon(provider: AiProvider) {
  if (provider === "raycast") {
    return Icon.ArrowRight;
  }
  if (provider === "custom") {
    return Icon.Checkmark;
  }
  return Icon.ArrowRight;
}

function customDisplayName(settings: AiPreferenceValues): string {
  return settings.customProviderName?.trim() || AI_PROVIDER_DISPLAY_NAMES.custom;
}

function selectedProviderDisplayName(settings: AiPreferenceValues): string {
  return settings.aiProvider === "custom"
    ? customDisplayName(settings)
    : AI_PROVIDER_DISPLAY_NAMES[settings.aiProvider];
}

function RaycastModelList({
  settings,
  onSelected,
}: {
  readonly settings: AiPreferenceValues;
  readonly onSelected: (settings: AiPreferenceValues) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const models = availableRaycastAiModels();
  const currentModelId = settings.raycastModel ?? DEFAULT_RAYCAST_AI_MODEL;
  const currentModel = models.find((model) => model.id === currentModelId);
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const filteredModels = models.filter(
    (model) =>
      model.id !== currentModelId &&
      (!normalizedSearch ||
        model.id.toLocaleLowerCase().includes(normalizedSearch) ||
        model.displayName.toLocaleLowerCase().includes(normalizedSearch))
  );

  async function selectModel(model: RaycastAiModel): Promise<void> {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const saved = await aiSettingsRepository.save({
        ...settings,
        raycastModel: model.id,
        raycastModelName: model.displayName,
      });
      onSelected(saved);
      await showToast({ style: Toast.Style.Success, title: "Raycast AI Selected", message: model.displayName });
      await popToRoot();
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save AI Settings",
        message: errorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <List
      filtering={false}
      isLoading={isSaving}
      navigationTitle="Choose Raycast AI Model"
      searchBarPlaceholder="Search models…"
      onSearchTextChange={setSearchText}
    >
      {currentModel ? (
        <List.Section title="Current Model">
          <RaycastModelItem model={currentModel} selected onSelect={selectModel} />
        </List.Section>
      ) : null}
      <List.Section title={`Models (${filteredModels.length})`}>
        {filteredModels.map((model) => (
          <RaycastModelItem key={model.id} model={model} onSelect={selectModel} />
        ))}
      </List.Section>
    </List>
  );
}

function RaycastModelItem({
  model,
  selected = false,
  onSelect,
}: {
  readonly model: RaycastAiModel;
  readonly selected?: boolean;
  readonly onSelect: (model: RaycastAiModel) => Promise<void>;
}) {
  return (
    <List.Item
      title={model.displayName}
      subtitle={model.id}
      icon={selected ? Icon.Checkmark : Icon.Stars}
      accessories={selected ? [{ text: "Selected" }] : undefined}
      actions={
        <ActionPanel>
          <Action title="Use Model" icon={Icon.Checkmark} onAction={() => onSelect(model)} />
        </ActionPanel>
      }
    />
  );
}

function CustomProviderFields({
  connectionError,
  settings,
  onChange,
}: {
  readonly connectionError?: string;
  readonly settings: AiPreferenceValues;
  readonly onChange: (settings: AiPreferenceValues) => void;
}) {
  const remoteHttpWarning = isRemoteHttpBaseUrl(settings.customBaseUrl ?? "")
    ? "Remote HTTP is not allowed because prompts and credentials could be intercepted. Use HTTPS."
    : undefined;
  return (
    <>
      <Form.TextField
        id="customProviderName"
        title="Provider Name"
        placeholder="e.g. Ollama, LM Studio, OpenRouter"
        value={settings.customProviderName ?? ""}
        onChange={(value) => onChange({ ...settings, customProviderName: value })}
      />
      <Form.TextField
        id="customBaseUrl"
        title="Base URL"
        placeholder="http://localhost:11434/v1"
        value={settings.customBaseUrl ?? ""}
        onChange={(value) => onChange({ ...settings, customBaseUrl: value })}
      />
      {remoteHttpWarning ? <Form.Description title="Warning" text={remoteHttpWarning} /> : null}
      <Form.TextField
        id="customModel"
        title="Model ID"
        placeholder="llama3.1"
        value={settings.customModel ?? ""}
        onChange={(value) => onChange({ ...settings, customModel: value })}
      />
      <Form.PasswordField
        id="customApiKey"
        title="API Key"
        placeholder="sk-..."
        value={settings.customApiKey ?? ""}
        onChange={(value) => onChange({ ...settings, customApiKey: value })}
      />
      <Form.Description title="Authentication" text="API key is sent as an Authorization: Bearer header." />
      <Form.TextArea
        id="customHeadersJson"
        title="Additional Headers JSON"
        placeholder='{"X-Organization": "example"}'
        value={settings.customHeadersJson ?? ""}
        onChange={(value) => onChange({ ...settings, customHeadersJson: value })}
      />
      <Form.Description
        title="Additional Headers JSON"
        text="Optional headers stored in macOS Keychain. Use a flat JSON object of string values. API Key overrides any Authorization header here."
      />
      {connectionError ? <Form.Description title="Configuration Error" text={connectionError} /> : null}
    </>
  );
}

function CustomModelList({
  models,
  settings,
  onSelected,
}: {
  readonly models: readonly AiModel[];
  readonly settings: AiPreferenceValues;
  readonly onSelected: (settings: AiPreferenceValues) => void;
}) {
  const { pop } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const filteredModels = normalizedSearch
    ? models.filter((model) => model.id.toLocaleLowerCase().includes(normalizedSearch))
    : models;

  return (
    <List
      filtering={false}
      navigationTitle="Choose Model"
      searchBarPlaceholder="Search models…"
      onSearchTextChange={setSearchText}
    >
      <List.Section title={`Models (${filteredModels.length})`}>
        {filteredModels.map((model) => (
          <List.Item
            key={model.id}
            title={model.displayName || model.id}
            actions={
              <ActionPanel>
                <Action
                  title="Use Model"
                  icon={Icon.Checkmark}
                  onAction={() => {
                    onSelected({ ...settings, customModel: model.id });
                    pop();
                  }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

function ExternalProviderFields({
  connectionError,
  provider,
  settings,
  onChange,
}: {
  readonly connectionError?: string;
  readonly provider: ExternalAiProvider;
  readonly settings: AiPreferenceValues;
  readonly onChange: (settings: AiPreferenceValues) => void;
}) {
  const model = modelFor(settings, provider);
  const modelName = modelNameFor(settings, provider);
  return (
    <>
      <Form.PasswordField
        id={`${provider}ApiKey`}
        title={`${AI_PROVIDER_DISPLAY_NAMES[provider]} API Key`}
        value={apiKeyFor(settings, provider) ?? ""}
        error={connectionError}
        onChange={(apiKey) => onChange(withApiKey(settings, provider, apiKey))}
      />
      <Form.Description
        title="Current Model"
        text={model ? (modelName ?? humanizeAiModelId(model)) : "No model selected yet."}
      />
    </>
  );
}

function ModelList({
  models,
  provider,
  settings,
  onSelected,
}: {
  readonly models: readonly AiModel[];
  readonly provider: ExternalAiProvider;
  readonly settings: AiPreferenceValues;
  readonly onSelected: (settings: AiPreferenceValues) => void;
}) {
  const { push } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const currentModel = selectedModel(settings);
  const currentModelName = selectedModelName(settings);
  const normalizedSearch = searchText.trim().toLocaleLowerCase();
  const filteredModels = normalizedSearch
    ? models.filter(
        (model) =>
          model.id.toLocaleLowerCase().includes(normalizedSearch) ||
          model.displayName?.toLocaleLowerCase().includes(normalizedSearch)
      )
    : models;
  const currentModelDetails = currentModel ? models.find((model) => model.id === currentModel) : undefined;
  const availableModels = filteredModels.filter((model) => model.id !== currentModel);
  const modelSections =
    provider === "openai"
      ? OPENAI_MODEL_GROUPS.flatMap((title) => {
          const modelsInGroup = availableModels.filter((model) => model.group === title);
          return modelsInGroup.length > 0 ? [{ title, models: modelsInGroup }] : [];
        })
      : provider === "gemini"
        ? geminiModelSections(availableModels)
        : provider === "anthropic"
          ? claudeModelSections(availableModels)
          : [{ title: `Text Models (${availableModels.length})`, models: availableModels }];

  async function selectModel(modelId: string, modelName?: string, thinkingSupported?: boolean): Promise<void> {
    if (isSaving) {
      return;
    }
    const normalizedModel = normalizeSelectedModelId(provider, modelId);
    if (!normalizedModel) {
      return;
    }
    const normalizedModelName = modelName?.trim() || humanizeAiModelId(normalizedModel);
    const supportsThinking = thinkingSupported ?? supportsAiThinking(provider, normalizedModel);
    const previousThinkingLevel = thinkingLevelFor(settings, provider);
    const nextThinkingLevel =
      supportsThinking &&
      previousThinkingLevel &&
      aiThinkingLevels(provider, normalizedModel).includes(previousThinkingLevel)
        ? previousThinkingLevel
        : undefined;
    const nextSettings = withThinkingLevel(
      withModel(settings, provider, normalizedModel, normalizedModelName, supportsThinking),
      provider,
      nextThinkingLevel
    );
    setIsSaving(true);
    try {
      if (supportsThinking) {
        push(<ThinkingForm provider={provider} settings={nextSettings} onSelected={onSelected} />);
        return;
      }
      const saved = await aiSettingsRepository.save(nextSettings);
      onSelected(saved);
      await showToast({ style: Toast.Style.Success, title: `${AI_PROVIDER_DISPLAY_NAMES[provider]} Selected` });
      await popToRoot();
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save AI Settings",
        message: errorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  const manualModelForm = <ManualModelForm provider={provider} onSubmit={selectModel} />;

  return (
    <List
      filtering={false}
      isLoading={isSaving}
      navigationTitle={`Choose ${AI_PROVIDER_DISPLAY_NAMES[provider]} Model`}
      searchBarPlaceholder="Search models…"
      onSearchTextChange={setSearchText}
    >
      {currentModel ? (
        <List.Section title="Current Model">
          <List.Item
            title={
              currentModelName ??
              (currentModelDetails ? modelTitle(currentModelDetails) : humanizeAiModelId(currentModel))
            }
            subtitle="Currently selected"
            icon={Icon.Checkmark}
            accessories={[{ text: "Selected" }]}
            actions={
              <ActionPanel>
                <Action
                  title="Use Model"
                  icon={Icon.Checkmark}
                  onAction={() =>
                    selectModel(
                      currentModel,
                      currentModelName ?? humanizeAiModelId(currentModel),
                      currentModelDetails?.thinkingSupported
                    )
                  }
                />
                <Action.Push title="Enter Model ID Manually" icon={Icon.Pencil} target={manualModelForm} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      {modelSections.map((section) => (
        <ModelSection
          key={section.title}
          models={section.models}
          title={section.title}
          manualModelForm={manualModelForm}
          onSelect={selectModel}
        />
      ))}
      <List.Section title="Manual Selection">
        <List.Item
          title="Enter Model ID Manually"
          subtitle="Use a model that is not shown in the provider's list"
          icon={Icon.Pencil}
          actions={
            <ActionPanel>
              <Action.Push title="Enter Model ID Manually" icon={Icon.Pencil} target={manualModelForm} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

function ThinkingForm({
  provider,
  settings,
  onSelected,
}: {
  readonly provider: ExternalAiProvider;
  readonly settings: AiPreferenceValues;
  readonly onSelected: (settings: AiPreferenceValues) => void;
}) {
  const [thinkingLevel, setThinkingLevel] = useState<AiThinkingLevel | undefined>(thinkingLevelFor(settings, provider));
  const [isSaving, setIsSaving] = useState(false);

  async function save(): Promise<void> {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const saved = await aiSettingsRepository.save(withThinkingLevel(settings, provider, thinkingLevel));
      onSelected(saved);
      await showToast({ style: Toast.Style.Success, title: `${AI_PROVIDER_DISPLAY_NAMES[provider]} Selected` });
      await popToRoot();
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save AI Settings",
        message: errorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle="Configure Thinking"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Use Model" icon={Icon.Checkmark} onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Model"
        text={modelNameFor(settings, provider) ?? humanizeAiModelId(modelFor(settings, provider) ?? "")}
      />
      <Form.Dropdown
        id="thinkingLevel"
        title="Thinking"
        value={thinkingLevel ?? "default"}
        onChange={(value) =>
          setThinkingLevel(aiThinkingLevels(provider, modelFor(settings, provider)).find((level) => level === value))
        }
      >
        <Form.Dropdown.Item title="Provider Default" value="default" />
        {aiThinkingLevels(provider, modelFor(settings, provider)).map((level) => (
          <Form.Dropdown.Item key={level} title={thinkingLevelTitle(level)} value={level} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function thinkingLevelTitle(level: AiThinkingLevel): string {
  return level === "none" ? "Off" : level[0].toUpperCase() + level.slice(1);
}

function geminiModelSections(
  models: readonly AiModel[]
): readonly { readonly title: string; readonly models: readonly AiModel[] }[] {
  const grouped = new Map<string, AiModel[]>();
  for (const model of models) {
    const title = model.group ?? "Other Models";
    const group = grouped.get(title);
    if (group) {
      group.push(model);
    } else {
      grouped.set(title, [model]);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareGeminiGroupTitles(left, right))
    .map(([title, models]) => ({ title, models }));
}

function compareGeminiGroupTitles(left: string, right: string): number {
  const leftVersion = geminiGroupVersion(left);
  const rightVersion = geminiGroupVersion(right);
  if (leftVersion !== undefined && rightVersion !== undefined) {
    return rightVersion - leftVersion;
  }
  if (left === "Gemini Latest") {
    return -1;
  }
  if (right === "Gemini Latest") {
    return 1;
  }
  if (leftVersion !== undefined) {
    return -1;
  }
  if (rightVersion !== undefined) {
    return 1;
  }
  if (left === "Gemma") {
    return -1;
  }
  if (right === "Gemma") {
    return 1;
  }
  return left.localeCompare(right);
}

function geminiGroupVersion(group: string): number | undefined {
  const match = /^Gemini (\d+(?:\.\d+)?)$/.exec(group);
  return match ? Number(match[1]) : undefined;
}

function claudeModelSections(
  models: readonly AiModel[]
): readonly { readonly title: string; readonly models: readonly AiModel[] }[] {
  const grouped = new Map<string, AiModel[]>();
  for (const model of models) {
    const title = model.group ?? "Other Models";
    const group = grouped.get(title);
    if (group) {
      group.push(model);
    } else {
      grouped.set(title, [model]);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareClaudeGroupTitles(left, right))
    .map(([title, models]) => ({ title, models }));
}

function compareClaudeGroupTitles(left: string, right: string): number {
  const leftVersion = claudeGroupVersion(left);
  const rightVersion = claudeGroupVersion(right);
  if (leftVersion !== undefined && rightVersion !== undefined) {
    return rightVersion - leftVersion;
  }
  if (leftVersion !== undefined) {
    return -1;
  }
  if (rightVersion !== undefined) {
    return 1;
  }
  return left.localeCompare(right);
}

function claudeGroupVersion(group: string): number | undefined {
  const match = /^Claude (\d+(?:\.\d+)?)$/.exec(group);
  return match ? Number(match[1]) : undefined;
}

function ModelSection({
  models,
  title,
  manualModelForm,
  onSelect,
}: {
  readonly models: readonly AiModel[];
  readonly title: string;
  readonly manualModelForm: ReactElement;
  readonly onSelect: (modelId: string, modelName?: string, thinkingSupported?: boolean) => Promise<void>;
}) {
  return (
    <List.Section title={title}>
      {models.map((model) => (
        <List.Item
          key={model.id}
          title={modelTitle(model)}
          actions={
            <ActionPanel>
              <Action
                title="Use Model"
                icon={Icon.Checkmark}
                onAction={() => onSelect(model.id, modelTitle(model), model.thinkingSupported)}
              />
              <Action.Push title="Enter Model ID Manually" icon={Icon.Pencil} target={manualModelForm} />
            </ActionPanel>
          }
        />
      ))}
    </List.Section>
  );
}

function modelTitle(model: AiModel): string {
  return model.displayName || humanizeAiModelId(model.id);
}

function ManualModelForm({
  provider,
  onSubmit,
}: {
  readonly provider: ExternalAiProvider;
  readonly onSubmit: (modelId: string) => Promise<void>;
}) {
  const [modelId, setModelId] = useState("");
  const [validationError, setValidationError] = useState<string | undefined>();

  async function submit(): Promise<void> {
    if (!modelId.trim()) {
      setValidationError("Model ID is required");
      return;
    }
    await onSubmit(modelId);
  }

  return (
    <Form
      navigationTitle="Enter Model ID"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Use Model" icon={Icon.Checkmark} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Provider"
        text={`Enter a model ID supported by ${AI_PROVIDER_DISPLAY_NAMES[provider]}.`}
      />
      <Form.TextField
        id="modelId"
        title="Model ID"
        placeholder={provider === "gemini" ? "gemini-…" : "Enter model ID"}
        value={modelId}
        error={validationError}
        onChange={(value) => {
          setModelId(value);
          setValidationError(undefined);
        }}
      />
    </Form>
  );
}

function selectedApiKey(settings: AiPreferenceValues): string | undefined {
  switch (settings.aiProvider) {
    case "raycast":
    case "custom":
      return undefined;
    case "openai":
      return settings.openaiApiKey;
    case "gemini":
      return settings.geminiApiKey;
    case "anthropic":
      return settings.anthropicApiKey;
  }
}

function selectedModel(settings: AiPreferenceValues): string | undefined {
  switch (settings.aiProvider) {
    case "raycast":
      return undefined;
    case "openai":
      return settings.openaiModel;
    case "gemini":
      return settings.geminiModel;
    case "anthropic":
      return settings.anthropicModel;
    case "custom":
      return settings.customModel;
  }
}

function selectedModelName(settings: AiPreferenceValues): string | undefined {
  switch (settings.aiProvider) {
    case "raycast":
    case "custom":
      return undefined;
    case "openai":
      return settings.openaiModelName;
    case "gemini":
      return settings.geminiModelName;
    case "anthropic":
      return settings.anthropicModelName;
  }
}

function apiKeyFor(settings: AiPreferenceValues, provider: ExternalAiProvider): string | undefined {
  switch (provider) {
    case "openai":
      return settings.openaiApiKey;
    case "gemini":
      return settings.geminiApiKey;
    case "anthropic":
      return settings.anthropicApiKey;
  }
}

function modelFor(settings: AiPreferenceValues, provider: ExternalAiProvider): string | undefined {
  switch (provider) {
    case "openai":
      return settings.openaiModel;
    case "gemini":
      return settings.geminiModel;
    case "anthropic":
      return settings.anthropicModel;
  }
}

function modelNameFor(settings: AiPreferenceValues, provider: ExternalAiProvider): string | undefined {
  switch (provider) {
    case "openai":
      return settings.openaiModelName;
    case "gemini":
      return settings.geminiModelName;
    case "anthropic":
      return settings.anthropicModelName;
  }
}

function withApiKey(settings: AiPreferenceValues, provider: ExternalAiProvider, apiKey: string): AiPreferenceValues {
  switch (provider) {
    case "openai":
      return { ...settings, openaiApiKey: apiKey };
    case "gemini":
      return { ...settings, geminiApiKey: apiKey };
    case "anthropic":
      return { ...settings, anthropicApiKey: apiKey };
  }
}

function withModel(
  settings: AiPreferenceValues,
  provider: ExternalAiProvider,
  model: string,
  modelName: string,
  thinkingSupported: boolean
): AiPreferenceValues {
  switch (provider) {
    case "openai":
      return {
        ...settings,
        openaiModel: model,
        openaiModelName: modelName,
        ...(thinkingSupported ? {} : { openaiThinkingLevel: undefined }),
      };
    case "gemini":
      return {
        ...settings,
        geminiModel: model,
        geminiModelName: modelName,
        ...(thinkingSupported ? {} : { geminiThinkingLevel: undefined }),
      };
    case "anthropic":
      return {
        ...settings,
        anthropicModel: model,
        anthropicModelName: modelName,
        ...(thinkingSupported ? {} : { anthropicThinkingLevel: undefined }),
      };
  }
}

function thinkingLevelFor(settings: AiPreferenceValues, provider: ExternalAiProvider): AiThinkingLevel | undefined {
  switch (provider) {
    case "openai":
      return settings.openaiThinkingLevel;
    case "gemini":
      return settings.geminiThinkingLevel;
    case "anthropic":
      return settings.anthropicThinkingLevel;
  }
}

function withThinkingLevel(
  settings: AiPreferenceValues,
  provider: ExternalAiProvider,
  thinkingLevel: AiThinkingLevel | undefined
): AiPreferenceValues {
  switch (provider) {
    case "openai":
      return { ...settings, openaiThinkingLevel: thinkingLevel };
    case "gemini":
      return { ...settings, geminiThinkingLevel: thinkingLevel };
    case "anthropic":
      return { ...settings, anthropicThinkingLevel: thinkingLevel };
  }
}

function providerApiKeyUrl(provider: AiProvider): string | undefined {
  switch (provider) {
    case "raycast":
    case "custom":
      return undefined;
    case "openai":
      return "https://platform.openai.com/api-keys";
    case "gemini":
      return "https://aistudio.google.com/apikey";
    case "anthropic":
      return "https://console.anthropic.com/settings/keys";
  }
}

function isAiProvider(value: string): value is AiProvider {
  return value === "raycast" || value === "openai" || value === "gemini" || value === "anthropic" || value === "custom";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
