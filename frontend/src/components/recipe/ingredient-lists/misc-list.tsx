import { memo } from 'react'
import { ToolCase } from 'lucide-react'
import type { RecipeMisc } from '@/types/database'
import { MiscItem } from '../ingredient-items'

interface MiscListProps {
  sortedMisc: RecipeMisc[]
  expandedMisc: Set<string>
  toggleMiscExpansion: (miscId: string) => void
  isMobileExpanded: boolean
}

export const MiscList = memo<MiscListProps>(({
  sortedMisc,
  expandedMisc,
  toggleMiscExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <ToolCase className="w-4 h-4 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        <span>Misc</span>
        {!sortedMisc.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No misc ingredients added
          </span>
        )}
      </h3>
      {sortedMisc.length > 0 && (
        <div className="space-y-2">
          {sortedMisc.map((recipeMisc) => (
            <MiscItem
              key={recipeMisc.id}
              recipeMisc={recipeMisc}
              isExpanded={expandedMisc.has(recipeMisc.id)}
              onToggleExpansion={toggleMiscExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

MiscList.displayName = 'MiscList'
