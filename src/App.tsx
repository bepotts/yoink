// Renders the download form and manages link, folder, validation, and download state.

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { validateDownload, type DownloadProgress } from './ipc/download-types';
import { formatVersions } from './shared/versions';

const SAVED_FOLDER_KEY = 'yoink.savedFolder';

function loadSavedFolder() {
  try {
    return localStorage.getItem(SAVED_FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [link, setLink] = useState('');
  const [folder, setFolder] = useState(loadSavedFolder);
  const [saveFolderStatus, setSaveFolderStatus] = useState('');
  const [folderError, setFolderError] = useState('');
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState('');
  const [completedFolder, setCompletedFolder] = useState('');
  const [openingFolder, setOpeningFolder] = useState(false);
  const [openFolderError, setOpenFolderError] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  useEffect(() => window.yoink.onDownloadProgress(setProgress), []);
  const linkInput = useRef<HTMLInputElement>(null);
  const folderButton = useRef<HTMLButtonElement>(null);

  async function selectFolder() {
    setSelectingFolder(true);
    setFolderError('');
    try {
      const selected = await window.yoink.selectFolder();
      if (selected) {
        setFolder(selected);
        setSaveFolderStatus('');
      }
    } catch {
      setFolderError('Could not open the folder picker. Please try again.');
    } finally {
      setSelectingFolder(false);
    }
  }

  function saveFolder() {
    try {
      localStorage.setItem(SAVED_FOLDER_KEY, folder);
      setSaveFolderStatus('Folder saved for future launches.');
    } catch {
      setSaveFolderStatus('Could not save the folder. Please try again.');
    }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = { link: link.trim(), folder };
    const error = validateDownload(request);
    if (error) {
      setStatus(error);
      if (error.includes('link')) linkInput.current?.focus();
      else folderButton.current?.focus();
      return;
    }
    setDownloading(true);
    setCompletedFolder('');
    setOpenFolderError('');
    setProgress(null);
    setStatus('Downloading…');
    try {
      const result = await window.yoink.downloadVideo(request);
      if (result.success) setCompletedFolder(request.folder);
      setStatus(
        result.success
          ? 'Download complete. Video saved to the selected folder.'
          : result.error,
      );
    } catch {
      setStatus('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function openDownloadFolder() {
    setOpeningFolder(true);
    setOpenFolderError('');
    try {
      setOpenFolderError(await window.yoink.openFolder(completedFolder));
    } catch {
      setOpenFolderError(
        'Could not open the download folder. Please try again.',
      );
    } finally {
      setOpeningFolder(false);
    }
  }

  return (
    <main>
      <h1>Yoink</h1>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="link">Link</label>
          <input
            ref={linkInput}
            id="link"
            type="url"
            placeholder="https://example.com"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={downloading}
          />
        </div>
        <div className="field">
          <span id="folder-label">Folder</span>
          <div className="folder-actions">
            <button
              ref={folderButton}
              id="select-folder"
              type="button"
              aria-describedby="selected-folder"
              disabled={selectingFolder || downloading}
              onClick={selectFolder}
            >
              Select folder
            </button>
            <button
              type="button"
              disabled={!folder || selectingFolder || downloading}
              onClick={saveFolder}
            >
              Save folder
            </button>
          </div>
          <p id="selected-folder" role="status">
            {folderError || folder || 'No folder selected'}
          </p>
          <p className="save-folder-status" role="status">
            {saveFolderStatus}
          </p>
        </div>
        <button
          id="submit"
          type="submit"
          disabled={downloading || selectingFolder}
        >
          Submit
        </button>
        <p id="download-status" role="status" aria-live="polite">
          {status}
        </p>
        {completedFolder && (
          <button
            type="button"
            onClick={openDownloadFolder}
            disabled={openingFolder}
          >
            Open folder
          </button>
        )}
        {openFolderError && <p role="alert">{openFolderError}</p>}
        {downloading && (
          <div className="download-progress">
            <progress
              aria-label="Download progress"
              max={100}
              value={progress?.percent ?? undefined}
            />
            <span>
              {progress?.phase === 'processing'
                ? 'Processing video…'
                : progress?.percent != null
                  ? `${Math.round(progress.percent)}% of current stream`
                  : 'Preparing download…'}
            </span>
          </div>
        )}
      </form>
      <p id="versions">{formatVersions(window.versions)}</p>
    </main>
  );
}
