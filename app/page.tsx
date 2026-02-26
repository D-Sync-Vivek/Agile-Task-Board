import KanbanBoard from "@/components/Kanban/KanbanBoard"


export default function Home() {
  return (
    <main className="flex h-screen flex-col bg-gray-950 overflow-hidden">
      
      {/* 1. HEADER: Stays at the top, never moves */}
      <header className="flex-none border-b border-gray-800 bg-gray-900/50 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Project Board</h1>
            <p className="text-xs text-gray-400 mt-1">Manage your tasks, track progress, and ship faster.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block px-2 py-1 rounded bg-gray-800 text-gray-400 text-[10px] font-mono border border-gray-700">
              v1.0.0
            </span>
          </div>
        </div>
      </header>

      {/* 2. SCROLLABLE AREA:  */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-gray-950 p-6">
         <div className="h-full min-w-fit">
           <KanbanBoard />
         </div>
      </div>
      
    </main>
  )
}