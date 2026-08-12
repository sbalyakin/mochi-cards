import { Icon } from "@raycast/api";

import type { BulkCardOperationStatus } from "../services/bulk-card-regenerator";

export function statusIcon(status: BulkCardOperationStatus): Icon {
  switch (status) {
    case "pending":
      return Icon.Circle;
    case "running":
      return Icon.Hourglass;
    case "updated":
      return Icon.CheckCircle;
    case "updated-with-warning":
      return Icon.Warning;
    case "failed":
      return Icon.XMarkCircle;
    case "skipped":
      return Icon.MinusCircle;
    case "cancelled":
      return Icon.Stop;
  }
}

export function statusLabel(status: BulkCardOperationStatus): string {
  return status === "updated-with-warning"
    ? "Updated with warning"
    : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
