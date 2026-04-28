import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

export function PipelineRerunDialog({
  stage,
  isRunning,
  onOpenChange,
  onConfirm,
}: {
  stage: 'segmentation' | 'cast detection' | null
  isRunning: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const copy =
    stage === 'segmentation'
      ? {
          title: 'Re-run segmentation',
          description:
            'This will delete and regenerate spans, reset cast detection, attribution, and synthesis-derived outputs. Manual cast edits will be preserved, but cast detection must be run again.',
          confirmLabel: 'Re-run Segmentation',
        }
      : {
          title: 'Re-run cast detection',
          description:
            'This will delete regenerated cast evidence, reset attribution and synthesis-derived outputs, then detect cast again. Manual cast edits and deletions will be preserved.',
          confirmLabel: 'Re-run Cast Detection',
        }

  return (
    <Dialog open={stage !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="confirm"
            disabled={isRunning}
            onClick={onConfirm}
            size="lg"
          >
            {isRunning ? 'Running' : copy.confirmLabel}
          </Button>
          <DialogClose asChild>
            <Button variant="cancel" disabled={isRunning} size="lg">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
