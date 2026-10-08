import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "Falta configurar GROQ_API_KEY en el servidor." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "La solicitud no contiene JSON valido." }, { status: 400 })
  }

  const messages = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200 || messages.at(-1)?.role !== "user" ||
    !messages.every(message => message && (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" && message.content.trim() && message.content.length <= 20000)) {
    return NextResponse.json({ error: "El historial de mensajes no es valido." }, { status: 400 })
  }

  const model = "qwen/qwen3.8-27b"
  const guardModel = "meta-llama/llama-prompt-guard-2-86m"
  const safetyThreshold = 0.5
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  try {
    const signal = AbortSignal.timeout(60000)
    for (const message of messages.filter(message => message.role === "user")) {
      const guardResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ model: guardModel, messages: [{ role: "user", content: message.content }] }),
        signal,
      })

      if (!guardResponse.ok) {
        return NextResponse.json({ error: "El filtro de seguridad no esta disponible. No se ha generado ninguna respuesta. Intenta de nuevo mas tarde." }, { status: guardResponse.status === 429 ? 429 : 502 })
      }

      const guardData = await guardResponse.json()
      const classification = guardData.choices?.[0]?.message?.content
      const score = typeof classification === "string" && classification.trim() ? Number(classification) : NaN
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        return NextResponse.json({ error: "El filtro de seguridad devolvio un resultado invalido. No se ha generado ninguna respuesta." }, { status: 502 })
      }
      if (score >= safetyThreshold) {
        return NextResponse.json({ error: "El filtro de seguridad bloqueo el mensaje por detectar un posible intento de manipular las instrucciones de la IA." }, { status: 403 })
      }
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: messages.map(message => ({ role: message.role, content: message.content })),
        temperature: 0.6,
        max_completion_tokens: 2048,
        top_p: 0.95,
        stream: false,
        reasoning_effort: "default",
        stop: null,
      }),
      signal,
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: "El modelo Qwen solicitado no esta disponible para esta clave de Groq." }, { status: 503 })
      }
      return NextResponse.json({ error: response.status === 429
        ? "Groq ha alcanzado su limite de solicitudes. Intenta de nuevo mas tarde."
        : "Groq no pudo completar la solicitud." }, { status: response.status === 429 ? 429 : 502 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    const usage = data.usage
    if (typeof content !== "string" || !content.trim() ||
      ![usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
      return NextResponse.json({ error: "Groq devolvio una respuesta incompleta." }, { status: 502 })
    }

    return NextResponse.json({ content, model: data.model || model, usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    } })
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con Groq. Intenta de nuevo." }, { status: 502 })
  }
}