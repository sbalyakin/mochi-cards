import { execFileSync } from "node:child_process";

import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Detail,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCachedPromise, usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";

import { CARD_SORT_OPTIONS, cardTitle, isCardSort, isSortDescending, sortCards, type CardSort } from "./card-sorting";
import { EditCardFlow } from "./components/edit-card-flow";
import { resolveGenerationTemplate } from "./domain/edit-card";
import GenerateCard from "./generate-card";
import { cardMarkdown } from "./mochi-card-content";
import {
  isMochiDeckNotFoundError,
  MochiClient,
  MochiError,
  type MochiCard,
  type MochiDeck,
  type MochiTemplate,
} from "./services/mochi-client";
import { DeckSelectionRepository } from "./storage/deck-selection-repository";
import { CardGenerationContextRepository } from "./storage/card-generation-context-repository";
import {
  MochiCatalogRepository,
  type MochiCatalog,
  type MochiCatalogTemplate,
} from "./storage/mochi-catalog-repository";
import { TemplateRepository } from "./storage/template-repository";

const deckSelectionRepository = new DeckSelectionRepository();
const cardGenerationContextRepository = new CardGenerationContextRepository();
const generationTemplateRepository = new TemplateRepository();
const mochiCatalogRepository = new MochiCatalogRepository();
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormatter = createDateTimeFormatter();
const EMPTY_ICON = "blank-icon.svg";
const CARD_FILTER_OPTIONS = [
  { value: "all", title: "All Cards" },
  { value: "reviewed", title: "Reviewed Only" },
  { value: "not-reviewed", title: "Not Reviewed Only" },
] as const;
const CARD_SORT_ICONS: Readonly<Record<CardSort, Icon>> = {
  position: Icon.StackedBars4,
  alphabetical: Icon.Uppercase,
  "created-at": Icon.Calendar,
  "updated-at": Icon.Pencil,
  "last-reviewed": Icon.CheckCircle,
  "review-count": Icon.CheckList,
};

type CardFilter = (typeof CARD_FILTER_OPTIONS)[number]["value"];

