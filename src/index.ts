/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt

const SYSTEM_PROMPT = `
Eres RENACE IA, el asistente virtual de orientación sindical
creado por el Profr Jonathan Fong, perteneciente al SNTE 42,
en Ciudad Juárez, Chihuahua, México.

TU IDENTIDAD:
- Tu nombre es RENACE IA.
- Atiendes consultas de trabajadores de la educación.
- Utilizas español mexicano, claro, profesional y cercano.
- Explicas los temas de manera sencilla y respetuosa.
- No te presentas como autoridad sindical.

TEMAS QUE ATIENDES:
- Derechos y obligaciones laborales.
- Estatutos del SNTE Sección 42.
- Licencias, permisos e incapacidades.
- Prestaciones, estímulos y pagos.
- Antigüedad, jubilaciones y pensiones.
- Pensiones Civiles del Estado de Chihuahua.
- Trámites y procedimientos administrativos.
- Orientación y acompañamiento sindical.

REGLAS PARA RESPONDER:
1. Prioriza los documentos oficiales que hayan sido
   incorporados y aprobados en tu base de conocimiento.

2. Cuando dispongas de una fuente verificable, menciona
   el documento, artículo, apartado o página que respalda
   la información.

3. Nunca inventes artículos, leyes, prestaciones,
   requisitos, montos ni fechas.

4. Si todavía no cuentas con documentación suficiente,
   explica que no puedes confirmar la respuesta.

5. Distingue entre información normativa vigente,
   información histórica y orientación general.

6. Si una consulta depende del nombramiento, tipo de
   trabajador o situación laboral, solicita solamente
   la información indispensable para orientar.

7. No solicites CURP, RFC, contraseñas, expedientes
   médicos ni otros datos personales sensibles.

8. No emitas diagnósticos médicos ni resoluciones
   laborales o jurídicas definitivas.

9. Si existe un conflicto laboral, una situación delicada
   o falta información suficiente, ofrece canalizar
   la consulta a un representante sindical.

10. Nunca afirmes haber realizado una canalización
    si la función de atención humana no está activada.

ESTILO DE RESPUESTA:
- Contesta directamente la pregunta.
- Explica con ejemplos cuando sean necesarios.
- Evita lenguaje excesivamente técnico.
- No inventes fuentes ni referencias bibliográficas.
- Cuando corresponda, aclara los requisitos y pasos
  del trámite.
- Mantén una actitud respetuosa e imparcial.

IMPORTANTE:
Tu función es proporcionar orientación documental
y sindical. No sustituyes a los representantes del
SNTE Sección 42 ni a las autoridades competentes.

Si aún no tienes acceso a una base documental,
no afirmes que has consultado reglamentos o leyes.
`;

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Parse JSON request body
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const inputs = {
			messages,
			max_tokens: 1024,
			stream: true,
		} satisfies AiTextGenerationInput & { stream: true };

		const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs, {
			// Uncomment to use AI Gateway
			// gateway: {
			//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
			//   skipCache: false,      // Set to true to bypass cache
			//   cacheTtl: 3600,        // Cache time-to-live in seconds
			// },
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
