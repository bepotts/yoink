// Renders the download form and manages link, folder, validation, and download state.

import { useRef, useState, type SubmitEvent } from 'react';
import { validateDownload } from './shared/download';
import { formatVersions } from './shared/versions';

export function App() {
  const [link, setLink] = useState('');
  const [folder, setFolder] = useState('');
  const [folderError, setFolderError] = useState('');
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  const folderButton = useRef<HTMLButtonElement>(null);

  async function selectFolder() {
    setSelectingFolder(true);
    setFolderError('');
    try {
      const selected = await window.yoink.selectFolder();
      if (selected) setFolder(selected);
    } catch {
      setFolderError('Could not open the folder picker. Please try again.');
    } finally {
      setSelectingFolder(false);
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
    setStatus('Downloading…');
    try {
      const result = await window.yoink.downloadVideo(request);
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
          <p id="selected-folder" role="status">
            {folderError || folder || 'No folder selected'}
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
      </form>
      <p id="versions">{formatVersions(window.versions)}</p>
    </main>
  );
}