export default function BrowseCards() {
  const { mochiApiKey } = getPreferenceValues<Preferences.BrowseCards>();
  const client = new MochiClient(mochiApiKey);
  const browseDataAbortable = useRef<AbortController | undefined>(undefined);
  const reloadAbortable = useRef<AbortController | undefined>(undefined);
  const [isReloading, setIsReloading] = useState(false);
  const [isCatalogInvalidated, setIsCatalogInvalidated] = useState(false);
  const [, setCatalogRevision] = useState(0);
  let cachedCatalog: MochiCatalog | undefined;
  let catalogCacheError: unknown;
  try {
    cachedCatalog = mochiCatalogRepository.get();
  } catch (error: unknown) {
    catalogCacheError = error;
  }
  const shouldLoadCatalog = cachedCatalog === undefined && catalogCacheError === undefined && !isReloading;
  const {
    data: loadedCatalog,
    error: initialCatalogError,
    isLoading: isLoadingBrowseData,
  } = usePromise(() => fetchAndCacheMochiCatalog(client, browseDataAbortable.current?.signal), [], {
    abortable: browseDataAbortable,
    execute: shouldLoadCatalog,
    onData() {
      setIsCatalogInvalidated(false);
    },
  });
  const {
    data: selectedDeckIds = [],
    error: selectionError,
    isLoading: isLoadingSelection,
    revalidate: revalidateSelection,
  } = usePromise(() => deckSelectionRepository.list(), []);

  useEffect(
    () => () => {
      reloadAbortable.current?.abort(new Error("Browse Cards closed"));
    },
    []
  );

  async function reloadDecks(): Promise<void> {
    if (isLoadingBrowseData || reloadAbortable.current) {
      return;
    }

    const controller = new AbortController();
    reloadAbortable.current = controller;
    setIsReloading(true);
    try {
      const catalog = await fetchAndCacheMochiCatalog(client, controller.signal);
      setIsCatalogInvalidated(false);
      setCatalogRevision((revision) => revision + 1);
      await showToast({
        style: Toast.Style.Success,
        title: "Decks Reloaded",
        message: `${catalog.decks.length} deck${catalog.decks.length === 1 ? "" : "s"}`,
      });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Reload Decks",
          message: mochiErrorMessage(error),
        });
      }
    } finally {
      if (reloadAbortable.current === controller) {
        reloadAbortable.current = undefined;
        setIsReloading(false);
      }
    }
  }

  function invalidateCatalog(): void {
    mochiCatalogRepository.clear();
    setIsCatalogInvalidated(true);
  }

  const browseData = isCatalogInvalidated ? undefined : (cachedCatalog ?? loadedCatalog);
  const browseDataError = browseData ? undefined : (catalogCacheError ?? initialCatalogError);
  const decks = browseData?.decks ?? [];
  const templates = browseData?.templates ?? [];
  const selectedDeckIdSet = new Set(selectedDeckIds);
  const visibleDecks = decks.filter((deck) => selectedDeckIdSet.has(deck.id));

  function rememberMochiTemplate(template: MochiTemplate): void {
    const currentCatalog = mochiCatalogRepository.get();
    if (!currentCatalog) {
      return;
    }
    mochiCatalogRepository.replace({
      ...currentCatalog,
      templates: [...currentCatalog.templates.filter((candidate) => candidate.id !== template.id), template].sort(
        (left, right) => left.name.localeCompare(right.name)
      ),
    });
    setCatalogRevision((revision) => revision + 1);
  }

  const configureAction = (
    <Action.Push
      title="Configure Visible Decks"
      icon={Icon.Cog}
      target={<ConfigureDecks decks={decks} initialDeckIds={selectedDeckIds} onSelectionChange={revalidateSelection} />}
    />
  );

  return (
    <List
      isLoading={isLoadingBrowseData || isLoadingSelection || isReloading}
      navigationTitle="Browse Cards"
      searchBarPlaceholder="Search visible decks"
    >
      {browseDataError || selectionError ? (
        <List.EmptyView
          icon={Icon.Warning}
          title={browseDataError ? "Could Not Load Decks or Templates" : "Could Not Load Deck Settings"}
          description={browseDataError ? mochiErrorMessage(browseDataError) : errorMessage(selectionError)}
          actions={
            <ActionPanel>
              {browseDataError ? (
                <Action title="Reload Decks" icon={Icon.ArrowClockwise} onAction={reloadDecks} />
              ) : (
                configureAction
              )}
            </ActionPanel>
          }
        />
      ) : isCatalogInvalidated ? (
        <List.EmptyView
          icon={Icon.ArrowClockwise}
          title="Refreshing Decks"
          description="Fetching the current deck catalog from Mochi."
        />
      ) : decks.length === 0 ? (
        <List.EmptyView
          icon={Icon.Book}
          title="No Decks Found"
          description="Create a deck in Mochi, then reload this command."
          actions={
            <ActionPanel>
              <Action title="Reload Decks" icon={Icon.ArrowClockwise} onAction={reloadDecks} />
            </ActionPanel>
          }
        />
      ) : visibleDecks.length === 0 ? (
        <List.EmptyView
          icon={Icon.Eye}
          title="No Visible Decks"
          description="Choose which Mochi decks you want to browse."
          actions={
            <ActionPanel>
              {configureAction}
              <Action title="Reload Decks" icon={Icon.ArrowClockwise} onAction={reloadDecks} />
            </ActionPanel>
          }
        />
      ) : (
        visibleDecks.map((deck) => (
          <List.Item
            key={deck.id}
            icon={Icon.Book}
            title={deck.name}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Browse Cards"
                  icon={Icon.ArrowRight}
                  target={
                    <CardList
                      client={client}
                      deck={deck}
                      templates={templates}
                      onDeckNotFound={invalidateCatalog}
                      onMochiTemplateUpdated={rememberMochiTemplate}
                    />
                  }
                />
                {configureAction}
                <Action title="Reload Decks" icon={Icon.ArrowClockwise} onAction={reloadDecks} />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

type ConfigureDecksProps = {
  readonly decks: readonly MochiDeck[];
  readonly initialDeckIds: readonly string[];
  readonly onSelectionChange: () => Promise<readonly string[]>;
};

function ConfigureDecks({ decks, initialDeckIds, onSelectionChange }: ConfigureDecksProps) {
  const [selectedDeckIds, setSelectedDeckIds] = useState(() => new Set(initialDeckIds));
  const [isSaving, setIsSaving] = useState(false);

  async function toggleDeck(deck: MochiDeck): Promise<void> {
    if (isSaving) {
      return;
    }

    const nextSelection = new Set(selectedDeckIds);
    if (nextSelection.has(deck.id)) {
      nextSelection.delete(deck.id);
    } else {
      nextSelection.add(deck.id);
    }

    setIsSaving(true);
    try {
      await deckSelectionRepository.replace([...nextSelection]);
      setSelectedDeckIds(nextSelection);
      await onSelectionChange();
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Save Deck Selection",
        message: errorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <List isLoading={isSaving} navigationTitle="Configure Visible Decks" searchBarPlaceholder="Search Mochi decks">
      {decks.map((deck) => {
        const isSelected = selectedDeckIds.has(deck.id);
        return (
          <List.Item
            key={deck.id}
            icon={Icon.Book}
            title={deck.name}
            accessories={[{ icon: isSelected ? Icon.CheckCircle : Icon.Circle }]}
            actions={
              <ActionPanel>
                <Action
                  title={isSelected ? "Hide Deck" : "Show Deck"}
                  icon={isSelected ? Icon.EyeDisabled : Icon.Eye}
                  onAction={() => toggleDeck(deck)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

type CardListProps = {
  readonly client: MochiClient;
  readonly deck: MochiDeck;
  readonly templates: readonly MochiCatalogTemplate[];
  readonly onDeckNotFound: () => void;
  readonly onMochiTemplateUpdated: (template: MochiTemplate) => void;
};

function CardList({ client, deck, templates, onDeckNotFound, onMochiTemplateUpdated }: CardListProps) {
  const { pop } = useNavigation();
  const abortable = useRef<AbortController | undefined>(undefined);
  const [sort, setSort] = useState<CardSort>("position");
  const [isSortReversed, setIsSortReversed] = useState(false);
  const [filter, setFilter] = useState<CardFilter>("all");
  const [isShowingMetadata, setIsShowingMetadata] = useState(true);
  const [isDeletingCard, setIsDeletingCard] = useState(false);
  const [templateOverrides, setTemplateOverrides] = useState<Readonly<Record<string, MochiTemplate>>>({});
  const isDeletingCardRef = useRef(false);
  const hasCardsRef = useRef(false);
  const {
    data: cards = [],
    error,
    isLoading,
    revalidate,
  } = useCachedPromise((deckId: string) => client.listCards(deckId, abortable.current?.signal), [deck.id], {
    abortable,
    initialData: [],
    async onError(error) {
      if (isMochiDeckNotFoundError(error)) {
        onDeckNotFound();
      } else if (hasCardsRef.current) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Refresh Cards",
          message: mochiErrorMessage(error),
        });
      }
    },
  });
  hasCardsRef.current = cards.length > 0;
  const isDeckNotFound = isMochiDeckNotFoundError(error);
  const visibleError = isDeckNotFound || cards.length === 0 ? error : undefined;
  const availableTemplates = [
    ...templates.map((template) => templateOverrides[template.id] ?? template),
    ...Object.values(templateOverrides).filter(
      (template) => !templates.some((candidate) => candidate.id === template.id)
    ),
  ];
  const templatesById = new Map(availableTemplates.map((template) => [template.id, template]));
  const sortedCards = sortCards(cards, sort, isSortReversed);
  const visibleCards = sortedCards.filter((card) => matchesFilter(card, filter));
  const isCurrentSortDescending = isSortDescending(sort, isSortReversed);

  function rememberUpdatedTemplate(template: MochiTemplate): void {
    setTemplateOverrides((current) => ({ ...current, [template.id]: template }));
    onMochiTemplateUpdated(template);
  }

  function selectViewOption(value: string): void {
    if (isCardFilter(value)) {
      setFilter(value);
      return;
    }
    if (isCardSort(value)) {
      if (value === sort) {
        setIsSortReversed((reversed) => !reversed);
      } else {
        setSort(value);
        setIsSortReversed(false);
      }
    }
  }

  async function deleteCard(card: MochiCard): Promise<boolean> {
    if (isDeletingCardRef.current) {
      return false;
    }

    const confirmed = await confirmAlert({
      title: "Delete Card?",
      message: `Permanently delete “${cardTitle(card)}” from Mochi? This cannot be undone.`,
      primaryAction: { title: "Delete Card", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) {
      return false;
    }

    if (isDeletingCardRef.current) {
      return false;
    }

    isDeletingCardRef.current = true;
    setIsDeletingCard(true);
    try {
      try {
        await client.deleteCard(card.id);
      } catch (error: unknown) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Delete Card",
          message: mochiErrorMessage(error),
        });
        return false;
      }

      let contextDeleteError: unknown;
      try {
        await cardGenerationContextRepository.delete(card.id);
      } catch (error: unknown) {
        contextDeleteError = error;
      }

      let refreshError: unknown;
      try {
        await revalidate();
      } catch (error: unknown) {
        refreshError = error;
      }

      const partialFailureMessage = [
        contextDeleteError ? `Edit context: ${errorMessage(contextDeleteError)}` : undefined,
        refreshError ? `Card list refresh: ${errorMessage(refreshError)}` : undefined,
      ]
        .filter((message): message is string => message !== undefined)
        .join(" · ");
      await showToast(
        partialFailureMessage
          ? {
              style: Toast.Style.Failure,
              title: "Card Deleted, but Follow-Up Was Incomplete",
              message: partialFailureMessage,
            }
          : { style: Toast.Style.Success, title: "Card Deleted" }
      );
      return true;
    } finally {
      isDeletingCardRef.current = false;
      setIsDeletingCard(false);
    }
  }

  async function reloadCards(): Promise<void> {
    try {
      await revalidate();
      await showToast({ style: Toast.Style.Success, title: "Cards Reloaded" });
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Reload Cards",
        message: mochiErrorMessage(error),
      });
    }
  }

  return (
    <List
      isLoading={isLoading || isDeletingCard}
      isShowingDetail
      navigationTitle={
        filter === "all" ? deck.name : `${deck.name} · ${filter === "reviewed" ? "Reviewed" : "Not Reviewed"}`
      }
      searchBarAccessory={
        <List.Dropdown tooltip="Sort and Filter Cards" value={sort} onChange={selectViewOption}>
          <List.Dropdown.Section title="Sort by">
            {CARD_SORT_OPTIONS.map((option) => (
              <List.Dropdown.Item
                key={option.value}
                icon={CARD_SORT_ICONS[option.value]}
                title={option.value === sort && isCurrentSortDescending ? `${option.title} (desc)` : option.title}
                value={option.value}
              />
            ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Show">
            {CARD_FILTER_OPTIONS.map((option) => (
              <List.Dropdown.Item
                key={option.value}
                icon={filter === option.value ? Icon.Checkmark : EMPTY_ICON}
                title={option.title}
                value={option.value}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      searchBarPlaceholder="Search cards"
    >
      {visibleError || cards.length === 0 || visibleCards.length === 0 ? (
        <List.EmptyView
          icon={visibleError ? Icon.Warning : Icon.Document}
          title={
            visibleError
              ? isDeckNotFound
                ? "Deck Not Found"
                : "Could Not Load Cards"
              : cards.length === 0
                ? "No Cards in This Deck"
                : filter === "reviewed"
                  ? "No Reviewed Cards"
                  : "No Cards Without Reviews"
          }
          description={
            visibleError
              ? isDeckNotFound
                ? "This cached deck no longer exists in Mochi. The deck cache was cleared."
                : mochiErrorMessage(visibleError)
              : cards.length === 0
                ? "Cards added to this deck will appear here."
                : filter === "reviewed"
                  ? "Review a card in Mochi to show it here."
                  : "Every card in this deck has at least one review."
          }
          actions={
            <ActionPanel>
              {isDeckNotFound ? (
                <Action title="Back to Decks" icon={Icon.ArrowLeft} onAction={pop} />
              ) : (
                <>
                  <Action.Push
                    title="Create Card"
                    icon={Icon.Plus}
                    shortcut={Keyboard.Shortcut.Common.New}
                    target={<GenerateCard deckId={deck.id} />}
                  />
                  <Action
                    title="Reload Cards"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={reloadCards}
                  />
                </>
              )}
            </ActionPanel>
          }
        />
      ) : (
        visibleCards.map((card) => {
          const template = card.templateId ? templatesById.get(card.templateId) : undefined;
          return (
            <List.Item
              key={card.id}
              icon={card.archived ? Icon.CircleDisabled : Icon.Document}
              title={cardTitle(card)}
              keywords={[card.content, ...card.tags, ...card.fields.map((field) => String(field.value))]}
              detail={<CardDetail card={card} deck={deck} template={template} showMetadata={isShowingMetadata} />}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Open Card"
                    icon={Icon.Document}
                    shortcut={Keyboard.Shortcut.Common.Open}
                    target={
                      <CardView
                        card={card}
                        client={client}
                        deck={deck}
                        templates={availableTemplates}
                        onDelete={() => deleteCard(card)}
                        onCardUpdated={async (_updatedCard, updatedTemplate) => {
                          rememberUpdatedTemplate(updatedTemplate);
                          await revalidate();
                        }}
                      />
                    }
                  />
                  {card.templateId ? (
                    <EditCardAction
                      card={card}
                      client={client}
                      deck={deck}
                      onCardUpdated={async (_updatedCard, updatedTemplate) => {
                        rememberUpdatedTemplate(updatedTemplate);
                        await revalidate();
                      }}
                    />
                  ) : null}
                  <Action.Push
                    title="Create Card"
                    icon={Icon.Plus}
                    shortcut={Keyboard.Shortcut.Common.New}
                    target={<GenerateCard deckId={deck.id} />}
                  />
                  <Action.CopyToClipboard
                    title="Copy as Markdown"
                    content={cardMarkdown(card, template)}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                  <Action
                    title={isShowingMetadata ? "Hide Details" : "Show Details"}
                    icon={isShowingMetadata ? Icon.EyeDisabled : Icon.Eye}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                    onAction={() => setIsShowingMetadata((isVisible) => !isVisible)}
                  />
                  <Action
                    title={isSortReversed ? "Use Default Sort Order" : "Reverse Sort Order"}
                    icon={isSortReversed ? Icon.ArrowUp : Icon.ArrowDown}
                    onAction={() => setIsSortReversed((reversed) => !reversed)}
                  />
                  <Action
                    title="Reload Cards"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={reloadCards}
                  />
                  <ActionPanel.Section title="Danger Zone">
                    <Action
                      title="Delete Card"
                      icon={Icon.Trash}
                      shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                      style={Action.Style.Destructive}
                      onAction={() => {
                        void deleteCard(card);
                      }}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function CardView({
  card,
  client,
  deck,
  templates,
  onDelete,
  onCardUpdated,
}: {
  readonly card: MochiCard;
  readonly client: MochiClient;
  readonly deck: MochiDeck;
  readonly templates: readonly MochiCatalogTemplate[];
  readonly onDelete: () => Promise<boolean>;
  readonly onCardUpdated: (card: MochiCard, template: MochiTemplate) => Promise<void> | void;
}) {
  const { pop } = useNavigation();
  const reloadAbortable = useRef<AbortController | undefined>(undefined);
  const deleteInProgress = useRef(false);
  const isMounted = useRef(true);
  const deleteOperationNumber = useRef(0);
  const [currentCard, setCurrentCard] = useState(card);
  const [templateOverride, setTemplateOverride] = useState<MochiTemplate | undefined>(undefined);
  const [isReloading, setIsReloading] = useState(false);
  const template = currentCard.templateId
    ? templateOverride?.id === currentCard.templateId
      ? templateOverride
      : templates.find((candidate) => candidate.id === currentCard.templateId)
    : undefined;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      deleteOperationNumber.current += 1;
      reloadAbortable.current?.abort(new Error("Card view closed"));
    };
  }, []);

  async function deleteCard(): Promise<void> {
    if (deleteInProgress.current) {
      return;
    }
    deleteInProgress.current = true;
    const currentOperation = deleteOperationNumber.current + 1;
    deleteOperationNumber.current = currentOperation;
    try {
      const deleted = await onDelete();
      if (deleted && isMounted.current && deleteOperationNumber.current === currentOperation) {
        pop();
      }
    } finally {
      if (deleteOperationNumber.current === currentOperation) {
        deleteInProgress.current = false;
      }
    }
  }

  async function reloadCard(): Promise<void> {
    if (reloadAbortable.current) {
      return;
    }

    const controller = new AbortController();
    reloadAbortable.current = controller;
    setIsReloading(true);
    try {
      const updatedCard = await client.getCard(currentCard.id, controller.signal);
      if (!controller.signal.aborted) {
        setCurrentCard(updatedCard);
        await showToast({ style: Toast.Style.Success, title: "Card Reloaded" });
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Reload Card",
          message: mochiErrorMessage(error),
        });
      }
    } finally {
      if (reloadAbortable.current === controller) {
        reloadAbortable.current = undefined;
        setIsReloading(false);
      }
    }
  }

  return (
    <Detail
      isLoading={isReloading}
      navigationTitle={cardTitle(currentCard)}
      markdown={cardMarkdown(currentCard, template)}
      actions={
        <ActionPanel>
          {currentCard.templateId ? (
            <EditCardAction
              card={currentCard}
              client={client}
              deck={deck}
              onCardUpdated={async (updatedCard, updatedTemplate) => {
                setCurrentCard(updatedCard);
                setTemplateOverride(updatedTemplate);
                await onCardUpdated(updatedCard, updatedTemplate);
              }}
            />
          ) : null}
          <Action.CopyToClipboard
            title="Copy as Markdown"
            content={cardMarkdown(currentCard, template)}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action
            title="Reload Card"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={reloadCard}
          />
          <ActionPanel.Section title="Danger Zone">
            <Action
              title="Delete Card"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
              style={Action.Style.Destructive}
              onAction={deleteCard}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function EditCardAction({
  card,
  client,
  deck,
  onCardUpdated,
}: {
  readonly card: MochiCard;
  readonly client: MochiClient;
  readonly deck: MochiDeck;
  readonly onCardUpdated: (card: MochiCard, template: MochiTemplate) => Promise<void> | void;
}) {
  const { push } = useNavigation();
  const isOpening = useRef(false);
  const openAbortable = useRef<AbortController | undefined>(undefined);
  const isMounted = useRef(true);
  const operationNumber = useRef(0);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      operationNumber.current += 1;
      openAbortable.current?.abort(new Error("Card view closed"));
    };
  }, []);

  async function openEditor(): Promise<void> {
    if (isOpening.current) {
      return;
    }
    isOpening.current = true;
    const currentOperation = operationNumber.current + 1;
    operationNumber.current = currentOperation;
    const controller = new AbortController();
    openAbortable.current = controller;
    const isCurrent = (): boolean =>
      isMounted.current && operationNumber.current === currentOperation && !controller.signal.aborted;
    try {
      const freshCard = await client.getCard(card.id, controller.signal);
      if (!isCurrent()) {
        return;
      }
      if (freshCard.deckId !== deck.id) {
        throw new Error("Card moved to another Mochi deck. Reopen it from the new deck before editing.");
      }
      if (!freshCard.templateId) {
        throw new Error("Card no longer uses a Mochi template. Reopen it before editing.");
      }
      const generationTemplates = await generationTemplateRepository.list();
      if (!isCurrent()) {
        return;
      }
      const resolution = resolveGenerationTemplate(generationTemplates, deck.id, freshCard.templateId);
      if (resolution.kind === "create") {
        const shouldCreate = await confirmAlert({
          icon: Icon.Warning,
          title: "No Generation Template",
          message: "This card has no compatible Generation Template. Create one to edit the card?",
          primaryAction: { title: "Create Generation Template" },
        });
        if (!isCurrent() || !shouldCreate) {
          return;
        }
      }
      if (isCurrent()) {
        push(<EditCardFlow card={freshCard} client={client} deck={deck} onCardUpdated={onCardUpdated} />);
      }
    } catch (error: unknown) {
      if (isCurrent()) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could Not Start Card Edit",
          message: errorMessage(error),
        });
      }
    } finally {
      if (openAbortable.current === controller) {
        openAbortable.current = undefined;
      }
      if (operationNumber.current === currentOperation) {
        isOpening.current = false;
      }
    }
  }

  return <Action title="Edit Card" icon={Icon.Pencil} shortcut={Keyboard.Shortcut.Common.Edit} onAction={openEditor} />;
}

function isCardFilter(value: string): value is CardFilter {
  return CARD_FILTER_OPTIONS.some((option) => option.value === value);
}

function matchesFilter(card: MochiCard, filter: CardFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return filter === "reviewed" ? card.reviews.length > 0 : card.reviews.length === 0;
}

function CardDetail({
  card,
  deck,
  template,
  showMetadata,
}: {
  readonly card: MochiCard;
  readonly deck: MochiDeck;
  readonly template?: MochiCatalogTemplate;
  readonly showMetadata: boolean;
}) {
  const latestReviewDate = lastReviewDate(card);
  const hasSameCreatedAndUpdatedTime = datesMatchWithinMinute(card.createdAt, card.updatedAt);
  const templateFieldNamesById = new Map(template?.fields.map((field) => [field.id, field.name]));

  return (
    <List.Item.Detail
      markdown={cardMarkdown(card, template)}
      metadata={
        showMetadata ? (
          <List.Item.Detail.Metadata>
            {card.fields.map((field) => (
              <List.Item.Detail.Metadata.Label
                key={field.id}
                title={templateFieldNamesById.get(field.id) || field.id}
                text={String(field.value)}
              />
            ))}
            {card.tags.length > 0 ? (
              <List.Item.Detail.Metadata.TagList title="Tags">
                {card.tags.map((tag) => (
                  <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
                ))}
              </List.Item.Detail.Metadata.TagList>
            ) : null}
            {card.fields.length > 0 || card.tags.length > 0 ? <List.Item.Detail.Metadata.Separator /> : null}
            <List.Item.Detail.Metadata.Label title="Review Count" text={String(card.reviews.length)} />
            {latestReviewDate ? (
              <List.Item.Detail.Metadata.Label title="Last Reviewed" text={formatDateOnly(latestReviewDate)} />
            ) : null}
            {card.createdAt ? (
              <List.Item.Detail.Metadata.Label title="Created" text={formatDate(card.createdAt)} />
            ) : null}
            {card.updatedAt && !hasSameCreatedAndUpdatedTime ? (
              <List.Item.Detail.Metadata.Label title="Updated" text={formatDate(card.updatedAt)} />
            ) : null}
            {card.archived ? <List.Item.Detail.Metadata.Label title="Archived" text="Yes" /> : null}
            <List.Item.Detail.Metadata.Separator />
            {card.templateId ? (
              <List.Item.Detail.Metadata.Label
                title="Mochi Template"
                text={template?.name ?? "Unavailable Template"}
                icon={Icon.Box}
              />
            ) : null}
            <List.Item.Detail.Metadata.Label title="Deck" text={deck.name} icon={Icon.Book} />
          </List.Item.Detail.Metadata>
        ) : undefined
      }
    />
  );
}

function formatDate(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function formatDateOnly(value: string): string {
  return dateFormatter.format(new Date(value));
}

function createDateTimeFormatter(): Intl.DateTimeFormat {
  const hourCycle = systemHourCycle();
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(hourCycle ? { hourCycle } : {}),
  });
}

function systemHourCycle(): "h12" | "h23" | undefined {
  try {
    const setting = execFileSync("/usr/bin/defaults", ["read", "-g", "AppleICUForce24HourTime"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
    if (setting === "1" || setting === "true") {
      return "h23";
    }
    if (setting === "0" || setting === "false") {
      return "h12";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function lastReviewDate(card: MochiCard): string | undefined {
  return card.reviews.reduce<string | undefined>(
    (latest, review) => (latest === undefined || review.date > latest ? review.date : latest),
    undefined
  );
}

function datesMatchWithinMinute(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  const difference = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(difference) && difference < 60_000;
}

function mochiErrorMessage(error: unknown): string {
  if (error instanceof MochiError && error.kind === "unauthorized") {
    return "Check the Mochi API key in extension preferences.";
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

async function fetchAndCacheMochiCatalog(client: MochiClient, signal?: AbortSignal): Promise<MochiCatalog> {
  const decks = await client.listDecks(signal);
  const templates = await client.listTemplates(signal);
  const catalog: MochiCatalog = { decks, templates };
  mochiCatalogRepository.replace(catalog);
  return catalog;
}
