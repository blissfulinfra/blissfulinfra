// {{#IF_LOCALSTACK}}
import { useState, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface UploadedFile {
  key: string
  uri: string
}

async function fetchFiles(): Promise<string[]> {
  const res = await fetch('/api/storage/files')
  if (!res.ok) throw new Error('Failed to list files')
  return res.json()
}

async function uploadFile(file: File): Promise<UploadedFile> {
  const params = new URLSearchParams({ filename: file.name, contentType: file.type || 'application/octet-stream' })
  const presignRes = await fetch(`/api/storage/files/presign?${params}`, { method: 'POST' })
  if (!presignRes.ok) throw new Error('Failed to get upload URL')
  const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)

  return { key, uri: `s3://${key}` }
}

function isViewableInBrowser(key: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|pdf|txt|md|html|json|csv)$/i.test(key)
}

export function FileManager() {
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setFiles(await fetchFiles())
      setLoaded(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await uploadFile(file)
      setFiles(prev => [...prev, result.key])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function openPreview(key: string) {
    const encoded = encodeURIComponent(key)
    setPreview({ key, url: `/api/storage/files/${encoded}/content` })
  }

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <Card.Title>File Storage (S3)</Card.Title>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : loaded ? 'Refresh' : 'Load files'}
            </Button>
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
            <input ref={inputRef} type="file" className="hidden" onChange={handleUpload} />
          </div>
        </div>
      </Card.Header>

      <Card.Content>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {!loaded && !loading && (
          <p className="text-sm text-muted-foreground">Click "Load files" to list objects in the S3 bucket.</p>
        )}

        {loaded && files.length === 0 && (
          <p className="text-sm text-muted-foreground">No files yet. Upload one above.</p>
        )}

        {files.length > 0 && (
          <ul className="divide-y text-sm">
            {files.map(key => (
              <li key={key} className="flex items-center justify-between py-2 gap-2">
                <span className="truncate text-muted-foreground font-mono text-xs flex-1" title={key}>
                  {key}
                </span>
                <div className="flex gap-1 shrink-0">
                  {isViewableInBrowser(key) && (
                    <Button variant="outline" size="sm" onClick={() => openPreview(key)}>
                      View
                    </Button>
                  )}
                  <a
                    href={`/api/storage/files/${encodeURIComponent(key)}/content`}
                    download={key.split('/').pop()}
                  >
                    <Button variant="outline" size="sm">Download</Button>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>

      {/* Inline preview modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-sm text-muted-foreground truncate">{preview.key}</span>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Close</Button>
            </div>
            {/\.(png|jpe?g|gif|webp|svg)$/i.test(preview.key) ? (
              <img src={preview.url} alt={preview.key} className="max-w-full mx-auto rounded" />
            ) : /\.pdf$/i.test(preview.key) ? (
              <iframe src={preview.url} className="w-full h-[70vh] rounded border" title={preview.key} />
            ) : (
              <iframe src={preview.url} className="w-full h-[60vh] rounded border font-mono text-sm" title={preview.key} />
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
// {{/IF_LOCALSTACK}}
