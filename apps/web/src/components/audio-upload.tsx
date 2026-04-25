import { BracketButton } from '~/components/bracket-button'
import { UploadIcon } from '~/components/icons/upload'
import { Button } from '~/components/ui/button'
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from '~/components/ui/file-upload'

interface AudioUploadProps {
  files: File[]
  setFiles: (files: File[]) => void
  onFileReject: (file: File) => void
}

export function AudioUpload({
  files,
  setFiles,
  onFileReject,
}: AudioUploadProps) {
  return (
    <FileUpload
      maxFiles={1}
      maxSize={5 * 1024 * 1024}
      className="w-full max-w-md"
      value={files}
      onValueChange={setFiles}
      onFileReject={onFileReject}
      multiple
    >
      <FileUploadDropzone>
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center justify-center rounded-full border p-2.5">
            <UploadIcon className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium text-sm">Drag & drop files here</p>
          <p className="text-muted-foreground text-xs">
            Or click to browse (max 2 files, up to 5MB each)
          </p>
        </div>
        <FileUploadTrigger asChild>
          <Button size="sm" className="mt-2 w-fit">
            Browse files
          </Button>
        </FileUploadTrigger>
      </FileUploadDropzone>
      <FileUploadList>
        {files.map((file, index) => (
          <FileUploadItem key={index} value={file}>
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            <FileUploadItemDelete asChild>
              <BracketButton>x</BracketButton>
            </FileUploadItemDelete>
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  )
}
