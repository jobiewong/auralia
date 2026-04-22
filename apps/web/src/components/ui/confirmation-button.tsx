import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useLongPress } from 'react-aria/useLongPress'
import { cn } from '~/lib/utils'

export function ConfirmationButton({
  children,
  disabled = false,
  onClick,
  onLongPress,
  className,
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  onLongPress: () => void
  className?: string
}) {
  const [buttonState, setButtonState] = useState<
    'idle' | 'clicking' | 'complete'
  >('idle')
  const { longPressProps } = useLongPress({
    onLongPressStart: () => {
      setButtonState('clicking')
    },
    onLongPressEnd: () => {
      setButtonState('idle')
    },
    onLongPress: () => {
      setButtonState('complete')
      onLongPress()
    },
    threshold: 1000,
  })

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative isolate overflow-hidden rounded-full border border-orange-950 text-orange-950 hover:bg-orange-950/10 transition-colors duration-150 ease-in-out cursor-pointer disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...longPressProps}
    >
      {buttonState === 'complete' ? (
        <motion.div
          key="confirmed"
          className="relative z-10 size-full flex items-center gap-2 px-4 py-2 text-orange-500 bg-orange-950 text-center"
        >
          Running...
        </motion.div>
      ) : (
        <motion.div
          key="default-children"
          className="relative z-10 size-full flex items-center gap-2 px-4 py-2 text-orange-950"
        >
          {children}
        </motion.div>
      )}

      <AnimatePresence>
        {buttonState === 'clicking' ? (
          <motion.div
            key="delete-indicator"
            className="pointer-events-none absolute inset-0 z-20"
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{
              clipPath: 'inset(0 0% 0 0)',
            }}
            exit={{
              clipPath: 'inset(0 100% 0 0)',
              transition: {
                duration: 0.35,
              },
            }}
            transition={{
              duration: 1,
              ease: 'linear',
            }}
          >
            <div className="absolute inset-0 bg-orange-950" />
            <div className="relative z-10 size-full flex items-center gap-2 px-4 py-2 text-orange-500">
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </button>
  )
}
