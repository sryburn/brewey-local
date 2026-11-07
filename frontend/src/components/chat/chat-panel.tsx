import ChatContainer from './chat-container'

interface ChatPanelProps {
  onRecipeUpdate?: (recipeId: string) => void
  onMobileRecipeCollapse?: () => void
  isMobileRecipeExpanded?: boolean
}

export default function ChatPanel({ onRecipeUpdate, onMobileRecipeCollapse, isMobileRecipeExpanded }: ChatPanelProps) {
  return <ChatContainer onRecipeUpdate={onRecipeUpdate} onMobileRecipeCollapse={onMobileRecipeCollapse} isMobileRecipeExpanded={isMobileRecipeExpanded} />
}