import { Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";

import { RegenerationReportRepository } from "../storage/regeneration-report-repository";
import { statusIcon, statusLabel } from "./regeneration-status";

const reportRepository = new RegenerationReportRepository();

export function RegenerationReport() {
  const { data: report, error, isLoading } = usePromise(() => reportRepository.get(), []);
  const finishedAt = report ? new Date(report.finishedAt).toLocaleString() : undefined;

  return (
    <List isLoading={isLoading} navigationTitle="Last Regeneration Report">
      {error ? (
        <List.EmptyView icon={Icon.Warning} title="Could Not Load Report" description={errorMessage(error)} />
      ) : !report ? (
        <List.EmptyView
          icon={Icon.Repeat}
          title="No Regeneration Has Run Yet"
          description="Run Regenerate Cards… on a template to see a report here."
        />
      ) : (
        <List.Section title={report.templateName} subtitle={`${report.updates.length} cards · finished ${finishedAt}`}>
          {report.updates.map((update) => (
            <List.Item
              key={update.cardId}
              icon={statusIcon(update.status)}
              title={update.title}
              subtitle={update.message}
              accessories={[{ text: statusLabel(update.status) }]}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "Unexpected error";
}
