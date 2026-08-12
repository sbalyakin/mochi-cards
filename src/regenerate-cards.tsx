import { Action, ActionPanel, getPreferenceValues, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";

import { checkBulkRegenerationAvailability } from "./domain/bulk-card-regeneration";
import { startBulkRegeneration } from "./services/bulk-regeneration-launcher";
import { MochiClient } from "./services/mochi-client";
import { TemplateRepository } from "./storage/template-repository";

type Preferences = { readonly mochiApiKey: string };

const repository = new TemplateRepository();
const client = new MochiClient(getPreferenceValues<Preferences>().mochiApiKey);

export default function RegenerateCards() {
  const { data: templates = [], error, isLoading } = usePromise(() => repository.list(), []);
  const eligible = templates.filter(
    (template) => checkBulkRegenerationAvailability(template, templates).kind === "available"
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search templates" navigationTitle="Regenerate Cards">
      {error ? (
        <List.EmptyView icon={Icon.Warning} title="Could Not Load Templates" description={errorMessage(error)} />
      ) : eligible.length === 0 ? (
        <List.EmptyView
          icon={Icon.Repeat}
          title="No Templates Ready for Bulk Regeneration"
          description="Configure a Generation Template with a linked Mochi template first."
        />
      ) : (
        eligible.map((template) => (
          <List.Item
            key={template.id}
            icon={Icon.Snippets}
            title={template.name}
            subtitle={template.deckName}
            actions={
              <ActionPanel>
                <Action
                  title="Regenerate Cards…"
                  icon={Icon.Repeat}
                  onAction={() => startBulkRegeneration(client, template, templates)}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
