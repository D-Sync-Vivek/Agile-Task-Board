import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Github,
  Kanban,
  LayoutDashboard,
  ListTodo,
  MousePointerClick,
  Plus,
  Search,
  Settings,
  Sun,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="font-sans antialiased text-slate-800 bg-[#FAFBFD] relative overflow-x-hidden selection:bg-[#5145F5]/10 selection:text-[#5145F5]">
      {/* Ambient Light Effects */}
      <div
        aria-hidden="true"
        className="absolute top-0 right-0 w-3/4 h-[850px] pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(circle at 75% 25%, rgba(99, 102, 241, 0.12) 0%, rgba(219, 234, 254, 0.25) 35%, transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 w-1/2 h-[600px] pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(circle at 15% 15%, rgba(238, 242, 255, 0.8) 0%, transparent 60%)",
        }}
      />

      {/* Header */}
      <header className="w-full sticky top-0 z-50 bg-[#FAFBFD]/90 backdrop-blur-md border-b border-slate-100/80 transition-all">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 h-20 flex items-center justify-between">
          <Link className="flex items-center gap-2.5 group" href="/">
            <div className="w-9 h-9 rounded-xl bg-[#5145F5] flex items-center justify-center text-white shadow-sm shadow-indigo-500/30 transition-transform group-hover:scale-105">
              <Kanban className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Agile <span className="text-[#5145F5]">TaskBoard</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center space-x-9 text-[15px] font-medium text-slate-600">
            <a className="hover:text-slate-900 transition-colors" href="#features">
              Features
            </a>
            <a className="hover:text-slate-900 transition-colors" href="#how-it-works">
              How it Works
            </a>
            <a className="hover:text-slate-900 transition-colors" href="#contribute">
              Contribute
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#5145F5] hover:bg-[#4338CA] rounded-xl shadow-sm transition-all hover:shadow-indigo-500/25 hover:-translate-y-0.5"
              href="/dashboard"
            >
              <span>Open App</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-12 pb-20 lg:pt-16 lg:pb-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            <div className="lg:col-span-5 flex flex-col items-start z-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#5145F5]/[0.07] border border-[#5145F5]/[0.15] text-[#5145F5] text-xs font-semibold tracking-wide mb-6">
                <span className="text-xs">✦</span>
                <span>Organize • Plan • Get Things Done</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-extrabold text-slate-950 tracking-tight leading-[1.12] mb-6">
                A simple and powerful{" "}
                <span className="text-[#5145F5]">Kanban board</span> for modern teams
              </h1>

              <p className="text-slate-600 text-lg sm:text-[19px] leading-relaxed mb-9 max-w-xl font-normal">
                Plan, organize, and track your work with an intuitive Kanban board. Stay focused, move faster, and bring clarity to your tasks.
              </p>

              <div className="flex flex-wrap items-center gap-3.5 w-full sm:w-auto mb-11">
                <Link
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 text-base font-semibold text-white bg-[#5145F5] hover:bg-[#4338CA] rounded-xl shadow-md shadow-indigo-500/25 transition-all hover:-translate-y-0.5"
                  href="/dashboard"
                >
                  <span>Open TaskBoard</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </Link>
                <a
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 text-base font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-sm transition-all hover:border-slate-300"
                  href="https://github.com"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Github className="w-5 h-5" />
                  <span>View on GitHub</span>
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm font-medium text-slate-600">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>Free to use</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>Sign up required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>Open source</span>
                </div>
              </div>
            </div>

            {/* Hero App Interface Mockup */}
            <div className="lg:col-span-7 relative">
              <div className="w-full bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden transform transition-all duration-300">
                {/* App Top Header Bar */}
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-[#5145F5] flex items-center justify-center text-white">
                      <Kanban className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">
                      Agile <span className="text-[#5145F5]">TaskBoard</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      aria-label="Search"
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                    <button
                      aria-label="Toggle Theme"
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Sun className="w-4 h-4" />
                    </button>
                    <div className="w-6 h-6 rounded-full bg-[#1E293B] text-white flex items-center justify-center text-[10px] font-semibold tracking-wider">
                      VK
                    </div>
                  </div>
                </div>

                {/* App Inner Workspace */}
                <div className="grid grid-cols-12 min-h-[460px]">
                  {/* Mini Sidebar */}
                  <aside className="col-span-3 border-r border-slate-100 p-3.5 bg-slate-50/50 flex flex-col justify-between">
                    <div>
                      <nav className="space-y-1">
                        <a
                          className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#5145F5]/10 text-[#5145F5]"
                          href="#"
                        >
                          <LayoutDashboard className="w-4 h-4" />
                          <span>Board</span>
                        </a>
                        <a
                          className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                          href="#"
                        >
                          <User className="w-4 h-4 text-slate-400" />
                          <span>My Tasks</span>
                        </a>
                        <a
                          className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                          href="#"
                        >
                          <Settings className="w-4 h-4 text-slate-400" />
                          <span>Settings</span>
                        </a>
                      </nav>

                      <div className="mt-6">
                        <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          Projects
                        </p>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-200/50 rounded-md">
                            <span className="w-2 h-2 rounded-full bg-[#5145F5]"></span>
                            <span className="truncate">Website Redesign</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100/70 rounded-md">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            <span className="truncate">Mobile App</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100/70 rounded-md">
                            <span className="w-2 h-2 rounded-full bg-pink-500"></span>
                            <span className="truncate">Marketing</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100/70 rounded-md">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span className="truncate">Personal</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button className="mt-4 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-dashed border-slate-300 hover:border-slate-400 rounded-md transition-colors">
                      <Plus className="w-3 h-3" />
                      <span>New Project</span>
                    </button>
                  </aside>

                  {/* Main Kanban Area */}
                  <div className="col-span-9 p-4 bg-slate-50/20 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                          Website Redesign
                        </h2>
                        <p className="text-[11px] text-slate-400">4 tasks</p>
                      </div>
                      <button className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#5145F5] hover:bg-[#4338CA] text-white text-xs font-medium rounded-lg shadow-sm transition-colors">
                        <Plus className="w-3 h-3" />
                        <span>Add Task</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-2.5 flex-1 items-start">
                      {/* To Do */}
                      <div className="bg-slate-100/70 rounded-xl p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-700">To Do</span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-slate-200 px-1.5 py-0.5 rounded-full">
                              2
                            </span>
                          </div>
                        </div>
                        <button className="w-full text-left px-2 py-1 text-[10px] text-slate-500 hover:text-slate-800 hover:bg-white/60 rounded flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add a task
                        </button>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-pink-500"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              Design landing page
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-50 text-purple-600 border border-purple-100">
                              UI/UX
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 15</span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5145F5]"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              Set up analytics
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100">
                              Setup
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 18</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* In Progress */}
                      <div className="bg-blue-50/50 rounded-xl p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-700">
                              In Progress
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-blue-100/70 px-1.5 py-0.5 rounded-full">
                              2
                            </span>
                          </div>
                        </div>
                        <button className="w-full text-left px-2 py-1 text-[10px] text-blue-600/80 hover:text-blue-900 hover:bg-white/60 rounded flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add a task
                        </button>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              Implement authentication
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                              Development
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 12</span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              Create API endpoints
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                              Backend
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 14</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Review */}
                      <div className="bg-amber-50/50 rounded-xl p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-700">Review</span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-amber-100/70 px-1.5 py-0.5 rounded-full">
                              1
                            </span>
                          </div>
                        </div>
                        <button className="w-full text-left px-2 py-1 text-[10px] text-amber-600/80 hover:text-amber-900 hover:bg-white/60 rounded flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add a task
                        </button>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              UI component library
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                              Frontend
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 16</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Done */}
                      <div className="bg-emerald-50/50 rounded-xl p-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-700">Done</span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-emerald-100/70 px-1.5 py-0.5 rounded-full">
                              1
                            </span>
                          </div>
                        </div>
                        <button className="w-full text-left px-2 py-1 text-[10px] text-emerald-600/80 hover:text-emerald-900 hover:bg-white/60 rounded flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add a task
                        </button>
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-sm">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="text-[11px] font-semibold text-slate-800 leading-tight">
                              Project setup
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                              Setup
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-slate-400">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Oct 10</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="py-14 bg-white border-t border-b border-slate-100" id="features">
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="flex items-start gap-4" data-purpose="feature-item">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0 text-[#5145F5]">
                <MousePointerClick className="w-6 h-6" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">Drag & Drop</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Easily move tasks between columns with a smooth and intuitive interface.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4" data-purpose="feature-item">
              <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0 text-sky-500">
                <ListTodo className="w-6 h-6" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Organize Effortlessly
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Create tasks, set due dates, add labels, and keep your work structured.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4" data-purpose="feature-item">
              <div className="w-12 h-12 rounded-2xl bg-pink-50 flex items-center justify-center shrink-0 text-pink-500">
                <Users className="w-6 h-6" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">Stay Focused</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Get a clear overview of what needs to be done, in progress, and completed.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4" data-purpose="feature-item">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 text-emerald-500">
                <Zap className="w-6 h-6" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Modern & Open Source
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Built with modern technologies and completely open source for the community.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Secondary Product Showcase */}
      <section
        className="py-24 relative overflow-hidden bg-gradient-to-b from-white via-indigo-50/30 to-[#FAFBFD]"
        id="how-it-works"
      >
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl pointer-events-none"
        ></div>
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            <div className="lg:col-span-5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#5145F5]/10 text-[#5145F5] text-xs font-bold tracking-wider uppercase mb-5">
                BUILT FOR PRODUCTIVITY
              </div>
              <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-950 tracking-tight leading-tight mb-5">
                Everything you need in one place
              </h2>
              <p className="text-slate-600 text-lg leading-relaxed font-normal max-w-lg mb-8">
                A clean and simple interface to help you manage your tasks and projects without the complexity.
              </p>
              <ul className="space-y-3.5 text-slate-700 font-medium text-sm">
                <li className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs">
                    ✓
                  </span>
                  <span>Fast in-line task creation and tag assignment</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs">
                    ✓
                  </span>
                  <span>Custom color-coded labels for seamless filtering</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs">
                    ✓
                  </span>
                  <span>Lightweight, responsive, and distraction-free design</span>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-7 relative flex justify-center items-center py-6">
              {/* Background Board Mockup */}
              <div className="w-full max-w-lg h-96 bg-white/70 rounded-2xl border border-slate-200 p-5 shadow-sm opacity-50 scale-95 blur-[0.5px] pointer-events-none select-none">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="w-24 h-4 bg-slate-200 rounded"></div>
                  <div className="w-16 h-6 bg-slate-200 rounded-lg"></div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="bg-slate-100 h-64 rounded-xl"></div>
                  <div className="bg-slate-100 h-64 rounded-xl"></div>
                  <div className="bg-slate-100 h-64 rounded-xl"></div>
                </div>
              </div>

              {/* Foreground Interactive Modal Card */}
              <div
                className="absolute z-20 w-full max-w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 p-6 transform -rotate-1 hover:rotate-0 transition-transform duration-300"
                data-purpose="create-task-modal"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    Create Task
                  </h3>
                  <button
                    aria-label="Close dialog"
                    className="text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

                <form className="space-y-4 pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Title
                    </label>
                    <input
                      className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#5145F5]/30 focus:border-[#5145F5] transition-all text-slate-800 placeholder-slate-400"
                      defaultValue="Design landing page"
                      placeholder="Enter task title"
                      type="text"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Description
                    </label>
                    <textarea
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#5145F5]/30 focus:border-[#5145F5] transition-all text-slate-800 placeholder-slate-400 resize-none"
                      placeholder="Add a description (optional)"
                      rows={2}
                    ></textarea>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Project
                      </label>
                      <div className="relative">
                        <select
                          className="w-full appearance-none text-xs px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#5145F5]/30 focus:border-[#5145F5] text-slate-700 pr-7"
                          defaultValue="🟣 Website Redesign"
                        >
                          <option>🟣 Website Redesign</option>
                          <option>🔵 Mobile App</option>
                          <option>🟢 Marketing</option>
                        </select>
                        <svg
                          className="w-3.5 h-3.5 absolute right-2.5 top-3 pointer-events-none text-slate-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 9l-7 7-7-7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Column
                      </label>
                      <div className="relative">
                        <select
                          className="w-full appearance-none text-xs px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#5145F5]/30 focus:border-[#5145F5] text-slate-700 pr-7"
                          defaultValue="To Do"
                        >
                          <option>To Do</option>
                          <option>In Progress</option>
                          <option>Review</option>
                          <option>Done</option>
                        </select>
                        <svg
                          className="w-3.5 h-3.5 absolute right-2.5 top-3 pointer-events-none text-slate-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 9l-7 7-7-7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2.5 pt-2">
                    <button
                      className="px-3.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#5145F5] hover:bg-[#4338CA] rounded-lg shadow-sm transition-all hover:shadow-indigo-500/20"
                      type="button"
                    >
                      Save Task
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-12" id="contribute">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#5145F5] flex items-center justify-center text-white">
              <Kanban className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-900">
              Agile <span className="text-[#5145F5]">TaskBoard</span>
            </span>
            <span className="text-xs text-slate-400 ml-2">
              © 2025 Open Source Software.
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs font-medium text-slate-500">
            <a className="hover:text-slate-900 transition-colors" href="#features">
              Features
            </a>
            <a className="hover:text-slate-900 transition-colors" href="#how-it-works">
              How it Works
            </a>
            <a
              className="hover:text-slate-900 transition-colors flex items-center gap-1.5"
              href="https://github.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}