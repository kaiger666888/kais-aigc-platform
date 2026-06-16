import type { BranchStatus } from '../types/canvas'

export interface BranchColorSet {
  border: string
  bg: string
  line: string
  text: string
}

export const branchColors: Record<string, BranchColorSet> = {
  main: {
    border: '#3B82F6',
    bg: '#3B82F620',
    line: '#3B82F6',
    text: '#3B82F6',
  },
  explore: {
    border: '#10B981',
    bg: '#10B98120',
    line: '#10B981',
    text: '#10B981',
  },
  rejected: {
    border: '#EF4444',
    bg: '#EF444420',
    line: '#EF4444',
    text: '#EF4444',
  },
  archived: {
    border: '#6B7280',
    bg: '#6B728020',
    line: '#6B7280',
    text: '#6B7280',
  },
  pending: {
    border: '#F59E0B',
    bg: '#F59E0B20',
    line: '#F59E0B',
    text: '#F59E0B',
  },
}

export function getBranchColor(branchId: string | undefined, isExplore?: boolean): BranchColorSet {
  if (isExplore) return branchColors.explore
  if (!branchId || branchId === 'main') return branchColors.main
  return branchColors.pending
}

export function getBranchColorByStatus(status: BranchStatus): BranchColorSet {
  switch (status) {
    case 'active': return branchColors.main
    case 'draft': return branchColors.pending
    case 'paused': return branchColors.pending
    case 'completed': return branchColors.explore
    case 'rejected': return branchColors.rejected
    case 'archived': return branchColors.archived
  }
}
