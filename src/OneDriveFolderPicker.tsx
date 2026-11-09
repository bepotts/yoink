// Browses OneDrive one folder at a time and returns an explicit upload destination.

import { useEffect, useRef, useState } from 'react';
import type {
  OneDriveFolder,
  OneDriveFolderPage,
} from './onedrive/types/onedrive-types';

// Displays a folder-only hierarchical browser with root selection and pagination.
export function OneDriveFolderPicker({
  onSelect,
  onCancel,
}: {
  // Receives the destination deliberately selected by the user.
  onSelect: (folder: OneDriveFolder) => void;
  // Dismisses the dialog without changing the existing destination.
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<OneDriveFolderPage>();
  const [parents, setParents] = useState<OneDriveFolder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    window.yoink
      .listOneDriveFolders('root')
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active)
          setError(
            'Could not load OneDrive. Reconnect Microsoft and try again.',
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Navigates only after the requested folder page loads successfully.
  async function browse(id: string, history: OneDriveFolder[], more = false) {
    setBusy(true);
    setError('');
    try {
      const result = await window.yoink.listOneDriveFolders(
        id,
        more ? page?.nextPage : undefined,
      );
      setPage({
        ...result,
        folders: more
          ? [...(page?.folders ?? []), ...result.folders]
          : result.folders,
      });
      setParents(history);
    } catch {
      setError('Could not load this OneDrive folder. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onCancel={onCancel}
      aria-labelledby="onedrive-picker-title"
    >
      <h2 id="onedrive-picker-title">Select OneDrive folder</h2>
      <p>
        {[
          'My files',
          ...parents.slice(1).map((folder) => folder.name),
          ...(parents.length ? [page?.folder.name] : []),
        ]
          .filter(Boolean)
          .join(' / ')}
      </p>
      <button
        type="button"
        disabled={busy || !parents.length}
        onClick={() => void browse(parents.at(-1)!.id, parents.slice(0, -1))}
      >
        Back
      </button>
      <button
        type="button"
        disabled={busy || !page}
        onClick={() => page && onSelect(page.folder)}
      >
        Use this folder
      </button>
      {busy && <p role="status">Loading OneDrive folders…</p>}
      {error && <p role="alert">{error}</p>}
      <ul aria-label="OneDrive folders">
        {page?.folders.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void browse(folder.id, [...parents, page.folder])}
            >
              {folder.name}
            </button>
          </li>
        ))}
      </ul>
      {!busy && page && !page.folders.length && (
        <p>No subfolders in this folder.</p>
      )}
      {page?.nextPage && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void browse(page.folder.id, parents, true)}
        >
          Load more folders
        </button>
      )}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </dialog>
  );
}
