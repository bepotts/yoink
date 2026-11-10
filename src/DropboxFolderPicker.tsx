// Browses Dropbox one folder at a time and returns an explicit upload destination.

import { useEffect, useRef, useState } from 'react';
import type {
  DropboxFolder,
  DropboxFolderPage,
} from './cloud-storage/dropbox/types/dropbox-types';

// Displays a folder-only hierarchical browser with root selection and pagination.
export function DropboxFolderPicker({
  onSelect,
  onCancel,
}: {
  // Receives the destination deliberately selected by the user.
  onSelect: (folder: DropboxFolder) => void;
  // Dismisses the dialog without changing the existing destination.
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<DropboxFolderPage>();
  const [parents, setParents] = useState<DropboxFolder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    window.yoink
      .listDropboxFolders('')
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active)
          setError('Could not load Dropbox. Reconnect Dropbox and try again.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Navigates only after the requested folder page loads successfully.
  async function browse(
    folderPath: string,
    history: DropboxFolder[],
    more = false,
  ) {
    setBusy(true);
    setError('');
    try {
      const result = await window.yoink.listDropboxFolders(
        folderPath,
        more ? page?.cursor : undefined,
      );
      setPage({
        ...result,
        folders: more
          ? [...(page?.folders ?? []), ...result.folders]
          : result.folders,
      });
      setParents(history);
    } catch {
      setError('Could not load this Dropbox folder. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onCancel={onCancel}
      aria-labelledby="dropbox-picker-title"
    >
      <h2 id="dropbox-picker-title">Select Dropbox folder</h2>
      <p>
        {[
          'Dropbox',
          ...parents.slice(1).map((folder) => folder.name),
          ...(parents.length ? [page?.folder.name] : []),
        ]
          .filter(Boolean)
          .join(' / ')}
      </p>
      <button
        type="button"
        disabled={busy || !parents.length}
        onClick={() => void browse(parents.at(-1)!.path, parents.slice(0, -1))}
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
      {busy && <p role="status">Loading Dropbox folders…</p>}
      {error && <p role="alert">{error}</p>}
      <ul aria-label="Dropbox folders">
        {page?.folders.map((folder) => (
          <li key={folder.path}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void browse(folder.path, [...parents, page.folder])
              }
            >
              {folder.name}
            </button>
          </li>
        ))}
      </ul>
      {!busy && page && !page.folders.length && (
        <p>No subfolders in this folder.</p>
      )}
      {page?.cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void browse(page.folder.path, parents, true)}
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
