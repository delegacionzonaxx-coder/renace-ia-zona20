/**
 * RENACE IA — Zona Escolar 20, SNTE Sección 42.
 * Simulador histórico: reproduce exclusivamente las fórmulas y la tabla
 * de "SIMULADOR JUBILACION 2014.xlsx". No usa otras normas para calcular.
 * Sin historial persistente en el Worker.
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT = `
Eres RENACE IA, asistente de orientación sindical de la Zona Escolar 20,
SNTE Sección 42, creado por el Profr. Jonathan Fong, en Chihuahua, México.
Responde con claridad, en español mexicano, normalmente en menos de 80 palabras.
Orienta sobre prestaciones, derechos, licencias, trámites y Pensiones Civiles
con apoyo en documentos recuperados, citando los documentos utilizados.
Nunca inventes fuentes, montos o derechos. No solicites CURP, RFC,
números de empleado, domicilios, contraseñas ni documentación personal.
No confundas beneficios sindicales con los de Pensiones Civiles.
El simulador de jubilación del régimen anterior es una función independiente
que no se calcula a través de este modelo ni mediante otros documentos.
`;

type SearchChunk = { text: string; score: number; item: { key: string } };
type SearchEnv = Env & {
  RENACE_SEARCH: {
    search(params: { messages: Array<{ role: "user"; content: string }> }):
      Promise<{ chunks: SearchChunk[] }>;
  };
};
type Regimen = "anterior" | "individual";
type SexoExcel = "M" | "F";
type EntradasExcel = { ingreso: number; edad2014: number };

function responder(texto: string): Response {
  // Compatible con el lector SSE de la interfaz actual.
  const body = `data: ${JSON.stringify({ response: texto })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function seleccionarRegimen(texto: string): Regimen | null {
  const t = normalizar(texto).replace(/[.!?]+$/, "").trim();
  if (/^(1|regimen anterior|ley anterior|transitorio|sistema anterior|1\s*[).:-]\s*regimen anterior)$/.test(t)) {
    return "anterior";
  }
  if (/^(2|cuentas? individuales?|regimen nuevo|nueva ley|2\s*[).:-]\s*cuentas individuales)$/.test(t)) {
    return "individual";
  }
  return null;
}

/** B4 = edad cumplida al 31/12/2014; B5 = año de ingreso. */
function leerEntradasExcel(texto: string): EntradasExcel | null {
  const t = normalizar(texto);
  // Formas recomendadas: "1997 y 39", "39 y 1997",
  // "Ingreso: 1997, edad 2014: 39".
  const numeros = [...t.matchAll(/\b\d{1,4}\b/g)].map((m) => Number(m[0]));
  const anios = numeros.filter((n) => n >= 1950 && n <= 2013);
  if (anios.length !== 1) return null;
  const ingreso = anios[0];

  // Si el texto incluye el año de referencia 2014, este NO es la edad.
  let edad2014: number | null = null;
  const exp = t.match(/(?:edad(?:\s+al)?\s+(?:31\s+de\s+diciembre\s+de\s+)?2014|edad\s+en\s+2014)\s*[:=]?\s*(\d{1,3})\b/);
  if (exp) edad2014 = Number(exp[1]);
  if (edad2014 === null) {
    const porAnos = t.match(/\b(\d{1,3})\s+anos\b/);
    if (porAnos) edad2014 = Number(porAnos[1]);
  }
  if (edad2014 === null) {
    // En la entrada corta ignoramos 2014 y 31 si se escribe la fecha.
    const candidatos = numeros.filter((n) => n >= 16 && n <= 95 && n !== 31);
    if (candidatos.length === 1) edad2014 = candidatos[0];
    // "31" puede ser una edad legítima si NO figura la fecha 31/12/2014.
    if (edad2014 === null && !t.includes("2014")) {
      const simples = numeros.filter((n) => n >= 16 && n <= 95);
      if (simples.length === 1) edad2014 = simples[0];
    }
  }
  if (edad2014 === null || edad2014 < 16 || edad2014 > 95) return null;
  return { ingreso, edad2014 };
}

function seleccionarSexo(texto: string): SexoExcel | null {
  const t = normalizar(texto).replace(/[.!?]+$/, "").trim();
  if (/^(hombre|masculino|m)$/.test(t)) return "M";
  if (/^(mujer|femenino|f)$/.test(t)) return "F";
  return null;
}

