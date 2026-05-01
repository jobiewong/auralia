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
  stage: 'segmentation' | 'cast detection' | 'attribution' | 'synthesis' | null
  isRunning: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const copyOptions = {
    segmentation: {
      title: 'Re-run segmentation',
      description:
        'This will delete and regenerate spans, reset cast detection, attribution, and synthesis-derived outputs. Any manual edits to text will be lost. Manual cast edits will be preserved, but cast detection must be run again.',
      confirmLabel: 'Re-run Segmentation',
    },
    'cast detection': {
      title: 'Re-run cast detection',
      description:
        'This will delete regenerated cast evidence, reset attribution and synthesis-derived outputs, then detect cast again. Manual cast edits and deletions will be preserved.',
      confirmLabel: 'Re-run Cast Detection',
    },
    attribution: {
      title: 'Re-run attribution',
      description:
        'This will delete and regenerate attribution, reset synthesis-derived outputs. Manual attribution edits will be preserved, but attribution must be run again.',
      confirmLabel: 'Re-run Attribution',
    },
    synthesis: {
      title: 'Re-run synthesis',
      description:
        'This will delete and regenerate synthesis. All existing spans and chunk files will be deleted.',
      confirmLabel: 'Re-run Synthesis',
    },
  }
  const copy = stage ? copyOptions[stage] : null
  if (!copy) {
    return null
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
