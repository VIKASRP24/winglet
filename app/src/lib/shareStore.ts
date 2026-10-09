import { create } from 'zustand';
import type { Shared } from './share';

/** A share waiting for the person to pick a chat. Only the latest one is kept. */
export const usePendingShare = create<{ shared: Shared | null }>(() => ({ shared: null }));
