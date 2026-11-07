import { Building2, Users, Target, ChevronLeft, ChevronRight, CheckCircle2, Circle } from 'lucide-react'

export default function WorkflowSidebar({ isCollapsed, onToggle, step, campaignName }) {
  return (
    <aside className={`relative flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-700/60 transition-all duration-300 ${isCollapsed ? 'w-14' : 'w-56'} shrink-0`}>
      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-6 z-10 w-6 h-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow flex items-center justify-center text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <div className="overflow-hidden flex-1 py-6 px-3 space-y-6">
        {/* Workflow */}
        <div>
          {!isCollapsed && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2 mb-3">Workflow</p>
          )}
          <div className="space-y-1">
            <WorkflowItem
              icon={
                step > 1 ? (
                  <CheckCircle2 className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0 animate-fade-in" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
                    <span className="text-white text-[9px] font-bold">1</span>
                  </div>
                )
              }
              label="Product Input"
              sub={step > 1 ? 'Completed' : 'In progress'}
              active={step === 1}
              isCollapsed={isCollapsed}
            />
            <WorkflowItem
              icon={
                step === 2 ? (
                  <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center shrink-0 animate-scale-up">
                    <span className="text-white text-[9px] font-bold">2</span>
                  </div>
                ) : (
                  <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
                )
              }
              label="ICP Definition"
              sub={step === 2 ? 'In progress' : step > 2 ? 'Completed' : 'Ready'}
              active={step === 2}
              isCollapsed={isCollapsed}
            />
          </div>
        </div>

        {/* Output */}
        <div>
          {!isCollapsed && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2 mb-3">Output</p>
          )}
          <div className="space-y-1">
            <OutputItem icon={<Building2 className="w-4 h-4" />} label="Companies" isCollapsed={isCollapsed} />
            <OutputItem icon={<Target className="w-4 h-4" />} label="Competitors" isCollapsed={isCollapsed} />
            <OutputItem icon={<Users className="w-4 h-4" />} label="Decision Makers" isCollapsed={isCollapsed} />
          </div>
        </div>
      </div>
    </aside>
  )
}

function WorkflowItem({ icon, label, sub, active, done, isCollapsed }) {
  return (
    <div className={`flex items-center gap-2.5 px-2 py-2 rounded-lg ${active ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`}>
      {icon}
      {!isCollapsed && (
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${active ? 'text-violet-700 dark:text-violet-400' : 'text-slate-500 dark:text-slate-400'}`}>{label}</p>
          {sub && <p className={`text-[10px] font-medium ${active ? 'text-violet-500' : 'text-slate-400'}`}>{sub}</p>}
        </div>
      )}
    </div>
  )
}

function OutputItem({ icon, label, isCollapsed }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-default">
      <span className="shrink-0">{icon}</span>
      {!isCollapsed && <span className="text-sm truncate">{label}</span>}
    </div>
  )
}
