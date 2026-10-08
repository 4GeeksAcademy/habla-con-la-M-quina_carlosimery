"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, BarChart3, Bot, ChevronDown, Clock3, Copy, FileText, Folder, LayoutGrid, Menu, MoreHorizontal, Plus, Search, Settings2, Sparkles, Trash2, User, Zap } from "lucide-react"

const conversations = [
  { title: "Diseño de landing page", time: "Ahora", active: true },
  { title: "Refactorizar componente Button", time: "Ayer" },
  { title: "Ideas para onboarding", time: "Lun" },
  { title: "Analizar métricas Q3", time: "Dom" },
]

type Message = { role: "user" | "assistant"; text: string; time: string; detail?: string }
type ChatState = {
  messages: Message[]
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requests: number
  lastModel?: string
  byModel: Record<string, number>
  daily: Record<string, number>
}

const storageKey = "aurora-groq-chat-v1"
const emptyChat: ChatState = { messages: [], promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, byModel: {}, daily: {} }
const formatTokens = (value: number) => value.toLocaleString("es-ES")
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

function isChatState(value: unknown): value is ChatState {
  if (!value || typeof value !== "object") return false
  const state = value as ChatState
  return Array.isArray(state.messages) && state.messages.every(message => message &&
    (message.role === "user" || message.role === "assistant") && typeof message.text === "string" &&
    typeof message.time === "string" && (message.detail === undefined || typeof message.detail === "string")) &&
    [state.promptTokens, state.completionTokens, state.totalTokens, state.requests].every(count => Number.isSafeInteger(count) && count >= 0) &&
    (state.lastModel === undefined || (typeof state.lastModel === "string" && Boolean(state.lastModel.trim()))) &&
    [state.byModel, state.daily].every(counts => counts && typeof counts === "object" && !Array.isArray(counts) &&
      Object.values(counts).every(count => Number.isSafeInteger(count) && count >= 0))
}

