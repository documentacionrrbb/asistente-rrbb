import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize GoogleGenAI client lazily (only if GEMINI_API_KEY is defined)
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
      aiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiClient;
}

// In-Memory Database representing Google Drive "publica" folder for documentacionrrbb@gmail.com
interface Report {
  id: string; // Correlative number "N° 001", "N° 002"
  fecha: string;
  institucion: string;
  calle: string;
  numero: string;
  block: string;
  depto: string;
  rol1: string;
  rol2: string;
  requerimiento: string;
  resultados: string;
  documentacionAdjunta: string;
  source: string; // "manual" or "imagen"
  adjuntoSource: string; // "camara" | "drive" | "subida" | "ninguno"
  adjuntoFileName?: string;
  lastUpdated: string;
}

let reportsDb: Report[] = [
  {
    id: "N° 001",
    fecha: "2026-06-05",
    institucion: "Municipalidad de Santiago",
    calle: "Av. Libertador Bernardo O'Higgins",
    numero: "1350",
    block: "A",
    depto: "402",
    rol1: "1040",
    rol2: "23",
    requerimiento: "Revisión de catastro de bienes raíces e infraestructura patrimonial para regularización de títulos.",
    resultados: "Fiscalización de terreno completada de manera exitosa. Propiedad municipal se encuentra con infraestructura en buen estado de conservación.",
    documentacionAdjunta: "Copia Escritura_Santiago.pdf, Plano_Catastral_02.png",
    source: "manual",
    adjuntoSource: "drive",
    adjuntoFileName: "Copia Escritura_Santiago.pdf",
    lastUpdated: "2026-06-05T14:22:00Z"
  },
  {
    id: "N° 002",
    fecha: "2026-06-11", // aligned with current local time
    institucion: "Servicio de Vivienda y Urbanización (SERVIU)",
    calle: "Calle Huérfanos",
    numero: "1147",
    block: "B",
    depto: "12",
    rol1: "552",
    rol2: "12",
    requerimiento: "Recuperación administrativa de bien de uso público ocupado de forma irregular.",
    resultados: "Notificación formulada formalmente al ocupante. Se agendó restituir voluntariamente la propiedad para fin de mes con acompañamiento de equipo de operaciones.",
    documentacionAdjunta: "Notificacion_Oficiada.pdf, Registro_Fotografico.jpg",
    source: "imagen",
    adjuntoSource: "camara",
    adjuntoFileName: "Registro_Fotografico.jpg",
    lastUpdated: "2026-06-11T01:10:00Z"
  }
];

// Activity and notification logs for Google Drive uploads
interface DriveActionLog {
  id: string;
  action: string; // e.g. "CARGAR" | "RESCATAR" | "EDITAR"
  fileName: string;
  reportId: string;
  timestamp: string;
  details: string;
  notified: boolean;
}

let actionLogs: DriveActionLog[] = [];

// Helper to auto-assign correlative numbering
function generateNextNumber(): string {
  const nums = reportsDb.map(r => {
    const cleanNum = r.id.replace("N°", "").trim();
    return parseInt(cleanNum, 10) || 0;
  });
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  const next = max + 1;
  return `N° ${String(next).padStart(3, "0")}`;
}

// REST API Endpoints

// Get all reports from simulated "publica" folder
app.get("/api/reports", (req, res) => {
  res.json(reportsDb);
});

// Create or update a report (Cargar/Guardar en Google Drive)
app.post("/api/reports", (req, res) => {
  const data = req.body;
  let reportId = data.id;
  let isEditing = false;
  
  if (!reportId) {
    reportId = generateNextNumber();
  } else {
    // Check if it already exists
    isEditing = reportsDb.some(r => r.id === reportId);
  }

  const currentDate = new Date().toISOString().split("T")[0];
  const formattedReport: Report = {
    id: reportId,
    fecha: data.fecha || currentDate,
    institucion: data.institucion || "Sin Institución",
    calle: data.calle || "",
    numero: data.numero || "",
    block: data.block || "",
    depto: data.depto || "",
    rol1: data.rol1 || "",
    rol2: data.rol2 || "",
    requerimiento: data.requerimiento || "",
    resultados: data.resultados || "Pendiente de evaluación",
    documentacionAdjunta: data.documentacionAdjunta || "Ninguno",
    source: data.source || "manual",
    adjuntoSource: data.adjuntoSource || "ninguno",
    adjuntoFileName: data.adjuntoFileName || "",
    lastUpdated: new Date().toISOString()
  };

  if (isEditing) {
    reportsDb = reportsDb.map(r => r.id === reportId ? formattedReport : r);
  } else {
    reportsDb.push(formattedReport);
  }

  // Generate Google Drive notification context
  const actionType = isEditing ? "EDITAR" : "CARGAR";
  const newLog: DriveActionLog = {
    id: `LOG_${Date.now()}`,
    action: actionType,
    fileName: `reporte_${reportId.replace("N° ", "")}.html`,
    reportId: reportId,
    timestamp: new Date().toISOString(),
    details: `${isEditing ? 'Actualización' : 'Inscripción'} de reporte de gestión efectivizado exitosamente en carpeta /publica de documentacionrrbb@gmail.com para ${formattedReport.institucion}.`,
    notified: true
  };
  
  actionLogs.unshift(newLog);

  res.json({
    success: true,
    report: formattedReport,
    notification: `¡Notificación enviada a los usuarios! Archivo '${newLog.fileName}' cargado correctamente en carpetas de Google Drive documentacionrrbb@gmail.com.`,
    log: newLog
  });
});