/**
 * La hoja solo contiene los años 2021 a 2043, en H5:I27 (mujeres)
 * y K5:L27 (hombres). NO extrapolamos edades fuera de ese intervalo.
 * Todos los valores provienen únicamente del archivo XLSX cargado.
 */
const EDADES_EXCEL: Record<number, { F: number; M: number }> = {
  2021:{ F:51, M:53 }, 2022:{ F:51, M:53 }, 2023:{ F:51, M:53 },
  2024:{ F:52, M:54 }, 2025:{ F:52, M:54 }, 2026:{ F:52, M:54 },
  2027:{ F:53, M:55 }, 2028:{ F:53, M:55 }, 2029:{ F:53, M:55 },
  2030:{ F:54, M:56 }, 2031:{ F:54, M:56 }, 2032:{ F:54, M:56 },
  2033:{ F:54, M:56 }, 2034:{ F:54, M:56 }, 2035:{ F:54, M:56 },
  2036:{ F:54, M:56 }, 2037:{ F:54, M:56 }, 2038:{ F:54, M:56 },
  2039:{ F:54, M:56 }, 2040:{ F:54, M:56 }, 2041:{ F:54, M:56 },
  2042:{ F:54, M:56 }, 2043:{ F:54, M:56 },
};

type ResultadoExcel = {
  anioServicio: number;
  edadEnEseAnio: number;
  edadRequerida: number;
  diferencia: number;
  resultadoLiteral: string;
};

/**
 * B8  = SI(B6="M", B5+30, B5+28).
 * B9  = (B8-2014)+B4: se usa la entrada de edad B4 para reproducir las
 *        capturas. ATENCIÓN: el archivo guardado referencia E35 (vacía),
 *        lo que provoca un resultado numérico equivocado; es la única
 *        referencia que se repara para reflejar el comportamiento mostrado.
 * B11 = BUSCARV(B8, tabla del sexo, columna edad, coincidencia exacta).
 * B12 = B11-B9 (sin redondeos ni recálculos en años posteriores).
 * B13 = SI(B12<=0,"NO APORTA",SI(B12=1,"APORTA UN AÑO",
 *          SI(B12=2,"APORTA DOS AÑOS","APORTA TRES AÑOS"))).
 * La leyenda TRES AÑOS es literal incluso cuando B12 > 3.
 */
function calcularComoExcel(entrada: EntradasExcel, sexo: SexoExcel): ResultadoExcel | null {
  const anioServicio = entrada.ingreso + (sexo === "M" ? 30 : 28);
  const edadRequerida = EDADES_EXCEL[anioServicio]?.[sexo];
  if (edadRequerida === undefined) return null;
  const edadEnEseAnio = entrada.edad2014 + (anioServicio - 2014);
  const diferencia = edadRequerida - edadEnEseAnio;
  const resultadoLiteral = diferencia <= 0 ? "NO APORTA" :
    diferencia === 1 ? "APORTA UN AÑO" :
    diferencia === 2 ? "APORTA DOS AÑOS" : "APORTA TRES AÑOS";
  return { anioServicio, edadEnEseAnio, edadRequerida, diferencia, resultadoLiteral };
}

function esPreguntaDeSimulacion(texto: string): boolean {
  const t = normalizar(texto);
  return /simulad|calcul.{0,28}jubil|cuanto.{0,28}jubil|cuando.{0,28}jubil|falta.{0,35}jubil|jubil.{0,35}falta|fecha.{0,28}jubil|tiempo.{0,35}jubil|en que ano.{0,25}jubil|edad.{0,18}jubil|puedo jubilarme/.test(t);
}

function esOtroAsunto(texto: string): boolean {
  const t = normalizar(texto);
  return /gastos? funerarios?|seguro de vida|licencias?|permisos? laborales?|prestamos?|vacaciones|incapacidades|aguinaldo/.test(t)
    && !esPreguntaDeSimulacion(t);
}

