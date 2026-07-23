import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";

import { GenerationInputForm } from "./components/generation-input-form";
import { parseTemplate } from "./domain/template-parser";
import { TemplateRepository } from "./storage/template-repository";

const repository = new TemplateRepository();

type GenerateCardProps = {
  readonly deckId?: string;
};

export default function GenerateCard({ deckId }: GenerateCardProps = {}) {
  const { data: templates = [], error, isLoading } = usePromise(() => repository.list(), []);
  const matchingTemplates = deckId ? templates.filter((template) => template.deckId === deckId) : templates;

  if (deckId && !isLoading && !error && matchingTemplates.length === 1) {
    return <GenerationInputForm template={matchingTemplates[0]} />;
  }

  return (
    <List isLoading={isLoading} navigationTitle="Create Card" searchBarPlaceholder="Choose a template">
      {matchingTemplates.length === 0 ? (
        <List.EmptyView
          icon={error ? Icon.Warning : Icon.Stars}
          title={error ? "Could Not Load Templates" : deckId ? "No Templates for This Deck" : "No Templates Available"}
          description={
            error
              ? errorMessage(error)
              : deckId
                ? "Create a template for this deck with the Manage Templates command, then return here."
                : "Create a template with the Manage Templates command, then return here to generate a card."
          }
        />
      ) : (
        matchingTemplates.map((template) => {
          const aiFieldCount = parseTemplate(template.content).filter((segment) => segment.kind === "ai").length;
          return (
            <List.Item
              key={template.id}
              icon={Icon.Stars}
              title={template.name}
              subtitle={template.deckName}
              accessories={[
                { text: `${template.fields.length} input${template.fields.length === 1 ? "" : "s"}` },
                { text: `${aiFieldCount} AI field${aiFieldCount === 1 ? "" : "s"}` },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Use Template"
                    icon={Icon.ArrowRight}
                    target={<GenerationInputForm template={template} />}
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
