/**
 * RENACE IA - Chat sin historial persistente del lado del navegador.
 * Los mensajes existen solamente en memoria mientras la página está abierta.
 * Este archivo NO utiliza localStorage, sessionStorage, IndexedDB ni cookies.
 */

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const newChatButton = document.getElementById("new-chat-button");
const typingIndicator = document.getElementById("typing-indicator");
const quickPrompts = document.getElementById("quick-prompts");

// Archivo estático que debe publicarse en public/ junto a este script.
const GUIA_NUEVO_INGRESO_URL = "/guia-docentes-nuevo-ingreso.pdf";

function esDocenteDeNuevoIngreso(texto) {
  const t = texto.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  return /\b(?:soy|somos)\s+(?:un[ao]?\s+)?(?:docente|maestr[oa]|profesor[ao])\s+de\s+nuevo\s+ingreso\b/.test(t)
    || /\b(?:soy|somos)\s+(?:un[ao]?\s+)?(?:docente|maestr[oa]|profesor[ao])\s+reci[eé]n\s+ingresad[oa]s?\b/.test(t)
    || /\b(?:acabo|acabamos)\s+de\s+(?:ingresar|entrar)\s+(?:al\s+)?(?:servicio\s+docente|magisterio)\b/.test(t)
    || /\b(?:guia|paquete|bienvenida)\s+(?:para\s+)?(?:docentes?\s+)?de\s+nuevo\s+ingreso\b/.test(t);
}

function mostrarBienvenidaNuevoIngreso() {
  const mensaje =
    "¡Bienvenido al servicio docente! 🧡\n\n" +
    "Preparamos una guía con tus primeros pasos: alta en Pensiones Civiles, " +
    "carta testamentaria, SIMAP, seguros, derechos y pensiones. " +
    "Puedes consultarme cualquiera de estos temas.";

  // Crear el enlace como elemento DOM, nunca como HTML generado por la IA.
  const parrafo = addMessageToChat("assistant", mensaje);
  const enlace = document.createElement("a");
  enlace.href = GUIA_NUEVO_INGRESO_URL;
  enlace.target = "_blank";
  enlace.rel = "noopener noreferrer";
  enlace.textContent = "📄 Abrir o descargar tu Guía de Bienvenida (PDF)";
  enlace.setAttribute("aria-label", "Abrir la Guía de Bienvenida para docentes de nuevo ingreso, en formato PDF");
  enlace.style.display = "inline-block";
  enlace.style.marginTop = "12px";
  enlace.style.padding = "10px 14px";
  enlace.style.borderRadius = "10px";
  enlace.style.background = "#fff2df";
  enlace.style.border = "1px solid #f1cb97";
  enlace.style.color = "#9d4c06";
  enlace.style.fontWeight = "700";
  enlace.style.textDecoration = "underline";
  enlace.style.textUnderlineOffset = "3px";
  parrafo.parentElement.appendChild(enlace);
  scrollToBottom();

  // El historial continúa siendo temporal en memoria; nunca se guarda.
  chatHistory.push({
    role: "assistant",
    content: mensaje + "\nGuía de Bienvenida (PDF): " + GUIA_NUEVO_INGRESO_URL,
  });
  chatHistory = chatHistory.slice(-8);
}

const WELCOME_MESSAGE =
  "¡Hola! Soy RENACE IA, tu Asistente de Orientación Sindical SNTE42. " +
  "Puedes consultarme sobre Prestaciones, Derechos Laborales, Licencias, Trámites y Pensiones Civiles del Estado de Chihuahua.";

let chatHistory = [];
let isProcessing = false;
let activeController = null;
let requestVersion = 0;

function addMessageToChat(role, content) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  const paragraph = document.createElement("p");
  // textContent impide interpretar HTML o scripts enviados como mensajes.
  paragraph.textContent = content;
  messageEl.appendChild(paragraph);
  chatMessages.appendChild(messageEl);
  scrollToBottom();
  return paragraph;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setProcessing(processing) {
  isProcessing = processing;
  userInput.disabled = processing;
  sendButton.disabled = processing;
  typingIndicator.classList.toggle("visible", processing);
}

function clearConversation({ focus = true } = {}) {
  // Invalidar respuestas pendientes ANTES de interrumpir la transmisión.
  requestVersion += 1;
  if (activeController) {
    activeController.abort();
    activeController = null;
  }

  chatHistory = [];
  chatMessages.replaceChildren();
  quickPrompts.hidden = false;
  userInput.value = "";
  userInput.style.height = "auto";
  setProcessing(false);
  addMessageToChat("assistant", WELCOME_MESSAGE);
  // Mostrar desde el inicio el mensaje de bienvenida, incluso en pantallas pequeñas.
  chatMessages.scrollTop = 0;
  if (focus) userInput.focus();
}