function flujoSimulador(preguntas: string[]): Response | null {
  // Reanuda el flujo dentro de esta conversación en memoria; al pulsar
  // «Nueva consulta» en la interfaz se empieza sin historial.
  let inicio = -1;
  for (let i = preguntas.length - 1; i >= 0; i--) {
    if (esPreguntaDeSimulacion(preguntas[i])) { inicio = i; break; }
  }
  if (inicio === -1) return null;
  const despues = preguntas.slice(inicio + 1);
  const indiceRegimen = despues.findIndex((x) => seleccionarRegimen(x) !== null);
  if (indiceRegimen < 0) {
    return responder("¿A qué régimen perteneces?\n1. Régimen anterior\n2. Cuentas individuales");
  }
  const regimen = seleccionarRegimen(despues[indiceRegimen]);
  if (regimen === "individual") {
    return responder(
      "El simulador solo es válido para trabajadores del régimen anterior, cuentas individuales debe revisar la Ley de PCE actual."
    );
  }

  const siguientes = despues.slice(indiceRegimen + 1);
  const indiceEntradas = siguientes.findIndex((x) => leerEntradasExcel(x) !== null);
  if (indiceEntradas < 0) {
    return responder("¿En qué año ingresaste al servicio y qué edad tenías al 31 de diciembre de 2014? (Ejemplo: 1997 y 39).");
  }
  const entradas = leerEntradasExcel(siguientes[indiceEntradas])!;
  const siguientesSexo = siguientes.slice(indiceEntradas + 1);
  const indiceSexo = siguientesSexo.findIndex((x) => seleccionarSexo(x) !== null);
  if (indiceSexo < 0) return responder("¿Eres hombre o mujer?");

  const sexo = seleccionarSexo(siguientesSexo[indiceSexo])!;
  const resultado = calcularComoExcel(entradas, sexo);
  if (!resultado) {
    return responder("El año obtenido no aparece en la tabla del Excel (2021–2043). No puedo simularlo sin modificar el archivo original.");
  }

  const nota = resultado.diferencia > 3
    ? "\nNota: la fórmula del Excel muestra 'APORTA TRES AÑOS' también cuando la diferencia es mayor de 3."
    : "";
  return responder(
    `Simulador 2014 — régimen anterior\n` +
    `Año al cumplir los años de servicio: ${resultado.anioServicio}\n` +
    `Edad ese año: ${resultado.edadEnEseAnio}\n` +
    `Edad requerida según Excel: ${resultado.edadRequerida}\n` +
    `Diferencia: ${resultado.diferencia} años\n` +
    `Resultado del Excel: ${resultado.resultadoLiteral}${nota}\n` +
    "Estimación informativa; no confirma la fecha oficial de jubilación."
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return handleChatRequest(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-22);
    const userMessages = history.filter((m) => m.role === "user");
    const pregunta = userMessages[userMessages.length - 1]?.content?.trim();
    if (!pregunta || pregunta.length > 3000) {
      return Response.json({ error: "Escribe una consulta válida." }, { status: 400 });
    }

    // El simulador jamás invoca AI Search ni utiliza otros documentos.
    if (!esOtroAsunto(pregunta)) {
      const calculo = flujoSimulador(userMessages.map((m) => m.content));
      if (calculo) return calculo;
    }

    // El resto de RENACE IA conserva su búsqueda documental normal.
    const consulta = userMessages.slice(-4).map((m) => m.content.slice(0, 600)).join(". ");
    const resultados = await (env as SearchEnv).RENACE_SEARCH.search({
      messages: [{ role: "user", content: consulta.slice(0, 1900) }],
    });
    const fuentes = (resultados.chunks ?? [])
      .filter((c) => typeof c.text === "string" && typeof c.item?.key === "string"
        && typeof c.score === "number" && c.score >= 0.35
        && !/SIMULADOR JUBILACION 2014/i.test(c.item.key))
      .sort((a,b) => b.score-a.score)
      .slice(0,6);
    const contexto = fuentes.length
      ? fuentes.map((f,i) => `FUENTE ${i+1}\nDocumento: ${f.item.key}\nExtracto:\n${f.text.slice(0,2400)}`).join("\n\n---\n\n")
      : "No se encontraron fragmentos pertinentes.";
    const instrucciones = `${SYSTEM_PROMPT}\n\nDOCUMENTOS RECUPERADOS:\n${contexto}\n\nResponde brevemente, sin inventar fundamentos. Incluye la fuente si utilizas documentos.`;
    const messages: ChatMessage[] = [{ role: "system", content: instrucciones }, ...history];
    const inputs = { messages, max_tokens: 450, stream: true } satisfies AiTextGenerationInput & { stream: true };
    const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  } catch {
    // No incluir contenido de consultas en registros.
    console.error("Error al atender una consulta de RENACE IA.");
    return Response.json({ error: "No fue posible atender la consulta." }, { status: 503 });
  }
}