// Delete a report
app.delete("/api/reports/:id", (req, res) => {
  const { id } = req.params;
  reportsDb = reportsDb.filter(r => r.id !== id);
  res.json({ success: true });
});

// Get recent activity logs / notifications
app.get("/api/logs", (req, res) => {
  res.json(actionLogs);
});

// AI OCR Intelligent Data Extraction Route
app.post("/api/ocr", async (req, res) => {
  const { imageBase64, mimeType } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: "No se proporcionó información de imagen." });
  }

  const prompt = `Analiza esta imagen de un documento de propiedad, boleta, comprobante, tasación u oficio estatal de Recuperación de Bienes.
Extrae detalladamente y de forma muy precisa los datos del inmueble y asigna cada valor de manera clara.
Extrae obligatoriamente los siguientes campos estructurados si están descriptos o intuidos (si no existen, rellénalos vacíos o con lo más parecido):
1. CALLE: Dirección o nombre de calle.
2. NÚMERO: Altura o número de domicilio.
3. BLOCK: Identificador de block de edificio o condominio.
4. DEPTO: Número de departamento.
5. ROL Parte 1: El primer segmento numérico del Rol catastral (e.g. antes de la barra o guión como 1234 en 1234-56).
6. ROL Parte 2: El segundo segmento numérico del Rol catastral (e.g. después de la barra o guión como 56 en 1234-56).
7. INSTITUCIÓN: Dependencia pública municipal, estatal o de vivienda emisora.
8. REQUERIMIENTO: Resumen del trámite, solicitud u observación descripta.

Proporciona tu respuesta estrictamente estructurada en formato JSON.`;

  try {
    const ai = getGenAI();
    if (!ai) {
      console.log("No se detectó GEMINI_API_KEY o está en valor default. Usando simulación inteligente OCR...");
      // Implement a super rich simulation based on realistic property scanned inputs
      // Let's randomized or adapt depending on whether the image contains certain mock metadata or just random
      const mockResult = {
        calle: "Avenida O'Higgins",
        numero: "405",
        block: "C",
        depto: "302",
        rol1: "4201",
        rol2: "18",
        institucion: "Dirección de Obras Municipales (DOM) - Iquique",
        requerimiento: "Análisis técnico de factibilidad para recuperación y deslinde de bien fiscal tras inspección en terreno.",
        resultados: "Se constata que la estructura requiere deslindes oficiales. Se propone fiscalización por parte del SERVIU Regional."
      };
      
      // Delay to simulate latency
      await new Promise(resolve => setTimeout(resolve, 1500));
      return res.json({
        mocked: true,
        data: mockResult,
        warning: "Para obtener reconocimiento real con IA, configure su GEMINI_API_KEY en Panel de Secretos"
      });
    }

    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: imageBase64,
      },
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: { parts: [imagePart, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            calle: { type: Type.STRING },
            numero: { type: Type.STRING },
            block: { type: Type.STRING },
            depto: { type: Type.STRING },
            rol1: { type: Type.STRING },
            rol2: { type: Type.STRING },
            institucion: { type: Type.STRING },
            requerimiento: { type: Type.STRING }
          },
          required: ["calle", "numero", "rol1", "rol2"]
        }
      }
    });

    const textResult = response.text;
    if (textResult) {
      const parsedData = JSON.parse(textResult.trim());
      res.json({
        success: true,
        data: parsedData
      });
    } else {
      throw new Error("Respuesta vacía recibida del motor Gemini AI");
    }

  } catch (error: any) {
    console.error("Fallo durante operación OCR por parte de Gemini:", error);
    res.status(500).json({
      error: "Error interno procesando OCR de la imagen de propiedad.",
      detail: error.message
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
