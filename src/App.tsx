// Renders the download form and manages link, folder, validation, and download state.

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { validateDownload, type DownloadProgress } from './ipc/download-types';
import type { GoogleAccountStatus } from './google/types/account-types';
import type { DriveFolder } from './google/types/drive-types';
import { formatVersions } from './shared/versions';

const SAVED_FOLDER_KEY = 'yoink.savedFolder';

// Restores the saved local destination.
function loadSavedFolder() {
  try {
    return localStorage.getItem(SAVED_FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
}

// Renders downloads and the Google account connection controls.
export function App() {
  const [googleAccount, setGoogleAccount] = useState<GoogleAccountStatus>({
    // Load saved account state after the component mounts.
    connected: false,
  });
  const [googleBusy, setGoogleBusy] = useState(false);
  const [destination, setDestination] = useState<'local' | 'drive'>('local');
  const [driveFolder, setDriveFolder] = useState<DriveFolder | null>(null);
  const [pickingDriveFolder, setPickingDriveFolder] = useState(false);
  const [completedDriveFolder, setCompletedDriveFolder] = useState('');
  useEffect(() => {
    window.yoink
      .googleStatus()
      .then(setGoogleAccount)
      .catch(() => {
        setGoogleAccount({
          // Status lookup did not complete.
          connected: false,
          // Let the user retry with the connect control.
          error: 'Could not read Google connection status.',
        });
      });
  }, []);

  // Connects or disconnects the account while preventing repeated submissions.
  async function toggleGoogleAccount() {
    setGoogleBusy(true);
    try {
      setDriveFolder(null);
      setGoogleAccount(
        await (googleAccount.connected && !googleAccount.needsReconnect
          ? window.yoink.disconnectGoogle()
          : window.yoink.connectGoogle()),
      );
    } catch {
      setGoogleAccount({
        // Retain the last known connection state.
        connected: googleAccount.connected,
        // Report an IPC failure without provider data.
        error: 'Could not update the Google connection. Please try again.',
      });
    } finally {
      setGoogleBusy(false);
    }
  }

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
  const driveFolderButton = useRef<HTMLButtonElement>(null);

  // Opens the local destination picker.
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

  // Opens Google's folder Picker and preserves the previous destination if cancelled.
  async function selectGoogleDriveFolder() {
    setPickingDriveFolder(true);
    setFolderError('');
    try {
      const selected = await window.yoink.selectDriveFolder();
      if (selected) {
        setDriveFolder(selected);
        setGoogleAccount(await window.yoink.googleStatus());
      }
    } catch {
      setFolderError(
        'Could not select a Drive folder. Enable Google Picker API in your Cloud project and try again.',
      );
    } finally {
      setPickingDriveFolder(false);
    }
  }

  // Saves the local folder for future launches.
  function saveFolder() {
    try {
      localStorage.setItem(SAVED_FOLDER_KEY, folder);
      setSaveFolderStatus('Folder saved for future launches.');
    } catch {
      setSaveFolderStatus('Could not save the folder. Please try again.');
    }
  }

  // Downloads a video and saves it to the selected destination.
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = {
      // Normalize the submitted video URL.
      link: link.trim(),
      // Drive destinations do not require a local folder.
      folder: destination === 'local' ? folder : '',
      // Selecting Drive replaces local saving.
      ...(destination === 'drive'
        ? {
            /* Selected cloud destination. */ driveFolderId:
              driveFolder?.id ?? '',
          }
        : {}),
    };
    const error = validateDownload(request);
    if (error) {
      setStatus(error);
      if (error.includes('link')) linkInput.current?.focus();
      else if (destination === 'drive') driveFolderButton.current?.focus();
      else folderButton.current?.focus();
      return;
    }
    setDownloading(true);
    setCompletedFolder('');
    setCompletedDriveFolder('');
    setOpenFolderError('');
    setProgress(null);
    setStatus('Downloading…');
    try {
      const result = await window.yoink.downloadVideo(request);
      if (result.success) {
        if (request.driveFolderId)
          setCompletedDriveFolder(request.driveFolderId);
        else setCompletedFolder(request.folder);
      }
      setStatus(
        result.success
          ? request.driveFolderId
            ? 'Upload complete. Video saved to Google Drive.'
            : 'Download complete. Video saved to the selected folder.'
          : result.error,
      );
    } catch {
      setStatus('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  // Opens the local folder containing the completed video.
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

  // Opens the completed Drive destination without exposing arbitrary URLs to IPC.
  async function openCompletedDriveFolder() {
    try {
      setOpenFolderError(
        await window.yoink.openDriveFolder(completedDriveFolder),
      );
    } catch {
      setOpenFolderError('Could not open the Google Drive folder.');
    }
  }

  return (
    <main>
      <h1>Yoink</h1>
      <section aria-label="Google Drive connection">
        <button
          type="button"
          disabled={googleBusy || downloading || pickingDriveFolder}
          onClick={toggleGoogleAccount}
        >
          {googleBusy
            ? 'Updating Google connection…'
            : googleAccount.needsReconnect
              ? 'Reconnect Google Drive'
              : googleAccount.connected
                ? 'Disconnect Google'
                : 'Connect Google Drive'}
        </button>
        <p role="status">
          {googleAccount.error ||
            (googleAccount.connected
              ? googleAccount.needsReconnect
                ? 'Reconnect Google Drive to allow uploads.'
                : 'Google Drive connected.'
              : 'Connect your Google account to upload to Drive.')}
        </p>
      </section>
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
          <label htmlFor="destination">Save to</label>
          <select
            id="destination"
            value={destination}
            disabled={downloading || googleBusy || pickingDriveFolder}
            onChange={(event) => {
              setDestination(event.target.value as 'local' | 'drive');
              setFolderError('');
            }}
          >
            <option value="local">Local folder</option>
            <option value="drive">Google Drive</option>
          </select>
        </div>
        {destination === 'local' ? (
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
        ) : (
          <div className="field">
            <button
              ref={driveFolderButton}
              type="button"
              disabled={downloading || googleBusy || pickingDriveFolder}
              onClick={selectGoogleDriveFolder}
            >
              {pickingDriveFolder
                ? 'Choose a folder in your browser…'
                : 'Select Google Drive folder'}
            </button>
            <p role="status">
              {folderError ||
                (driveFolder
                  ? `Google Drive: ${driveFolder.name}`
                  : 'No Google Drive folder selected')}
            </p>
          </div>
        )}
        <button
          id="submit"
          type="submit"
          disabled={
            downloading ||
            selectingFolder ||
            pickingDriveFolder ||
            googleBusy ||
            (destination === 'drive' &&
              (!googleAccount.connected ||
                googleAccount.needsReconnect === true))
          }
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
        {completedDriveFolder && (
          <button type="button" onClick={openCompletedDriveFolder}>
            Open Google Drive folder
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
              {progress?.phase === 'uploading'
                ? 'Uploading to Google Drive…'
                : progress?.phase === 'processing'
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
