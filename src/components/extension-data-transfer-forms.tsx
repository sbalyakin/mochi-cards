import { homedir } from "node:os";
import { join } from "node:path";

import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  LocalStorage,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";

import { parseExtensionData, replaceExtensionData, serializeExtensionData } from "../extension-data-transfer";
import { validateExtensionData } from "../extension-data-validation";
import {
  extensionDataFileExists,
  readExtensionDataFile,
  sanitizeExtensionDataFilename,
  saveExtensionDataFile,
} from "../services/extension-data-file";
import { RegenerationLockRepository } from "../storage/regeneration-lock-repository";

const regenerationLock = new RegenerationLockRepository();

export function ExportExtensionDataForm() {
  const { pop } = useNavigation();
  const [directories, setDirectories] = useState<readonly string[]>([join(homedir(), "Downloads")]);
  const [filename, setFilename] = useState(defaultExportFilename);
  const [directoryError, setDirectoryError] = useState<string>();
  const [filenameError, setFilenameError] = useState<string>();
  const [isExporting, setIsExporting] = useState(false);

  async function exportData(): Promise<void> {
    const directory = directories[0];
    setDirectoryError(directory ? undefined : "Choose a destination directory");
    setFilenameError(filename.trim().length > 0 ? undefined : "Enter a filename");
    if (!directory || filename.trim().length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      const safeFilename = sanitizeExtensionDataFilename(filename);
      const path = join(directory, safeFilename);
      let overwrite = false;
      if (await extensionDataFileExists(path)) {
        overwrite = await confirmAlert({
          icon: Icon.Warning,
          title: "Replace Existing File?",
          message: safeFilename,
          primaryAction: { title: "Replace", style: Alert.ActionStyle.Destructive },
        });
        if (!overwrite) {
          return;
        }
      }

      const items = await LocalStorage.allItems();
      const savedPath = await saveExtensionDataFile(directory, filename, serializeExtensionData(items), overwrite);
      await showToast({ style: Toast.Style.Success, title: "Extension data exported", message: savedPath });
      const reveal = await confirmAlert({
        icon: Icon.Finder,
        title: "Show the exported file in Finder?",
        primaryAction: { title: "Show in Finder" },
        dismissAction: { title: "Done" },
      });
      if (reveal) {
        await showInFinder(savedPath);
      } else {
        pop();
      }
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not export extension data",
        message: errorMessage(error),
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Form
      isLoading={isExporting}
      navigationTitle="Export Extension Data"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Export Data" icon={Icon.Upload} onSubmit={exportData} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="directory"
        title="Directory"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        value={[...directories]}
        error={directoryError}
        onChange={setDirectories}
      />
      <Form.TextField
        id="filename"
        title="Filename"
        placeholder="mochi-cards-data.json"
        value={filename}
        error={filenameError}
        onChange={(value) => {
          setFilename(value);
          setFilenameError(undefined);
        }}
      />
    </Form>
  );
}

export function ImportExtensionDataForm({ onImported }: { readonly onImported: () => Promise<void> }) {
  const { pop } = useNavigation();
  const [files, setFiles] = useState<readonly string[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);

  async function importData(): Promise<void> {
    const path = files[0];
    setFileError(path ? undefined : "Choose a Mochi Cards data file");
    if (!path) {
      return;
    }

    setIsImporting(true);
    try {
      const items = parseExtensionData(await readExtensionDataFile(path));
      await validateExtensionData(items);
      const confirmed = await confirmAlert({
        icon: Icon.Download,
        title: "Replace Extension Data?",
        message: `This replaces all non-secret Mochi Cards data in this app with ${Object.keys(items).length} imported items.`,
        primaryAction: { title: "Import", style: Alert.ActionStyle.Destructive },
      });
      if (!confirmed) {
        return;
      }

      const leaseToken = await regenerationLock.acquire();
      if (!leaseToken) {
        throw new Error("Extension data cannot be imported while card regeneration is running");
      }
      try {
        await replaceExtensionData(LocalStorage, items);
        await onImported();
      } finally {
        await regenerationLock.release(leaseToken);
      }
      await showToast({
        style: Toast.Style.Success,
        title: "Extension data imported",
        message: `${Object.keys(items).length} local storage items`,
      });
      pop();
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not import extension data",
        message: errorMessage(error),
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Form
      isLoading={isImporting}
      navigationTitle="Import Extension Data"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Import Data" icon={Icon.Download} onSubmit={importData} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="file"
        title="Data File"
        allowMultipleSelection={false}
        canChooseDirectories={false}
        canChooseFiles
        value={[...files]}
        error={fileError}
        onChange={(value) => {
          setFiles(value);
          setFileError(undefined);
        }}
      />
      <Form.Description text="Import replaces this app's non-secret Mochi Cards data. API keys and cache are not included." />
    </Form>
  );
}

function defaultExportFilename(): string {
  return `mochi-cards-data-${new Date().toISOString().slice(0, 10)}.json`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
