import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";

import { CARD_SORT_OPTIONS, cardTitle, isCardSort, isSortDescending, sortCards, type CardSort } from "./card-sorting";
import {
  isMochiDeckNotFoundError,
  MochiClient,
  MochiError,
  type MochiCard,
  type MochiDeck,
} from "./services/mochi-client";
import { DeckSelectionRepository } from "./storage/deck-selection-repository";
import { MochiCatalogRepository, type MochiCatalog, type MochiCatalogItem } from "./storage/mochi-catalog-repository";

const deckSelectionRepository = new DeckSelectionRepository();
const mochiCatalogRepository = new MochiCatalogRepository();
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
                    <CardList client={client} deck={deck} templates={templates} onDeckNotFound={invalidateCatalog} />
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
  readonly templates: readonly MochiCatalogItem[];
  readonly onDeckNotFound: () => void;
};

function CardList({ client, deck, templates, onDeckNotFound }: CardListProps) {
  const { pop } = useNavigation();
  const abortable = useRef<AbortController | undefined>(undefined);
  const [sort, setSort] = useState<CardSort>("position");
  const [isSortReversed, setIsSortReversed] = useState(false);
  const [filter, setFilter] = useState<CardFilter>("all");
  const {
    data: cards = [],
    error,
    isLoading,
    revalidate,
  } = usePromise(() => client.listCards(deck.id, abortable.current?.signal), [], {
    abortable,
    onError(error) {
      if (isMochiDeckNotFoundError(error)) {
        onDeckNotFound();
      }
    },
  });
  const isDeckNotFound = isMochiDeckNotFoundError(error);
  const templateNamesById = new Map(templates.map((template) => [template.id, template.name]));
  const sortedCards = sortCards(cards, sort, isSortReversed);
  const visibleCards = sortedCards.filter((card) => matchesFilter(card, filter));
  const isCurrentSortDescending = isSortDescending(sort, isSortReversed);

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

  return (
    <List
      isLoading={isLoading}
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
      {error || cards.length === 0 || visibleCards.length === 0 ? (
        <List.EmptyView
          icon={error ? Icon.Warning : Icon.Document}
          title={
            error
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
            error
              ? isDeckNotFound
                ? "This cached deck no longer exists in Mochi. The deck cache was cleared."
                : mochiErrorMessage(error)
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
                <Action title="Reload Cards" icon={Icon.ArrowClockwise} onAction={revalidate} />
              )}
            </ActionPanel>
          }
        />
      ) : (
        visibleCards.map((card) => (
          <List.Item
            key={card.id}
            icon={card.archived ? Icon.CircleDisabled : Icon.Document}
            title={cardTitle(card)}
            keywords={[card.content, ...card.tags, ...card.fields.map((field) => field.value)]}
            detail={
              <CardDetail
                card={card}
                deck={deck}
                templateName={card.templateId ? templateNamesById.get(card.templateId) : undefined}
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Card Markdown" content={cardMarkdown(card)} />
                <Action
                  title={isSortReversed ? "Use Default Sort Order" : "Reverse Sort Order"}
                  icon={isSortReversed ? Icon.ArrowUp : Icon.ArrowDown}
                  onAction={() => setIsSortReversed((reversed) => !reversed)}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action title="Reload Cards" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
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
  templateName,
}: {
  readonly card: MochiCard;
  readonly deck: MochiDeck;
  readonly templateName?: string;
}) {
  return (
    <List.Item.Detail
      markdown={cardMarkdown(card)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Deck" text={deck.name} icon={Icon.Book} />
          <List.Item.Detail.Metadata.Label title="Card ID" text={card.id} />
          {card.createdAt ? (
            <List.Item.Detail.Metadata.Label title="Created" text={formatDate(card.createdAt)} />
          ) : null}
          {card.updatedAt ? (
            <List.Item.Detail.Metadata.Label title="Updated" text={formatDate(card.updatedAt)} />
          ) : null}
          {card.templateId ? (
            <List.Item.Detail.Metadata.Label
              title="Template"
              text={templateName ?? "Unavailable Template"}
              icon={Icon.Document}
            />
          ) : null}
          {card.archived !== undefined ? (
            <List.Item.Detail.Metadata.Label title="Archived" text={card.archived ? "Yes" : "No"} />
          ) : null}
          {card.tags.length > 0 ? (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {card.tags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          ) : null}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function cardMarkdown(card: MochiCard): string {
  if (card.content.trim().length > 0) {
    return card.content;
  }
  if (card.fields.length === 0) {
    return "_No card content._";
  }
  return card.fields.map((field) => `### ${field.id}\n\n${field.value || "_Empty_"}`).join("\n\n---\n\n");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
