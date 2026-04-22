import { useMemo, useRef } from 'react';
import { FileUp, Sparkles, X } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select } from './ui/select';
import { formatBytes } from '../lib/utils';

export function UploadPanel({
  files,
  onFilesAdded,
  onRemoveFile,
  onClearQueue,
  onProcess,
  processing,
  detailLevel,
  onDetailLevelChange,
  schemaMode,
  onSchemaModeChange,
  schemaId,
  onSchemaIdChange,
  schemas,
  status,
}) {
  const inputRef = useRef(null);

  const queueLabel = useMemo(() => {
    return `${files.length} file${files.length === 1 ? '' : 's'} queued`;
  }, [files.length]);

  const handleDrop = event => {
    event.preventDefault();
    const incoming = Array.from(event.dataTransfer.files || []).filter(file =>
      file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
    );
    onFilesAdded(incoming);
  };

  return (
    <Card className="ep-section-card">
      <CardHeader>
        <div className="ep-section-headline">01 / Upload PDFs</div>
        <CardTitle>Schema-aware extraction</CardTitle>
        <CardDescription>
          Choose an established schema or let the model discover one before extraction.
        </CardDescription>
      </CardHeader>
      <CardContent className="ep-upload-content">
        <button
          type="button"
          className="ep-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={event => event.preventDefault()}
          onDrop={handleDrop}
          disabled={processing}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf"
            hidden
            onChange={event => onFilesAdded(Array.from(event.target.files || []))}
          />
          <div className="ep-dropzone-icon">
            <FileUp size={26} />
          </div>
          <div className="ep-dropzone-title">Drop PDFs here or click to browse</div>
          <div className="ep-dropzone-copy">
            The frontend now runs as a modular React app while preserving upload, review, validation, and export.
          </div>
        </button>

        {files.length ? (
          <div className="ep-queue-list">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="ep-queue-item">
                <div className="ep-queue-file">
                  <span className="ep-queue-name">{file.name}</span>
                  <span className="ep-queue-size">{formatBytes(file.size)}</span>
                </div>
                <button type="button" className="ep-queue-remove" onClick={() => onRemoveFile(index)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="ep-toolbar-grid">
          <div className="ep-toolbar-control">
            <label>Schema Mode</label>
            <Select value={schemaMode} onChange={event => onSchemaModeChange(event.target.value)} disabled={processing}>
              <option value="discover">AI Discover</option>
              <option value="predefined">Predefined Schema</option>
            </Select>
          </div>

          <div className="ep-toolbar-control">
            <label>Schema</label>
            <Select
              value={schemaId}
              onChange={event => onSchemaIdChange(event.target.value)}
              disabled={processing || schemaMode !== 'predefined'}
            >
              {schemas.length ? (
                schemas.map(schema => (
                  <option key={schema.id} value={schema.id}>
                    {schema.label}
                  </option>
                ))
              ) : (
                <option value="">No schemas available</option>
              )}
            </Select>
          </div>

          <div className="ep-toolbar-control">
            <label>Detail Level</label>
            <Select
              value={detailLevel}
              onChange={event => onDetailLevelChange(event.target.value)}
              disabled={processing}
            >
              <option value="core">Core</option>
              <option value="standard">Standard</option>
              <option value="exhaustive">Exhaustive</option>
            </Select>
          </div>
        </div>

        <div className="ep-upload-actions">
          <div className="ep-upload-meta">
            <Sparkles size={14} />
            <span>{queueLabel}</span>
          </div>
          <div className="ep-upload-buttons">
            <Button variant="ghost" onClick={onClearQueue} disabled={processing || !files.length}>
              Clear Queue
            </Button>
            <Button variant="primary" onClick={onProcess} disabled={processing || !files.length}>
              {processing ? 'Processing...' : 'Process Queue'}
            </Button>
          </div>
        </div>

        {status?.message ? (
          <div className={`ep-status ep-status-${status.type || 'info'}`}>{status.message}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