function consumeSseEvents(buffer) {
  let normalized = buffer.replace(/\r/g, "");
  const events = [];
  let end;
  while ((end = normalized.indexOf("\n\n")) !== -1) {
    const raw = normalized.slice(0, end);
    normalized = normalized.slice(end + 2);
    const lines = raw.split("\n");
    const data = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (data.length) events.push(data.join("\n"));
  }
  return { events, buffer: normalized };
}

function extractText(sseData) {
  // No registrar aquí contenido, respuestas ni errores con información personal.
  try {
    const json = JSON.parse(sseData);
    if (typeof json.response === "string") return json.response;
    const openAiDelta = json.choices?.[0]?.delta?.content;
    return typeof openAiDelta === "string" ? openAiDelta : "";
  } catch {
    return "";
  }
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  // Atajo directo y determinista: no consulta IA ni cambia el simulador.
  if (esDocenteDeNuevoIngreso(message)) {
    addMessageToChat("user", message);
    userInput.value = "";
    userInput.style.height = "auto";
    quickPrompts.hidden = true;
    chatHistory.push({ role: "user", content: message });
    chatHistory = chatHistory.slice(-8);
    mostrarBienvenidaNuevoIngreso();
    userInput.focus();
    return;
  }

  const thisRequest = ++requestVersion;
  const controller = new AbortController();
  activeController = controller;
  setProcessing(true);

  addMessageToChat("user", message);
  userInput.value = "";
  userInput.style.height = "auto";
  chatHistory.push({ role: "user", content: message });
  quickPrompts.hidden = true;
  chatHistory = chatHistory.slice(-8);

  let assistantTextEl = null;
  let responseText = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) throw new Error("Respuesta HTTP no válida");
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("No se recibió un flujo de respuesta del asistente");
    }
    if (!response.body) throw new Error("Respuesta vacía");

    assistantTextEl = addMessageToChat("assistant", "");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    const processEvents = (events) => {
      for (const data of events) {
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        responseText += extractText(data);
      }
      if (thisRequest === requestVersion) {
        assistantTextEl.textContent = responseText;
        scrollToBottom();
      }
    };

    while (!finished) {
      const { done, value } = await reader.read();
      if (thisRequest !== requestVersion) return;
      if (done) {
        buffer += decoder.decode();
        processEvents(consumeSseEvents(buffer + "\n\n").events);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseEvents(buffer);
      buffer = parsed.buffer;
      processEvents(parsed.events);
    }

    if (!responseText.trim()) {
      assistantTextEl.textContent = "No recibí una respuesta. Intenta nuevamente.";
    } else {
      chatHistory.push({ role: "assistant", content: responseText });
      chatHistory = chatHistory.slice(-8);
    }
  } catch (error) {
    if (thisRequest !== requestVersion || controller.signal.aborted) return;
    const errorText = "No fue posible completar la consulta. Intenta de nuevo. Si la sesión de acceso venció, vuelve a iniciar sesión.";
    if (assistantTextEl) assistantTextEl.textContent = errorText;
    else addMessageToChat("assistant", errorText);
  } finally {
    if (thisRequest === requestVersion) {
      activeController = null;
      setProcessing(false);
      userInput.focus();
    }
  }
}

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 170) + "px";
});
userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
sendButton.addEventListener("click", sendMessage);
newChatButton.addEventListener("click", () => clearConversation());

// Las sugerencias solo completan el cuadro: no envían consultas automáticamente.
document.querySelectorAll(".prompt-chip").forEach((button) => {
  button.addEventListener("click", () => {
    if (isProcessing) return;
    userInput.value = button.dataset.question || "";
    userInput.dispatchEvent(new Event("input"));
    userInput.focus();
  });
});

// Al regresar a una página recuperada de la caché de navegación, limpiar el chat.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) clearConversation({ focus: false });
});
// Interrumpir transmisiones y descartar mensajes al abandonar la página.
window.addEventListener("pagehide", () => {
  requestVersion += 1;
  activeController?.abort();
  activeController = null;
  chatHistory = [];
  chatMessages.replaceChildren();
  userInput.value = "";
});

clearConversation({ focus: false });
