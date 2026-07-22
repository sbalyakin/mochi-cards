import { Action, ActionPanel, Alert, confirmAlert, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";

import { TemplateForm } from "./components/template-form";
import type { CardTemplate } from "./domain/template";
import { TemplateRepository } from "./storage/template-repository";

const repository = new TemplateRepository();

export default function ManageTemplates() {
  const { data: templates = [], error, isLoading, revalidate } = usePromise(() => repository.list(), []);
  const refresh = async (): Promise<void> => {
    await revalidate();
  };

  async function duplicate(template: CardTemplate): Promise<void> {
    try {
      await repository.duplicate(template.id);
      await revalidate();
      await showToast({ style: Toast.Style.Success, title: "Template duplicated" });
    } catch (duplicateError: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not duplicate template",
        message: errorMessage(duplicateError),
      });
    }
  }

  async function deleteTemplate(template: CardTemplate): Promise<void> {
    const confirmed = await confirmAlert({
      icon: Icon.Trash,
      title: `Delete “${template.name}”?`,
      message: "This template cannot be recovered.",
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) {
      return;
    }

    try {
      await repository.delete(template.id);
      await revalidate();
      await showToast({ style: Toast.Style.Success, title: "Template deleted" });
    } catch (deleteError: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not delete template",
        message: errorMessage(deleteError),
      });
    }
  }

  const createAction = (
    <Action.Push
      title="Create Template"
      icon={Icon.Plus}
      target={<TemplateForm repository={repository} onSaved={refresh} />}
    />
  );

  return (
    <List isLoading={isLoading} navigationTitle="Manage Templates" searchBarPlaceholder="Search templates">
      {templates.length === 0 ? (
        <List.EmptyView
          icon={error ? Icon.Warning : Icon.Document}
          title={error ? "Could Not Load Templates" : "No Templates Yet"}
          description={error ? errorMessage(error) : "Create a reusable Markdown template to generate your first card."}
          actions={<ActionPanel>{createAction}</ActionPanel>}
        />
      ) : (
        templates.map((template) => (
          <List.Item
            key={template.id}
            icon={Icon.Document}
            title={template.name}
            subtitle={template.deckName}
            accessories={[
              { text: `${template.fields.length} field${template.fields.length === 1 ? "" : "s"}` },
              ...(template.tags.length > 0 ? [{ tag: template.tags[0] }] : []),
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Edit Template"
                  icon={Icon.Pencil}
                  target={<TemplateForm repository={repository} template={template} onSaved={refresh} />}
                />
                {createAction}
                <Action title="Duplicate Template" icon={Icon.Duplicate} onAction={() => duplicate(template)} />
                <Action
                  title="Delete Template"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => deleteTemplate(template)}
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
  return error instanceof Error ? error.message : "Unexpected error";
}
