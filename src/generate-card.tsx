import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";

import { GenerationInputForm } from "./components/generation-input-form";
import type { CardTemplate, FieldValues } from "./domain/template";
import type { MochiCard } from "./services/mochi-client";
import { TemplateForm } from "./components/template-form";
import { TemplateRepository } from "./storage/template-repository";

const repository = new TemplateRepository();

type GenerateCardProps = {
  readonly deckId?: string;
  readonly initialSearchText?: string;
  readonly onCardCreated?: (card: MochiCard) => Promise<void> | void;
  readonly returnToSourceAfterCardCreated?: boolean;
};

export default function GenerateCard({
  deckId,
  initialSearchText,
  onCardCreated,
  returnToSourceAfterCardCreated = false,
}: GenerateCardProps = {}) {
  const { data: templates = [], error, isLoading, revalidate } = usePromise(() => repository.list(), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const matchingTemplates = deckId ? templates.filter((template) => template.deckId === deckId) : templates;
  const selectedTemplate = matchingTemplates.find((template) => template.id === selectedTemplateId);
  const soleDeckTemplate =
    deckId && !isLoading && !error && matchingTemplates.length === 1 ? matchingTemplates[0] : undefined;
  const activeTemplate = selectedTemplate ?? soleDeckTemplate;
  const refresh = async (): Promise<void> => {
    await revalidate();
  };

  if (activeTemplate) {
    return (
      <GenerationInputForm
        template={activeTemplate}
        initialValues={initialValuesForWord(activeTemplate, initialSearchText)}
        onCardCreated={onCardCreated}
        returnToSourceAfterCardCreated={returnToSourceAfterCardCreated}
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle={deckId ? "Create Card" : undefined}
      searchBarPlaceholder="Choose a template to create a card"
    >
      {error ? (
        <List.EmptyView icon={Icon.Warning} title="Couldn't Load Templates" description={errorMessage(error)} />
      ) : matchingTemplates.length === 0 ? (
        <List.Item
          icon={Icon.NewDocument}
          title="Create Template"
          subtitle={
            deckId ? "Create a template for this deck to make a card." : "Create your first template to make a card."
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="Create Template"
                icon={Icon.NewDocument}
                shortcut={Keyboard.Shortcut.Common.New}
                target={<TemplateForm repository={repository} onSaved={refresh} />}
              />
            </ActionPanel>
          }
        />
      ) : (
        matchingTemplates.map((template) => {
          const canGenerate = template.output.kind === "card-body" || template.output.target.status === "configured";
          return (
            <List.Item
              key={template.id}
              icon={Icon.Snippets}
              title={template.name}
              accessories={[
                ...(!canGenerate ? [{ tag: { value: "Needs Mapping", color: "orange" } }] : []),
                { icon: Icon.Book, text: template.deckName },
              ]}
              actions={
                <ActionPanel>
                  {canGenerate ? (
                    returnToSourceAfterCardCreated ? (
                      <Action
                        title="Create Card Using Template"
                        icon={Icon.NewDocument}
                        onAction={() => setSelectedTemplateId(template.id)}
                      />
                    ) : (
                      <Action.Push
                        title="Create Card Using Template"
                        icon={Icon.NewDocument}
                        target={
                          <GenerationInputForm
                            template={template}
                            initialValues={initialValuesForWord(template, initialSearchText)}
                            onCardCreated={onCardCreated}
                          />
                        }
                      />
                    )
                  ) : null}
                  <Action.Push
                    title="Edit Template"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    target={
                      <TemplateForm repository={repository} template={template} onSaved={refresh} onDeleted={refresh} />
                    }
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function initialValuesForWord(template: CardTemplate, searchText: string | undefined): FieldValues | undefined {
  const word = searchText?.trim();
  const textFields = template.fields.filter((field) => field.type === "text");
  const wordField = textFields.find((field) => field.name.trim().toLowerCase() === "word") ?? textFields[0];
  return word && wordField ? { [wordField.id]: word } : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
