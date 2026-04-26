import { BracketButton } from '~/components/bracket-button'
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
      className="w-full"
      value={files}
      onValueChange={setFiles}
      onFileReject={onFileReject}
      multiple
    >
      <FileUploadDropzone>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="font-medium text-sm">Drag & drop files here</p>
          <p className="text-orange-500/50 text-xs">
            Or click to browse (max 2 files, up to 5MB each)
          </p>
        </div>
        <FileUploadTrigger asChild>
          <Button size="sm" className="mt-2 w-fit" variant="cancel">
            Browse files
          </Button>
        </FileUploadTrigger>
      </FileUploadDropzone>
      <FileUploadList>
        {files.map((file, index) => (
          <FileUploadItem key={index} value={file} className="p-0">
            <FileUploadItemMetadata />
            <FileUploadItemDelete asChild>
              <BracketButton className="hover:text-orange-500/70">
                x
              </BracketButton>
            </FileUploadItemDelete>
          </FileUploadItem>
        ))}
      </FileUploadList>
    </FileUpload>
  )
}
