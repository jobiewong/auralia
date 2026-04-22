import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseWorkSourceMetadata(sourceMetadata: string | null) {
  if (sourceMetadata === null) {
    return null;
  }
  const json = JSON.parse(sourceMetadata) as { source: string, work_id: string, work_title: string, authors: { name: string, url: string }[] }
  return json
}