export default function Page() {
  const [prompt, setPrompt] = useState("")
  const [chat, setChat] = useState<ChatState>(emptyChat)
  const [isLoading, setIsLoading] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState("")
  const [storageError, setStorageError] = useState("")
  const [mobileNav, setMobileNav] = useState(false)
  const pending = useRef(false)
  const bottom = useRef<HTMLDivElement>(null)
  const messages = chat.messages

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (!isChatState(parsed)) throw new Error("Invalid saved chat")
        setChat(parsed)
      }
    } catch {
      setStorageError("No se pudo restaurar el historial local.")
    }
    setIsReady(true)
  }, [])

  useEffect(() => {
    if (!isReady) return
    try {
      if (chat.messages.length === 0 && chat.requests === 0) {
        localStorage.removeItem(storageKey)
      } else {
        localStorage.setItem(storageKey, JSON.stringify(chat))
      }
    } catch {
      setStorageError("No se pudo guardar el historial en este navegador.")
    }
  }, [chat, isReady])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length, isLoading])

  async function sendMessage() {
    const text = prompt.trim()
    if (!text || !isReady || pending.current) return
    pending.current = true
    setIsLoading(true)
    setError("")
    const time = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    const nextMessages: Message[] = [...messages, { role: "user", text, time: time() }]
    setChat(previous => ({ ...previous, messages: nextMessages }))
    setPrompt("")
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.map(message => ({ role: message.role, content: message.text })) }),
        signal: AbortSignal.timeout(70000),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const errorMessages: Record<number, string> = {
          401: "No se pudo autenticar la solicitud. Revisa la configuracion del servidor.",
          403: "El filtro de seguridad ha bloqueado este mensaje. Reformula tu solicitud.",
          429: "Se ha alcanzado el limite de solicitudes. Intenta de nuevo mas tarde.",
          503: "El servicio no esta disponible en este momento. Intenta de nuevo mas tarde.",
        }
        const apiError = typeof data?.error === "string" && data.error.trim() ? data.error : null
        throw new Error(apiError || errorMessages[response.status] || "No se pudo enviar el mensaje. Intenta de nuevo mas tarde.")
      }
      if (!data || typeof data.content !== "string" || !data.content.trim() || typeof data.model !== "string" || !data.model.trim() ||
        ![data.usage?.prompt_tokens, data.usage?.completion_tokens, data.usage?.total_tokens].every(count => Number.isSafeInteger(count) && count >= 0) ||
        data.usage.total_tokens !== data.usage.prompt_tokens + data.usage.completion_tokens) {
        throw new Error("La respuesta del servidor no es valida.")
      }
      const today = dateKey(new Date())
      setChat(previous => ({
        ...previous,
        messages: [...nextMessages, { role: "assistant", text: data.content, time: time() }],
        promptTokens: previous.promptTokens + data.usage.prompt_tokens,
        completionTokens: previous.completionTokens + data.usage.completion_tokens,
        totalTokens: previous.totalTokens + data.usage.total_tokens,
        requests: previous.requests + 1,
        lastModel: data.model,
        byModel: { ...previous.byModel, [data.model]: (previous.byModel[data.model] || 0) + data.usage.total_tokens },
        daily: { ...previous.daily, [today]: (previous.daily[today] || 0) + data.usage.total_tokens },
      }))
    } catch (cause) {
      setChat(previous => ({ ...previous, messages }))
      setPrompt(text)
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        setError("La respuesta esta tardando demasiado. Intenta enviar el mensaje de nuevo.")
      } else if (cause instanceof TypeError) {
        setError("No se pudo conectar con el servidor. Comprueba tu conexion e intenta de nuevo.")
      } else {
        setError(cause instanceof Error ? cause.message : "No se pudo enviar el mensaje. Intenta de nuevo.")
      }
    } finally {
      pending.current = false
      setIsLoading(false)
    }
  }

  function newConversation() {
    if (pending.current || !isReady) return
    setChat(previous => ({ ...previous, messages: [] }))
    setPrompt("")
    setError("")
  }

  function clearConversation() {
    if (pending.current || !isReady) return
    try {
      localStorage.removeItem(storageKey)
    } catch {
      setStorageError("No se pudo borrar la conversacion guardada en este navegador.")
      return
    }
    setChat(emptyChat)
    setPrompt("")
    setError("")
    setStorageError("")
    setMobileNav(false)
  }

  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date()
    day.setDate(day.getDate() - 6 + index)
    return { label: day.toLocaleDateString("es-ES", { weekday: "short" }), tokens: chat.daily[dateKey(day)] || 0 }
  })
  const maxDailyTokens = Math.max(1, ...week.map(day => day.tokens))

  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <div className="flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-20 flex w-[260px] flex-col border-r border-border bg-sidebar transition-transform duration-200 lg:static lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex h-[72px] items-center justify-between border-b border-border px-5">
            <div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles /></div><span className="font-semibold tracking-tight">Aurora AI</span></div>
            <button onClick={() => setMobileNav(false)} className="text-muted-foreground lg:hidden" aria-label="Cerrar menú"><span className="text-xl">×</span></button>
          </div>
          <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-2">
              <button onClick={newConversation} disabled={!isReady || isLoading} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40"><Plus data-icon="inline-start" /> Nueva conversación</button>
              <button onClick={clearConversation} disabled={!isReady || isLoading} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-red-600 transition hover:bg-accent disabled:opacity-40"><Trash2 /> Borrar conversación</button>
            </div>
            <div className="flex flex-col gap-1"><p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p><NavItem icon={<LayoutGrid />} label="Conversaciones" active /><NavItem icon={<Folder />} label="Proyectos" /><NavItem icon={<BarChart3 />} label="Uso y facturación" /></div>
            <div className="flex flex-col gap-1"><p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Historial reciente</p>{conversations.map((item) => <button key={item.title} className={`flex items-center justify-between rounded-md px-2 py-2 text-left text-sm ${item.active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}><span className="truncate">{item.title}</span><span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{item.time}</span></button>)}</div>
          </div>
          <div className="mt-auto border-t border-border p-4"><button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Settings2 /> Ajustes <ChevronDown className="ml-auto" /></button><div className="mt-3 flex items-center gap-3 px-2"><div className="flex size-8 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900">CM</div><div className="min-w-0"><p className="truncate text-sm font-medium">Carlos Emery</p><p className="truncate text-xs text-muted-foreground">Plan Pro</p></div><MoreHorizontal className="ml-auto text-muted-foreground" /></div></div>
        </aside>
        {mobileNav && <button className="fixed inset-0 z-10 bg-black/20 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Cerrar menú" />}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[72px] items-center justify-between border-b border-border px-4 sm:px-8"><div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} className="rounded-md p-2 hover:bg-accent lg:hidden" aria-label="Abrir menú"><Menu /></button><div><p className="text-xs text-muted-foreground">Conversación</p><h1 className="text-sm font-semibold">Diseño de landing page</h1></div></div><div className="flex items-center gap-2"><button className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Buscar"><Search /></button><button className="hidden rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent sm:block">Compartir</button></div></header>
          <div className="border-b border-border px-4 py-4 sm:px-8 xl:hidden"><div className="mx-auto w-full max-w-3xl"><UsageSummary chat={chat} /></div></div>
          <div className="flex flex-1 flex-col overflow-hidden"><div aria-live="polite" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto px-4 py-8 sm:px-8">{messages.map((message, index) => <div key={index} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`flex min-w-0 max-w-[86%] gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}><div className={`flex size-7 shrink-0 items-center justify-center rounded-full ${message.role === "user" ? "bg-foreground text-background" : "bg-primary text-primary-foreground"}`}>{message.role === "user" ? <User /> : <Bot />}</div><div className="flex min-w-0 flex-col gap-2"><div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-tr-sm bg-secondary text-secondary-foreground" : "rounded-tl-sm border border-border bg-card"}`}><p>{message.text}</p>{message.detail && <p className="mt-3 border-t border-border pt-3 text-muted-foreground">{message.detail}</p>}</div><div className={`flex items-center gap-3 text-[10px] text-muted-foreground ${message.role === "user" ? "justify-end" : ""}`}><span>{message.time}</span>{message.role === "assistant" && <><button onClick={() => navigator.clipboard.writeText(message.text).catch(() => setError("No se pudo copiar el mensaje."))} className="hover:text-foreground" aria-label="Copiar mensaje"><Copy /></button><button className="hover:text-foreground" aria-label="Más acciones"><MoreHorizontal /></button></>}</div></div></div></div>)}{isLoading && <p role="status" className="text-sm text-muted-foreground">Pensando...</p>}{error && <p role="alert" className="text-sm text-red-600">{error}</p>}{storageError && <p role="alert" className="text-sm text-red-600">{storageError}</p>}<div ref={bottom} /></div>
            <div className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-8"><div className="rounded-xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"><textarea value={prompt} disabled={!isReady || isLoading} maxLength={20000} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void sendMessage() } }} placeholder="Escribe un mensaje..." rows={2} className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground" aria-label="Mensaje" /><div className="flex items-center justify-between pt-2"><div className="flex items-center gap-1 text-muted-foreground"><button className="rounded-md p-2 hover:bg-accent" aria-label="Adjuntar archivo"><FileText /></button><span className="text-[11px]">Shift + Enter para nueva línea</span></div><button onClick={sendMessage} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40" disabled={!prompt.trim() || !isReady || isLoading} aria-label="Enviar mensaje"><ArrowUp /></button></div></div><p className="pt-3 text-center text-[10px] text-muted-foreground">Aurora puede cometer errores. Verifica la información importante.</p></div>
          </div>
        </section>
        <aside className="hidden w-[280px] shrink-0 border-l border-border bg-sidebar/40 xl:flex xl:flex-col">
          <div className="border-b border-border px-6 py-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Resumen de uso</p>
            <div className="mt-4"><UsageSummary chat={chat} /></div>
            <p className="mt-2 text-xs text-muted-foreground">{formatTokens(chat.requests)} solicitudes completadas</p>
          </div>
          <div className="flex flex-col gap-6 px-6 py-6">
            <div><p className="mb-3 text-xs font-medium">Últimos 7 días</p><div className="grid h-24 grid-cols-7 gap-2">{week.map((day, index) => <div key={index} className="flex min-w-0 flex-col justify-end gap-2"><div className="flex h-20 items-end"><div title={`${formatTokens(day.tokens)} tokens`} className="w-full rounded-sm bg-primary" style={{ height: `${day.tokens / maxDailyTokens * 100}%` }} /></div><span className="text-center text-[9px] text-muted-foreground">{day.label}</span></div>)}</div></div>
            <div className="flex flex-col gap-3"><p className="text-xs font-medium">Por modelo</p>{Object.entries(chat.byModel).map(([model, tokens]) => <UsageRow key={model} label={model} value={formatTokens(tokens)} color="bg-primary" />)}</div>
          </div>
          <div className="mt-auto flex items-center gap-2 border-t border-border px-6 py-4 text-[10px] text-muted-foreground"><Clock3 /> {isLoading ? "Actualizando..." : "Uso acumulado en este navegador"}</div>
        </aside>
      </div>
    </main>
  )
}

function UsageSummary({ chat }: { chat: ChatState }) {
  return (
    <dl aria-label="Uso de tokens de la sesión" className="grid grid-cols-3 gap-x-3 gap-y-4 xl:grid-cols-1">
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">Tokens de prompt</dt><dd className="mt-1 break-words text-lg font-semibold">{formatTokens(chat.promptTokens)}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">Tokens de completado</dt><dd className="mt-1 break-words text-lg font-semibold">{formatTokens(chat.completionTokens)}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">Total combinado</dt><dd className="mt-1 break-words text-lg font-semibold">{formatTokens(chat.totalTokens)}</dd></div>
      <div className="col-span-3 min-w-0 xl:col-span-1"><dt className="text-xs text-muted-foreground">Modelo de la última respuesta</dt><dd className="mt-1 break-words text-sm">{chat.lastModel || "Sin respuestas"}</dd></div>
    </dl>
  )
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) { return <button className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>{icon}{label}</button> }
function UsageRow({ label, value, color }: { label: string; value: string; color: string }) { return <div className="flex items-center gap-2 text-xs"><span className={`size-2 rounded-full ${color}`} /><span className="flex-1 text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div> }

