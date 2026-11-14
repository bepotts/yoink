// Renders the download form and manages link, folder, validation, and download state.

import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { validateDownload, type DownloadProgress } from './ipc/download-types';
import type { GoogleAccountStatus } from './cloud-storage/google/types/account-types';
import type { DriveFolder } from './cloud-storage/google/types/drive-types';
import { DropboxFolderPicker } from './DropboxFolderPicker';
import type {
  DropboxStatus,
  DropboxFolder,
} from './cloud-storage/dropbox/types/dropbox-types';
import { OneDriveFolderPicker } from './OneDriveFolderPicker';
import type {
  OneDriveStatus,
  OneDriveFolder,
} from './cloud-storage/onedrive/types/onedrive-types';
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
    connected: false,
  });
  const [googleBusy, setGoogleBusy] = useState(false);
  const [microsoftAccount, setMicrosoftAccount] = useState<OneDriveStatus>({
    connected: false,
  });
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [oneDriveFolder, setOneDriveFolder] = useState<OneDriveFolder | null>(
    null,
  );
  const [pickingOneDrive, setPickingOneDrive] = useState(false);
  const [completedOneDrive, setCompletedOneDrive] = useState('');
  useEffect(() => {
    window.yoink
      .oneDriveStatus()
      .then(setMicrosoftAccount)
      .catch(() => {});
  }, []);

  // Connects or removes the Microsoft account without dropping its folder on failure.
  async function toggleMicrosoft() {
    setMicrosoftBusy(true);
    try {
      const result = await (microsoftAccount.connected
        ? window.yoink.disconnectOneDrive()
        : window.yoink.connectOneDrive());
      setMicrosoftAccount(result);
      if (!result.error) setOneDriveFolder(null);
    } catch {
      setMicrosoftAccount({
        ...microsoftAccount,
        error: 'Could not update the Microsoft connection. Please try again.',
      });
    } finally {
      setMicrosoftBusy(false);
    }
  }
  const [dropboxAccount, setDropboxAccount] = useState<DropboxStatus>({
    connected: false,
  });
  const [dropboxBusy, setDropboxBusy] = useState(false);
  const [dropboxFolder, setDropboxFolder] = useState<DropboxFolder | null>(
    null,
  );
  const [pickingDropbox, setPickingDropbox] = useState(false);
  const [completedDropbox, setCompletedDropbox] = useState<string | null>(null);
  const dropboxButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    window.yoink
      .dropboxStatus()
      .then(setDropboxAccount)
      .catch(() => {});
  }, []);

  // Adds or disconnects a Dropbox account without losing a valid destination on failure.
  async function toggleDropbox() {
    setDropboxBusy(true);
    try {
      const result = await (dropboxAccount.connected
        ? window.yoink.disconnectDropbox()
        : window.yoink.connectDropbox());
      setDropboxAccount(result);
      if (!result.error) setDropboxFolder(null);
    } catch {
      setDropboxAccount({
        ...dropboxAccount,
        error: 'Could not update the Dropbox account. Please try again.',
      });
    } finally {
      setDropboxBusy(false);
    }
  }

  // Opens the completed Dropbox destination through the main-process URL validator.
  async function openDropbox() {
    if (completedDropbox === null) return;
    try {
      setOpenFolderError(
        await window.yoink.openDropboxFolder(completedDropbox),
      );
    } catch {
      setOpenFolderError('Could not open the Dropbox folder.');
    }
  }

  const [destination, setDestination] = useState<
    'local' | 'drive' | 'onedrive' | 'dropbox' | 's3'
  >('local');
  // Uploads a native-dialog-selected video through the configured backend.
  async function uploadLocalS3Video() {
    setDownloading(true);
    setProgress({ phase: 'uploading', percent: null });
    setCompletedFolder('');
    setCompletedDriveFolder('');
    setCompletedOneDrive('');
    setCompletedDropbox(null);
    setOpenFolderError('');
    setStatus('Choose a video to upload…');
    try {
      const result = await window.yoink.uploadS3Video();
      setStatus(
        result === null
          ? 'Upload cancelled.'
          : result.success
            ? 'Upload complete. Video saved to Amazon S3.'
            : result.error,
      );
    } catch {
      setStatus('S3 upload failed. Please try again.');
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  const [driveFolder, setDriveFolder] = useState<DriveFolder | null>(null);
  const [pickingDriveFolder, setPickingDriveFolder] = useState(false);
  const [completedDriveFolder, setCompletedDriveFolder] = useState('');
  useEffect(() => {
    window.yoink
      .googleStatus()
      .then(setGoogleAccount)
      .catch(() => {
        setGoogleAccount({
          connected: false,
          error: 'Could not read Google connection status.',
        });
      });
  }, []);

  // Connects or disconnects the account while preventing repeated submissions.
  async function toggleGoogleAccount() {
    setGoogleBusy(true);
    try {
      const result = await (googleAccount.connected &&
      !googleAccount.needsReconnect
        ? window.yoink.disconnectGoogle()
        : window.yoink.connectGoogle());
      setGoogleAccount(result);
      // Failed account changes retain the valid destination and existing credentials.
      if (!result.error) setDriveFolder(null);
    } catch {
      setGoogleAccount({
        ...googleAccount,
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
  const oneDriveButton = useRef<HTMLButtonElement>(null);

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
      ...(destination === 's3' ? { uploadToS3: true } : {}),
      link: link.trim(),
      folder: destination === 'local' ? folder : '',
      ...(destination === 'drive'
        ? {
            driveFolderId: driveFolder?.id ?? '',
          }
        : {}),
      ...(destination === 'onedrive'
        ? {
            oneDriveFolderId: oneDriveFolder?.id ?? '',
          }
        : {}),
      ...(destination === 'dropbox'
        ? { dropboxFolderPath: dropboxFolder?.path ?? '__not_selected__' }
        : {}),
    };
    const error = validateDownload(request);
    if (error) {
      setStatus(error);
      if (error.includes('link')) linkInput.current?.focus();
      else if (destination === 'dropbox') dropboxButton.current?.focus();
      else if (destination === 'onedrive') oneDriveButton.current?.focus();
      else if (destination === 'drive') driveFolderButton.current?.focus();
      else folderButton.current?.focus();
      return;
    }
    setDownloading(true);
    setCompletedFolder('');
    setCompletedDriveFolder('');
    setCompletedOneDrive('');
    setCompletedDropbox(null);
    setOpenFolderError('');
    setProgress(null);
    setStatus('Downloading…');
    try {
      const result = await window.yoink.downloadVideo(request);
      if (result.success) {
        if (request.dropboxFolderPath !== undefined)
          setCompletedDropbox(request.dropboxFolderPath);
        else if (request.oneDriveFolderId)
          setCompletedOneDrive(request.oneDriveFolderId);
        else if (request.driveFolderId)
          setCompletedDriveFolder(request.driveFolderId);
        else if (!request.uploadToS3) setCompletedFolder(request.folder);
      }
      setStatus(
        result.success
          ? request.uploadToS3
            ? 'Upload complete. Video saved to Amazon S3.'
            : request.dropboxFolderPath !== undefined
              ? 'Upload complete. Video saved to Dropbox.'
              : request.oneDriveFolderId
                ? 'Upload complete. Video saved to OneDrive.'
                : request.driveFolderId
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

  // Opens the completed Microsoft destination through a validated main-process request.
  async function openOneDrive() {
    try {
      setOpenFolderError(
        await window.yoink.openOneDriveFolder(completedOneDrive),
      );
    } catch {
      setOpenFolderError('Could not open the OneDrive folder.');
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
      <section aria-label="OneDrive connection">
        <button
          type="button"
          disabled={microsoftBusy || downloading || pickingOneDrive}
          onClick={toggleMicrosoft}
        >
          {microsoftBusy
            ? 'Updating Microsoft connection…'
            : microsoftAccount.connected
              ? 'Disconnect OneDrive'
              : 'Connect OneDrive'}
        </button>
        <p role="status">
          {microsoftAccount.error ||
            (microsoftAccount.connected
              ? 'OneDrive connected.'
              : 'Connect your Microsoft account to upload to OneDrive.')}
        </p>
      </section>
      <section aria-label="Dropbox connection">
        <button
          type="button"
          disabled={dropboxBusy || downloading || pickingDropbox}
          onClick={toggleDropbox}
        >
          {dropboxBusy
            ? 'Updating Dropbox account…'
            : dropboxAccount.connected
              ? 'Disconnect Dropbox'
              : 'Add Dropbox account'}
        </button>
        <p role="status">
          {dropboxAccount.error ||
            (dropboxAccount.connected
              ? 'Dropbox connected.'
              : 'Add your Dropbox account to upload videos to Dropbox.')}
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
            disabled={
              downloading ||
              googleBusy ||
              pickingDriveFolder ||
              microsoftBusy ||
              pickingOneDrive ||
              dropboxBusy ||
              pickingDropbox
            }
            onChange={(event) => {
              setDestination(
                event.target.value as
                  | 'local'
                  | 'drive'
                  | 'onedrive'
                  | 'dropbox'
                  | 's3',
              );
              setFolderError('');
            }}
          >
            <option value="local">Local folder</option>
            <option value="drive">Google Drive</option>
            <option value="onedrive">OneDrive</option>
            <option value="dropbox">Dropbox</option>
            <option value="s3">Amazon S3</option>
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
        ) : destination === 's3' ? (
          <div className="field">
            <p>Videos upload to the configured Amazon S3 bucket.</p>
            <button
              type="button"
              disabled={downloading}
              onClick={uploadLocalS3Video}
            >
              Upload a video from computer
            </button>
          </div>
        ) : destination === 'dropbox' ? (
          <div className="field">
            <button
              ref={dropboxButton}
              type="button"
              disabled={downloading || dropboxBusy || !dropboxAccount.connected}
              onClick={() => setPickingDropbox(true)}
            >
              Select Dropbox folder
            </button>
            <p role="status">
              {dropboxFolder
                ? `Dropbox: ${dropboxFolder.name}`
                : 'No Dropbox folder selected'}
            </p>
          </div>
        ) : destination === 'onedrive' ? (
          <div className="field">
            <button
              ref={oneDriveButton}
              type="button"
              disabled={
                downloading || microsoftBusy || !microsoftAccount.connected
              }
              onClick={() => setPickingOneDrive(true)}
            >
              Select OneDrive folder
            </button>
            <p role="status">
              {oneDriveFolder
                ? `OneDrive: ${oneDriveFolder.name}`
                : 'No OneDrive folder selected'}
            </p>
          </div>
        ) : (
          <div className="field">
            <button
              ref={driveFolderButton}
              type="button"
              disabled={
                downloading ||
                googleBusy ||
                pickingDriveFolder ||
                microsoftBusy ||
                pickingOneDrive
              }
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
            pickingOneDrive ||
            pickingDropbox ||
            dropboxBusy ||
            (destination === 'dropbox' && !dropboxAccount.connected) ||
            microsoftBusy ||
            (destination === 'onedrive' && !microsoftAccount.connected) ||
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
        {completedOneDrive && (
          <button type="button" onClick={openOneDrive}>
            Open OneDrive folder
          </button>
        )}
        {completedDropbox !== null && (
          <button type="button" onClick={openDropbox}>
            Open Dropbox folder
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
                ? destination === 's3'
                  ? 'Uploading to Amazon S3…'
                  : destination === 'dropbox'
                    ? 'Uploading to Dropbox…'
                    : destination === 'onedrive'
                      ? 'Uploading to OneDrive…'
                      : 'Uploading to Google Drive…'
                : progress?.phase === 'processing'
                  ? 'Processing video…'
                  : progress?.percent != null
                    ? `${Math.round(progress.percent)}% of current stream`
                    : 'Preparing download…'}
            </span>
          </div>
        )}
      </form>
      {pickingOneDrive && (
        <OneDriveFolderPicker
          onCancel={() => setPickingOneDrive(false)}
          onSelect={(selected) => {
            setOneDriveFolder(selected);
            setPickingOneDrive(false);
          }}
        />
      )}
      {pickingDropbox && (
        <DropboxFolderPicker
          onCancel={() => setPickingDropbox(false)}
          onSelect={(selected) => {
            setDropboxFolder(selected);
            setPickingDropbox(false);
          }}
        />
      )}
      <p id="versions">{formatVersions(window.versions)}</p>
    </main>
  );
}
